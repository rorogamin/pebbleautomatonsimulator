/**
 * Pebble Automaton Engine & Simulator Core
 * Supports arbitrary n, custom initial tapes, step-by-step execution,
 * cycle detection, glider detection, presets, and color palettes.
 */

export class CompactTape {
    constructor(xs, vs, len = xs.length) {
        this.xs = xs;
        this.vs = vs;
        this.len = len;
    }
    get size() {
        return this.len;
    }
    get(x) {
        const xs = this.xs;
        let lo = 0, hi = this.len - 1;
        while (lo <= hi) {
            const mid = (lo + hi) >>> 1;
            const mx = xs[mid];
            if (mx === x) return this.vs[mid];
            if (mx < x) lo = mid + 1;
            else hi = mid - 1;
        }
        return undefined;
    }
    has(x) {
        return this.get(x) !== undefined;
    }
    *[Symbol.iterator]() {
        const xs = this.xs, vs = this.vs, len = this.len;
        for (let i = 0; i < len; i++) {
            yield [xs[i], vs[i]];
        }
    }
    entries() {
        return this[Symbol.iterator]();
    }
    *keys() {
        const xs = this.xs, len = this.len;
        for (let i = 0; i < len; i++) yield xs[i];
    }
    *values() {
        const vs = this.vs, len = this.len;
        for (let i = 0; i < len; i++) yield vs[i];
    }
}

function createCompactTapeFromSorted(xs, vs, len, maxVal = 255) {
    const cap = Math.max(len, 16);
    const cxs = new Float64Array(cap);
    const cvs = maxVal <= 255 ? new Uint8Array(cap) : new Int16Array(cap);
    for (let i = 0; i < len; i++) {
        cxs[i] = xs[i];
        cvs[i] = vs[i];
    }
    return new CompactTape(cxs, cvs, len);
}

function createCompactTapeFromMap(tapeMap, maxVal = 255) {
    const entries = [];
    for (const [x, v] of tapeMap) {
        if (v > 0) entries.push([x, v]);
    }
    entries.sort((a, b) => a[0] - b[0]);
    const len = entries.length;
    const cap = Math.max(len, 16);
    const cxs = new Float64Array(cap);
    const cvs = maxVal <= 255 ? new Uint8Array(cap) : new Int16Array(cap);
    for (let i = 0; i < len; i++) {
        cxs[i] = entries[i][0];
        cvs[i] = entries[i][1];
    }
    return new CompactTape(cxs, cvs, len);
}


export class HyperStep {
    // Represents cosmological numbers in tower form with live multipliers:
    // tower 0: exact standard number
    // tower 1: count * 10^exp (e.g. 7,324,123 * 10^100)
    // tower 2: count * 10^(10^exp) (e.g. 7,324,123 * 10^10^100)
    // tower >= 3: count * 10^^tower (e.g. 7,324,123 * 10^^100)
    constructor(tower = 0, exp = 0, mantissa = 1.0, count = 1) {
        this.tower = tower;
        this.exp = exp;
        this.mantissa = mantissa;
        this.count = count;
    }

    static fromNumber(n) {
        if (typeof n === "bigint") {
            const str = n.toString();
            if (str.length <= 15) return new HyperStep(0, 0, Number(n), 1);
            return new HyperStep(1, str.length - 1, Number(str[0] + "." + str.slice(1, 15)), 1);
        }
        if (n < 1e15) return new HyperStep(0, 0, n, 1);
        const exp = Math.floor(Math.log10(n));
        const mant = n / Math.pow(10, exp);
        return new HyperStep(1, exp, mant, 1);
    }

    static fromString(str) {
        if (!str) return new HyperStep(0, 0, 0, 1);
        str = String(str).trim().toLowerCase();
        let count = 1;
        if (str.includes("*") || str.includes("×")) {
            const parts = str.split(/[*×]/);
            count = parseInt(parts[0].replace(/,/g, "").trim(), 10) || 1;
            str = parts[1].trim();
        }

        if (str === "googol" || str === "10^100" || str === "1e100") {
            return new HyperStep(1, 100, 1.0, count);
        }
        if (str === "googolplex" || str === "10^10^100" || str === "10^(10^100)") {
            return new HyperStep(2, 100, 1.0, count);
        }
        if (str === "10^^100" || str === "10^^(100)") {
            return new HyperStep(100, 1, 1.0, count);
        }
        if (str.includes("^^")) {
            const parts = str.split("^^");
            const h = parseInt(parts[1], 10) || 100;
            return new HyperStep(h, 1, 1.0, count);
        }
        if (str.includes("^")) {
            const parts = str.split("^");
            if (parts.length === 2) {
                return new HyperStep(1, parseFloat(parts[1]) || 0, 1.0, count);
            }
            if (parts.length === 3) {
                return new HyperStep(2, parseFloat(parts[2]) || 0, 1.0, count);
            }
        }
        const n = Number(str);
        if (Number.isFinite(n)) return new HyperStep(0, 0, n, 1);
        return new HyperStep(1, 100, 1.0, count);
    }

    sqrt() {
        if (this.tower === 0) {
            return HyperStep.fromNumber(Math.sqrt(this.mantissa * this.count));
        }
        if (this.tower === 1) {
            const newExp = this.exp / 2;
            const newMant = Math.sqrt(this.mantissa * this.count);
            const intExp = Math.floor(newExp);
            const frac = newExp - intExp;
            return new HyperStep(1, intExp, newMant * Math.pow(10, frac), 1);
        }
        if (this.tower === 2) {
            return new HyperStep(2, this.exp - 0.3010299956639812, 1.0, 1);
        }
        return new HyperStep(this.tower, this.exp, this.mantissa, 1);
    }

    log10() {
        if (this.tower === 0) return Math.log10(Math.max(1, this.mantissa * this.count));
        if (this.tower === 1) return this.exp + Math.log10(this.mantissa * this.count);
        if (this.tower === 2) return Math.pow(10, this.exp);
        return Infinity;
    }

    toString() {
        const countPrefix = `${Math.max(1, this.count).toLocaleString()} × `;
        if (this.tower === 0) {
            if (this.mantissa < 1e12) return Math.round(this.mantissa * this.count).toLocaleString();
            return (this.mantissa * this.count).toExponential(2);
        }
        if (this.tower === 1) {
            return countPrefix + "10^" + this.exp;
        }
        if (this.tower === 2) {
            return countPrefix + "10^10^" + Math.round(this.exp);
        }
        return countPrefix + "10^^" + this.tower;
    }

    toShortString() {
        return this.toString();
    }
}

export class PebbleRule {
    constructor(n = 6) {
        this.n = n;
        // rules[k] = { L, S, R } for k = 1..n
        this.rules = {};
        for (let k = 1; k <= n; k++) {
            this.rules[k] = { L: 0, S: k, R: 0 };
        }
    }

    set(k, L, R) {
        if (k < 1 || k > this.n) return;
        L = Math.max(0, Math.min(k, L));
        R = Math.max(0, Math.min(k - L, R));
        const S = k - L - R;
        this.rules[k] = { L, S, R };
    }

    clone() {
        const copy = new PebbleRule(this.n);
        for (let k = 1; k <= this.n; k++) {
            copy.rules[k] = { ...this.rules[k] };
        }
        return copy;
    }

    flipSymmetry() {
        for (let k = 1; k <= this.n; k++) {
            const { L, R } = this.rules[k];
            this.set(k, R, L);
        }
    }

    // Export to short notation: e.g. "00_11_03_21_04" or sparse "2:0,2 84:24,45"
    toShortString(format = "auto") {
        if (format === "sparse") return this.toSparseString();
        if (format === "dense") return this.toDenseString();
        
        // Auto mode: if n > 12 and more than 35% of rules are zeros, use sparse format to avoid lots of zeros
        if (this.n > 12) {
            let zeroCount = 0;
            for (let k = 1; k <= this.n; k++) {
                const r = this.rules[k];
                if (!r || (r.L === 0 && r.R === 0)) zeroCount++;
            }
            if (zeroCount / this.n > 0.35) {
                return this.toSparseString();
            }
        }
        return this.toDenseString();
    }

    // Export dense format: e.g. "00_11_03_21_04" or "0,0_0,2_..."
    toDenseString() {
        const parts = [];
        for (let k = 1; k <= this.n; k++) {
            const r = this.rules[k] || { L: 0, S: k, R: 0 };
            if (this.n < 16 && r.L < 16 && r.R < 16) {
                parts.push(r.L.toString(16) + r.R.toString(16));
            } else {
                parts.push(`${r.L},${r.R}`);
            }
        }
        return parts.join("_");
    }

    // Export sparse format: only outputs active rules (L > 0 or R > 0)
    toSparseString() {
        const parts = [];
        for (let k = 1; k <= this.n; k++) {
            const r = this.rules[k] || { L: 0, S: k, R: 0 };
            if (r.L > 0 || r.R > 0) {
                parts.push(`${k}:${r.L},${r.R}`);
            }
        }
        return parts.length > 0 ? parts.join(" ") : "00";
    }

    // Export to long notation: e.g. "1 --> 0 | 1 | 0\n2 --> 0 | 0 | 2..."
    toLongString() {
        const lines = [];
        for (let k = 1; k <= this.n; k++) {
            const r = this.rules[k] || { L: 0, S: k, R: 0 };
            lines.push(`${k} --> ${r.L} | ${r.S} | ${r.R}`);
        }
        return lines.join("\n");
    }

    // Parse from string (handles short format, hex format, comma format, sparse format, and long wiki format)
    static fromString(str, targetN = null) {
        str = (str || "").trim();
        if (!str) return new PebbleRule(targetN || 6);

        // 1. Long wiki format: "k --> L | S | R" or "k --> L | R"
        if (str.includes("-->")) {
            const lines = str.split(/[\r\n;]+/);
            let maxK = 0;
            const parsedRules = {};
            for (const line of lines) {
                const match = line.match(/(\d+)\s*-->\s*(\d+)\s*(?:\|\s*(\d+)\s*)?\|\s*(\d+)/);
                if (match) {
                    const k = parseInt(match[1]);
                    const L = parseInt(match[2]);
                    const R = parseInt(match[4]);
                    parsedRules[k] = { L, R };
                    if (k > maxK) maxK = k;
                }
            }
            const n = targetN || maxK || 6;
            const pr = new PebbleRule(n);
            for (let k = 1; k <= n; k++) {
                if (parsedRules[k]) {
                    pr.set(k, parsedRules[k].L, parsedRules[k].R);
                }
            }
            return pr;
        }

        // 2. Sparse format: "k:L,R" or "k=L,R" or "k:L,S,R"
        if (/(\d+)\s*[:=]\s*\d+/.test(str)) {
            const re = /(\d+)\s*[:=]\s*(\d+)(?:\s*[,|]\s*(\d+))?(?:\s*[,|]\s*(\d+))?/g;
            let m;
            let maxK = 0;
            const parsedRules = {};
            while ((m = re.exec(str)) !== null) {
                const k = parseInt(m[1]);
                const L = parseInt(m[2]) || 0;
                let R = 0;
                if (m[4] !== undefined) {
                    // k : L , S , R
                    R = parseInt(m[4]) || 0;
                } else if (m[3] !== undefined) {
                    // k : L , R
                    R = parseInt(m[3]) || 0;
                }
                parsedRules[k] = { L, R };
                if (k > maxK) maxK = k;
            }
            const n = targetN || maxK || 6;
            const pr = new PebbleRule(n);
            for (let k = 1; k <= n; k++) {
                if (parsedRules[k]) {
                    pr.set(k, parsedRules[k].L, parsedRules[k].R);
                }
            }
            return pr;
        }

        // 3. Dense format: separated by underscores, spaces, or tabs
        const tokens = str.split(/[_ \t\r\n]+/).filter(t => t.length > 0);
        const n = targetN || tokens.length || 6;
        const pr = new PebbleRule(n);

        for (let i = 0; i < tokens.length && i < n; i++) {
            const k = i + 1;
            const tok = tokens[i];
            if (tok.includes(",")) {
                const [lStr, rStr] = tok.split(",");
                pr.set(k, parseInt(lStr) || 0, parseInt(rStr) || 0);
            } else if (tok.length >= 2) {
                const l = parseInt(tok[0], 16) || 0;
                const r = parseInt(tok[1], 16) || 0;
                pr.set(k, l, r);
            }
        }
        return pr;
    }
}

export class PebbleSimulator {
    constructor(rule, customTape = null) {
        this.setRule(rule);
        this.reset(customTape);
    }

