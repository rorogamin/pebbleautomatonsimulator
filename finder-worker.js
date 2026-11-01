/**
 * Client-Side In-Browser Finder Web Worker
 * Includes multi-period cycle detector and escaping glider detector.
 */

function getPairs(k) {
    const list = [];
    for (let l = 0; l <= k; l++) {
        for (let r = 0; r <= k - l; r++) {
            list.push([l, r]);
        }
    }
    return list;
}

function verifyIsolatedGlider(pattern, period, dx, dir, L, R, S) {
    if (!pattern || pattern.length === 0 || period <= 0 || period > 64) return null;
    const tape = new Map();
    let totalSum = 0;
    for (let i = 0; i < pattern.length; i++) {
        if (pattern[i] > 0) tape.set(i, pattern[i]);
        totalSum += pattern[i];
    }
    const minOrig = 0;
    const maxOrig = pattern.length - 1;
    let maxRearExc = 0;
    let maxFrontExc = 0;

    for (let s = 0; s < period; s++) {
        const nextTape = new Map();
        let anyMoving = false;
        let actMin = 9999, actMax = -9999;

        for (const [x, v] of tape) {
            if (v <= 0) continue;
            if (L[v] === 255) return null; // unassigned rule
            const l = L[v], r = R[v], stay = S[v];
            if (stay > 0) nextTape.set(x, (nextTape.get(x) || 0) + stay);
            if (l > 0) nextTape.set(x - 1, (nextTape.get(x - 1) || 0) + l);
            if (r > 0) nextTape.set(x + 1, (nextTape.get(x + 1) || 0) + r);
            if (l > 0 || r > 0) {
                anyMoving = true;
                if (x < actMin) actMin = x;
                if (x > actMax) actMax = x;
            }
        }

        if (!anyMoving) return null;

        if (dir === 1) { // R
            const rear = minOrig - actMin;
            if (rear > maxRearExc) maxRearExc = rear;
            const front = actMax - maxOrig;
            if (front > maxFrontExc) maxFrontExc = front;
        } else { // L
            const rear = actMax - maxOrig;
            if (rear > maxRearExc) maxRearExc = rear;
            const front = minOrig - actMin;
            if (front > maxFrontExc) maxFrontExc = front;
        }

        tape = nextTape;
    }

    let finActMin = 9999, finActMax = -9999;
    let curSum = 0;
    for (const [x, v] of tape) {
        if (v > 0) {
            curSum += v;
            if (x < finActMin) finActMin = x;
            if (x > finActMax) finActMax = x;
        }
    }
    if (curSum !== totalSum) return null;
    if (finActMin > finActMax) return null;
    if (finActMin !== minOrig + dx) return null;
    if (finActMax - finActMin + 1 !== pattern.length) return null;

    for (let i = 0; i < pattern.length; i++) {
        if ((tape.get(finActMin + i) || 0) !== pattern[i]) return null;
    }

    return { valid: true, maxRearExc, maxFrontExc };
}

function verifyIsolatedCycler(tapeSliceMap, L, R, S, maxPeriod = 64, dirCheck = 0) {
    if (!tapeSliceMap || tapeSliceMap.size === 0) return null;
    let initMin = 99999, initMax = -99999;
    let allStatic = true;
    for (const [x, v] of tapeSliceMap) {
        if (v > 0) {
            if (x < initMin) initMin = x;
            if (x > initMax) initMax = x;
            if (L[v] === 255) return null;
            if (L[v] > 0 || R[v] > 0) allStatic = false;
        }
    }
    if (allStatic) return { valid: true, period: 0, exc: 0 };

    let curr = new Map(tapeSliceMap);
    let maxRightReach = initMax;
    let minLeftReach = initMin;

    for (let s = 1; s <= maxPeriod; s++) {
        const nextTape = new Map();
        for (const [x, v] of curr) {
            if (v <= 0) continue;
            if (L[v] === 255) return null;
            const l = L[v], r = R[v], stay = S[v];
            if (stay > 0) nextTape.set(x, (nextTape.get(x) || 0) + stay);
            if (l > 0) nextTape.set(x - 1, (nextTape.get(x - 1) || 0) + l);
            if (r > 0) nextTape.set(x + 1, (nextTape.get(x + 1) || 0) + r);
        }
        curr = new Map();
        let curMin = 99999, curMax = -99999;
        for (const [x, v] of nextTape) {
            if (v > 0) {
                curr.set(x, v);
                if (x < curMin) curMin = x;
                if (x > curMax) curMax = x;
            }
        }
        if (curr.size === 0) return null;
        if (curMax > maxRightReach) maxRightReach = curMax;
        if (curMin < minLeftReach) minLeftReach = curMin;

        if (curMin === initMin && curMax === initMax && curr.size === tapeSliceMap.size) {
            let matches = true;
            for (const [x, v] of tapeSliceMap) {
                if (curr.get(x) !== v) { matches = false; break; }
            }
            if (matches) {
                let exc = 0;
                if (dirCheck === 1) exc = maxRightReach - initMax;
                else if (dirCheck === -1) exc = initMin - minLeftReach;
                return { valid: true, period: s, exc };
            }
        }
    }
    return null;
}