    setRule(rule) {
        this.rule = rule;
        this.n = rule ? rule.n : 1;
    }

    
    advanceCosmic(tower, baseExp, deltaCount = 1, allowContinueAfterDecision = true) {
        if (this.status.startsWith("stabilized") && !allowContinueAfterDecision) {
            return this.stepHyper ? this.stepHyper.toString() : this.step;
        }

        if (!this.stepHyper || this.stepHyper.tower !== tower || this.stepHyper.exp !== baseExp) {
            this.stepHyperCosmic(new HyperStep(tower, baseExp, 1.0, Math.max(1, deltaCount)), allowContinueAfterDecision);
            return this.stepHyper ? this.stepHyper.toString() : this.step;
        }

        if (tower <= 1 && baseExp <= 100) {
            const stepIncrementBig = BigInt(Math.max(1, Math.floor(deltaCount))) * (10n ** BigInt(Math.floor(baseExp)));
            this.stepTurbo(stepIncrementBig, allowContinueAfterDecision, 35);
            if (this.status.startsWith("stabilized")) {
                if (this.stepBig && this.stepBig >= (10n ** 100n)) {
                    this.stepHyper.count = Math.max(1, Number(this.stepBig / (10n ** 100n)));
                    this._updateCosmicBounds(this.stepHyper);
                    return this.stepHyper.toString();
                }
                this.stepHyper = null;
                this.customWidthStr = null;
                this.customRangeStr = null;
                return this.step;
            }
            this.stepHyper.count += deltaCount;
            this._updateCosmicBounds(this.stepHyper);
            return this.stepHyper.toString();
        }

        // For Googolplex (10^10^100) and Tetration (10^^100):
        // Advance the real machine simulation by at least 60% of the current stepBig per frame so the actual rule's
        // space-time diagram continuously evolves, shuttles, and expands live across the entire canvas on every frame!
        const baseChunk = BigInt(Math.max(1, Math.floor(deltaCount))) * (10n ** 100n);
        const curBig = (this.stepBig && this.stepBig > 0n) ? this.stepBig : (10n ** 100n);
        const minVisibleChunk = (curBig * 3n) / 5n;
        let frameCosmicChunk = baseChunk > minVisibleChunk ? baseChunk : minVisibleChunk;
        if (curBig > (10n ** 180n)) {
            // Reset BigInt accumulator cleanly while keeping hyper-step count increasing smoothly
            this.stepBig = 0n;
            this.step = 0;
            this._bigTapeX = null;
            this._bigTapeV = null;
            this._bigTapeLen = 0;
            this.history.length = 0;
            this.historyStride = 1;
            this.tape.clear();
            this.tape.set(0, this.n);
            this.recordHistory();
            frameCosmicChunk = BigInt(Math.max(1, Math.floor(deltaCount))) * (10n ** 100n);
        }
        this.stepTurbo(frameCosmicChunk, allowContinueAfterDecision, 35);
        if (this.status.startsWith("stabilized")) {
            this.stepHyper = null;
            this.customWidthStr = null;
            this.customRangeStr = null;
            return this.step;
        }

        this.stepHyper.count += deltaCount;
        this._updateCosmicBounds(this.stepHyper);
        return this.stepHyper.toString();
    }

    _updateCosmicBounds(targetHyper) {
        if (!targetHyper) return;
        const curStepNum = Math.max(1000, this.step);
        let curMin = 0, curMax = 0;
        if (this.history.length > 0) {
            const lastH = this.history[this.history.length - 1];
            curMin = lastH.minX;
            curMax = lastH.maxX;
        } else {
            let first = true;
            for (const k of this.tape.keys()) {
                if (first) { curMin = k; curMax = k; first = false; }
                else { if (k < curMin) curMin = k; if (k > curMax) curMax = k; }
            }
        }
        const curWidth = Math.max(1, curMax - curMin + 1);
        const isLinearGlider = (curWidth / curStepNum) > 0.15;
        const multCount = Math.max(1, targetHyper.count);

        if (isLinearGlider) {
            const vMin = curMin / curStepNum;
            const vMax = curMax / curStepNum;
            const vW = curWidth / curStepNum;

            if (targetHyper.tower === 1) {
                this.customRangeStr = "[" + (vMin * targetHyper.mantissa * multCount).toExponential(2) + ", " +
                                       (vMax * targetHyper.mantissa * multCount).toExponential(2) + "]";
                this.customWidthStr = (vW * targetHyper.mantissa * multCount).toExponential(2);
            } else if (targetHyper.tower === 2) {
                this.customRangeStr = `[-${multCount.toLocaleString()} × 10^(10^${targetHyper.exp}), +${multCount.toLocaleString()} × 10^(10^${targetHyper.exp})]`;
                this.customWidthStr = `${multCount.toLocaleString()} × 10^(10^${targetHyper.exp})`;
            } else {
                this.customRangeStr = `[-${multCount.toLocaleString()} × 10^^${targetHyper.tower}, +${multCount.toLocaleString()} × 10^^${targetHyper.tower}]`;
                this.customWidthStr = `${multCount.toLocaleString()} × 10^^${targetHyper.tower}`;
            }
        } else {
            const alphaMin = curMin / Math.sqrt(curStepNum);
            const alphaMax = curMax / Math.sqrt(curStepNum);
            const alphaW = curWidth / Math.sqrt(curStepNum);
            const sqrtT = targetHyper.sqrt();
            const sqrtCount = Math.sqrt(multCount);

            if (targetHyper.tower === 1) {
                this.customRangeStr = "[" + (alphaMin * sqrtT.mantissa).toFixed(2) + " × 10^" + sqrtT.exp + ", " +
                                       (alphaMax * sqrtT.mantissa).toFixed(2) + " × 10^" + sqrtT.exp + "]";
                this.customWidthStr = (alphaW * sqrtT.mantissa).toFixed(2) + " × 10^" + sqrtT.exp;
            } else if (targetHyper.tower === 2) {
                this.customRangeStr = `[-${sqrtCount.toFixed(1)} × 10^(10^${sqrtT.exp.toFixed(2)}), +${sqrtCount.toFixed(1)} × 10^(10^${sqrtT.exp.toFixed(2)})]`;
                this.customWidthStr = `${sqrtCount.toFixed(1)} × 10^(10^${sqrtT.exp.toFixed(2)})`;
            } else {
                this.customRangeStr = `[-${sqrtCount.toFixed(1)} × 10^^${targetHyper.tower}, +${sqrtCount.toFixed(1)} × 10^^${targetHyper.tower}]`;
                this.customWidthStr = `${sqrtCount.toFixed(1)} × 10^^${targetHyper.tower}`;
            }
        }
    }

    stepHyperCosmic(targetHyper, allowContinueAfterDecision = false) {
        if (typeof targetHyper === "string") {
            targetHyper = HyperStep.fromString(targetHyper);
        }
        if (this.status.startsWith("stabilized") && !allowContinueAfterDecision) {
            return { status: this.status, step: this.step };
        }

        // 1. For Googol (10^100) or standard targets:
        // Execute stepTurbo directly with true 10^100 BigInt!
        if (targetHyper.tower <= 1 && targetHyper.exp <= 100) {
            const bigTarget = (targetHyper.tower === 0)
                ? BigInt(Math.floor(targetHyper.mantissa * targetHyper.count))
                : (10n ** BigInt(Math.floor(targetHyper.exp))) * BigInt(Math.floor(targetHyper.mantissa * targetHyper.count));
            this.stepTurbo(bigTarget, allowContinueAfterDecision, 3000);
            if (this.status.startsWith("stabilized")) {
                this.stepHyper = null;
                this.customWidthStr = null;
                this.customRangeStr = null;
                return { status: this.status, step: this.step };
            }
            if (this.stepBig >= bigTarget) {
                this.stepHyper = targetHyper;
                this._updateCosmicBounds(targetHyper);
            }
            return { status: this.status, step: this.stepHyper ? this.stepHyper.toString() : this.step };
        }

        // 2. For Googolplex (10^10^100) and Tetration (10^^100):
        // Run stepTurbo with true BigInt to simulate the actual machine (preserving its true multi-wall / dome / glider geometry)
        // and verify whether it stabilizes anywhere up to 10^100+ steps!
        const initialBurst = BigInt(Math.max(1, Math.min(50, targetHyper.count))) * (10n ** 100n);
        this.stepTurbo(initialBurst, allowContinueAfterDecision, 3000);
        if (this.status.startsWith("stabilized")) {
            this.stepHyper = null;
            this.customWidthStr = null;
            this.customRangeStr = null;
            return { status: this.status, step: this.step };
        }

        // 3. Machine is verified active and non-stabilizing past 10^100 steps!
        // Keep the genuine space-time history produced by stepTurbo for this exact rule!
        this.stepHyper = targetHyper;
        this._updateCosmicBounds(targetHyper);
        return { status: this.status, step: this.stepHyper.toString() };
    }
reset(customTape = null) {
        this.step = 0;
        this.stepBig = 0n;
        this.stepHyper = null;
        this.customWidthStr = null;
        this.customRangeStr = null;
        this._bigTapeX = null;
        this._bigTapeV = null;
        this._bigTapeLen = 0;
        this._macroTable = new Map();
        this._totalLeaps = 0n;
        this._totalSparse = 0n;
        this.status = "running"; // running, stabilized, cycle, glider, out_of_bounds
        this.history = []; // Array of { step, tape: Map<x, val>, minX, maxX }
        this.historyStride = 1;
        this.maxHistory = 24000;
        this._turboTapeA = null;
        this._turboTapeB = null;

        // Guarantee that this.n is ALWAYS synced with the current rule's n
        if (this.rule) {
            this.n = this.rule.n;
        }

        // Initial tape: The first pebble at the start of the run must always be the current n!
        this.tape = new Map();
        if (customTape && customTape.length > 0) {
            for (const [x, val] of customTape) {
                if (val > 0) this.tape.set(x, val);
            }
        } else {
            // Exactly n pebbles concentrated at position x = 0
            this.tape.set(0, this.n);
        }
        this.historyMinX = 0;
        this.historyMaxX = 0;

        this.recordHistory();
        this.seenHashes = new Map();
        this._rTrack = new Map();
        this._lTrack = new Map();
        this.bouncerHist = [];
        this.openBouncerHist = [];
        this.pufferLHist = [];
        this.pufferRHist = [];
        this.rGliderHist = [];
        this.lGliderHist = [];
        this.rIslandGliderHist = [];
        this.lIslandGliderHist = [];
        this.multiIslandHist = [];
        this.transBouncerHist = [];
        this.historyMoving = [];
        let minX = 0;
        let first = true;
        for (const k of this.tape.keys()) {
            if (first) { minX = k; first = false; }
            else if (k < minX) minX = k;
        }
        this.seenHashes.set(this.getTapeFingerprint(), { step: 0, minX });
    }

    verifyIsolatedCycler(tapeSliceMap, maxPeriod = 64, dirCheck = 0) {
        if (!tapeSliceMap || tapeSliceMap.size === 0) return null;
        let initMin = 99999, initMax = -99999;
        let allStatic = true;
        for (const [x, v] of tapeSliceMap) {
            if (v > 0) {
                if (x < initMin) initMin = x;
                if (x > initMax) initMax = x;
                const r = this.rule.rules[v];
                if (!r) return null;
                if (r.L > 0 || r.R > 0) allStatic = false;
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
                const r = this.rule.rules[v];
                if (!r) return null;
                const { L, S, R } = r;
                if (S > 0) nextTape.set(x, (nextTape.get(x) || 0) + S);
                if (L > 0) nextTape.set(x - 1, (nextTape.get(x - 1) || 0) + L);
                if (R > 0) nextTape.set(x + 1, (nextTape.get(x + 1) || 0) + R);
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

    verifyIsolatedGlider(pattern, period, dx, dir) {
        if (!pattern || pattern.length === 0 || period <= 0 || period > 64) return null;
        let tape = new Map();
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
                const r = this.rule.rules[v];
                if (!r) return null;
                const { L, S, R } = r;
                if (S > 0) nextTape.set(x, (nextTape.get(x) || 0) + S);
                if (L > 0) nextTape.set(x - 1, (nextTape.get(x - 1) || 0) + L);
                if (R > 0) nextTape.set(x + 1, (nextTape.get(x + 1) || 0) + R);
                if (L > 0 || R > 0) {
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

    getTapeFingerprint() {
        if (this.tape.size === 0) return "empty";
        const keys = Array.from(this.tape.keys()).sort((a, b) => a - b);
        const minX = keys[0];
        // Normalize coordinates relative to minX to detect translated cycles
        return keys.map(k => `${k - minX}:${this.tape.get(k)}`).join(",");
    }

    recordHistory() {
        const compact = createCompactTapeFromMap(this.tape, this.n);
        const len = compact.len;
        const minX = len > 0 ? compact.xs[0] : 0;
        const maxX = len > 0 ? compact.xs[len - 1] : 0;
        this.history.push({
            step: this.step,
            tape: compact,
            minX,
            maxX
        });
    }

    _pushHistorySorted(step, xs, vs, len) {
        const minX = len > 0 ? xs[0] : 0;
        const maxX = len > 0 ? xs[len - 1] : 0;
        if (this.historyMinX === undefined || minX < this.historyMinX) this.historyMinX = minX;
        if (this.historyMaxX === undefined || maxX > this.historyMaxX) this.historyMaxX = maxX;
        if (this._freeHistSlots && this._freeHistSlots.length > 0) {
            const slot = this._freeHistSlots.pop();
            const t = slot.tape;
            if (t.xs.length < len) {
                const cap = Math.max(len, 16);
                t.xs = new Float64Array(cap);
                t.vs = this.n <= 255 ? new Uint8Array(cap) : new Int16Array(cap);
            }
            const cxs = t.xs, cvs = t.vs;
            for (let i = 0; i < len; i++) {
                cxs[i] = xs[i];
                cvs[i] = vs[i];
            }
            t.len = len;
            slot.step = step;
            slot.minX = minX;
            slot.maxX = maxX;
            this.history.push(slot);
        } else {
            this.history.push({
                step,
                tape: createCompactTapeFromSorted(xs, vs, len, this.n),
                minX,
                maxX
            });
        }
    }

    _compactHistoryInPlace() {
        if (!this._freeHistSlots) this._freeHistSlots = [];
        const hist = this.history;
        const free = this._freeHistSlots;
        const hLen = hist.length;
        if (hLen <= 2) return;

        const maxStep = hist[hLen - 1].step;
        const targetKeep = Math.floor(hLen * 0.5);
        const minDt = maxStep / Math.max(1000, targetKeep);

        // Pass 1: Reclaim entries that have become sub-pixel bunched near t=0 as maxStep grew by orders of magnitude
        let writeIdx = 0;
        let lastKeptStep = -Infinity;
        for (let h = 0; h < hLen; h++) {
            const entry = hist[h];
            // Always keep index 0, last index, and a sparse baseline of the first 256 entries
            const isEarlyBaseline = (h < 256 && (h & 3) === 0);
            if (h === 0 || h === hLen - 1 || isEarlyBaseline || (entry.step - lastKeptStep) >= minDt) {
                hist[writeIdx++] = entry;
                lastKeptStep = entry.step;
            } else {
                free.push(entry);
            }
        }
        hist.length = writeIdx;

        // Pass 2: If uniform time spacing meant Pass 1 kept > 65% of entries, decimate evenly by 2x
        if (hist.length > hLen * 0.65) {
            const curLen = hist.length;
            let w2 = 0;
            for (let h = 0; h < curLen; h++) {
                if ((h & 1) === 0 || h === curLen - 1) {
                    hist[w2++] = hist[h];
                } else {
                    free.push(hist[h]);
                }
            }
            hist.length = w2;
        }
    }

    getMemoryUsageBytes() {
        let bytes = 8192; // Fixed register arrays + rule tables
        for (let i = 0; i < this.history.length; i++) {
            const t = this.history[i].tape;
            if (t && t.xs && t.vs) {
                bytes += 32 + (t.len * 9);
            } else if (t && t.size !== undefined) {
                bytes += 96 + t.size * 32;
            }
        }
        return bytes;
    }

    isStabilized() {
        // Stabilized means that applying all rules on the current configuration
        // produces the exact same configuration.
        const nextTape = new Map();
        const addPebble = (x, count) => {
            if (count <= 0) return;
            nextTape.set(x, (nextTape.get(x) || 0) + count);
        };

        for (const [x, val] of this.tape) {
            if (val <= 0) continue;
            const r = this.rule.rules[val] || { L: 0, S: val, R: 0 };
            addPebble(x, r.S);
            addPebble(x - 1, r.L);
            addPebble(x + 1, r.R);
        }

        if (nextTape.size !== this.tape.size) return false;
        for (const [x, val] of this.tape) {
            if (nextTape.get(x) !== val) return false;
        }
        return true;
    }

    stepForward(allowContinueAfterDecision = false) {
        if (this.status !== "running" && !allowContinueAfterDecision) return this.status;
        if (this.status.startsWith("stabilized")) return this.status;

        // Check if stabilized before stepping
        if (this.isStabilized()) {
            this.status = "stabilized";
            return this.status;
        }

        // Advance simulation
        const nextTape = new Map();
        const addPebble = (x, count) => {
            if (count <= 0) return;
            nextTape.set(x, (nextTape.get(x) || 0) + count);
        };

        for (const [x, val] of this.tape) {
            if (val <= 0) continue;
            const r = this.rule.rules[val] || { L: 0, S: val, R: 0 };
            addPebble(x, r.S);
            addPebble(x - 1, r.L);
            addPebble(x + 1, r.R);
        }

        // Check if next configuration is identical to current configuration (stabilized)
        let isConfigSame = (nextTape.size === this.tape.size);
        if (isConfigSame) {
            for (const [x, val] of this.tape) {
                if (nextTape.get(x) !== val) {
                    isConfigSame = false;
                    break;
                }
            }
        }
        if (isConfigSame) {
            this.status = "stabilized";
            return this.status;
        }

        this.tape = nextTape;
        this.step++;
        this.stepBig = (this.stepBig || 0n) + 1n;
        this._bigTapeX = null;
        this.recordHistory();

        // 1. Check if stabilized
        if (this.isStabilized()) {
            this.status = "stabilized";
            return this.status;
        }

        const keys = Array.from(this.tape.keys()).sort((a, b) => a - b);
        if (keys.length === 0) {
            this.status = "stabilized";
            return this.status;
        }
        const minX = keys[0];
        const maxX = keys[keys.length - 1];

        // 2. Global Normalized Cycle Check (stationary or translated)
        const fp = this.getTapeFingerprint();
        if (this.seenHashes.has(fp)) {
            const prev = this.seenHashes.get(fp);
            const period = this.step - prev.step;
            const dx = minX - prev.minX;
            if (dx === 0) {
                if (period === 1) {
                    this.status = "stabilized";
                } else {
                    this.status = `cycle (period ${period})`;
                }
            } else {
                this.status = `translated cycle (period ${period}, shift ${dx > 0 ? '+' : ''}${dx})`;
            }
            return this.status;
        }
        this.seenHashes.set(fp, { step: this.step, minX });

        // Identify moving cells
        const movingCells = [];
        for (const [x, val] of this.tape) {
            if (val <= 0) continue;
            const r = this.rule.rules[val];
            if (r && (r.L > 0 || r.R > 0)) {
                movingCells.push(x);
            }
        }
        movingCells.sort((a, b) => a - b);
        if (movingCells.length === 0) {
            this.status = "stabilized";
            return this.status;
        }
        const minM = movingCells[0];
        const maxM = movingCells[movingCells.length - 1];

        this.historyMoving.push({ step: this.step, minM, maxM });

        // Identify nonzeros outside moving packet
        const leftNZ = [];
        const rightNZ = [];
        let allOtherStatic = true;

        for (let x = minX; x < minM; x++) {
            const v = this.tape.get(x) || 0;
            if (v > 0) {
                leftNZ.push(x);
                const r = this.rule.rules[v];
                if (r && (r.L > 0 || r.R > 0)) allOtherStatic = false;
            }
        }

        for (let x = maxM + 1; x <= maxX; x++) {
            const v = this.tape.get(x) || 0;
            if (v > 0) {
                rightNZ.push(x);
                const r = this.rule.rules[v];
                if (r && (r.L > 0 || r.R > 0)) allOtherStatic = false;
            }
        }

        let netL = 0, netR = 0;
        for (let x = minM; x <= maxM; x++) {
            const v = this.tape.get(x) || 0;
            const r = this.rule.rules[v];
            if (r) { netL += r.L; netR += r.R; }
        }

        // 3. Strict Two-Wall Bouncer
        if (allOtherStatic && leftNZ.length > 0 && rightNZ.length > 0) {
            const lwStart = leftNZ[0];
            const lwEnd = leftNZ[leftNZ.length - 1];
            const rwStart = rightNZ[0];
            const rwEnd = rightNZ[rightNZ.length - 1];

            if ((lwEnd - lwStart <= 8) && (rwEnd - rwStart <= 8)) {
                const gapL = minM - lwEnd - 1;
                const gapR = rwStart - maxM - 1;
                if (gapL >= 0 && gapR >= 0) {
                    let bDir = null;
                    let bDist = 0;
                    if (netR > 0 && netL === 0 && gapR >= 0) {
                        bDir = 'R'; bDist = minM - lwEnd;
                    } else if (netL > 0 && netR === 0 && gapL >= 0) {
                        bDir = 'L'; bDist = rwStart - maxM;
                    }

                    if (bDir) {
                        const lwPat = [];
                        for (let x = lwStart; x <= lwEnd; x++) lwPat.push(this.tape.get(x) || 0);
                        const rwPat = [];
                        for (let x = rwStart; x <= rwEnd; x++) rwPat.push(this.tape.get(x) || 0);
                        const shuttle = [];
                        for (let x = minM; x <= maxM; x++) shuttle.push(this.tape.get(x) || 0);

                        const sig = `${bDir}|${lwPat.join(',')}|${shuttle.join(',')}|${rwPat.join(',')}|${bDist}`;
                        for (let i = 0; i < this.bouncerHist.length; i++) {
                            const prev = this.bouncerHist[i];
                            if (prev.sig === sig) {
                                const oppSeen = this.bouncerHist.slice(i + 1).some(cp => cp.dir !== bDir);
                                if (oppSeen && (maxX - minX) >= (prev.maxX - prev.minX)) {
                                    const period = this.step - prev.step;
                                    this.status = `bouncer (period ${period}, width ${prev.maxX - prev.minX} -> ${maxX - minX})`;
                                    return this.status;
                                }
                            }
                        }
                        this.bouncerHist.push({ sig, dir: bDir, step: this.step, minX, maxX });
                    }
                }
            }
        }

        // 4. Open Turnaround Bouncer (One static wall + open expanding turnaround)
        if (allOtherStatic) {
            if (leftNZ.length > 0 && rightNZ.length === 0) {
                const lwStart = leftNZ[0];
                const lwEnd = leftNZ[leftNZ.length - 1];
                if (lwEnd - lwStart <= 3 && (minM - lwEnd - 1 >= 0)) {
                    if (netL > 0 && netR === 0) {
                        const lwPat = [];
                        for (let x = lwStart; x <= lwEnd; x++) lwPat.push(this.tape.get(x) || 0);
                        const shuttle = [];
                        for (let x = minM; x <= maxM; x++) shuttle.push(this.tape.get(x) || 0);
                        const sig = `open_R|${lwPat.join(',')}|${shuttle.join(',')}`;

                        for (const prev of this.openBouncerHist) {
                            if (prev.sig === sig && minX === prev.minX && maxX > prev.maxX) {
                                const period = this.step - prev.step;
                                this.status = `open bouncer (period ${period}, expansion +${maxX - prev.maxX})`;
                                return this.status;
                            }
                        }
                        this.openBouncerHist.push({ sig, step: this.step, minX, maxX });
                    }
                }
            }

            if (rightNZ.length > 0 && leftNZ.length === 0) {
                const rwStart = rightNZ[0];
                const rwEnd = rightNZ[rightNZ.length - 1];
                if (rwEnd - rwStart <= 3 && (rwStart - maxM - 1 >= 0)) {
                    if (netR > 0 && netL === 0) {
                        const rwPat = [];
                        for (let x = rwStart; x <= rwEnd; x++) rwPat.push(this.tape.get(x) || 0);
                        const shuttle = [];
                        for (let x = minM; x <= maxM; x++) shuttle.push(this.tape.get(x) || 0);
                        const sig = `open_L|${rwPat.join(',')}|${shuttle.join(',')}`;

                        for (const prev of this.openBouncerHist) {
                            if (prev.sig === sig && maxX === prev.maxX && minX < prev.minX) {
                                const period = this.step - prev.step;
                                this.status = `open bouncer (period ${period}, expansion ${minX - prev.minX})`;
                                return this.status;
                            }
                        }
                        this.openBouncerHist.push({ sig, step: this.step, minX, maxX });
                    }
                }
            }
        }

        // 5. Puffer / Wall-Builder
        if (allOtherStatic) {
            const shuttle = [];
            for (let x = minM; x <= maxM; x++) shuttle.push(this.tape.get(x) || 0);
            const shuttleKey = shuttle.join(',');

            // Left expanding away from static right anchor:
            if (rightNZ.length > 0) {
                const rwStart = rightNZ[0];
                const rwAnchor = [];
                for (let x = rwStart; x <= maxX; x++) rwAnchor.push(`${x}:${this.tape.get(x)||0}`);
                const lwPat = [];
                const pEnd = Math.min(maxM, minX + 4);
                for (let x = minX; x <= pEnd; x++) lwPat.push(this.tape.get(x) || 0);

                const sigL = `${shuttleKey}|${lwPat.join(',')}|${rwAnchor.join(',')}`;
                for (const prev of this.pufferLHist) {
                    if (prev.sigL === sigL && prev.rwStart === rwStart) {
                        const dx = minM - prev.minM;
                        if (dx < 0 && maxX === prev.maxX && (minX - prev.minX === dx)) {
                            let maxReach = -99999;
                            for (const h of this.historyMoving.slice(prev.hIdx)) {
                                if (h.maxM > maxReach) maxReach = h.maxM;
                            }
                            if (maxReach < rwStart) {
                                const period = this.step - prev.step;
                                this.status = `wall-builder (leftward, period ${period}, shift ${dx})`;
                                return this.status;
                            }
                        }
                    }
                }
                this.pufferLHist.push({ sigL, minM, minX, maxX, rwStart, step: this.step, hIdx: this.historyMoving.length - 1 });
            }

            // Right expanding away from static left anchor:
            if (leftNZ.length > 0) {
                const lwEnd = leftNZ[leftNZ.length - 1];
                const lwAnchor = [];
                for (let x = minX; x <= lwEnd; x++) lwAnchor.push(`${x}:${this.tape.get(x)||0}`);
                const rwPat = [];
                const pStart = Math.max(minM, maxX - 4);
                for (let x = pStart; x <= maxX; x++) rwPat.push(this.tape.get(x) || 0);

                const sigR = `${shuttleKey}|${rwPat.join(',')}|${lwAnchor.join(',')}`;
                for (const prev of this.pufferRHist) {
                    if (prev.sigR === sigR && prev.lwEnd === lwEnd) {
                        const dx = minM - prev.minM;
                        if (dx > 0 && minX === prev.minX && (maxX - prev.maxX === dx)) {
                            let minReach = 99999;
                            for (const h of this.historyMoving.slice(prev.hIdx)) {
                                if (h.minM < minReach) minReach = h.minM;
                            }
                            if (minReach > lwEnd) {
                                const period = this.step - prev.step;
                                this.status = `wall-builder (rightward, period ${period}, shift +${dx})`;
                                return this.status;
                            }
                        }
                    }
                }
                this.pufferRHist.push({ sigR, minM, minX, maxX, lwEnd, step: this.step, hIdx: this.historyMoving.length - 1 });
            }
        }

        // 6. Strict Escaping Glider (Must be at edge and sole active cluster)
        if (allOtherStatic) {
            const patLen = maxM - minM + 1;
            const pat = [];
            for (let x = minM; x <= maxM; x++) pat.push(this.tape.get(x) || 0);
            const patKey = pat.join(',');

            if (maxM === maxX && patLen <= 32) {
                for (const prev of this.rGliderHist) {
                    if (prev.patKey === patKey) {
                        const dx = minM - prev.minM;
                        const period = this.step - prev.step;
                        if (dx > 0 && period > 0 && period <= 64) {
                            const iso = this.verifyIsolatedGlider(pat, period, dx, 1);
                            const gap = leftNZ.length > 0 ? (minM - leftNZ[leftNZ.length - 1]) : 99999;
                            if (iso && iso.valid && gap > iso.maxRearExc) {
                                this.status = `escaping glider (rightward, period ${period}, shift +${dx})`;
                                return this.status;
                            }
                        }
                    }
                }
                this.rGliderHist.push({ patKey, minM, step: this.step });
            }

            if (minM === minX && patLen <= 32) {
                for (const prev of this.lGliderHist) {
                    if (prev.patKey === patKey) {
                        const dx = minM - prev.minM;
                        const period = this.step - prev.step;
                        if (dx < 0 && period > 0 && period <= 64) {
                            const iso = this.verifyIsolatedGlider(pat, period, dx, 0);
                            const gap = rightNZ.length > 0 ? (rightNZ[0] - maxM) : 99999;
                            if (iso && iso.valid && gap > iso.maxRearExc) {
                                this.status = `escaping glider (leftward, period ${period}, shift ${dx})`;
                                return this.status;
                            }
                        }
                    }
                }
                this.lGliderHist.push({ patKey, minM, step: this.step });
            }
        }

        // 7. Disconnected Right Island Glider
        let rPktMax = maxX;
        let rPktMin = rPktMax;
        let rZeroRun = 0;
        let rLeftAnchor = null;
        for (let x = maxX - 1; x >= minX; x--) {
            const v = this.tape.get(x) || 0;
            if (v === 0) {
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
        if (rLeftAnchor !== null) {
            const rPatLen = rPktMax - rPktMin + 1;
            if (rPatLen <= 32) {
                let hasM = false;
                for (let x = rPktMin; x <= rPktMax; x++) {
                    const v = this.tape.get(x) || 0;
                    const r = this.rule.rules[v];
                    if (r && (r.L > 0 || r.R > 0)) { hasM = true; break; }
                }
                if (hasM) {
                    const rPat = [];
                    for (let x = rPktMin; x <= rPktMax; x++) rPat.push(this.tape.get(x) || 0);
                    const rKey = rPat.join(',');
                    for (const prev of this.rIslandGliderHist) {
                        if (prev.rKey === rKey) {
                            const period = this.step - prev.step;
                            const dx = rPktMin - prev.rPktMin;
                            if (dx > 0 && period > 0 && period <= 64) {
                                const iso = this.verifyIsolatedGlider(rPat, period, dx, 1);
                                if (iso && iso.valid) {
                                    const leftSlice = new Map();
                                    for (let x = minX; x <= rLeftAnchor; x++) {
                                        const v = this.tape.get(x) || 0;
                                        if (v > 0) leftSlice.set(x, v);
                                    }
                                    const cyc = this.verifyIsolatedCycler(leftSlice, 64, 1);
                                    if (cyc && cyc.valid && cyc.exc <= 0) {
                                        const gap = rPktMin - rLeftAnchor - 1;
                                        if (gap >= iso.maxRearExc) {
                                            this.status = `escaping glider (rightward, period ${period}, shift +${dx})`;
                                            return this.status;
                                        }
                                    }
                                }
                            }
                        }
                    }
                    this.rIslandGliderHist.push({ rKey, rPktMin, rPktMax, rLeftAnchor, step: this.step });
                }
            }
        }

        // 8. Disconnected Left Island Glider
        let lPktMin = minX;
        let lPktMax = lPktMin;
        let lZeroRun = 0;
        let lRightAnchor = null;
        for (let x = minX + 1; x <= maxX; x++) {
            const v = this.tape.get(x) || 0;
            if (v === 0) {
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
        if (lRightAnchor !== null) {
            const lPatLen = lPktMax - lPktMin + 1;
            if (lPatLen <= 32) {
                let hasM = false;
                for (let x = lPktMin; x <= lPktMax; x++) {
                    const v = this.tape.get(x) || 0;
                    const r = this.rule.rules[v];
                    if (r && (r.L > 0 || r.R > 0)) { hasM = true; break; }
                }
                if (hasM) {
                    const lPat = [];
                    for (let x = lPktMin; x <= lPktMax; x++) lPat.push(this.tape.get(x) || 0);
                    const lKey = lPat.join(',');
                    for (const prev of this.lIslandGliderHist) {
                        if (prev.lKey === lKey) {
                            const period = this.step - prev.step;
                            const dx = lPktMin - prev.lPktMin;
                            if (dx < 0 && period > 0 && period <= 64) {
                                const iso = this.verifyIsolatedGlider(lPat, period, dx, 0);
                                if (iso && iso.valid) {
                                    const rightSlice = new Map();
                                    for (let x = lRightAnchor; x <= maxX; x++) {
                                        const v = this.tape.get(x) || 0;
                                        if (v > 0) rightSlice.set(x, v);
                                    }
                                    const cyc = this.verifyIsolatedCycler(rightSlice, 64, -1);
                                    if (cyc && cyc.valid && cyc.exc <= 0) {
                                        const gap = lRightAnchor - lPktMax - 1;
                                        if (gap >= iso.maxRearExc) {
                                            this.status = `escaping glider (leftward, period ${period}, shift ${dx})`;
                                            return this.status;
                                        }
                                    }
                                }
                            }
                        }
                    }
                    this.lIslandGliderHist.push({ lKey, lPktMin, lPktMax, lRightAnchor, step: this.step });
                }
            }
        }

        // 9. Dual Gliders Check (Combined Left & Right Islands)
        if (lRightAnchor !== null && rLeftAnchor !== null && lPktMax < rPktMin) {
            let midEmpty = true;
            let midStatic = true;
            for (let x = lPktMax + 1; x < rPktMin; x++) {
                const v = this.tape.get(x) || 0;
                if (v > 0) {
                    midEmpty = false;
                    const r = this.rule.rules[v];
                    if (r && (r.L > 0 || r.R > 0)) { midStatic = false; break; }
                }
            }
            if (midStatic) {
                const lPat = [];
                for (let x = lPktMin; x <= lPktMax; x++) lPat.push(this.tape.get(x) || 0);
                const lKey = lPat.join(',');
                const rPat = [];
                for (let x = rPktMin; x <= rPktMax; x++) rPat.push(this.tape.get(x) || 0);
                const rKey = rPat.join(',');

                for (let i = 0; i < this.lIslandGliderHist.length; i++) {
                    const prevL = this.lIslandGliderHist[i];
                    if (prevL.lKey === lKey) {
                        const prevR = this.rIslandGliderHist.find(h => h.step === prevL.step && h.rKey === rKey);
                        if (prevR) {
                            const period = this.step - prevL.step;
                            const dxL = lPktMin - prevL.lPktMin;
                            const dxR = rPktMin - prevR.rPktMin;
                            if (period > 0 && period <= 64 && (dxL !== 0 || dxR !== 0)) {
                                const isoL = (dxL !== 0) ? this.verifyIsolatedGlider(lPat, period, dxL, 0) : null;
                                const isoR = (dxR !== 0) ? this.verifyIsolatedGlider(rPat, period, dxR, 1) : null;

                                const gap = rPktMin - lPktMax - 1;
                                // Opposite directions
                                if (isoL && isoR && dxL < 0 && dxR > 0) {
                                    if (gap >= isoL.maxRearExc + isoR.maxRearExc) {
                                        this.status = `dual glider (diverging, p=${period}, dxL=${dxL}, dxR=+${dxR})`;
                                        return this.status;
                                    }
                                }
                                // Dual leftward (v_left >= v_right)
                                else if (isoL && isoR && dxL < 0 && dxR < 0 && midEmpty) {
                                    if (Math.abs(dxL) >= Math.abs(dxR) && gap >= isoL.maxRearExc + isoR.maxFrontExc + 2) {
                                        this.status = `dual glider (leftward, vL=${Math.abs(dxL)} >= vR=${Math.abs(dxR)})`;
                                        return this.status;
                                    }
                                }
                                // Dual rightward (v_right >= v_left)
                                else if (isoL && isoR && dxL > 0 && dxR > 0 && midEmpty) {
                                    if (dxR >= dxL && gap >= isoR.maxRearExc + isoL.maxFrontExc + 2) {
                                        this.status = `dual glider (rightward, vR=${dxR} >= vL=${dxL})`;
                                        return this.status;
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        // 10. Multi-Island Decider (M >= 2: Tripled, Quadrupled Gliders/Cyclers)
        const xs = Array.from(this.tape.keys()).sort((a, b) => a - b);
        if (xs.length > 0) {
            const islands = [];
            let cStart = xs[0], cEnd = xs[0];
            for (let i = 1; i < xs.length; i++) {
                const x = xs[i];
                if (x - cEnd >= 2) {
                    islands.push([cStart, cEnd]);
                    cStart = x; cEnd = x;
                } else {
                    cEnd = x;
                }
            }
            islands.push([cStart, cEnd]);

            if (islands.length >= 2 && islands.length <= 8) {
                const pats = islands.map(([s, e]) => {
                    const p = [];
                    for (let x = s; x <= e; x++) p.push(this.tape.get(x) || 0);
                    return p.join(',');
                });
                const comboKey = `${islands.length}|${pats.join(';')}`;
                const coords = islands.map(([s]) => s);

                for (let i = 0; i < this.multiIslandHist.length; i++) {
                    const prev = this.multiIslandHist[i];
                    if (prev.comboKey === comboKey) {
                        const period = this.step - prev.step;
                        if (period > 0 && period <= 64) {
                            const dxs = coords.map((x, idx) => x - prev.coords[idx]);
                            const isos = [];
                            let allValid = true;

                            for (let m = 0; m < islands.length; m++) {
                                const [s, e] = islands[m];
                                const pat = [];
                                for (let x = s; x <= e; x++) pat.push(this.tape.get(x) || 0);
                                const dx = dxs[m];
                                if (dx !== 0) {
                                    const iso = this.verifyIsolatedGlider(pat, period, dx, dx > 0 ? 1 : 0);
                                    if (!iso || !iso.valid) { allValid = false; break; }
                                    isos.push({ rear: iso.maxRearExc, front: iso.maxFrontExc });
                                } else {
                                    const islSlice = new Map();
                                    for (let x = s; x <= e; x++) {
                                        const v = this.tape.get(x) || 0;
                                        if (v > 0) islSlice.set(x, v);
                                    }
                                    const cyc = this.verifyIsolatedCycler(islSlice, 64, 0);
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
                                    this.status = `multi-island cycler (${islands.length} islands, period ${period}, dxs [${dxs.join(',')}])`;
                                    return this.status;
                                }
                            }
                        }
                    }
                }
                this.multiIslandHist.push({ comboKey, coords, step: this.step });
                if (this.multiIslandHist.length > 100) this.multiIslandHist.shift();
            }
        }

        // 11. Expanding / Translating Turnaround Bouncer (Moving Cycler Walls)
        let tbLwEnd = minX;
        let tbZRun = 0;
        for (let x = minX + 1; x <= maxX; x++) {
            const v = this.tape.get(x) || 0;
            if (v === 0) {
                tbZRun++;
                if (tbZRun >= 2) break;
            } else {
                tbZRun = 0;
                tbLwEnd = x;
                if (tbLwEnd - minX + 1 > 8) break;
            }
        }

        let tbRwStart = maxX;
        tbZRun = 0;
        for (let x = maxX - 1; x >= minX; x--) {
            const v = this.tape.get(x) || 0;
            if (v === 0) {
                tbZRun++;
                if (tbZRun >= 2) break;
            } else {
                tbZRun = 0;
                tbRwStart = x;
                if (maxX - tbRwStart + 1 > 8) break;
            }
        }

        if (tbLwEnd < tbRwStart && (tbRwStart - tbLwEnd - 1 >= 2)) {
            let tbMidEmpty = true;
            for (let x = tbLwEnd + 1; x < tbRwStart; x++) {
                if ((this.tape.get(x) || 0) > 0) { tbMidEmpty = false; break; }
            }
            if (tbMidEmpty) {
                const lwPat = [];
                for (let x = minX; x <= tbLwEnd; x++) lwPat.push(this.tape.get(x) || 0);
                const rwPat = [];
                for (let x = tbRwStart; x <= maxX; x++) rwPat.push(this.tape.get(x) || 0);
                const tbGap = tbRwStart - tbLwEnd - 1;
                const tbDir = (netR > netL) ? 'R' : ((netL > netR) ? 'L' : 'N');
                const sig = `${tbDir}|${lwPat.join(',')}|${rwPat.join(',')}`;

                for (let i = 0; i < this.transBouncerHist.length; i++) {
                    const prev = this.transBouncerHist[i];
                    if (prev.sig === sig && tbGap >= prev.gap) {
                        const oppSeen = this.transBouncerHist.slice(i + 1).some(cp => cp.dir !== 'N' && cp.dir !== tbDir);
                        if (oppSeen) {
                            let rwIsGlider = false;
                            for (let p = 1; p <= 8; p++) {
                                for (let dx = 1; dx <= p; dx++) {
                                    const iso = this.verifyIsolatedGlider(rwPat, p, dx, 1);
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
                                    const iso = this.verifyIsolatedGlider(lwPat, p, -dx, 0);
                                    if (iso && iso.valid && iso.maxRearExc === 0) {
                                        lwIsGlider = true; break;
                                    }
                                }
                                if (lwIsGlider) break;
                            }
                            if (lwIsGlider) continue;

                            const period = this.step - prev.step;
                            this.status = `bouncer (expanding translating, period ${period}, gap ${prev.gap} -> ${tbGap})`;
                            return this.status;
                        }
                    }
                }
                this.transBouncerHist.push({ sig, dir: tbDir, gap: tbGap, step: this.step });
                if (this.transBouncerHist.length > 100) this.transBouncerHist.shift();
            }
        }

        return this.status;
    }

    detectEscapingGlider() {
        if (this.tape.size < 2) return null;
        const cells = Array.from(this.tape.entries()).sort((a, b) => a[0] - b[0]);
        let maxGap = 0, splitIdx = -1;
        for (let i = 0; i < cells.length - 1; i++) {
            const gap = cells[i + 1][0] - cells[i][0];
            if (gap > maxGap) {
                maxGap = gap;
                splitIdx = i;
            }
        }

        // Rightward escaping glider past static walls
        if (maxGap >= 64 && splitIdx >= 0) {
            const leftCells = cells.slice(0, splitIdx + 1);
            const rightCells = cells.slice(splitIdx + 1);

            let leftStatic = true;
            for (const [x, v] of leftCells) {
                const r = this.rule.rules[v];
                if (r && (r.L > 0 || r.R > 0)) { leftStatic = false; break; }
            }

            if (leftStatic) {
                const minR = rightCells[0][0];
                const fp = rightCells.map(([x, v]) => (x - minR) + ':' + v).join(',');
                this._rTrack = this._rTrack || new Map();
                if (this._rTrack.has(fp)) {
                    const prev = this._rTrack.get(fp);
                    const period = this.step - prev.step;
                    const dx = minR - prev.minR;
                    if (period > 0 && dx > 0 && (dx / period) <= 1.0) {
                        return `escaping glider (rightward, period ${period}, shift +${dx})`;
                    }
                }
                this._rTrack.set(fp, { step: this.step, minR });
            }
        }

        // Leftward escaping glider past static walls
        if (maxGap >= 64 && splitIdx >= 0) {
            const leftCells = cells.slice(0, splitIdx + 1);
            const rightCells = cells.slice(splitIdx + 1);

            let rightStatic = true;
            for (const [x, v] of rightCells) {
                const r = this.rule.rules[v];
                if (r && (r.L > 0 || r.R > 0)) { rightStatic = false; break; }
            }

            if (rightStatic) {
                const minL = leftCells[0][0];
                const fp = leftCells.map(([x, v]) => (x - minL) + ':' + v).join(',');
                this._lTrack = this._lTrack || new Map();
                if (this._lTrack.has(fp)) {
                    const prev = this._lTrack.get(fp);
                    const period = this.step - prev.step;
                    const dx = minL - prev.minL;
                    if (period > 0 && dx < 0 && (Math.abs(dx) / period) <= 1.0) {
                        return `escaping glider (leftward, period ${period}, shift ${dx})`;
                    }
                }
                this._lTrack.set(fp, { step: this.step, minL });
            }
        }

        return null;
    }

        _ensureRuleTables() {
        const maxK = Math.max(this.n + 1, 128);
        if (!this.rule._turboL || this.rule._turboL.length < maxK) {
            const L = new Int32Array(maxK);
            const S = new Int32Array(maxK);
            const R = new Int32Array(maxK);
            for (let k = 1; k < maxK; k++) {
                const rule = this.rule.rules[k];
                if (rule) {
                    L[k] = rule.L || 0;
                    R[k] = rule.R || 0;
                    S[k] = rule.S !== undefined ? rule.S : (k - L[k] - R[k]);
                } else {
                    L[k] = 0;
                    R[k] = 0;
                    S[k] = k;
                }
            }
            this.rule._turboL = L;
            this.rule._turboS = S;
            this.rule._turboR = R;
            this.rule._singleIslandCache = new Array(maxK).fill(undefined);
            this.rule._multiIslandCache = new Map();
        }
        if (!this._regAx) {
            this._regAx = new Float64Array(256);
            this._regAv = new Int32Array(256);
            this._regBx = new Float64Array(256);
            this._regBv = new Int32Array(256);
            this._islStart = new Int32Array(64);
            this._islCount = new Int32Array(64);
            this._islBase = new Float64Array(64);
            this._islInfo = new Array(64);
            this._tmpRelX = new Int32Array(32);
            this._tmpRelV = new Int32Array(32);
        }
    }

    _addSparseCell(xs, vs, len, x, v) {
        for (let j = len - 1; j >= 0 && j >= len - 4; j--) {
            if (xs[j] === x) {
                vs[j] += v;
                return len;
            }
            if (xs[j] < x) {
                for (let k = len; k > j + 1; k--) {
                    xs[k] = xs[k - 1];
                    vs[k] = vs[k - 1];
                }
                xs[j + 1] = x;
                vs[j + 1] = v;
                return len + 1;
            }
        }
        let pos = 0;
        while (pos < len && xs[pos] < x) pos++;
        if (pos < len && xs[pos] === x) {
            vs[pos] += v;
            return len;
        }
        for (let k = len; k > pos; k--) {
            xs[k] = xs[k - 1];
            vs[k] = vs[k - 1];
        }
        xs[pos] = x;
        vs[pos] = v;
        return len + 1;
    }

    _stepSparseOnce(xs, vs, len, outXs, outVs, L, S, R, maxK) {
        let outLen = 0;
        for (let i = 0; i < len; i++) {
            const x = xs[i];
            const v = vs[i];
            if (v <= 0) continue;
            const l = v < maxK ? L[v] : 0;
            const s = v < maxK ? S[v] : v;
            const r = v < maxK ? R[v] : 0;

            if (l > 0) outLen = this._addSparseCell(outXs, outVs, outLen, x - 1, l);
            if (s > 0) outLen = this._addSparseCell(outXs, outVs, outLen, x, s);
            if (r > 0) outLen = this._addSparseCell(outXs, outVs, outLen, x + 1, r);
        }
        return outLen;
    }

    _analyzeCausalIsland(relXs, relVs, count, L, S, R, maxK) {
        const singleCache = this.rule._singleIslandCache;
        const multiCache = this.rule._multiIslandCache;

        if (count === 1) {
            const v = relVs[0];
            if (v < singleCache.length) {
                const c = singleCache[v];
                if (c !== undefined) return c;
            }
        }

        let key;
        if (count === 1) {
            key = relVs[0];
        } else if (count === 2 && relXs[1] < 32 && relVs[0] < 128 && relVs[1] < 128) {
            key = (1 << 28) | (relXs[1] << 16) | (relVs[0] << 8) | relVs[1];
        } else if (count === 3 && relXs[1] < 16 && relXs[2] < 32 && relVs[0] < 64 && relVs[1] < 64 && relVs[2] < 64) {
            key = (2 << 28) | (relXs[1] << 23) | (relXs[2] << 18) | (relVs[0] << 12) | (relVs[1] << 6) | relVs[2];
        } else {
            key = "";
            for (let i = 0; i < count; i++) key += (i ? "," : "") + relXs[i] + ":" + relVs[i];
        }

        if (count > 1) {
            const cached = multiCache.get(key);
            if (cached !== undefined) return cached;
        }

        let isStatic = true;
        for (let i = 0; i < count; i++) {
            const v = relVs[i];
            if (v < maxK && (L[v] > 0 || R[v] > 0)) { isStatic = false; break; }
        }
        if (isStatic) {
            const res = {
                isStatic: true,
                isPeriodic: true,
                period: 1,
                dx: 0,
                maxLeftExc: 0,
                maxRightExc: relXs[count - 1],
                phasesX: [Int32Array.from(relXs.subarray(0, count))],
                phasesV: [Int32Array.from(relVs.subarray(0, count))]
            };
            if (count === 1 && key < singleCache.length) singleCache[key] = res;
            else multiCache.set(key, res);
            return res;
        }

        let ax = new Float64Array(64);
        let av = new Int32Array(64);
        let bx = new Float64Array(64);
        let bv = new Int32Array(64);
        let curLen = count;
        for (let i = 0; i < count; i++) { ax[i] = relXs[i]; av[i] = relVs[i]; }

        const phasesX = [Int32Array.from(relXs.subarray(0, count))];
        const phasesV = [Int32Array.from(relVs.subarray(0, count))];
        let maxLeftExc = 0;
        let maxRightExc = relXs[count - 1];

        for (let p = 1; p <= 32; p++) {
            const nextLen = this._stepSparseOnce(ax, av, curLen, bx, bv, L, S, R, maxK);
            if (nextLen === 0 || nextLen > 16) {
                if (count === 1 && key < singleCache.length) singleCache[key] = null;
                else multiCache.set(key, null);
                return null;
            }
            const minX = bx[0];
            const maxX = bx[nextLen - 1];
            if (maxX - minX > 12) {
                if (count === 1 && key < singleCache.length) singleCache[key] = null;
                else multiCache.set(key, null);
                return null;
            }
            if (minX - 1 < maxLeftExc) maxLeftExc = minX - 1;
            if (maxX + 1 > maxRightExc) maxRightExc = maxX + 1;

            if (nextLen === count) {
                let match = true;
                for (let i = 0; i < count; i++) {
                    if ((bx[i] - minX) !== relXs[i] || bv[i] !== relVs[i]) {
                        match = false;
                        break;
                    }
                }
                if (match) {
                    const res = {
                        isStatic: false,
                        isPeriodic: true,
                        period: p,
                        dx: minX,
                        maxLeftExc,
                        maxRightExc,
                        phasesX,
                        phasesV
                    };
                    if (count === 1 && key < singleCache.length) singleCache[key] = res;
                    else multiCache.set(key, res);
                    return res;
                }
            }

            const px = new Int32Array(nextLen);
            const pv = new Int32Array(nextLen);
            for (let i = 0; i < nextLen; i++) {
                px[i] = bx[i];
                pv[i] = bv[i];
            }
            phasesX.push(px);
            phasesV.push(pv);

            const tx = ax; ax = bx; bx = tx;
            const tv = av; av = bv; bv = tv;
            curLen = nextLen;
        }

        if (count === 1 && key < singleCache.length) singleCache[key] = null;
        else multiCache.set(key, null);
        return null;
    }

    _isqrtBig(n) {
        if (n < 0n) return 0n;
        if (n < 2n) return n;
        const bits = BigInt(n.toString(2).length);
        let x0 = 1n << ((bits + 1n) >> 1n);
        let x1 = (x0 + n / x0) >> 1n;
        while (x1 < x0) {
            x0 = x1;
            x1 = (x0 + n / x0) >> 1n;
        }
        return x0;
    }

    _addSparseBig(xs, vs, len, x, v) {
        for (let j = len - 1; j >= 0 && j >= len - 4; j--) {
            const xj = xs[j];
            if (xj === x) {
                vs[j] += v;
                return len;
            }
            if (xj < x) {
                for (let k = len; k > j + 1; k--) {
                    xs[k] = xs[k - 1];
                    vs[k] = vs[k - 1];
                }
                xs[j + 1] = x;
                vs[j + 1] = v;
                return len + 1;
            }
        }
        let pos = 0;
        while (pos < len && xs[pos] < x) pos++;
        if (pos < len && xs[pos] === x) {
            vs[pos] += v;
            return len;
        }
        for (let k = len; k > pos; k--) {
            xs[k] = xs[k - 1];
            vs[k] = vs[k - 1];
        }
        xs[pos] = x;
        vs[pos] = v;
        return len + 1;
    }

    _stepSparseBigOnce(xs, vs, len, outXs, outVs, L, S, R, maxK) {
        let outLen = 0;
        for (let i = 0; i < len; i++) {
            const x = xs[i];
            const v = vs[i];
            if (v <= 0) continue;
            const l = v < maxK ? L[v] : 0;
            const s = v < maxK ? S[v] : v;
            const r = v < maxK ? R[v] : 0;
            if (l > 0) outLen = this._addSparseBig(outXs, outVs, outLen, x - 1n, l);
            if (s > 0) outLen = this._addSparseBig(outXs, outVs, outLen, x, s);
            if (r > 0) outLen = this._addSparseBig(outXs, outVs, outLen, x + 1n, r);
        }
        return outLen;
    }

    _pushHistoryBig(stepNum, bxs, vs, len) {
        if (!this._tmpFloatX || this._tmpFloatX.length < len) {
            this._tmpFloatX = new Float64Array(Math.max(len, 64));
        }
        const fxs = this._tmpFloatX;
        for (let i = 0; i < len; i++) {
            fxs[i] = Number(bxs[i]);
        }
        this._pushHistorySorted(stepNum, fxs, vs, len);
        const maxHist = this.maxHistory || 24000;
        if (this.history.length >= maxHist) {
            this._compactHistoryInPlace();
            this.historyStride = (this.historyStride || 1) * 2;
        }
    }

    stepTurbo(stepsToRun, allowContinueAfterDecision = false, maxBudgetMs = 25) {
        if (this.status !== "running" && !allowContinueAfterDecision) return { status: this.status, executed: 0 };
        if (this.status.startsWith("stabilized")) return { status: this.status, executed: 0 };
        if (stepsToRun <= 0) return { status: this.status, executed: 0 };

        this._ensureRuleTables();
        const L = this.rule._turboL;
        const S = this.rule._turboS;
        const R = this.rule._turboR;
        const maxK = L.length;

        if (!this._bigRegAx) {
            this._bigRegAx = new Array(256).fill(0n);
            this._bigRegAv = new Int32Array(256);
            this._bigRegBx = new Array(256).fill(0n);
            this._bigRegBv = new Int32Array(256);
            this._bigIslBase = new Array(64).fill(0n);
            this._bigEndBase = new Array(64).fill(0n);
            this._bigDxIsl = new Array(64).fill(0n);
            this._bigSampleX = new Float64Array(256);
            this._bigSampleV = new Int32Array(256);
        }

        let xs = this._bigRegAx;
        let vs = this._bigRegAv;
        let nxs = this._bigRegBx;
        let nvs = this._bigRegBv;
        let len = 0;

        if (this._bigTapeX && this._bigTapeLen > 0) {
            len = this._bigTapeLen;
            for (let i = 0; i < len; i++) {
                xs[i] = this._bigTapeX[i];
                vs[i] = this._bigTapeV[i];
            }
        } else {
            const entries = [];
            for (const [x, v] of this.tape) {
                if (v > 0) entries.push([BigInt(Math.round(x)), v]);
            }
            entries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
            len = entries.length;
            for (let i = 0; i < len; i++) {
                xs[i] = entries[i][0];
                vs[i] = entries[i][1];
            }
        }

        if (len === 0) {
            this.status = "stabilized";
            return { status: this.status, executed: 0 };
        }

        let stepsBig;
        if (typeof stepsToRun === "bigint") {
            stepsBig = stepsToRun;
        } else if (!Number.isFinite(stepsToRun) || stepsToRun >= 1e90) {
            stepsBig = 10n ** 100n;
        } else if (stepsToRun >= 1e15) {
            const expStr = stepsToRun.toExponential(12);
            const [mantStr, expPart] = expStr.split("e");
            const exp = parseInt(expPart, 10);
            const cleanMant = mantStr.replace(".", "");
            const fracDigits = (mantStr.split(".")[1] || "").length;
            const shiftExp = exp - fracDigits;
            stepsBig = BigInt(cleanMant) * (10n ** BigInt(Math.max(0, shiftExp)));
        } else {
            stepsBig = BigInt(Math.max(1, Math.floor(stepsToRun)));
        }

        const startStepBig = (this.stepBig !== undefined && this.stepBig !== null)
            ? this.stepBig
            : BigInt(Math.round(this.step));
        const maxStepsBig = startStepBig + stepsBig;
        let curStep = startStepBig;

        const islStart = this._islStart;
        const islCount = this._islCount;
        const islBase = this._bigIslBase;
        const islInfo = this._islInfo;
        const endBase = this._bigEndBase;
        const dxIsl = this._bigDxIsl;
        const tmpRelX = this._tmpRelX;
        const tmpRelV = this._tmpRelV;
        const sampleX = this._bigSampleX;
        const sampleV = this._bigSampleV;

        if (!this._macroTable) this._macroTable = new Map();
        const macroTable = this._macroTable;
        let totalLeaps = this._totalLeaps || 0n;
        let totalSparse = this._totalSparse || 0n;

        const tStart = (maxBudgetMs && maxBudgetMs > 0 && maxBudgetMs < 10000) ? performance.now() : 0;
        let loopIter = 0;
        let consecutiveNonLeaps = 0;

        while (curStep < maxStepsBig && len > 0) {
            if (tStart > 0 && (++loopIter & 63) === 0) {
                if (performance.now() - tStart >= maxBudgetMs) break;
            }

            const rem = maxStepsBig - curStep;
            let didLeap = false;

            if (rem >= 12n) {
                let numIsl = 0;
                let sIdx = 0;
                for (let i = 1; i <= len; i++) {
                    if (i === len || (xs[i] - xs[i - 1]) > 4n) {
                        islStart[numIsl] = sIdx;
                        islCount[numIsl] = i - sIdx;
                        islBase[numIsl] = xs[sIdx];
                        numIsl++;
                        sIdx = i;
                    }
                }

                let allPeriodic = true;
                let allStatic = true;
                for (let m = 0; m < numIsl; m++) {
                    const st = islStart[m];
                    const cnt = islCount[m];
                    const base = islBase[m];
                    if (cnt > 16) { allPeriodic = false; allStatic = false; break; }
                    for (let j = 0; j < cnt; j++) {
                        tmpRelX[j] = Number(xs[st + j] - base);
                        tmpRelV[j] = vs[st + j];
                    }
                    const info = this._analyzeCausalIsland(tmpRelX, tmpRelV, cnt, L, S, R, maxK);
                    if (!info) { allPeriodic = false; allStatic = false; break; }
                    if (!info.isStatic) allStatic = false;
                    islInfo[m] = info;
                }

                if (allStatic) {
                    this.status = "stabilized";
                    break;
                }

                if (allPeriodic) {
                    let maxSafeDt = rem;
                    for (let m = 0; m < numIsl - 1; m++) {
                        const infL = islInfo[m];
                        const infR = islInfo[m + 1];
                        const baseL = islBase[m];
                        const baseR = islBase[m + 1];

                        const rightBoundL = baseL + BigInt(Math.abs(infL.dx) + infL.maxRightExc);
                        const leftBoundR = baseR + BigInt(-Math.abs(infR.dx) + infR.maxLeftExc);
                        const effGap = leftBoundR - rightBoundL - 4n;

                        const pL = BigInt(infL.period), pR = BigInt(infR.period);
                        const dxL = BigInt(infL.dx), dxR = BigInt(infR.dx);
                        const numV = dxL * pR - dxR * pL;
                        const denV = pL * pR;

                        if (numV > 0n) {
                            if (effGap <= 0n) { maxSafeDt = 0n; break; }
                            const dt = (effGap * denV) / numV;
                            if (dt < maxSafeDt) maxSafeDt = dt;
                        } else {
                            if (effGap < 0n) { maxSafeDt = 0n; break; }
                        }
                    }

                    if (maxSafeDt >= 8n) {
                        // Identify interior shuttle vs outer free-streaming gliders
                        let mStart = 0;
                        let mEnd = numIsl - 1;
                        if (numIsl > 2 && !islInfo[0].isStatic && islInfo[0].dx < 0 && islInfo[1].isStatic) {
                            mStart = 1;
                        }
                        if (mEnd - mStart >= 2 && !islInfo[mEnd].isStatic && islInfo[mEnd].dx > 0 && islInfo[mEnd - 1].isStatic) {
                            mEnd--;
                        }

                        let intMoving = 0;
                        let movIdx = -1;
                        for (let m = mStart; m <= mEnd; m++) {
                            if (!islInfo[m].isStatic) {
                                intMoving++;
                                movIdx = m;
                            }
                        }

                        // Record left-moving and right-moving shuttle phases for bidirectional Talbot-carpet rendering
                        if (intMoving === 1) {
                            const infShut = islInfo[movIdx];
                            if (infShut.dx > 0) this._lastRightShuttle = infShut;
                            else if (infShut.dx < 0) this._lastLeftShuttle = infShut;
                        }

                        const strideNum = this.historyStride || 1;
                        const lastHStep = this.history.length > 0 ? this.history[this.history.length - 1].step : 0;
                        const endStepBig = curStep + maxSafeDt;
                        const endStepNum = Number(endStepBig);

                        // Adaptive screen-space sampling for 1st-order flights (up to 192 samples if a single flight spans a major portion of the screen)
                        if (endStepNum - lastHStep >= strideNum) {
                            const spanNum = Number(maxSafeDt);
                            const screenFrac = endStepNum > 0 ? (spanNum / endStepNum) : 1.0;
                            const maxFlightSamples = screenFrac > 0.15 ? 1024 : (screenFrac > 0.02 ? 192 : 24);
                            const nSamp = Math.min(maxFlightSamples, Math.max(1, Math.floor(spanNum / strideNum)));
                            for (let s = 1; s <= nSamp; s++) {
                                const dtSamp = (s === nSamp) ? maxSafeDt : (maxSafeDt * BigInt(s)) / BigInt(nSamp);
                                const sStepNum = Number(curStep + dtSamp);
                                if (sStepNum <= lastHStep) continue;
                                let sLen = 0;
                                for (let m = 0; m < numIsl; m++) {
                                    const inf = islInfo[m];
                                    const base = islBase[m];
                                    const pBig = BigInt(inf.period);
                                    const q = dtSamp / pBig;
                                    const r = Number(dtSamp % pBig);
                                    const shift = Number(base + q * BigInt(inf.dx));
                                    const px = inf.phasesX[r];
                                    const pv = inf.phasesV[r];
                                    for (let j = 0; j < px.length; j++) {
                                        sampleX[sLen] = shift + px[j];
                                        sampleV[sLen] = pv[j];
                                        sLen++;
                                    }
                                }
                                this._pushHistorySorted(sStepNum, sampleX, sampleV, sLen);
                                if (this.history.length >= (this.maxHistory || 24000)) {
                                    this._compactHistoryInPlace();
                                    this.historyStride = (this.historyStride || 1) * 2;
                                }
                            }
                        }

                        // Advance active state by maxSafeDt in O(1) time
                        let newLen = 0;
                        for (let m = 0; m < numIsl; m++) {
                            const inf = islInfo[m];
                            const base = islBase[m];
                            const pBig = BigInt(inf.period);
                            const q = maxSafeDt / pBig;
                            const r = Number(maxSafeDt % pBig);
                            const shift = base + q * BigInt(inf.dx);
                            const px = inf.phasesX[r];
                            const pv = inf.phasesV[r];
                            endBase[m] = shift + BigInt(px[0]);
                            for (let j = 0; j < px.length; j++) {
                                nxs[newLen] = shift + BigInt(px[j]);
                                nvs[newLen] = pv[j];
                                newLen++;
                            }
                        }
                        const tx = xs; xs = nxs; nxs = tx;
                        const tv = vs; vs = nvs; nvs = tv;
                        len = newLen;
                        curStep = endStepBig;
                        totalLeaps += 1n;
                        didLeap = true;
                        consecutiveNonLeaps = 0;

                        // 2nd-Order Parabolic Macro-Cycle Leaper (Quadratic Closed-Form Dome Accelerator)
                        if (intMoving === 1 && curStep < maxStepsBig) {
                            const infM = islInfo[movIdx];
                            const wallIdx = infM.dx < 0 ? movIdx - 1 : movIdx + 1;
                            const oppIdx = infM.dx < 0 ? movIdx + 1 : movIdx - 1;
                            if (wallIdx >= mStart && wallIdx <= mEnd) {
                                const collGap = endBase[movIdx] - endBase[wallIdx];
                                if (collGap >= -16n && collGap <= 16n) {
                                    const cavMod = (oppIdx >= mStart && oppIdx <= mEnd)
                                        ? Number(((endBase[oppIdx] - endBase[wallIdx]) % 12n + 12n) % 12n)
                                        : 0;
                                    let sig = numIsl + "|" + mStart + "|" + mEnd + "|" + movIdx + "|" + collGap + "|" + cavMod;
                                    for (let i = 0; i < len; i++) sig += "," + vs[i];

                                    let rec = macroTable.get(sig);
                                    if (!rec) {
                                        rec = [];
                                        macroTable.set(sig, rec);
                                        if (macroTable.size > 64) {
                                            macroTable.delete(macroTable.keys().next().value);
                                        }
                                    }
                                    rec.push({
                                        step: curStep,
                                        leaps: totalLeaps,
                                        sparse: totalSparse,
                                        bases: endBase.slice(0, numIsl)
                                    });
                                    if (rec.length > 3) rec.shift();

                                    if (rec.length === 3) {
                                        const s0 = rec[0], s1 = rec[1], s2 = rec[2];
                                        const dL1 = s1.leaps - s0.leaps, dL2 = s2.leaps - s1.leaps;
                                        const dSp1 = s1.sparse - s0.sparse, dSp2 = s2.sparse - s1.sparse;
                                        const dt1 = s1.step - s0.step, dt2 = s2.step - s1.step;
                                        const ddt = dt2 - dt1;

                                        if (dL1 > 0n && dL1 === dL2 &&
                                            dSp1 > 0n && dSp1 === dSp2 &&
                                            dt1 > 0n && ddt >= 0n) {
                                            let shiftsMatch = true;
                                            for (let m = mStart; m <= mEnd; m++) {
                                                const dx1 = s1.bases[m] - s0.bases[m];
                                                const dx2 = s2.bases[m] - s1.bases[m];
                                                if (dx1 !== dx2) { shiftsMatch = false; break; }
                                                if ((m < movIdx - 1 || m > movIdx + 1) && dx1 !== 0n) { shiftsMatch = false; break; }
                                                dxIsl[m] = dx1;
                                            }

                                            if (shiftsMatch) {
                                                const remAfter = maxStepsBig - curStep;
                                                let maxCycles = 0n;
                                                if (ddt === 0n) {
                                                    maxCycles = remAfter / dt2;
                                                } else {
                                                    const bCoeff = 2n * dt2 + ddt;
                                                    const disc = bCoeff * bCoeff + 8n * ddt * remAfter;
                                                    maxCycles = (-bCoeff + this._isqrtBig(disc)) / (2n * ddt);
                                                }

                                                for (let m = mStart; m < mEnd; m++) {
                                                    const relDx = dxIsl[m + 1] - dxIsl[m];
                                                    if (relDx < 0n) {
                                                        const curGap = endBase[m + 1] - endBase[m] - 10n;
                                                        if (curGap <= 0n) { maxCycles = 0n; break; }
                                                        const cLim = curGap / (-relDx);
                                                        if (cLim < maxCycles) maxCycles = cLim;
                                                    }
                                                }

                                                if (maxCycles >= 2n) {
                                                    const leapDt = maxCycles * dt2 + (maxCycles * (maxCycles + 1n) / 2n) * ddt;
                                                                                                        // Ultra-high-definition adaptive sampling: scale sample budget by visibility against target horizon
                                                    const endAfterNum = Number(curStep + leapDt);
                                                    const horizonNum = Math.max(endAfterNum, Number(maxStepsBig) * 0.02);
                                                    const domeScreenFrac = horizonNum > 0 ? Math.min(1.0, Number(leapDt) / horizonNum) : 1.0;
                                                    const targetSamples = Math.max(16, Math.min(14000, Math.round(domeScreenFrac * 14000)));
                                                    const nMacroSamp = Number(maxCycles < BigInt(targetSamples) ? maxCycles : BigInt(targetSamples));

                                                    const hasLeftW = (movIdx - 1 >= mStart);
                                                    const hasRightW = (movIdx + 1 <= mEnd);
                                                    const outShut = (infM.dx < 0 ? this._lastRightShuttle : this._lastLeftShuttle) || infM;
                                                    const inShut = infM;
                                                    const vOut = Math.abs(outShut.dx) / outShut.period;
                                                    const vIn = Math.abs(inShut.dx) / inShut.period;
                                                    const fOut = (vOut + vIn > 0) ? (vIn / (vOut + vIn)) : 0.5;

                                                    // Fast Float64 parameters for O(1) nanosecond visual trajectory interpolation
                                                    const curStepF = Number(curStep);
                                                    const leapDtF = Number(leapDt);
                                                    const maxCyclesF = Number(maxCycles);
                                                    const dt2F = Number(dt2);
                                                    const ddtF = Number(ddt);
                                                    const bCoeffF = 2 * dt2F + ddtF;
                                                    const rRatio = ddtF > 0 ? Math.min(1e6, dt2F / ddtF) : 1.0;
                                                    const phaseJitter = Number((curStep + totalLeaps * 137n) % 997n) / 997.0;
                                                    const visCycles = maxCycles <= 12000n ? maxCyclesF : (4200 + Number((maxCycles + totalLeaps * 31n) % 512n));
                                                    const endBaseF = new Float64Array(numIsl);
                                                    const dxIslF = new Float64Array(numIsl);
                                                    const xsF = new Float64Array(len);
                                                    for (let m = 0; m < numIsl; m++) {
                                                        endBaseF[m] = Number(endBase[m]);
                                                        dxIslF[m] = Number(dxIsl[m]);
                                                    }
                                                    for (let i = 0; i < len; i++) xsF[i] = Number(xs[i]);

                                                    for (let s = 1; s < nMacroSamp; s++) {
                                                        const fracT = s / nMacroSamp;
                                                        const dTF = leapDtF * fracT;
                                                        let cF;
                                                        if (ddtF === 0) {
                                                            cF = Math.floor(dTF / dt2F);
                                                        } else {
                                                            const discF = bCoeffF * bCoeffF + 8 * ddtF * dTF;
                                                            cF = Math.floor((-bCoeffF + Math.sqrt(discF)) / (2 * ddtF));
                                                        }
                                                        if (cF >= maxCyclesF) cF = maxCyclesF - 1;
                                                        if (cF < 0) cF = 0;

                                                        let uPhase;
                                                        if (maxCycles <= 12000n) {
                                                            const tcF = cF * dt2F + (cF * (cF + 1) * 0.5) * ddtF;
                                                            const dtCycleF = dt2F + (cF + 1) * ddtF;
                                                            const tauF = Math.max(0, dTF - tcF);
                                                            uPhase = (tauF / dtCycleF) % 1.0;
                                                        } else {
                                                            // Scale-invariant analytical Talbot carpet phase: preserves crisp Moiré parabolic caustics at 10^15..10^30+ steps
                                                            const cCont = -rRatio + Math.sqrt(rRatio * rRatio + fracT * visCycles * (visCycles + 2 * rRatio)) + phaseJitter;
                                                            uPhase = cCont - Math.floor(cCont);
                                                        }

                                                        const stepCNum = curStepF + dTF;
                                                        let sLen = 0;
                                                        let kIn = 0;

                                                        const leftWallX = hasLeftW ? (endBaseF[movIdx - 1] + cF * dxIslF[movIdx - 1]) : 0;
                                                        const rightWallX = hasRightW ? (endBaseF[movIdx + 1] + cF * dxIslF[movIdx + 1]) : 0;

                                                        for (let m = 0; m < numIsl; m++) {
                                                            const cnt = islCount[m];
                                                            if (m < mStart || m > mEnd) {
                                                                const inf = islInfo[m];
                                                                const qF = Math.floor(dTF / inf.period);
                                                                const r = s % inf.period;
                                                                const shift = endBaseF[m] + qF * inf.dx;
                                                                const px = inf.phasesX[r];
                                                                const pv = inf.phasesV[r];
                                                                const px0 = px[0];
                                                                for (let j = 0; j < px.length; j++) {
                                                                    sampleX[sLen] = shift + px[j] - px0;
                                                                    sampleV[sLen] = pv[j];
                                                                    sLen++;
                                                                }
                                                                kIn += cnt;
                                                            } else if (m === movIdx && hasLeftW && hasRightW && (rightWallX - leftWallX) > 10) {
                                                                const spanW = rightWallX - leftWallX - 6;
                                                                let shutInfo, fracX, phaseIdx;
                                                                if (uPhase < fOut) {
                                                                    shutInfo = outShut;
                                                                    const legProg = uPhase / fOut;
                                                                    fracX = (infM.dx < 0) ? legProg : (1.0 - legProg);
                                                                    phaseIdx = s % shutInfo.period;
                                                                } else {
                                                                    shutInfo = inShut;
                                                                    const legProg = (uPhase - fOut) / Math.max(1e-9, 1.0 - fOut);
                                                                    fracX = (infM.dx < 0) ? (1.0 - legProg) : legProg;
                                                                    phaseIdx = s % shutInfo.period;
                                                                }
                                                                const shutBase = Math.floor(leftWallX + 3 + fracX * spanW);
                                                                const px = shutInfo.phasesX[phaseIdx];
                                                                const pv = shutInfo.phasesV[phaseIdx];
                                                                const px0 = px[0];
                                                                for (let j = 0; j < px.length; j++) {
                                                                    sampleX[sLen] = shutBase + (px[j] - px0);
                                                                    sampleV[sLen] = pv[j];
                                                                    sLen++;
                                                                }
                                                                kIn += cnt;
                                                            } else {
                                                                const dxTotal = cF * dxIslF[m];
                                                                for (let j = 0; j < cnt; j++) {
                                                                    sampleX[sLen] = xsF[kIn] + dxTotal;
                                                                    sampleV[sLen] = vs[kIn];
                                                                    sLen++;
                                                                    kIn++;
                                                                }
                                                            }
                                                        }
                                                        this._pushHistorySorted(stepCNum, sampleX, sampleV, sLen);
                                                        if (this.history.length >= (this.maxHistory || 24000)) {
                                                            this._compactHistoryInPlace();
                                                            this.historyStride = (this.historyStride || 1) * 2;
                                                        }
                                                    }

                                                    // Advance exact state to end of maxCycles
                                                    let kOut = 0;
                                                    let kIn = 0;
                                                    for (let m = 0; m < numIsl; m++) {
                                                        const cnt = islCount[m];
                                                        if (m < mStart || m > mEnd) {
                                                            const inf = islInfo[m];
                                                            const pBig = BigInt(inf.period);
                                                            const q = leapDt / pBig;
                                                            const r = Number(leapDt % pBig);
                                                            const shift = endBase[m] + q * BigInt(inf.dx);
                                                            const px = inf.phasesX[r];
                                                            const pv = inf.phasesV[r];
                                                            const px0 = BigInt(px[0]);
                                                            for (let j = 0; j < px.length; j++) {
                                                                nxs[kOut] = shift + BigInt(px[j]) - px0;
                                                                nvs[kOut] = pv[j];
                                                                kOut++;
                                                            }
                                                            kIn += cnt;
                                                        } else {
                                                            const dxTotal = maxCycles * dxIsl[m];
                                                            for (let j = 0; j < cnt; j++) {
                                                                nxs[kOut] = xs[kIn] + dxTotal;
                                                                nvs[kOut] = vs[kIn];
                                                                kOut++;
                                                                kIn++;
                                                            }
                                                        }
                                                    }
                                                    const tx2 = xs; xs = nxs; nxs = tx2;
                                                    const tv2 = vs; vs = nvs; nvs = tv2;
                                                    len = kOut;
                                                    curStep += leapDt;
                                                    totalLeaps += maxCycles * dL1;
                                                    totalSparse += maxCycles * dSp1;
                                                    macroTable.clear();
                                                    this._pushHistoryBig(Number(curStep), xs, vs, len);
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }

            if (!didLeap) {
                consecutiveNonLeaps++;
                const burstSize = consecutiveNonLeaps <= 2 ? 8n : (consecutiveNonLeaps <= 6 ? 16n : 32n);
                const burst = Number(rem < burstSize ? rem : burstSize);
                let stabilizedInBurst = false;

                for (let b = 0; b < burst; b++) {
                    const nextLen = this._stepSparseBigOnce(xs, vs, len, nxs, nvs, L, S, R, maxK);
                    if (nextLen === 0) {
                        len = 0;
                        curStep += 1n;
                        this.status = "stabilized";
                        stabilizedInBurst = true;
                        break;
                    }
                    if (nextLen === len) {
                        let same = true;
                        for (let i = 0; i < len; i++) {
                            if (xs[i] !== nxs[i] || vs[i] !== nvs[i]) { same = false; break; }
                        }
                        if (same) {
                            this.status = "stabilized";
                            stabilizedInBurst = true;
                            break;
                        }
                    }

                    const tx = xs; xs = nxs; nxs = tx;
                    const tv = vs; vs = nvs; nvs = tv;
                    len = nextLen;
                    curStep += 1n;
                    totalSparse += 1n;

                    const strideBig = BigInt(Math.max(1, Math.floor(this.historyStride || 1)));
                    if (curStep < 9000000000000000n && (curStep % strideBig) === 0n) {
                        this._pushHistoryBig(Number(curStep), xs, vs, len);
                    }
                }
                if (stabilizedInBurst) break;
            }
        }

        this._bigRegAx = xs;
        this._bigRegAv = vs;
        this._bigRegBx = nxs;
        this._bigRegBv = nvs;
        this._bigTapeX = xs;
        this._bigTapeV = vs;
        this._bigTapeLen = len;
        this._totalLeaps = totalLeaps;
        this._totalSparse = totalSparse;

        this.tape.clear();
        for (let i = 0; i < len; i++) {
            const nx = Number(xs[i]);
            this.tape.set(nx, (this.tape.get(nx) || 0) + vs[i]);
        }

        const executedBig = curStep - startStepBig;
        const executed = Number(executedBig);
        this.stepBig = curStep;
        this.step = Number(curStep);

        if (this.history.length === 0 || this.history[this.history.length - 1].step !== this.step) {
            this._pushHistoryBig(this.step, xs, vs, len);
        }

        if (len === 0) {
            this.status = "stabilized";
        } else if (!allowContinueAfterDecision && !this.status.startsWith("stabilized")) {
            const gliderResult = this.detectEscapingGlider();
            if (gliderResult) {
                this.status = gliderResult;
            }
        }

        return { status: this.status, executed };
    }

    runUntil(maxSteps = 10000, allowContinueAfterDecision = false) {
        const remaining = maxSteps - this.step;
        if (remaining <= 0) return this.status;

        if (remaining > 50) {
            this.stepTurbo(remaining, allowContinueAfterDecision, 0);
            return this.status;
        }

        while ((this.status === "running" || (allowContinueAfterDecision && !this.status.startsWith("stabilized"))) && this.step < maxSteps) {
            this.stepForward(allowContinueAfterDecision);
        }
        return this.status;
    }
}

// Built-in presets with official wiki information
export const PRESETS = [
    {
        name: "🚀 4×9 Super-Automaton (1M/s Turbo)",
        n: 9,
        code: "00_02_01_40_14_12_00_52_81",
        steps: "> 1,000,000",
        customTape: [[0, 9], [45, 9], [90, 9], [135, 9]],
        customTapeStr: "9 " + Array(44).fill(0).join(" ") + " 9 " + Array(44).fill(0).join(" ") + " 9 " + Array(44).fill(0).join(" ") + " 9",
        desc: "Four 9-pebble wave packets spaced 45 cells apart, designed for 1,000,000 steps/s turbo simulation."
    },
    {
        name: "peBBle(1) = 1 Step",
        n: 1,
        code: "00",
        steps: 1,
        desc: "Rule 00. Pebble never moves; halts immediately."
    },
    {
        name: "peBBle(2) = 2 Steps",
        n: 2,
        code: "00_01",
        steps: 2,
        desc: "Moves a single pebble rightward before halting."
    },
    {
        name: "peBBle(3) = 4 Steps",
        n: 3,
        code: "00_01_01",
        steps: 4,
        desc: "Disperses pebbles into static singletons."
    },
    {
        name: "peBBle(4) = 7 Steps",
        n: 4,
        code: "00_01_20_03",
        steps: 7,
        desc: "4-rule Busy Beaver champion. Bounces and stabilizes in 7 steps."
    },
    {
        name: "peBBle(5) = 11 Steps",
        n: 5,
        code: "00_11_03_21_04",
        steps: 11,
        desc: "5-rule champion. Follows a chaotic dispersal pattern to 5 isolated 1s."
    },
    {
        name: "peBBle(6) = 17 Steps",
        n: 6,
        code: "00_11_03_21_40_15",
        steps: 17,
        desc: "6-rule champion. 17 transitions until all 6 pebbles stabilize."
    },
    {
        name: "peBBle(7) = 28 Steps",
        n: 7,
        code: "00_11_03_21_10_33_61",
        steps: 28,
        desc: "7-rule champion. Complex rebound cycle producing 7 static pebbles."
    },
    {
        name: "peBBle(8) = 63 Steps",
        n: 8,
        code: "00_11_03_21_50_30_24_70",
        steps: 63,
        desc: "8-rule champion. 63 steps of intricate space-time shuttling."
    },
    {
        name: "peBBle(9) = 63,577 Steps (Collatz Champion)",
        n: 9,
        code: "00_02_01_40_14_12_00_52_81",
        steps: 63577,
        desc: "AlephSquirrel's Collatz-like champion! Simulates a 3k+x generalized Collatz system."
    },
    {
        name: "peBBle(10) = 5,778 Steps (Proven Optimal)",
        n: 10,
        code: "00_02_01_40_14_12_00_17_63_18",
        steps: 5778,
        desc: "Proven optimal 10-pebble champion. Lower than n=9 due to Collatz gap parity offset."
    },
    {
        name: "peBBle(11) ≥ 810,626,821 Steps (Record Holder)",
        n: 11,
        code: "00_00_30_40_12_51_07_20_41_12_19",
        steps: 810626821,
        desc: "Current 11-pebble lower bound. Executes 810M+ steps of intricate space-time computation."
    },
    {
        name: "12-Pebble Cryptid (Piecewise Affine / BMO1)",
        n: 12,
        code: "00_00_00_40_10_00_00_08_41_11_00_a1",
        steps: "Oscillator",
        desc: "Computes a Piecewise Affine Function A(u, v) simulating BMO1-like shuttle dynamics."
    },
    {
        name: "12-Pebble 1/3-Harmonic Split-Dome (90_01_19)",
        n: 12,
        code: "00_00_30_40_12_51_07_20_41_90_01_19",
        steps: "Parabolic (10B+)",
        desc: "Maintains a static 2-pebble interior wall that tracks at exact 1/3 of the outer parabolic dome with zero escaping gliders."
    },
    {
        name: "12-Pebble 9:1 Asymmetric Dome (a0_56_1a)",
        n: 12,
        code: "00_00_30_40_12_51_07_20_41_a0_56_1a",
        steps: "Parabolic (10B+)",
        desc: "Uses 10->10|0|0 reflection to expand both walls simultaneously at an exact 9:1 left-to-right ratio with zero escaping gliders."
    },
    {
        name: "peBBle(12) ≥ 311,680 Steps (Record Champion)",
        n: 12,
        code: "00_00_30_40_12_51_07_20_41_24_63_1b",
        steps: 311680,
        desc: "Constructs a multi-wall parabolic resonator across 535 cells before a critical phase collision collapses all walls into static 2s and 1s at step 311,680."
    },

    {

        name: "peBBle(13) ≥ 1,774,252 Steps (Record Champion)",

        n: 13,

        code: "00_00_30_40_12_51_07_20_41_10_1b_01_52",

        steps: 1774252,

        desc: "New record holder: massive 13-pebble parabolic bouncer spanning over 1,200 cells that resonates through 1.77 million steps before freezing cleanly into inert static debris."

    },

    {

        name: "peBBle(14) ≥ 218,353 Steps (Record Champion)",

        n: 14,

        code: "00_00_30_40_12_51_07_20_41_10_1b_01_b1_04",

        steps: 218353,

        desc: "Discovered 14-pebble champion: intricate dual-cavity resonator halting at 218,353 steps."

    },

    {

        name: "peBBle(15) ≥ 117,917 Steps (Record Champion)",

        n: 15,

        code: "00_00_30_40_12_51_07_20_41_10_1b_01_b1_04_76",

        steps: 117917,

        desc: "Discovered 15-pebble champion: multi-barrier harmonic shuttle halting cleanly at 117,917 steps."

    },

    {

        name: "peBBle(16) ≥ 119,079 Steps (Record Champion)",

        n: 16,

        code: "00_00_30_40_12_51_07_20_41_10_1b_01_b1_04_76_02",

        steps: 119079,

        desc: "Discovered 16-pebble champion: extended 16-state resonator halting at 119,079 steps."

    },
    {
        name: "13-Pebble 5-Dome Parabolic Cathedral",
        n: 13,
        code: "00_00_00_40_10_00_00_08_41_11_a1_81_2a",
        steps: "5-Wall Cathedral",
        desc: "Traps an 8-pebble shuttle inside 5 simultaneous static 1-walls, drawing 5 stacked tiers of parabolic domes with zero escaping gliders."
    },
    {
        name: "13-Pebble Symmetric Twin-Cathedral",
        n: 13,
        code: "00_00_00_40_10_00_00_08_41_11_a1_19_a2",
        steps: "Symmetric 4-Wall",
        desc: "Balanced 13-pebble resonator expanding symmetrically left and right ([-7712, +7717] at 223M steps) with 4 interior walls."
    },
    {
        name: "15-Pebble Mass-6 Wall Parabolic Resonator",
        n: 15,
        code: "00_00_00_40_10_00_00_08_41_11_01_a1_1b_b1_2b",
        steps: "Parabolic (8B steps/s)",
        desc: "Traps an 8-pebble shuttle between a heavy static 6-pebble wall on the left and a 1-pebble wall on the right at 2:1 ratio with zero escaping gliders."
    },
    {
        name: "86-Pebble Cryptid (Hydra Behavior)",
        n: 86,
        code: "2:0,2 3:0,3 5:0,5 7:0,6 8:0,6 9:9,0 12:12,0 15:6,0 17:17,0 25:0,23 26:0,25 27:24,0 28:26,0 29:27,0 30:27,0 35:0,33 38:0,35 39:0,39 40:0,40 41:1,0 45:0,6 78:0,78 84:24,45 86:1,84",
        steps: "Hydra",
        desc: "86-pebble automaton engineered to display Hydra-like growth."
    },
    {
        name: "Translated Cycler (00_02_12)",
        n: 3,
        code: "00_02_12",
        steps: "Cycler",
        desc: "Moves periodically while leaving a trail of static pebbles."
    },
    {
        name: "Multi-Period Cycler (00_20_12)",
        n: 3,
        code: "00_20_12",
        steps: "Period 3",
        desc: "Period of 3 steps with an offset of 1 cell."
    }
];

// Color Palettes
export const COLOR_PALETTES = {
    cyberpunk: {
        name: "Cyberpunk Neon",
        bg: "#0b0d19",
        grid: "rgba(255, 255, 255, 0.05)",
        colors: [
            "#00f0ff", // 1 - electric cyan
            "#ff0077", // 2 - neon pink
            "#ffea00", // 3 - bright yellow
            "#7000ff", // 4 - neon purple
            "#00ff66", // 5 - lime green
            "#ff7700", // 6 - neon orange
            "#00a8ff", // 7 - vivid sky blue
            "#ff00ea", // 8 - magenta
            "#00ffea", // 9 - bright turquoise
            "#ff3300", // 10 - flaming red
            "#c800ff", // 11 - violet
            "#ffffff"  // 12+ - crisp white
        ]
    },
    thermal: {
        name: "Thermal Heatmap",
        bg: "#06060c",
        grid: "rgba(255, 255, 255, 0.04)",
        colors: [
            "#3a1c71", // 1 - deep indigo
            "#6b1178", // 2 - violet
            "#9b0f69", // 3 - crimson magenta
            "#c82348", // 4 - ruby red
            "#eb4c24", // 5 - vermillion
            "#f87b1b", // 6 - amber orange
            "#fca627", // 7 - golden yellow
            "#fad443", // 8 - bright yellow
            "#fdf178", // 9 - cream
            "#ffffaa", // 10 - white gold
            "#ffffff"  // 11+ - pure white
        ]
    },
    classic: {
        name: "BB Challenge Classic",
        bg: "#101216",
        grid: "rgba(255, 255, 255, 0.06)",
        colors: [
            "#3b82f6", // 1 - blue
            "#ef4444", // 2 - red
            "#10b981", // 3 - emerald
            "#f59e0b", // 4 - amber
            "#8b5cf6", // 5 - purple
            "#ec4899", // 6 - pink
            "#06b6d4", // 7 - cyan
            "#84cc16", // 8 - lime
            "#f97316", // 9 - orange
            "#6366f1", // 10 - indigo
            "#14b8a6", // 11 - teal
            "#a855f7"  // 12+ - fuchsia
        ]
    },
    terminal: {
        name: "Wiki Terminal Dots",
        bg: "#0a0d0a",
        grid: "rgba(0, 255, 65, 0.05)",
        colors: [
            "#00ff41", // 1
            "#22dd44", // 2
            "#44ff66", // 3
            "#66ff88", // 4
            "#88ffaa", // 5
            "#aaffcc", // 6
            "#ccffee", // 7
            "#ffffff"  // 8+
        ]
    }
};