self.onmessage = function (e) {
    const { mode, n, maxSteps, duration, id } = e.data;
    const startTime = performance.now();
    let evaluated = 0;
    let leaders = [];

    const recordLeader = (steps, ruleStr) => {
        leaders.push({ steps, rule: ruleStr });
        leaders.sort((a, b) => b.steps - a.steps);
        if (leaders.length > 20) leaders.length = 20;

        self.postMessage({
            type: "champion",
            steps,
            rule: ruleStr,
            elapsed: (performance.now() - startTime) / 1000,
            evaluated
        });
    };

    if (mode === "tree") {
        const UNASSIGNED = 255;
        const L = new Uint8Array(n + 1).fill(UNASSIGNED);
        const R = new Uint8Array(n + 1).fill(UNASSIGNED);
        const S = new Uint8Array(n + 1).fill(UNASSIGNED);

        const pairMap = [];
        for (let k = 1; k <= n; k++) pairMap[k] = getPairs(k);

        const tapeA = new Uint8Array(2048);
        const tapeB = new Uint8Array(2048);
        const MID = 1024;

        const holdouts = [];
        const recordHoldout = () => {
            const ruleStr = [];
            for (let k = 1; k <= n; k++) {
                if (L[k] === UNASSIGNED) ruleStr.push("??");
                else ruleStr.push(L[k].toString(16) + R[k].toString(16));
            }
            if (holdouts.length < 50000) {
                holdouts.push(ruleStr.join("_"));
            }
        };

        function search(currMin, currMax, step, history) {
            evaluated++;
            if (duration > 0 && (evaluated & 0x7FFF) === 0 && (performance.now() - startTime) >= duration * 1000) {
                return;
            }
            if (evaluated % 50000 === 0) {
                const now = performance.now();
                self.postMessage({
                    type: "progress",
                    elapsed: (now - startTime) / 1000,
                    evaluated,
                    rate_m_per_s: (evaluated / (now - startTime)) / 1000,
                    champion: leaders[0]?.steps || 0,
                    holdouts: holdouts.length
                });
            }

            const localHist = history ? [...history] : [];

            while (step < maxSteps) {
                let missingV = -1;
                let anyMoving = false;
                let minMoving = 9999, maxMoving = -9999;
                let minStatic = 9999, maxStatic = -9999;
                let numMoving = 0, numStatic = 0;

                for (let x = currMin; x <= currMax; x++) {
                    const v = tapeA[x];
                    if (v > 0) {
                        if (L[v] === UNASSIGNED) {
                            missingV = v;
                            break;
                        }
                        if (L[v] > 0 || R[v] > 0) {
                            anyMoving = true;
                            numMoving++;
                            if (x < minMoving) minMoving = x;
                            if (x > maxMoving) maxMoving = x;
                        } else {
                            numStatic++;
                            if (x < minStatic) minStatic = x;
                            if (x > maxStatic) maxStatic = x;
                        }
                    }
                }

                if (missingV !== -1) {
                    const choices = pairMap[missingV];
                    for (let i = 0; i < choices.length; i++) {
                        const [l, r] = choices[i];
                        L[missingV] = l;
                        R[missingV] = r;
                        S[missingV] = missingV - l - r;

                        const snapshot = tapeA.slice(currMin, currMax + 1);
                        search(currMin, currMax, step, localHist);
                        tapeA.set(snapshot, currMin);

                        L[missingV] = UNASSIGNED;
                        R[missingV] = UNASSIGNED;
                        S[missingV] = UNASSIGNED;
                    }
                    return;
                }

                if (!anyMoving) {
                    // Halting state reached!
                    const ruleStr = [];
                    for (let k = 1; k <= n; k++) {
                        if (L[k] === UNASSIGNED) ruleStr.push("??");
                        else ruleStr.push(L[k].toString(16) + R[k].toString(16));
                    }
                    recordLeader(step, ruleStr.join("_"));
                    return;
                }

                // Gliders on boundaries
                const leftV = tapeA[currMin];
                if (L[leftV] === leftV && currMin < MID) return;
                const rightV = tapeA[currMax];
                if (R[rightV] === rightV && currMax > MID) return;

                // 1. Full-tape translated cycle check
                let fullKey = "";
                for (let x = currMin; x <= currMax; x++) {
                    if (tapeA[x] > 0) fullKey += `${x - currMin}:${tapeA[x]},`;
                }

                for (let i = 0; i < localHist.length; i++) {
                    if (localHist[i].fullKey === fullKey) {
                        return; // Cycle pruned!
                    }
                }

                // Identify nonzeros outside moving packet
                const leftNZ = [];
                const rightNZ = [];
                let allOtherStatic = true;

                for (let x = currMin; x < minMoving; x++) {
                    const v = tapeA[x];
                    if (v > 0) {
                        leftNZ.push(x);
                        if (L[v] > 0 || R[v] > 0) allOtherStatic = false;
                    }
                }

                for (let x = maxMoving + 1; x <= currMax; x++) {
                    const v = tapeA[x];
                    if (v > 0) {
                        rightNZ.push(x);
                        if (L[v] > 0 || R[v] > 0) allOtherStatic = false;
                    }
                }

                let netL = 0, netR = 0;
                for (let x = minMoving; x <= maxMoving; x++) {
                    const v = tapeA[x];
                    if (v > 0 && L[v] !== UNASSIGNED) { netL += L[v]; netR += R[v]; }
                }

                let bouncerSig = null;
                let bDir = null;
                // 2. Strict Two-Wall Bouncer
                if (allOtherStatic && leftNZ.length > 0 && rightNZ.length > 0) {
                    const lwStart = leftNZ[0];
                    const lwEnd = leftNZ[leftNZ.length - 1];
                    const rwStart = rightNZ[0];
                    const rwEnd = rightNZ[rightNZ.length - 1];

                    if ((lwEnd - lwStart <= 8) && (rwEnd - rwStart <= 8)) {
                        const gapL = minMoving - lwEnd - 1;
                        const gapR = rwStart - maxMoving - 1;
                        if (gapL >= 0 && gapR >= 0) {
                            let bDist = 0;
                            if (netR > 0 && netL === 0 && gapR >= 0) {
                                bDir = 'R'; bDist = minMoving - lwEnd;
                            } else if (netL > 0 && netR === 0 && gapL >= 0) {
                                bDir = 'L'; bDist = rwStart - maxMoving;
                            }

                            if (bDir) {
                                let lwPat = "";
                                for (let x = lwStart; x <= lwEnd; x++) lwPat += `${tapeA[x]},`;
                                let rwPat = "";
                                for (let x = rwStart; x <= rwEnd; x++) rwPat += `${tapeA[x]},`;
                                let shuttle = "";
                                for (let x = minMoving; x <= maxMoving; x++) shuttle += `${tapeA[x]},`;

                                bouncerSig = `${bDir}|${lwPat}|${shuttle}|${rwPat}|${bDist}`;
                                for (let i = 0; i < localHist.length; i++) {
                                    const prev = localHist[i];
                                    if (prev.bouncerSig === bouncerSig) {
                                        const oppSeen = localHist.slice(i + 1).some(cp => cp.bDir && cp.bDir !== bDir);
                                        if (oppSeen && (currMax - currMin) >= (prev.currMax - prev.currMin)) {
                                            return; // Bouncer pruned!
                                        }
                                    }
                                }
                            }
                        }
                    }
                }

                // 3. Open Turnaround Bouncer
                let openBouncerSig = null;
                let openDir = null;
                if (allOtherStatic) {
                    if (leftNZ.length > 0 && rightNZ.length === 0) {
                        const lwStart = leftNZ[0];
                        const lwEnd = leftNZ[leftNZ.length - 1];
                        if (lwEnd - lwStart <= 3 && (minMoving - lwEnd - 1 >= 0)) {
                            if (netL > 0 && netR === 0) {
                                let lwPat = "";
                                for (let x = lwStart; x <= lwEnd; x++) lwPat += `${tapeA[x]},`;
                                let shuttle = "";
                                for (let x = minMoving; x <= maxMoving; x++) shuttle += `${tapeA[x]},`;
                                openBouncerSig = `open_R|${lwPat}|${shuttle}`;
                                openDir = 'R';

                                for (let i = 0; i < localHist.length; i++) {
                                    const prev = localHist[i];
                                    if (prev.openBouncerSig === openBouncerSig && currMin === prev.currMin && currMax > prev.currMax) {
                                        return; // Open Bouncer R pruned!
                                    }
                                }
                            }
                        }
                    }

                    if (rightNZ.length > 0 && leftNZ.length === 0) {
                        const rwStart = rightNZ[0];
                        const rwEnd = rightNZ[rightNZ.length - 1];
                        if (rwEnd - rwStart <= 3 && (rwStart - maxMoving - 1 >= 0)) {
                            if (netR > 0 && netL === 0) {
                                let rwPat = "";
                                for (let x = rwStart; x <= rwEnd; x++) rwPat += `${tapeA[x]},`;
                                let shuttle = "";
                                for (let x = minMoving; x <= maxMoving; x++) shuttle += `${tapeA[x]},`;
                                openBouncerSig = `open_L|${rwPat}|${shuttle}`;
                                openDir = 'L';

                                for (let i = 0; i < localHist.length; i++) {
                                    const prev = localHist[i];
                                    if (prev.openBouncerSig === openBouncerSig && currMax === prev.currMax && currMin < prev.currMin) {
                                        return; // Open Bouncer L pruned!
                                    }
                                }
                            }
                        }
                    }
                }

                // 4. Puffer / Wall-Builder
                let pufferLSig = null, rwStartAnchor = -1;
                let pufferRSig = null, lwEndAnchor = -1;
                if (allOtherStatic) {
                    let shuttle = "";
                    for (let x = minMoving; x <= maxMoving; x++) shuttle += `${tapeA[x]},`;

                    if (rightNZ.length > 0) {
                        rwStartAnchor = rightNZ[0];
                        let rwAnchor = "";
                        for (let x = rwStartAnchor; x <= currMax; x++) rwAnchor += `${x}:${tapeA[x]},`;
                        let lwPat = "";
                        const pEnd = Math.min(maxMoving, currMin + 4);
                        for (let x = currMin; x <= pEnd; x++) lwPat += `${tapeA[x]},`;

                        pufferLSig = `${shuttle}|${lwPat}|${rwAnchor}`;
                        for (let i = 0; i < localHist.length; i++) {
                            const prev = localHist[i];
                            if (prev.pufferLSig === pufferLSig && prev.rwStartAnchor === rwStartAnchor) {
                                const dx = minMoving - prev.minMoving;
                                if (dx < 0 && currMax === prev.currMax && (currMin - prev.currMin === dx)) {
                                    let maxReach = -9999;
                                    for (let j = i; j < localHist.length; j++) {
                                        if (localHist[j].maxMoving > maxReach) maxReach = localHist[j].maxMoving;
                                    }
                                    if (maxMoving > maxReach) maxReach = maxMoving;
                                    if (maxReach < rwStartAnchor) {
                                        return; // Wall-builder L pruned!
                                    }
                                }
                            }
                        }
                    }

                    if (leftNZ.length > 0) {
                        lwEndAnchor = leftNZ[leftNZ.length - 1];
                        let lwAnchor = "";
                        for (let x = currMin; x <= lwEndAnchor; x++) lwAnchor += `${x}:${tapeA[x]},`;
                        let rwPat = "";
                        const pStart = Math.max(minMoving, currMax - 4);
                        for (let x = pStart; x <= currMax; x++) rwPat += `${tapeA[x]},`;

                        pufferRSig = `${shuttle}|${rwPat}|${lwAnchor}`;
                        for (let i = 0; i < localHist.length; i++) {
                            const prev = localHist[i];
                            if (prev.pufferRSig === pufferRSig && prev.lwEndAnchor === lwEndAnchor) {
                                const dx = minMoving - prev.minMoving;
                                if (dx > 0 && currMin === prev.currMin && (currMax - prev.currMax === dx)) {
                                    let minReach = 9999;
                                    for (let j = i; j < localHist.length; j++) {
                                        if (localHist[j].minMoving < minReach) minReach = localHist[j].minMoving;
                                    }
                                    if (minMoving < minReach) minReach = minMoving;
                                    if (minReach > lwEndAnchor) {
                                        return; // Wall-builder R pruned!
                                    }
                                }
                            }
                        }
                    }
                }

                // 5. Strict Escaping Glider (Must be at edge and sole active)
                let rcKey = null, lcKey = null;
                if (allOtherStatic) {
                    const patLen = maxMoving - minMoving + 1;
                    if (currMax === maxMoving && patLen <= 32) {
                        const rcPat = [];
                        for (let x = minMoving; x <= maxMoving; x++) rcPat.push(tapeA[x]);
                        rcKey = rcPat.join(',');

                        for (let i = 0; i < localHist.length; i++) {
                            const prev = localHist[i];
                            if (prev.rcKey === rcKey) {
                                const dx = minMoving - prev.minMoving;
                                const period = step - prev.step;
                                if (dx > 0 && period > 0 && period <= 64) {
                                    const iso = verifyIsolatedGlider(rcPat, period, dx, 1, L, R, S);
                                    const gap = leftNZ.length > 0 ? (minMoving - leftNZ[leftNZ.length - 1]) : 9999;
                                    if (iso && iso.valid && gap > iso.maxRearExc) {
                                        return; // Right glider pruned!
                                    }
                                }
                            }
                        }
                    }

                    if (currMin === minMoving && patLen <= 32) {
                        const lcPat = [];
                        for (let x = minMoving; x <= maxMoving; x++) lcPat.push(tapeA[x]);
                        lcKey = lcPat.join(',');

                        for (let i = 0; i < localHist.length; i++) {
                            const prev = localHist[i];
                            if (prev.lcKey === lcKey) {
                                const dx = minMoving - prev.minMoving;
                                const period = step - prev.step;
                                if (dx < 0 && period > 0 && period <= 64) {
                                    const iso = verifyIsolatedGlider(lcPat, period, dx, 0, L, R, S);
                                    const gap = rightNZ.length > 0 ? (rightNZ[0] - maxMoving) : 9999;
                                    if (iso && iso.valid && gap > iso.maxRearExc) {
                                        return; // Left glider pruned!
                                    }
                                }
                            }
                        }
                    }
                }

                // 6. Disconnected Right Island Glider
                let rPktMax = currMax;
                let rPktMin = rPktMax;
                let rZeroRun = 0;
                let rLeftAnchor = null;
                for (let x = currMax - 1; x >= currMin; x--) {
                    if (tapeA[x] === 0) {
                        rZeroRun++;
                    } else {
                        if (rZeroRun >= 2) {
                            rLeftAnchor = x;
                            break;
                        } else {
                            rZeroRun = 0;
                            rPktMin = x;
                            if (rPktMax - rPktMin + 1 > 32) break;
                        }
                    }
                }
                let rIslandKey = null;
                if (rLeftAnchor !== null) {
                    const rPatLen = rPktMax - rPktMin + 1;
                    if (rPatLen <= 32) {
                        let hasM = false;
                        for (let x = rPktMin; x <= rPktMax; x++) {
                            const v = tapeA[x];
                            if (v > 0 && (L[v] > 0 || R[v] > 0)) { hasM = true; break; }
                        }
                        if (hasM) {
                            const rPat = [];
                            for (let x = rPktMin; x <= rPktMax; x++) rPat.push(tapeA[x]);
                            rIslandKey = rPat.join(',');
                            for (let i = 0; i < localHist.length; i++) {
                                const prev = localHist[i];
                                if (prev.rIslandKey === rIslandKey) {
                                    const period = step - prev.step;
                                    const dx = rPktMin - prev.rPktMin;
                                    if (dx > 0 && period > 0 && period <= 64) {
                                        const iso = verifyIsolatedGlider(rPat, period, dx, 1, L, R, S);
                                        if (iso && iso.valid) {
                                            const leftSlice = new Map();
                                            for (let x = currMin; x <= rLeftAnchor; x++) {
                                                if (tapeA[x] > 0) leftSlice.set(x, tapeA[x]);
                                            }
                                            const cyc = verifyIsolatedCycler(leftSlice, L, R, S, 64, 1);
                                            if (cyc && cyc.valid && cyc.exc <= 0) {
                                                const gap = rPktMin - rLeftAnchor - 1;
                                                if (gap >= iso.maxRearExc) {
                                                    return; // Disconnected Right Glider pruned!
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }

                // 7. Disconnected Left Island Glider
                let lPktMin = currMin;
                let lPktMax = lPktMin;
                let lZeroRun = 0;
                let lRightAnchor = null;
                for (let x = currMin + 1; x <= currMax; x++) {
                    if (tapeA[x] === 0) {
                        lZeroRun++;
                    } else {
                        if (lZeroRun >= 2) {
                            lRightAnchor = x;
                            break;
                        } else {
                            lZeroRun = 0;
                            lPktMax = x;
                            if (lPktMax - lPktMin + 1 > 32) break;
                        }
                    }
                }
                let lIslandKey = null;
                if (lRightAnchor !== null) {
                    const lPatLen = lPktMax - lPktMin + 1;
                    if (lPatLen <= 32) {
                        let hasM = false;
                        for (let x = lPktMin; x <= lPktMax; x++) {
                            const v = tapeA[x];
                            if (v > 0 && (L[v] > 0 || R[v] > 0)) { hasM = true; break; }
                        }
                        if (hasM) {
                            const lPat = [];
                            for (let x = lPktMin; x <= lPktMax; x++) lPat.push(tapeA[x]);
                            lIslandKey = lPat.join(',');
                            for (let i = 0; i < localHist.length; i++) {
                                const prev = localHist[i];
                                if (prev.lIslandKey === lIslandKey) {
                                    const period = step - prev.step;
                                    const dx = lPktMin - prev.lPktMin;
                                    if (dx < 0 && period > 0 && period <= 64) {
                                        const iso = verifyIsolatedGlider(lPat, period, dx, 0, L, R, S);
                                        if (iso && iso.valid) {
                                            const rightSlice = new Map();
                                            for (let x = lRightAnchor; x <= currMax; x++) {
                                                if (tapeA[x] > 0) rightSlice.set(x, tapeA[x]);
                                            }
                                            const cyc = verifyIsolatedCycler(rightSlice, L, R, S, 64, -1);
                                            if (cyc && cyc.valid && cyc.exc <= 0) {
                                                const gap = lRightAnchor - lPktMax - 1;
                                                if (gap >= iso.maxRearExc) {
                                                    return; // Disconnected Left Glider pruned!
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }

                // 8. Dual Gliders Check (Combined Left & Right Islands)
                if (lIslandKey && rIslandKey && lPktMax < rPktMin) {
                    let midEmpty = true;
                    let midStatic = true;
                    for (let x = lPktMax + 1; x < rPktMin; x++) {
                        const v = tapeA[x];
                        if (v > 0) {
                            midEmpty = false;
                            if (L[v] > 0 || R[v] > 0) { midStatic = false; break; }
                        }
                    }
                    if (midStatic) {
                        for (let i = 0; i < localHist.length; i++) {
                            const prev = localHist[i];
                            if (prev.lIslandKey === lIslandKey && prev.rIslandKey === rIslandKey) {
                                const period = step - prev.step;
                                const dxL = lPktMin - prev.lPktMin;
                                const dxR = rPktMin - prev.rPktMin;
                                if (period > 0 && period <= 64 && (dxL !== 0 || dxR !== 0)) {
                                    const lPat = [];
                                    for (let x = lPktMin; x <= lPktMax; x++) lPat.push(tapeA[x]);
                                    const rPat = [];
                                    for (let x = rPktMin; x <= rPktMax; x++) rPat.push(tapeA[x]);

                                    const isoL = (dxL !== 0) ? verifyIsolatedGlider(lPat, period, dxL, 0, L, R, S) : null;
                                    const isoR = (dxR !== 0) ? verifyIsolatedGlider(rPat, period, dxR, 1, L, R, S) : null;

                                    const gap = rPktMin - lPktMax - 1;
                                    // Opposite directions
                                    if (isoL && isoR && dxL < 0 && dxR > 0) {
                                        if (gap >= isoL.maxRearExc + isoR.maxRearExc) {
                                            return; // Pruned!
                                        }
                                    }
                                    // Dual leftward (v_left >= v_right)
                                    else if (isoL && isoR && dxL < 0 && dxR < 0 && midEmpty) {
                                        if (Math.abs(dxL) >= Math.abs(dxR) && gap >= isoL.maxRearExc + isoR.maxFrontExc + 2) {
                                            return; // Pruned!
                                        }
                                    }
                                    // Dual rightward (v_right >= v_left)
                                    else if (isoL && isoR && dxL > 0 && dxR > 0 && midEmpty) {
                                        if (dxR >= dxL && gap >= isoR.maxRearExc + isoL.maxFrontExc + 2) {
                                            return; // Pruned!
                                        }
                                    }
                                }
                            }
                        }
                    }
                }

                // 9. Multi-Island Decider (M >= 2: Tripled, Quadrupled Gliders/Cyclers)
                const islands = [];
                let cStart = currMin, cEnd = currMin;
                let zeroGap = 0;
                for (let x = currMin + 1; x <= currMax; x++) {
                    if (tapeA[x] === 0) {
                        zeroGap++;
                    } else {
                        if (zeroGap >= 2) {
                            if (islands.length < 8) islands.push([cStart, cEnd]);
                            cStart = x; cEnd = x;
                        } else {
                            cEnd = x;
                        }
                        zeroGap = 0;
                    }
                }
                if (islands.length < 8) islands.push([cStart, cEnd]);

                let mComboKey = null;
                const mCoords = islands.map(([s]) => s);
                if (islands.length >= 2 && islands.length <= 8) {
                    const pats = islands.map(([s, e]) => {
                        let p = "";
                        for (let x = s; x <= e; x++) p += `${tapeA[x]},`;
                        return p;
                    });
                    mComboKey = `${islands.length}|${pats.join(';')}`;

                    for (let i = 0; i < localHist.length; i++) {
                        const prev = localHist[i];
                        if (prev.mComboKey === mComboKey) {
                            const period = step - prev.step;
                            if (period > 0 && period <= 64) {
                                const dxs = mCoords.map((x, idx) => x - prev.mCoords[idx]);
                                const isos = [];
                                let allValid = true;

                                for (let m = 0; m < islands.length; m++) {
                                    const [s, e] = islands[m];
                                    const pat = [];
                                    for (let x = s; x <= e; x++) pat.push(tapeA[x]);
                                    const dx = dxs[m];
                                    if (dx !== 0) {
                                        const iso = verifyIsolatedGlider(pat, period, dx, dx > 0 ? 1 : 0, L, R, S);
                                        if (!iso || !iso.valid) { allValid = false; break; }
                                        isos.push({ rear: iso.maxRearExc, front: iso.maxFrontExc });
                                    } else {
                                        const islSlice = new Map();
                                        for (let x = s; x <= e; x++) {
                                            if (tapeA[x] > 0) islSlice.set(x, tapeA[x]);
                                        }
                                        const cyc = verifyIsolatedCycler(islSlice, L, R, S, 64, 0);
                                        if (!cyc || !cyc.valid) { allValid = false; break; }
                                        isos.push({ rear: cyc.exc, front: cyc.exc });
                                    }
                                }

                                if (allValid) {
                                    let safe = true;
                                    for (let k = 0; k < islands.length - 1; k++) {
                                        if (dxs[k + 1] < dxs[k]) { safe = false; break; }
                                        const gap = islands[k + 1][0] - islands[k][1] - 1;
                                        const dx_k = dxs[k];
                                        const dx_k1 = dxs[k + 1];
                                        if (dx_k <= 0 && dx_k1 >= 0) {
                                            if (gap < isos[k].rear + isos[k + 1].rear) { safe = false; break; }
                                        } else if (dx_k < 0 && dx_k1 < 0) {
                                            if (gap < isos[k].rear + isos[k + 1].front + 2) { safe = false; break; }
                                        } else if (dx_k > 0 && dx_k1 > 0) {
                                            if (gap < isos[k + 1].rear + isos[k].front + 2) { safe = false; break; }
                                        }
                                    }
                                    if (safe) {
                                        return; // Multi-island cycler / glider pruned!
                                    }
                                }
                            }
                        }
                    }
                }

                // 10. Expanding / Translating Turnaround Bouncer (Moving Cycler Walls)
                let tbLwEnd = currMin;
                let tbZRun = 0;
                for (let x = currMin + 1; x <= currMax; x++) {
                    if (tapeA[x] === 0) {
                        tbZRun++;
                        if (tbZRun >= 2) break;
                    } else {
                        tbZRun = 0;
                        tbLwEnd = x;
                        if (tbLwEnd - currMin + 1 > 8) break;
                    }
                }

                let tbRwStart = currMax;
                tbZRun = 0;
                for (let x = currMax - 1; x >= currMin; x--) {
                    if (tapeA[x] === 0) {
                        tbZRun++;
                        if (tbZRun >= 2) break;
                    } else {
                        tbZRun = 0;
                        tbRwStart = x;
                        if (currMax - tbRwStart + 1 > 8) break;
                    }
                }

                let hasTransBouncer = false;
                let tbSig = null, tbDir = null, tbGap = 0;

                if (tbLwEnd < tbRwStart && (tbRwStart - tbLwEnd - 1 >= 2)) {
                    let tbMidEmpty = true;
                    for (let x = tbLwEnd + 1; x < tbRwStart; x++) {
                        if (tapeA[x] > 0) { tbMidEmpty = false; break; }
                    }
                    if (tbMidEmpty) {
                        const lwPat = [];
                        for (let x = currMin; x <= tbLwEnd; x++) lwPat.push(tapeA[x]);
                        const rwPat = [];
                        for (let x = tbRwStart; x <= currMax; x++) rwPat.push(tapeA[x]);
                        tbGap = tbRwStart - tbLwEnd - 1;
                        tbDir = (netR > netL) ? 'R' : ((netL > netR) ? 'L' : 'N');
                        tbSig = `${tbDir}|${lwPat.join(',')}|${rwPat.join(',')}`;

                        for (let i = 0; i < localHist.length; i++) {
                            const prev = localHist[i];
                            if (prev.tbSig === tbSig && tbGap >= prev.tbGap) {
                                const oppSeen = localHist.slice(i + 1).some(cp => cp.tbDir && cp.tbDir !== 'N' && cp.tbDir !== tbDir);
                                if (oppSeen) {
                                    let rwIsGlider = false;
                                    for (let p = 1; p <= 8; p++) {
                                        for (let dx = 1; dx <= p; dx++) {
                                            const iso = verifyIsolatedGlider(rwPat, p, dx, 1, L, R, S);
                                            if (iso && iso.valid && iso.maxRearExc === 0) {
                                                rwIsGlider = true; break;
                                            }
                                        }
                                        if (rwIsGlider) break;
                                    }
                                    if (rwIsGlider) continue;

                                    let lwIsGlider = false;
                                    for (let p = 1; p <= 8; p++) {
                                        for (let dx = 1; dx <= p; dx++) {
                                            const iso = verifyIsolatedGlider(lwPat, p, -dx, 0, L, R, S);
                                            if (iso && iso.valid && iso.maxRearExc === 0) {
                                                lwIsGlider = true; break;
                                            }
                                        }
                                        if (lwIsGlider) break;
                                    }
                                    if (lwIsGlider) continue;

                                    return; // Expanding Translating Bouncer pruned!
                                }
                            }
                        }
                        hasTransBouncer = true;
                    }
                }

                localHist.push({
                    step, fullKey, currMin, currMax, minMoving, maxMoving,
                    bouncerSig, bDir,
                    openBouncerSig, openDir,
                    pufferLSig, rwStartAnchor,
                    pufferRSig, lwEndAnchor,
                    rcKey, lcKey,
                    rIslandKey, rPktMin, rPktMax,
                    lIslandKey, lPktMin, lPktMax,
                    mComboKey, mCoords,
                    hasTransBouncer, tbSig, tbDir, tbGap
                });
                if (localHist.length > 100) localHist.shift();

                // Step forward
                let newMin = currMin - 1;
                let newMax = currMax + 1;
                if (newMin <= 2 || newMax >= 2045) return;

                tapeB.fill(0, newMin, newMax + 1);

                for (let x = currMin; x <= currMax; x++) {
                    const v = tapeA[x];
                    if (v === 0) continue;
                    const l = L[v], r = R[v], s = S[v];
                    if (s > 0) tapeB[x] += s;
                    if (l > 0) tapeB[x - 1] += l;
                    if (r > 0) tapeB[x + 1] += r;
                }

                while (newMin <= newMax && tapeB[newMin] === 0) newMin++;
                if (newMin > newMax) return;
                while (newMax >= newMin && tapeB[newMax] === 0) newMax--;

                tapeA.set(tapeB.subarray(newMin, newMax + 1), newMin);
                currMin = newMin;
                currMax = newMax;
                step++;
            }

            // Exited loop without halting or decider pruning -> Holdout!
            recordHoldout();
        }

        const topPairs = pairMap[n];
        for (let i = 0; i < topPairs.length; i++) {
            if (duration > 0 && (performance.now() - startTime) >= duration * 1000) break;
            const [topL, topR] = topPairs[i];
            if (topL > topR) continue;
            if (topL === 0 && topR === n) continue;

            L.fill(UNASSIGNED);
            R.fill(UNASSIGNED);
            S.fill(UNASSIGNED);

            L[n] = topL;
            R[n] = topR;
            S[n] = n - topL - topR;

            tapeA.fill(0);
            tapeA[MID] = n;
            search(MID, MID, 0, []);
        }

        if (holdouts.length > 0) {
            self.postMessage({
                type: "holdout_samples",
                count: holdouts.length,
                samples: holdouts.slice(0, 100),
                all_holdouts: holdouts
            });
        }

        self.postMessage({
            type: "done",
            elapsed: (performance.now() - startTime) / 1000,
            evaluated,
            champion_steps: leaders[0]?.steps || 0,
            champion_rule: leaders[0]?.rule || "",
            holdouts: holdouts.length
        });
        return;
    } else {
        // Heuristic Search
        const endTime = duration > 0 ? (startTime + duration * 1000) : Infinity;
        const pairMap = [];
        for (let k = 1; k <= n; k++) pairMap[k] = getPairs(k);

        const L = new Uint8Array(n + 1);
        const R = new Uint8Array(n + 1);
        const S = new Uint8Array(n + 1);

        for (let k = 1; k <= n; k++) {
            const p = pairMap[k][Math.floor(Math.random() * pairMap[k].length)];
            L[k] = p[0]; R[k] = p[1]; S[k] = k - p[0] - p[1];
        }
        L[1] = 0; R[1] = 0; S[1] = 1;

        let bestScore = 0;
        const tapeA = new Uint8Array(2048);
        const tapeB = new Uint8Array(2048);
        const MID = 1024;
        const holdouts = [];

        while (performance.now() < endTime) {
            evaluated++;
            const candL = new Uint8Array(L);
            const candR = new Uint8Array(R);
            const candS = new Uint8Array(S);

            const numMut = 1 + Math.floor(Math.random() * 3);
            for (let m = 0; m < numMut; m++) {
                const k = 1 + Math.floor(Math.random() * n);
                const p = pairMap[k][Math.floor(Math.random() * pairMap[k].length)];
                candL[k] = p[0]; candR[k] = p[1]; candS[k] = k - p[0] - p[1];
            }
            candL[1] = 0; candR[1] = 0; candS[1] = 1;

            tapeA.fill(0);
            tapeA[MID] = n;
            let minX = MID, maxX = MID;
            let step = 0;
            let halted = false;

            while (step < maxSteps) {
                let moving = false;
                for (let x = minX; x <= maxX; x++) {
                    const v = tapeA[x];
                    if (v > 0 && (candL[v] > 0 || candR[v] > 0)) {
                        moving = true; break;
                    }
                }
                if (!moving) { halted = true; break; }

                if (candL[tapeA[minX]] === tapeA[minX] && minX < MID) break;
                if (candR[tapeA[maxX]] === tapeA[maxX] && maxX > MID) break;

                let newMin = minX - 1, newMax = maxX + 1;
                if (newMin <= 2 || newMax >= 2045) break;
                tapeB.fill(0, newMin, newMax + 1);

                for (let x = minX; x <= maxX; x++) {
                    const v = tapeA[x];
                    if (v === 0) continue;
                    const l = candL[v], r = candR[v], s = candS[v];
                    if (s > 0) tapeB[x] += s;
                    if (l > 0) tapeB[x - 1] += l;
                    if (r > 0) tapeB[x + 1] += r;
                }

                while (newMin <= newMax && tapeB[newMin] === 0) newMin++;
                if (newMin > newMax) { halted = true; step++; break; }
                while (newMax >= newMin && tapeB[newMax] === 0) newMax--;

                tapeA.set(tapeB.subarray(newMin, newMax + 1), newMin);
                minX = newMin; maxX = newMax;
                step++;
            }

            if (halted && step > 0) {
                const ruleParts = [];
                for (let k = 1; k <= n; k++) ruleParts.push(candL[k].toString(16) + candR[k].toString(16));
                const ruleStr = ruleParts.join("_");
                recordLeader(step, ruleStr);

                if (step >= bestScore) {
                    bestScore = step;
                    L.set(candL); R.set(candR); S.set(candS);
                }
            } else if (!halted && step >= maxSteps) {
                const ruleParts = [];
                for (let k = 1; k <= n; k++) ruleParts.push(candL[k].toString(16) + candR[k].toString(16));
                const ruleStr = ruleParts.join("_");
                if (holdouts.length < 50000) holdouts.push(ruleStr);
            }

            if (evaluated % 5000 === 0) {
                const now = performance.now();
                self.postMessage({
                    type: "progress",
                    elapsed: (now - startTime) / 1000,
                    evaluated,
                    rate_m_per_s: (evaluated / (now - startTime)) / 1000,
                    champion: leaders[0]?.steps || 0,
                    holdouts: holdouts.length
                });
            }
        }

        if (holdouts.length > 0) {
            self.postMessage({
                type: "holdout_samples",
                count: holdouts.length,
                samples: holdouts.slice(0, 100),
                all_holdouts: holdouts
            });
        }

        self.postMessage({
            type: "done",
            elapsed: (performance.now() - startTime) / 1000,
            evaluated,
            champion_steps: leaders[0]?.steps || 0,
            champion_rule: leaders[0]?.rule || "",
            holdouts: holdouts.length
        });
    }
};
