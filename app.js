/**

 * Pebble Automaton Lab - Main Application Logic

 * Integrates Canvas Space-Time Diagram, Rule Editor, Simulator,

 * and Multi-Threaded Finder.

 */



import { PebbleRule, PebbleSimulator, PRESETS, COLOR_PALETTES, HyperStep } from "./engine.js";
import { encodeGIF } from "./gif-encoder.js";



// State

let currentRule = PebbleRule.fromString("00_11_03_21_40_15", 6);

let simulator = new PebbleSimulator(currentRule);
window.simulator = simulator;

let customTape = null; // null or Array of [x, val]



let currentPaletteKey = "cyberpunk";

let currentRenderMode = "blocks";

let autoFollowCenter = true;



let isPlaying = false;

let playInterval = null;

let simSpeed = 30; // steps per second



// Camera / Viewport Transform

const view = {

    scale: 24, // uniform scale

    scaleX: 24, // horizontal pixels per cell

    scaleY: 24, // vertical pixels per step

    isAnamorphic: true, // auto-fits both width and million-step height
    aspectWidthRatio: 1.0, // user-customizable X width ratio (0.05 to 1.0) for thinner/slimmer diagrams

    panX: 0,

    panY: 20,

    isDragging: false,

    dragStartX: 0,

    dragStartY: 0,

    panStartX: 0,

    panStartY: 0

};
window.view = view;



// Backend state

let nativeEngineAvailable = false;

let activeEventSource = null;

let fallbackWorker = null;



// DOM Elements

const canvas = document.getElementById("spacetime-canvas");

const ctx = canvas.getContext("2d");

const container = document.getElementById("canvas-container");

const tooltip = document.getElementById("hover-tooltip");



const engineStatusEl = document.getElementById("engine-status");

const presetSelect = document.getElementById("preset-select");

const paletteSelect = document.getElementById("palette-select");

const renderModeSelect = document.getElementById("render-mode");



const btnPlay = document.getElementById("btn-play");

const btnPrev = document.getElementById("btn-prev");

const btnNext = document.getElementById("btn-next");

const btnReset = document.getElementById("btn-reset");

const btnRunAll = document.getElementById("btn-run-all");



const stepScrubber = document.getElementById("step-scrubber");

const stepLabel = document.getElementById("step-label");

const speedSlider = document.getElementById("speed-slider");

const speedLabel = document.getElementById("speed-label");

const autoStopDecider = document.getElementById("auto-stop-decider");



const statStatus = document.getElementById("stat-status");

const statSteps = document.getElementById("stat-steps");

const statCells = document.getElementById("stat-cells");

const statWidth = document.getElementById("stat-width");

const statRange = document.getElementById("stat-range");

const statPebbles = document.getElementById("stat-pebbles");



const inputN = document.getElementById("input-n");

const btnNDec = document.getElementById("btn-n-dec");

const btnNInc = document.getElementById("btn-n-inc");

const inputRuleCode = document.getElementById("input-rule-code");

const btnApplyCode = document.getElementById("btn-apply-code");

const btnCopyCode = document.getElementById("btn-copy-code");

const btnCopyWiki = document.getElementById("btn-copy-wiki");

const btnFlipRule = document.getElementById("btn-flip-rule");

const btnRandomRule = document.getElementById("btn-random-rule");

const btnResetRule = document.getElementById("btn-reset-rule");

const ruleGrid = document.getElementById("rule-grid");



const btnFmtAuto = document.getElementById("btn-fmt-auto");

const btnFmtSparse = document.getElementById("btn-fmt-sparse");

const btnFmtDense = document.getElementById("btn-fmt-dense");



let currentRuleFormat = "auto";



function updateRuleCodeDisplay() {

    if (inputRuleCode && currentRule) {

        inputRuleCode.value = currentRule.toShortString(currentRuleFormat);

    }

}



function setRuleFormat(fmt) {

    currentRuleFormat = fmt;

    if (btnFmtAuto) btnFmtAuto.classList.toggle("active", fmt === "auto");

    if (btnFmtSparse) btnFmtSparse.classList.toggle("active", fmt === "sparse");

    if (btnFmtDense) btnFmtDense.classList.toggle("active", fmt === "dense");

    updateRuleCodeDisplay();

}



if (btnFmtAuto) btnFmtAuto.addEventListener("click", () => setRuleFormat("auto"));

if (btnFmtSparse) btnFmtSparse.addEventListener("click", () => setRuleFormat("sparse"));

if (btnFmtDense) btnFmtDense.addEventListener("click", () => setRuleFormat("dense"));



if (btnCopyWiki) {

    btnCopyWiki.addEventListener("click", () => {

        if (currentRule) {

            navigator.clipboard.writeText(currentRule.toLongString());

            btnCopyWiki.textContent = "✓ Copied Wiki!";

            setTimeout(() => btnCopyWiki.textContent = "📋 Copy Wiki", 1500);

        }

    });

}



const btnZoomIn = document.getElementById("btn-zoom-in");

const btnZoomOut = document.getElementById("btn-zoom-out");

const btnFit = document.getElementById("btn-fit");

const btnFollow = document.getElementById("btn-follow");

const btnExportPng = document.getElementById("btn-export-png");
const btnExportGif = document.getElementById("btn-export-gif");
const btnRecordVideo = document.getElementById("btn-record-video");

const btnExportAscii = document.getElementById("btn-export-ascii");



// Finder DOM

const finderN = document.getElementById("finder-n");

const finderMode = document.getElementById("finder-mode");

const finderMaxSteps = document.getElementById("finder-max-steps");

const finderDuration = document.getElementById("finder-duration");

const btnStartFinder = document.getElementById("btn-start-finder");

const btnStopFinder = document.getElementById("btn-stop-finder");

const hudRate = document.getElementById("hud-rate");

const hudEvaluated = document.getElementById("hud-evaluated");

const hudTime = document.getElementById("hud-time");

const hudChampion = document.getElementById("hud-champion");

const finderProgressBar = document.getElementById("finder-progress-bar");

const leaderboardBody = document.getElementById("leaderboard-body");

const leaderboardCount = document.getElementById("leaderboard-count");



const hudHoldouts = document.getElementById("hud-holdouts");

const holdoutsCountBadge = document.getElementById("holdouts-count-badge");

const btnDownloadHoldouts = document.getElementById("btn-download-holdouts");

const btnToggleHoldoutsTable = document.getElementById("btn-toggle-holdouts-table");

const holdoutsPreviewWrap = document.getElementById("holdouts-preview-wrap");

const holdoutsBody = document.getElementById("holdouts-body");



let currentHoldoutCount = 0;

let currentHoldoutSamples = [];

let currentHoldoutsAll = null;



// Initialize Presets Dropdown

function initPresets() {

    presetSelect.innerHTML = '<option value="">-- Choose Preset Machine --</option>';

    PRESETS.forEach((p, idx) => {

        const opt = document.createElement("option");

        opt.value = idx;

        opt.textContent = `${p.name} (${p.n} pebbles)`;

        presetSelect.appendChild(opt);

    });



    presetSelect.addEventListener("change", (e) => {

        const idx = e.target.value;

        if (idx !== "") {

            loadPreset(PRESETS[idx]);

        }

    });

}



function loadPreset(preset) {
    if (!preset) return;
    inputN.value = preset.n;
    currentRule = PebbleRule.fromString(preset.code, preset.n);
    updateRuleCodeDisplay();
    finderN.value = preset.n;
    updateQuickNPills(preset.n);
    rebuildRuleTable();

    if (preset.customTape) {
        customTape = preset.customTape.slice();
        if (inputCustomTape) inputCustomTape.value = preset.customTapeStr || "";
        if (tapeBody) tapeBody.classList.remove("hidden");
        if (preset.name.includes("4×9") || preset.name.includes("1M/s")) {
            setSpeed(1000000);
            if (autoStopDecider) autoStopDecider.checked = false;
        }
    } else {
        customTape = null;
        if (inputCustomTape) inputCustomTape.value = "";
    }

    resetSimulation();
    fitToScreen();
}



// Check Backend Engine Status

async function checkEngineStatus() {

    try {

        const resp = await fetch("/api/status");

        if (resp.ok) {

            const data = await resp.json();

            if (data.native_engine) {

                nativeEngineAvailable = true;

                engineStatusEl.className = "status-pill status-connected";

                engineStatusEl.innerHTML = `<span class="dot"></span><span class="status-text">⚡ Native 16-Thread C Engine</span>`;

                return;

            }

        }

    } catch (err) {

        // Server not running; fallback to Web Worker

    }

    nativeEngineAvailable = false;

    engineStatusEl.className = "status-pill status-fallback";

    engineStatusEl.innerHTML = `<span class="dot"></span><span class="status-text">Client Web Worker Engine</span>`;

}



// Canvas & Camera Handling

function resizeCanvas() {

    const rect = container.getBoundingClientRect();

    const dpr = window.devicePixelRatio || 1;

    canvas.width = rect.width * dpr;

    canvas.height = rect.height * dpr;

    ctx.scale(dpr, dpr);

    renderDiagram();
    if (typeof renderTapeRibbon === 'function') renderTapeRibbon();
}



window.addEventListener("resize", resizeCanvas);



function centerCamera() {

    const rect = container.getBoundingClientRect();

    view.panX = rect.width / 2;

    view.panY = 30;

    renderDiagram();
    if (typeof renderTapeRibbon === 'function') renderTapeRibbon();
}



function fitToScreen() {
    const rect = container.getBoundingClientRect();
    if (simulator.history.length === 0) return;

    let minX = 0, maxX = 0;
    if (simulator.historyMinX !== undefined && simulator.historyMaxX !== undefined && (simulator.historyMinX !== 0 || simulator.historyMaxX !== 0)) {
        minX = simulator.historyMinX;
        maxX = simulator.historyMaxX;
    } else {
        simulator.history.forEach(h => {
            if (h.minX < minX) minX = h.minX;
            if (h.maxX > maxX) maxX = h.maxX;
        });
    }

    const maxAbsX = Math.max(Math.abs(minX), Math.abs(maxX));
    const tapeWidth = Math.max(8, 2 * maxAbsX + 4);
    const maxHistStep = (simulator.history.length > 0) ? simulator.history[simulator.history.length - 1].step : Math.max(12, simulator.step || 12);
    const totalSteps = Math.max(12, maxHistStep);

    const aspectFactor = view.aspectWidthRatio || 1.0;
    const targetScaleX = ((rect.width - 80) * aspectFactor) / tapeWidth;
    const targetScaleY = (rect.height - 80) / totalSteps;

    if (view.isAnamorphic || totalSteps > 2000 || (tapeWidth / totalSteps < 0.1)) {
        view.scaleX = Math.max(1e-300, Math.min(50, targetScaleX));
        view.scaleY = Math.max(1e-300, Math.min(50, targetScaleY));
        view.scale = Math.min(view.scaleX, view.scaleY);
    } else {
        const unified = Math.max(1e-300, Math.min(36, Math.min(targetScaleX, targetScaleY)));
        view.scale = unified;
        view.scaleX = unified;
        view.scaleY = unified;
    }

    view.panX = rect.width / 2;
    view.panY = 30;
    renderDiagram();
}



// Fast Pixel Blitter Helpers
function hexToUint32(hex, alpha = 255) {
    if (!hex) return 0xFFFFFFFF;
    if (hex.startsWith('#')) hex = hex.slice(1);
    if (hex.length === 3) {
        hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
    }
    const r = parseInt(hex.slice(0, 2), 16) || 0;
    const g = parseInt(hex.slice(2, 4), 16) || 0;
    const b = parseInt(hex.slice(4, 6), 16) || 0;
    return ((alpha << 24) | (b << 16) | (g << 8) | r) >>> 0;
}

let offscreenImg = null;
let offscreenBuf32 = null;
let cachedPaletteKey = null;
let cachedPaletteU32 = null;
let cachedBgU32 = 0;
let cachedGridU32 = 0;

function getPaletteUint32(pal, key) {
    if (cachedPaletteKey === key && cachedPaletteU32) {
        return { bg: cachedBgU32, grid: cachedGridU32, colors: cachedPaletteU32 };
    }
    cachedPaletteKey = key;
    cachedBgU32 = hexToUint32(pal.bg);
    cachedGridU32 = hexToUint32(pal.grid, 100);
    cachedPaletteU32 = (pal.colors || []).map(c => hexToUint32(c));
    return { bg: cachedBgU32, grid: cachedGridU32, colors: cachedPaletteU32 };
}

// Render Space-Time Diagram (Ultra-Fast Hybrid Pipeline: Direct Pixel Blitting for High Speed + Vector for Zoomed-In)

function renderDiagramDirectPixels(cw, ch, dpr, scaleX, scaleY, panX, panY, pal) {
    if (!offscreenImg || offscreenImg.width !== cw || offscreenImg.height !== ch) {
        offscreenImg = ctx.createImageData(cw, ch);
        offscreenBuf32 = new Uint32Array(offscreenImg.data.buffer);
    }

    const { bg, grid, colors } = getPaletteUint32(pal, currentPaletteKey);
    offscreenBuf32.fill(bg);

    const physPanX = panX * dpr;
    const physPanY = panY * dpr;
    const physScaleX = scaleX * dpr;
    const physScaleY = scaleY * dpr;

    // Center x=0 guideline
    const screenX0 = Math.floor(physPanX);
    if (screenX0 >= 0 && screenX0 < cw) {
        for (let y = 0; y < ch; y += 4) {
            if ((y & 4) === 0) {
                offscreenBuf32[y * cw + screenX0] = grid;
            }
        }
    }

    const histCount = simulator.history.length;
    if (histCount === 0) {
        ctx.putImageData(offscreenImg, 0, 0);
        return;
    }

    // High-precision adaptive sub-pixel step increment:
    // Ensures consecutive drawn steps never jump more than 1.2 physical pixels on screen,
    // guaranteeing 100% gapless, crystalline, solid lines without sub-pixel overdraw lag!
    const histStride = simulator.historyStride || 1;
    // Always draw every single recorded history step (never thin out the diagram on zoom-out!)
    const renderIncr = 1;
    const numColors = colors.length;

    const drawEntry = (i) => {
        const hist = simulator.history[i];
        if (!hist) return;

        const py = Math.floor(physPanY + hist.step * physScaleY);
        const nextHist = (i + renderIncr < histCount) ? simulator.history[i + renderIncr] : null;
        const stepSpan = nextHist ? (nextHist.step - hist.step) : histStride;

        const wallH = Math.max(2, Math.min(48, Math.ceil(stepSpan * physScaleY)));
        const dotH = Math.max(2, Math.min(3, Math.round(physScaleX)));
        const cellW = Math.max(2, Math.min(32, Math.round(physScaleX)));

        if (py + wallH < 0 || py >= ch) return;

        const t = hist.tape;
        const nt = nextHist ? nextHist.tape : null;

        if (t && t.xs && t.vs) {
            const cxs = t.xs;
            const cvs = t.vs;
            const clen = t.len;
            const nxs = (nt && nt.xs) ? nt.xs : null;
            const nlen = (nt && nt.xs) ? nt.len : 0;

            for (let k = 0; k < clen; k++) {
                const val = cvs[k];
                if (val <= 0) continue;
                const x = cxs[k];
                const px = Math.floor(physPanX + (x - 0.5) * physScaleX);
                if (px + cellW < 0 || px >= cw) continue;

                // Determine if this cell is a persistent wall/boundary or a fast-moving interior shuttle dot
                let isPersistentWall = (wallH <= 3);
                if (!isPersistentWall && nxs && nlen === clen && k < nlen) {
                    // Check if corresponding island cell in nextHist is the same wall/glider trajectory
                    const nx = nxs[k];
                    const dx = Math.abs(nx - x);
                    // Static wall or slow boundary wall (as opposed to shuttle jumping across the cavity)
                    if (dx <= Math.max(2, Math.abs(x) * 0.01)) {
                        isPersistentWall = true;
                    }
                }

                const effH = isPersistentWall ? wallH : dotH;
                const maxPy = Math.min(ch, py + effH);
                const minCy = Math.max(0, py);
                if (minCy >= maxPy) continue;

                const col = colors[Math.min(val - 1, numColors - 1)];

                // If persistent wall shifted slightly in X over a multi-pixel vertical span, interpolate X per scanline for smooth curves!
                if (isPersistentWall && effH > 3 && nxs && nlen === clen && k < nlen && nxs[k] !== x) {
                    const nextPx = Math.floor(physPanX + (nxs[k] - 0.5) * physScaleX);
                    const dPx = nextPx - px;
                    if (Math.abs(dPx) <= 16) {
                        for (let cy = minCy; cy < maxPy; cy++) {
                            const fracY = (cy - py) / effH;
                            const rowPx = Math.floor(px + dPx * fracY);
                            const minCx = Math.max(0, rowPx);
                            const maxPx = Math.min(cw, rowPx + cellW);
                            const rOffset = cy * cw;
                            for (let cx = minCx; cx < maxPx; cx++) {
                                offscreenBuf32[rOffset + cx] = col;
                            }
                        }
                        continue;
                    }
                }

                const maxPx = Math.min(cw, px + cellW);
                const minCx = Math.max(0, px);
                for (let cy = minCy; cy < maxPy; cy++) {
                    const rOffset = cy * cw;
                    for (let cx = minCx; cx < maxPx; cx++) {
                        offscreenBuf32[rOffset + cx] = col;
                    }
                }
            }
        } else {
            const maxPy = Math.min(ch, py + dotH);
            const minCy = Math.max(0, py);
            for (const [x, val] of t) {
                if (val <= 0) continue;
                const px = Math.floor(physPanX + (x - 0.5) * physScaleX);
                if (px + cellW < 0 || px >= cw) continue;

                const col = colors[Math.min(val - 1, numColors - 1)];
                const maxPx = Math.min(cw, px + cellW);
                const minCx = Math.max(0, px);

                for (let cy = minCy; cy < maxPy; cy++) {
                    const rOffset = cy * cw;
                    for (let cx = minCx; cx < maxPx; cx++) {
                        offscreenBuf32[rOffset + cx] = col;
                    }
                }
            }
        }
    };

    // Draw sampled history entries
    for (let i = 0; i < histCount; i += renderIncr) {
        drawEntry(i);
    }

    // Always draw the latest active generation at the current head
    if (histCount > 0 && (histCount - 1) % renderIncr !== 0) {
        drawEntry(histCount - 1);
    }

    // Current step scrubber marker line
    const maxHistStep1 = (histCount > 0) ? simulator.history[histCount - 1].step : simulator.step;
    const curStepCoord1 = (Number.isFinite(simulator.step) && simulator.step <= maxHistStep1) ? simulator.step : maxHistStep1;
    const currentStepY = Math.floor(physPanY + curStepCoord1 * physScaleY);
    if (currentStepY >= 0 && currentStepY < ch) {
        const markerCol = 0x88FF0000; // translucent cyan timeline line
        const rOffset = currentStepY * cw;
        for (let cx = 0; cx < cw; cx++) {
            offscreenBuf32[rOffset + cx] = markerCol;
        }
    }

    // Put image data directly to canvas in one instantaneous hardware blit
    ctx.putImageData(offscreenImg, 0, 0);
}

function renderDiagramVector(w, h, dpr, scaleX, scaleY, panX, panY, pal) {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);

    // Clear background
    ctx.fillStyle = pal.bg;
    ctx.fillRect(0, 0, w, h);

    // Coordinate guidelines
    ctx.strokeStyle = pal.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.setLineDash([4, 4]);
    ctx.moveTo(panX, 0);
    ctx.lineTo(panX, h);
    ctx.stroke();
    ctx.setLineDash([]);

    const getColorForVal = (val) => {
        if (val <= 0) return null;
        const idx = Math.min(val - 1, pal.colors.length - 1);
        return pal.colors[idx];
    };

    const cellSize = Math.max(1, scaleX >= 1 ? (scaleX - (scaleX > 12 ? 2 : 0)) : scaleX);
    const cellW = Math.max(2.0, scaleX >= 1 ? (scaleX - (scaleX > 12 ? 2 : 0)) : scaleX);
    const cellH = Math.max(1.5, scaleY >= 1 ? (scaleY - (scaleY > 12 ? 2 : 0)) : scaleY);
    const padX = (scaleX > 12) ? 1 : 0;
    const padY = (scaleY > 12) ? 1 : 0;

    for (let i = 0; i < simulator.history.length; i++) {
        const hist = simulator.history[i];
        if (!hist) continue;

        const y = panY + hist.step * scaleY;
        if (y + cellH < 0 || y > h) continue;

        for (const [x, val] of hist.tape) {
            if (val <= 0) continue;
            const screenX = panX + (x - 0.5) * scaleX;
            if (screenX + Math.max(cellW, scaleX) < 0 || screenX > w) continue;

            const col = getColorForVal(val);

            if (currentRenderMode === "wiki" && scaleX >= 10 && scaleY >= 10) {
                ctx.fillStyle = col || "#fff";
                ctx.font = `${Math.max(10, Math.min(scaleX, scaleY) * 0.75)}px ${getComputedStyle(document.body).getPropertyValue('--font-code')}`;
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                const ch = val < 16 ? val.toString(16) : "#";
                ctx.fillText(ch, screenX + scaleX / 2, y + scaleY / 2);
            } else {
                ctx.fillStyle = col;
                ctx.fillRect(screenX + padX, y + padY, cellW, cellH);

                if (currentRenderMode === "numbers" && scaleX >= 16 && scaleY >= 14) {
                    ctx.fillStyle = val > 6 ? "#000" : "#fff";
                    ctx.font = `bold ${Math.max(9, Math.floor(Math.min(scaleX, scaleY) * 0.55))}px ${getComputedStyle(document.body).getPropertyValue('--font-code')}`;
                    ctx.textAlign = "center";
                    ctx.textBaseline = "middle";
                    ctx.fillText(val < 16 ? val.toString(16) : val, screenX + scaleX / 2, y + scaleY / 2);
                }
            }
        }
    }

    const histCountV = simulator.history.length;
    const maxHistStepV = (histCountV > 0) ? simulator.history[histCountV - 1].step : simulator.step;
    const curStepCoordV = (Number.isFinite(simulator.step) && simulator.step <= maxHistStepV) ? simulator.step : maxHistStepV;
    const currentStepY = panY + curStepCoordV * scaleY;
    if (currentStepY >= 0 && currentStepY <= h) {
        ctx.strokeStyle = "rgba(0, 240, 255, 0.4)";
        ctx.lineWidth = 1;
        ctx.strokeRect(0, currentStepY, w, Math.max(1, scaleY));
    }

    ctx.restore();
}

function renderDiagram() {
    const rect = container.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    if (w <= 0 || h <= 0) return;

    const cw = canvas.width;
    const ch = canvas.height;
    if (cw <= 0 || ch <= 0) return;

    const pal = COLOR_PALETTES[currentPaletteKey] || COLOR_PALETTES.cyberpunk;
    const dpr = window.devicePixelRatio || 1;
    const scaleX = view.scaleX || view.scale || 16;
    const scaleY = view.scaleY || view.scale || 16;
    const { panX, panY } = view;

    // Direct pixel rendering for zoomed-out / fast play (75x faster, 0 lag!)
    if (scaleX < 8 || scaleY < 8) {
        renderDiagramDirectPixels(cw, ch, dpr, scaleX, scaleY, panX, panY, pal);
    } else {
        renderDiagramVector(w, h, dpr, scaleX, scaleY, panX, panY, pal);
    }
}



// Canvas Mouse & Interaction Handling

container.addEventListener("mousedown", (e) => {

    if (e.button === 0) {

        view.isDragging = true;

        view.dragStartX = e.clientX;

        view.dragStartY = e.clientY;

        view.panStartX = view.panX;

        view.panStartY = view.panY;

        container.classList.add("grabbing");

    }

});



window.addEventListener("mousemove", (e) => {

    if (view.isDragging) {

        view.panX = view.panStartX + (e.clientX - view.dragStartX);

        view.panY = view.panStartY + (e.clientY - view.dragStartY);

        renderDiagram();

    } else {

        updateTooltip(e);

    }

});



window.addEventListener("mouseup", () => {

    if (view.isDragging) {

        view.isDragging = false;

        container.classList.remove("grabbing");

    }

});



container.addEventListener("wheel", (e) => {
    e.preventDefault();
    const rect = container.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const zoomFactor = e.deltaY < 0 ? 1.2 : 0.83;
    const oldScaleX = view.scaleX || view.scale;
    const oldScaleY = view.scaleY || view.scale;

    let newScaleX = oldScaleX;
    let newScaleY = oldScaleY;

    if (e.shiftKey) {
        // Shift + Wheel = Zoom Tape Width (X) only
        newScaleX = Math.max(1e-300, Math.min(100, oldScaleX * zoomFactor));
    } else if (e.altKey) {
        // Alt + Wheel = Zoom Generations / Steps (Y) only
        newScaleY = Math.max(1e-300, Math.min(100, oldScaleY * zoomFactor));
    } else {
        // Wheel = Zoom both
        newScaleX = Math.max(1e-300, Math.min(100, oldScaleX * zoomFactor));
        newScaleY = Math.max(1e-300, Math.min(100, oldScaleY * zoomFactor));
    }

    view.panX = mouseX - (mouseX - view.panX) * (newScaleX / oldScaleX);
    view.panY = mouseY - (mouseY - view.panY) * (newScaleY / oldScaleY);
    view.scaleX = newScaleX;
    view.scaleY = newScaleY;
    view.scale = Math.min(newScaleX, newScaleY);

    renderDiagram();
    updateTooltip(e);
}, { passive: false });



container.addEventListener("mouseleave", () => {

    tooltip.classList.add("hidden");

});



function updateTooltip(e) {

    const rect = container.getBoundingClientRect();

    const mouseX = e.clientX - rect.left;

    const mouseY = e.clientY - rect.top;



    const t = Math.floor((mouseY - view.panY) / (view.scaleY || view.scale));
    const x = Math.round((mouseX - view.panX) / (view.scaleX || view.scale));



    if (t >= 0 && t < simulator.history.length) {

        const hist = simulator.history[t];

        const val = hist.tape.get(x) || 0;



        if (val > 0) {

            const r = currentRule.rules[val] || { L: 0, S: val, R: 0 };

            tooltip.innerHTML = `<strong>Position x = ${x}, Step t = ${t}</strong>\n` +

                                `Pebbles: <span style="color:var(--accent-cyan)">${val}</span>\n` +

                                `Action: 🠐 L: ${r.L}  |  ⬤ Stay: ${r.S}  |  🠒 R: ${r.R}`;

            tooltip.style.left = `${Math.min(rect.width - 200, mouseX + 15)}px`;

            tooltip.style.top = `${Math.min(rect.height - 90, mouseY + 15)}px`;

            tooltip.classList.remove("hidden");

            return;

        }

    }

    tooltip.classList.add("hidden");

}



// Simulation Stepping & Playback

function stepSimulation() {

    const allowContinue = autoStopDecider ? !autoStopDecider.checked : false;

    simulator.stepForward(allowContinue);

    updateUI();

    renderDiagram();
    if (typeof renderTapeRibbon === 'function') renderTapeRibbon();
}



function resetSimulation() {

    stopPlay();

    // Guarantee simulator is always synced with the latest currentRule and current n!

    simulator.setRule(currentRule);

    simulator.reset(customTape);
    simulator.stepHyper = null;
    simulator.customWidthStr = null;
    simulator.customRangeStr = null;

    updateUI();

    renderDiagram();
    if (typeof renderTapeRibbon === 'function') renderTapeRibbon();
}



function updateUI() {
    stepScrubber.max = Math.max(0, simulator.history.length - 1);
    stepScrubber.value = Math.max(0, simulator.history.length - 1);
    if (simulator.stepHyper) {
        const hStr = simulator.stepHyper.toString();
        stepLabel.textContent = `Step: ${hStr}`;
        statSteps.textContent = hStr;
        statSteps.title = hStr;
    } else {
        const fmtStep = formatLargeCount(simulator.step, simulator.stepBig);
        stepLabel.textContent = `Step: ${fmtStep}`;
        statSteps.textContent = fmtStep;
        if (simulator.stepBig !== undefined) {
            statSteps.title = simulator.stepBig.toString() + " steps";
        }
    }

    let pebbleSum = 0;
    for (const val of simulator.tape.values()) pebbleSum += val;
    statPebbles.textContent = pebbleSum || simulator.n;

    const statMemory = document.getElementById("stat-memory");
    if (statMemory && typeof simulator.getMemoryUsageBytes === "function") {
        const mb = simulator.getMemoryUsageBytes() / (1024 * 1024);
        statMemory.textContent = `${mb.toFixed(2)} MB`;
    }

    let minX = 0, maxX = 0;
    if (simulator.tape.size > 0) {
        let first = true;
        for (const k of simulator.tape.keys()) {
            if (first) { minX = k; maxX = k; first = false; }
            else {
                if (k < minX) minX = k;
                if (k > maxX) maxX = k;
            }
        }
        statCells.textContent = simulator.tape.size;
        statWidth.textContent = simulator.customWidthStr || formatLargeCount(maxX - minX + 1);
        statRange.textContent = simulator.customRangeStr || `[${formatLargeCount(minX)}, ${formatLargeCount(maxX)}]`;
    } else {
        statCells.textContent = 0;
        statWidth.textContent = 0;
        statRange.textContent = "[0, 0]";
    }



    if (simulator.step === 0 && simulator.status === "running") {

        statStatus.textContent = "READY (STEP 0)";

        statStatus.className = "m-val status-badge running";

    } else {

        statStatus.textContent = simulator.status.toUpperCase();

        let badgeType = "running";

        if (simulator.status.startsWith("stabilized")) badgeType = "stabilized";

        else if (simulator.status.includes("cycle") || simulator.status.includes("glider")) badgeType = "cycler";

        statStatus.className = `m-val status-badge ${badgeType}`;

    }



    const currentHist = simulator.history.length > 0 ? simulator.history[simulator.history.length - 1] : null;

    if (autoFollowCenter && (simulator.history.length > 0 || simulator.tape.size > 0)) {
        const rect = container.getBoundingClientRect();

        let allMinX = (simulator.historyMinX !== undefined) ? simulator.historyMinX : minX;
        let allMaxX = (simulator.historyMaxX !== undefined) ? simulator.historyMaxX : maxX;
        if (minX < allMinX) allMinX = minX;
        if (maxX > allMaxX) allMaxX = maxX;

        const maxAbsX = Math.max(Math.abs(allMinX), Math.abs(allMaxX));
        const curWidth = Math.max(10, 2 * maxAbsX + 4);
        const maxHistStep = (simulator.history.length > 0) ? simulator.history[simulator.history.length - 1].step : Math.max(20, simulator.step);
        const curSteps = Math.max(20, maxHistStep);

        if (view.isAnamorphic || curSteps > 2000) {
            const aspectFactor = view.aspectWidthRatio || 1.0;
            const targetScaleX = Math.max(1e-300, Math.min(50, ((rect.width - 80) * aspectFactor) / curWidth));
            const targetScaleY = Math.max(1e-300, Math.min(50, (rect.height - 80) / curSteps));

            const curSx = view.scaleX || targetScaleX;
            const curSy = view.scaleY || targetScaleY;

            // Instant snap when jumping scale orders of magnitude (e.g. cosmic leaps, initial play at 10^100/s),
            // smooth lerp during continuous playback:
            if (curSx <= 0 || targetScaleX <= 0 || (curSx / targetScaleX > 1.8) || (targetScaleX / curSx > 1.8)) {
                view.scaleX = targetScaleX;
            } else {
                view.scaleX = curSx + (targetScaleX - curSx) * 0.25;
            }

            if (curSy <= 0 || targetScaleY <= 0 || (curSy / targetScaleY > 1.8) || (targetScaleY / curSy > 1.8)) {
                view.scaleY = targetScaleY;
            } else {
                view.scaleY = curSy + (targetScaleY - curSy) * 0.25;
            }
            view.scale = Math.min(view.scaleX, view.scaleY);

            // Anchor origin x=0 rock-solid at canvas center: eliminates all left/right swaying!
            const targetPanX = rect.width / 2;
            view.panX += (targetPanX - view.panX) * 0.25;
            view.panY = 30;
        } else {
            const targetPanX = rect.width / 2;
            view.panX += (targetPanX - view.panX) * 0.15;

            const currentY = view.panY + maxHistStep * (view.scaleY || view.scale);
            if (currentY > rect.height - 60) {
                const targetPanY = rect.height - 120 - maxHistStep * (view.scaleY || view.scale);
                view.panY += (targetPanY - view.panY) * 0.2;
            }
        }
    }

}



function togglePlay() {

    if (isPlaying) {

        stopPlay();

    } else {

        startPlay();

    }

}



const SPEED_STOPS = [
    1, 5, 25, 100, 500, 2500, 10000, 50000, 200000,
    1000000,        // 1M/s
    10000000,       // 10M/s
    500000000,      // 500M/s
    1e12,           // 1T/s (Trillion)
    1e15,           // 1Qa/s (Quadrillion)
    1e18,           // 1Qi/s (Quintillion)
    1e21,           // 1Sx/s (Sextillion)
    1e24,           // 1Sp/s (Septillion)
    1e27,           // 1Oc/s (Octillion)
    1e30,           // 1No/s (Nonillion)
    1e100           // 10^100/s (Googol)
];

const SCALE_UNITS = [
    { val: 1e33, sym: "Dc", name: "Decillion", icon: "♾️" },
    { val: 1e30, sym: "No", name: "Nonillion", icon: "♾️" },
    { val: 1e27, sym: "Oc", name: "Octillion", icon: "🌀" },
    { val: 1e24, sym: "Sp", name: "Septillion", icon: "✨" },
    { val: 1e21, sym: "Sx", name: "Sextillion", icon: "🕳️" },
    { val: 1e18, sym: "Qi", name: "Quintillion", icon: "☀️" },
    { val: 1e15, sym: "Qa", name: "Quadrillion", icon: "🪐" },
    { val: 1e12, sym: "T",  name: "Trillion",    icon: "🌌" },
    { val: 1e9,  sym: "B",  name: "Billion",     icon: "🚀" },
    { val: 1e6,  sym: "M",  name: "Million",     icon: "⚡" }
];

function formatLargeCount(num, bigVal = undefined) {
    if (bigVal !== undefined && typeof bigVal === "bigint" && bigVal >= (10n ** 36n)) {
        const s = bigVal.toString();
        const len = s.length;
        if (len >= 100) {
            const count = bigVal / (10n ** 100n);
            const rem = bigVal % (10n ** 100n);
            if (count > 0n && rem === 0n) {
                return `${Number(count).toLocaleString()} × 10^100`;
            }
            const exp = len - 1;
            const mant = Number(s.slice(0, 4)) / 1000;
            return `${mant.toFixed(2)} × 10^${exp}`;
        }
        const exp = len - 1;
        const mant = Number(s.slice(0, 4)) / 1000;
        return `${mant.toFixed(2)} × 10^${exp}`;
    }
    if (!Number.isFinite(num)) return String(num);
    const abs = Math.abs(num);
    if (abs >= 1e36) {
        const exp = Math.floor(Math.log10(abs));
        const mant = abs / Math.pow(10, exp);
        if (exp >= 100 && exp % 100 === 0) {
            const c = Math.round(abs / 1e100);
            return `${c.toLocaleString()} × 10^100`;
        }
        return `${mant.toFixed(2)} × 10^${exp}`;
    }
    if (abs < 1e12) {
        return Math.round(num).toLocaleString();
    }
    const sign = num < 0 ? "-" : "";
    for (let i = 0; i < SCALE_UNITS.length; i++) {
        const u = SCALE_UNITS[i];
        if (abs >= u.val * 0.999999) {
            const scaled = abs / u.val;
            const digits = scaled >= 100 ? 1 : (scaled >= 10 ? 2 : 3);
            return `${sign}${scaled.toFixed(digits)} ${u.sym}`;
        }
    }
    return num.toExponential(2);
}

function formatRateCompact(rate) {
    if (rate >= 1e99) return "10^100/s";
    if (!Number.isFinite(rate) || rate < 0) return "0/s";
    for (let i = 0; i < SCALE_UNITS.length; i++) {
        const u = SCALE_UNITS[i];
        if (rate >= u.val * 0.999) {
            const v = rate / u.val;
            return `${v >= 100 ? Math.round(v) : v.toFixed(v >= 10 ? 1 : 2)}${u.sym}/s`;
        }
    }
    if (rate >= 1000) return `${(rate / 1000).toFixed(0)}k/s`;
    return `${Math.round(rate)}/s`;
}

function formatSpeedLabel(spd) {
    if (spd >= 1e99) return "🌌 10^100 steps/s";
    for (let i = 0; i < SCALE_UNITS.length; i++) {
        const u = SCALE_UNITS[i];
        if (spd >= u.val * 0.999) {
            const v = spd / u.val;
            return `${u.icon} ${v >= 10 ? Math.round(v) : Number(v.toFixed(1))}${u.sym} steps/s`;
        }
    }
    if (spd >= 1000) return `${(spd / 1000).toFixed(spd % 1000 === 0 ? 0 : 1)}k steps/s`;
    return `${spd} steps/s`;
}

function setSpeed(spd) {
    simSpeed = Number(spd);
    let minRatio = Infinity;
    let closestIdx = 0;
    for (let i = 0; i < SPEED_STOPS.length; i++) {
        const sStop = SPEED_STOPS[i];
        let diff = 0;
        if (simSpeed >= 1e50 || sStop >= 1e50) {
            diff = Math.abs(Math.log10(Math.max(1e50, sStop)) - Math.log10(Math.max(1e50, simSpeed)));
        } else {
            diff = Math.abs(Math.log10(sStop) - Math.log10(Math.max(1, simSpeed)));
        }
        if (diff < minRatio) {
            minRatio = diff;
            closestIdx = i;
        }
    }
    if (speedSlider) speedSlider.value = closestIdx;
    if (speedLabel) speedLabel.textContent = formatSpeedLabel(simSpeed);

    document.querySelectorAll(".btn-speed-preset").forEach(btn => {
        const numBtn = Number(btn.getAttribute("data-speed"));
        const active = Math.abs(numBtn - simSpeed) <= Math.max(1, simSpeed * 1e-6);
        btn.classList.toggle("active", active);
    });
}

let playAnimId = null;
let lastFrameTime = performance.now();
let stepAccumulator = 0;

function startPlay() {
    const allowContinue = autoStopDecider ? !autoStopDecider.checked : false;
    if (simulator.status.startsWith("stabilized")) {
        resetSimulation();
    } else if (simulator.status !== "running" && !allowContinue) {
        resetSimulation();
    }
    if (simulator.history.length > 0) {
        fitToScreen();
    }
    isPlaying = true;
    btnPlay.textContent = "⏸ Pause";
    btnPlay.classList.add("btn-danger");
    btnPlay.classList.remove("btn-primary");

    lastFrameTime = performance.now();
    stepAccumulator = 0;

    let lastSpeedMeasureTime = performance.now();
    let measuredStepsAccum = 0;

    function playLoop(now) {
        if (!isPlaying) return;
        const dt = Math.min((now - lastFrameTime) / 1000, 0.1);
        lastFrameTime = now;

        const allowCont = autoStopDecider ? !autoStopDecider.checked : false;

        // Cosmic Superluminal Speeds (Googol 10^100/s)
        if (typeof simSpeed === "number" && simSpeed >= 1e50) {
            const deltaCount = Math.max(1, Math.round(dt * 60));
            simulator.advanceCosmic(1, 100, deltaCount, allowCont);
            stepAccumulator = 0;
            measuredStepsAccum = simSpeed;

            const mNow = performance.now();
            if (mNow - lastSpeedMeasureTime >= 400) {
                lastSpeedMeasureTime = mNow;
                if (speedLabel) {
                    speedLabel.textContent = `${formatSpeedLabel(simSpeed)} (Live: 10^100/s)`;
                }
            }

            updateUI();
            renderDiagram();

            if (simulator.status.startsWith("stabilized") || (!allowCont && simulator.status !== "running")) {
                stopPlay();
                return;
            }
        } else {
            stepAccumulator += dt * simSpeed;
            const stepsToRun = stepAccumulator >= 1 ? Math.floor(stepAccumulator) : 0;

            if (stepsToRun > 0) {
                if (simSpeed <= 60 && stepsToRun <= 5) {
                    stepAccumulator -= stepsToRun;
                    for (let k = 0; k < stepsToRun; k++) {
                        simulator.stepForward(allowCont);
                        measuredStepsAccum += 1;
                        if (simulator.status.startsWith("stabilized") || (!allowCont && simulator.status !== "running")) break;
                    }
                } else {
                    const maxBudgetMs = (simSpeed >= 100000000) ? 55 : (simSpeed >= 10000000 ? 35 : 20);
                    const res = simulator.stepTurbo(stepsToRun, allowCont, maxBudgetMs);
                    const executed = (res && typeof res.executed === "number") ? res.executed : stepsToRun;
                    measuredStepsAccum += executed;

                    stepAccumulator = Math.max(0, stepAccumulator - executed);
                    if (stepAccumulator > simSpeed * 0.2) stepAccumulator = simSpeed * 0.2;
                }

                // Update real-time measured speed counter
                const mNow = performance.now();
                const mElapsed = (mNow - lastSpeedMeasureTime) / 1000;
                if (mElapsed >= 0.4) {
                    const actualRate = measuredStepsAccum / mElapsed;
                    lastSpeedMeasureTime = mNow;
                    measuredStepsAccum = 0;

                    if (speedLabel) {
                        const rateStr = formatRateCompact(actualRate);
                        speedLabel.textContent = `${formatSpeedLabel(simSpeed)} (Live: ${rateStr})`;
                    }
                }

                updateUI();
                renderDiagram();

                if (simulator.status.startsWith("stabilized") || (!allowCont && simulator.status !== "running")) {
                    stopPlay();
                    return;
                }
            }
        }

        playAnimId = requestAnimationFrame(playLoop);
    }

    if (playAnimId) cancelAnimationFrame(playAnimId);
    playAnimId = requestAnimationFrame(playLoop);
}

function stopPlay() {
    isPlaying = false;
    btnPlay.textContent = "▶ Play";
    btnPlay.classList.remove("btn-danger");
    btnPlay.classList.add("btn-primary");
    if (speedLabel) speedLabel.textContent = formatSpeedLabel(simSpeed);
    if (playAnimId) {
        cancelAnimationFrame(playAnimId);
        playAnimId = null;
    }
}

// Scrubber
stepScrubber.addEventListener("input", (e) => {
    stopPlay();
    const targetIdx = parseInt(e.target.value);
    if (targetIdx >= 0 && targetIdx < simulator.history.length) {
        const entry = simulator.history[targetIdx];
        simulator.step = entry.step;
        if (entry.tape && entry.tape.xs && entry.tape.vs) {
            simulator.tape = new Map();
            for (let i = 0; i < entry.tape.len; i++) {
                simulator.tape.set(entry.tape.xs[i], entry.tape.vs[i]);
            }
        } else {
            simulator.tape = new Map(entry.tape);
        }
        simulator.status = simulator.step === simulator.history.length - 1 && simulator.isStabilized() ? "stabilized" : "running";
        updateUI();
        renderDiagram();
    }
});

// Speed slider
if (speedSlider) {
    speedSlider.addEventListener("input", (e) => {
        const idx = parseInt(e.target.value);
        const spd = SPEED_STOPS[idx] || 100;
        setSpeed(spd);
    });
}

// Preset speed buttons
document.querySelectorAll(".btn-speed-preset").forEach(btn => {
    btn.addEventListener("click", () => {
        const spd = btn.getAttribute("data-speed");
        setSpeed(spd);
    });
});



// Buttons

btnPlay.addEventListener("click", togglePlay);

btnPrev.addEventListener("click", () => {

    stopPlay();

    if (simulator.step > 0) {

        simulator.step--;

        simulator.tape = new Map(simulator.history[simulator.step].tape);

        updateUI();

        renderDiagram();

    }

});

btnNext.addEventListener("click", () => {

    stopPlay();

    stepSimulation();

});

btnReset.addEventListener("click", resetSimulation);

btnRunAll.addEventListener("click", () => {

    stopPlay();

    const maxSteps = parseInt(document.getElementById("sim-max-steps")?.value) || 10000;

    const allowContinue = autoStopDecider ? !autoStopDecider.checked : false;

    simulator.runUntil(maxSteps, allowContinue);

    updateUI();

    renderDiagram();

    fitToScreen();

});



btnZoomIn.addEventListener("click", () => {
    const factor = 1.3;
    view.scaleX = Math.min(100, (view.scaleX || view.scale) * factor);
    view.scaleY = Math.min(100, (view.scaleY || view.scale) * factor);
    view.scale = Math.min(view.scaleX, view.scaleY);
    renderDiagram();
});

btnZoomOut.addEventListener("click", () => {
    const factor = 0.75;
    view.scaleX = Math.max(1e-300, (view.scaleX || view.scale) * factor);
    view.scaleY = Math.max(1e-300, (view.scaleY || view.scale) * factor);
    view.scale = Math.min(view.scaleX, view.scaleY);
    renderDiagram();
});

const btnAspect = document.getElementById("btn-aspect");
if (btnAspect) {
    btnAspect.addEventListener("click", () => {
        view.isAnamorphic = !view.isAnamorphic;
        btnAspect.classList.toggle("active", view.isAnamorphic);
        fitToScreen();
    });
}

const aspectWidthSlider = document.getElementById("aspect-width-slider");
const aspectWidthLabel = document.getElementById("aspect-width-label");
if (aspectWidthSlider) {
    aspectWidthSlider.addEventListener("input", (e) => {
        const val = parseInt(e.target.value) || 100;
        view.aspectWidthRatio = Math.max(0.05, Math.min(1.0, val / 100));
        if (aspectWidthLabel) aspectWidthLabel.textContent = `${val}%`;
        fitToScreen();
    });
}

btnFit.addEventListener("click", fitToScreen);

btnFollow.addEventListener("click", () => {

    autoFollowCenter = !autoFollowCenter;

    btnFollow.classList.toggle("active", autoFollowCenter);

});



paletteSelect.addEventListener("change", (e) => {

    currentPaletteKey = e.target.value;

    renderDiagram();

    rebuildRuleTable();

});



renderModeSelect.addEventListener("change", (e) => {

    currentRenderMode = e.target.value;

    renderDiagram();
    if (typeof renderTapeRibbon === 'function') renderTapeRibbon();
});



// Rule Editor & Table

function rebuildRuleTable() {

    const pal = COLOR_PALETTES[currentPaletteKey] || COLOR_PALETTES.cyberpunk;

    ruleGrid.innerHTML = "";



    for (let k = 1; k <= currentRule.n; k++) {

        const r = currentRule.rules[k] || { L: 0, S: k, R: 0 };

        const row = document.createElement("div");

        row.className = "rule-row";



        const colIdx = Math.min(k - 1, pal.colors.length - 1);

        const col = pal.colors[colIdx];



        row.innerHTML = `

            <div class="val-badge" style="background:${col}">${k < 16 ? k.toString(16) : k}</div>

            <div class="rule-control">

                <label>Left (🠐)</label>

                <input type="number" min="0" max="${k}" value="${r.L}" class="input-L" data-k="${k}">

            </div>

            <div class="stay-box">

                <div style="font-size:0.65rem; color:var(--text-muted)">Stay (⬤)</div>

                <div class="stay-num" id="stay-val-${k}">${r.S}</div>

            </div>

            <div class="rule-control">

                <label>Right (🠒)</label>

                <input type="number" min="0" max="${k}" value="${r.R}" class="input-R" data-k="${k}">

            </div>

            <div style="text-align:right">

                <button class="btn btn-xs btn-zero" data-k="${k}" title="Set to 0 0 (Halt)">0 0</button>

            </div>

        `;



        const inputL = row.querySelector(".input-L");

        const inputR = row.querySelector(".input-R");

        const stayVal = row.querySelector(`#stay-val-${k}`);

        const btnZero = row.querySelector(".btn-zero");



        const updateFromInputs = () => {

            let l = parseInt(inputL.value) || 0;

            let r = parseInt(inputR.value) || 0;

            if (l < 0) l = 0;

            if (l > k) l = k;

            if (r < 0) r = 0;

            if (r > k - l) r = k - l;

            inputL.value = l;

            inputR.value = r;



            currentRule.set(k, l, r);

            stayVal.textContent = k - l - r;

            updateRuleCodeDisplay();

            resetSimulation();

        };



        inputL.addEventListener("input", updateFromInputs);

        inputR.addEventListener("input", updateFromInputs);

        btnZero.addEventListener("click", () => {

            inputL.value = 0;

            inputR.value = 0;

            updateFromInputs();

        });



        ruleGrid.appendChild(row);

    }

}



// Total Pebbles (n) Handlers

function setN(newN) {

    newN = Math.max(1, Math.min(128, newN));

    inputN.value = newN;

    finderN.value = newN;

    updateQuickNPills(newN);



    // If an official preset champion exists for this exact n, auto-load it

    const matchingPreset = PRESETS.find(p => p.n === newN && typeof p.steps === "number");

    let newRule;

    if (matchingPreset) {

        newRule = PebbleRule.fromString(matchingPreset.code, newN);

    } else {

        newRule = new PebbleRule(newN);

        for (let k = 1; k <= Math.min(newN, currentRule ? currentRule.n : 0); k++) {

            if (currentRule && currentRule.rules[k]) {

                newRule.set(k, currentRule.rules[k].L, currentRule.rules[k].R);

            }

        }

        // Guarantee that the top rule for newN has active movement so pebbles disperse

        if (newN > 1 && newRule.rules[newN].L === 0 && newRule.rules[newN].R === 0) {

            const halfL = Math.floor(newN / 2);

            const halfR = newN - halfL;

            newRule.set(newN, halfL, halfR);

        }

        // Rule 1 is always (0, 0) halting

        newRule.set(1, 0, 0);

    }



    currentRule = newRule;

    updateRuleCodeDisplay();

    rebuildRuleTable();

    resetSimulation();

    fitToScreen();

}



inputN.addEventListener("change", (e) => setN(parseInt(e.target.value) || 6));

btnNDec.addEventListener("click", () => setN(parseInt(inputN.value) - 1));

btnNInc.addEventListener("click", () => setN(parseInt(inputN.value) + 1));



function updateQuickNPills(n) {

    document.querySelectorAll(".pill-btn").forEach(p => {

        p.classList.toggle("active", parseInt(p.dataset.n) === n);

    });

}



document.querySelectorAll(".pill-btn").forEach(p => {

    p.addEventListener("click", () => setN(parseInt(p.dataset.n)));

});



// Apply Rule Code Input

btnApplyCode.addEventListener("click", () => {

    const code = inputRuleCode.value.trim();

    if (code) {

        currentRule = PebbleRule.fromString(code, parseInt(inputN.value) || null);

        inputN.value = currentRule.n;

        finderN.value = currentRule.n;

        updateQuickNPills(currentRule.n);

        updateRuleCodeDisplay();

        rebuildRuleTable();

        resetSimulation();

        fitToScreen();

    }

});



btnCopyCode.addEventListener("click", () => {

    navigator.clipboard.writeText(inputRuleCode.value || currentRule.toShortString(currentRuleFormat));

    btnCopyCode.textContent = "✓ Copied!";

    setTimeout(() => btnCopyCode.textContent = "📋 Copy Code", 1500);

});



btnFlipRule.addEventListener("click", () => {

    currentRule.flipSymmetry();

    updateRuleCodeDisplay();

    rebuildRuleTable();

    resetSimulation();
    renderTapeRibbon();
});



btnRandomRule.addEventListener("click", () => {

    for (let k = 1; k <= currentRule.n; k++) {

        const l = Math.floor(Math.random() * (k + 1));

        const r = Math.floor(Math.random() * (k - l + 1));

        currentRule.set(k, l, r);

    }

    // Halting rule for 1

    currentRule.set(1, 0, 0);

    updateRuleCodeDisplay();

    rebuildRuleTable();

    resetSimulation();
    renderTapeRibbon();
});



btnResetRule.addEventListener("click", () => {

    for (let k = 1; k <= currentRule.n; k++) currentRule.set(k, 0, 0);

    updateRuleCodeDisplay();

    rebuildRuleTable();

    resetSimulation();
    renderTapeRibbon();
});



// Export to Wiki ASCII Art

btnExportAscii.addEventListener("click", () => {

    if (simulator.history.length === 0) return;

    let minX = 0, maxX = 0;

    simulator.history.forEach(h => {

        if (h.minX < minX) minX = h.minX;

        if (h.maxX > maxX) maxX = h.maxX;

    });



    const lines = [];

    simulator.history.forEach(h => {

        let line = "";

        for (let x = minX; x <= maxX; x++) {

            const v = h.tape.get(x) || 0;

            line += v === 0 ? "." : (v < 16 ? v.toString(16) : "#");

        }

        lines.push(line);

    });



    const asciiText = lines.join("\n");

    navigator.clipboard.writeText(asciiText);

    btnExportAscii.textContent = "✓ Copied ASCII!";

    setTimeout(() => btnExportAscii.textContent = "📋 ASCII", 1500);

});



// Export to PNG Image

// Export to Animated GIF
if (btnExportGif) {
    let gifRecording = false;
    let gifFrames = [];
    let gifTimer = null;
    let gifTargetWidth = 0;
    let gifTargetHeight = 0;
    const offCanvas = document.createElement("canvas");
    const offCtx = offCanvas.getContext("2d", { willReadFrequently: true });

    function captureGifFrame() {
        if (!gifRecording) return;
        try {
            // Downsample to max width 480 for ultra-fast client-side compression and light file size
            const maxW = 480;
            const aspect = canvas.height / canvas.width;
            gifTargetWidth = Math.min(canvas.width, maxW);
            gifTargetHeight = Math.max(1, Math.round(gifTargetWidth * aspect));
            if (offCanvas.width !== gifTargetWidth || offCanvas.height !== gifTargetHeight) {
                offCanvas.width = gifTargetWidth;
                offCanvas.height = gifTargetHeight;
            }
            offCtx.drawImage(canvas, 0, 0, gifTargetWidth, gifTargetHeight);
            const imgData = offCtx.getImageData(0, 0, gifTargetWidth, gifTargetHeight);
            gifFrames.push(new Uint8Array(imgData.data));
            btnExportGif.innerHTML = `🔴 GIF (${gifFrames.length})`;

            if (gifFrames.length >= 60) {
                stopAndCompileGif();
            }
        } catch (e) {
            console.error("Frame capture error:", e);
        }
    }

    function stopAndCompileGif() {
        if (!gifRecording) return;
        gifRecording = false;
        clearInterval(gifTimer);
        gifTimer = null;

        if (gifFrames.length === 0) {
            btnExportGif.innerHTML = "🎞️ GIF";
            btnExportGif.classList.remove("btn-gif-recording");
            return;
        }

        btnExportGif.innerHTML = "⌛ Encoding...";
        btnExportGif.title = "Encoding GIF, please wait...";

        setTimeout(() => {
            try {
                // 10 centiseconds per frame = 10fps
                const gifBytes = encodeGIF(gifTargetWidth, gifTargetHeight, gifFrames, 10);
                const blob = new Blob([gifBytes], { type: "image/gif" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `pebble_${currentRule ? currentRule.n : 6}_simulation.gif`;
                a.click();
                setTimeout(() => URL.revokeObjectURL(url), 5000);
            } catch (err) {
                console.error("GIF encoding error:", err);
                alert("GIF encoding failed: " + err.message);
            } finally {
                gifFrames = [];
                btnExportGif.innerHTML = "🎞️ GIF";
                btnExportGif.classList.remove("btn-gif-recording");
                btnExportGif.title = "Record & Export Animated GIF";
            }
        }, 50);
    }

    btnExportGif.addEventListener("click", () => {
        if (gifRecording) {
            stopAndCompileGif();
            return;
        }

        gifFrames = [];
        gifRecording = true;
        btnExportGif.classList.add("btn-gif-recording");
        btnExportGif.innerHTML = "🔴 GIF (0)";
        btnExportGif.title = "GIF Recording in progress... Click to stop & save";

        captureGifFrame();
        gifTimer = setInterval(captureGifFrame, 100);
    });
}

// Export to Video Clip (WebM)
if (btnRecordVideo) {
    let mediaRecorder = null;
    let recordedChunks = [];
    let recordTimer = null;
    let recordSeconds = 0;

    btnRecordVideo.addEventListener("click", () => {
        if (mediaRecorder && mediaRecorder.state === "recording") {
            mediaRecorder.stop();
            return;
        }

        try {
            const stream = canvas.captureStream(30);
            let options = { mimeType: "video/webm;codecs=vp9" };
            if (!MediaRecorder.isTypeSupported(options.mimeType)) {
                options = { mimeType: "video/webm" };
            }

            mediaRecorder = new MediaRecorder(stream, options);
            recordedChunks = [];

            mediaRecorder.ondataavailable = (e) => {
                if (e.data && e.data.size > 0) {
                    recordedChunks.push(e.data);
                }
            };

            mediaRecorder.onstop = () => {
                clearInterval(recordTimer);
                btnRecordVideo.innerHTML = "🎬 Clip";
                btnRecordVideo.classList.remove("btn-recording");
                btnRecordVideo.title = "Record Animated Video Clip (WebM for Discord)";

                if (recordedChunks.length === 0) return;
                const blob = new Blob(recordedChunks, { type: "video/webm" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `pebble_${currentRule ? currentRule.n : 6}_simulation.webm`;
                a.click();
                setTimeout(() => URL.revokeObjectURL(url), 5000);
            };

            mediaRecorder.start();
            recordSeconds = 0;
            btnRecordVideo.classList.add("btn-recording");
            btnRecordVideo.innerHTML = `🔴 0s`;
            btnRecordVideo.title = "Recording in progress... Click to stop";

            recordTimer = setInterval(() => {
                recordSeconds++;
                btnRecordVideo.innerHTML = `🔴 ${recordSeconds}s`;
                if (recordSeconds >= 60) {
                    mediaRecorder.stop();
                }
            }, 1000);

        } catch (err) {
            console.error("Recording error:", err);
            alert("Video recording error: " + err.message);
        }
    });
}

btnExportPng.addEventListener("click", () => {

    const link = document.createElement("a");

    link.download = `pebble_${currentRule.n}_steps_${simulator.history.length}.png`;

    link.href = canvas.toDataURL("image/png");

    link.click();

});



// Custom Tape Accordion

const tapeToggle = document.getElementById("tape-accordion-toggle");

const tapeBody = document.getElementById("tape-accordion-body");

const inputCustomTape = document.getElementById("input-custom-tape");

const btnApplyTape = document.getElementById("btn-apply-tape");



tapeToggle.addEventListener("click", () => {

    tapeBody.classList.toggle("hidden");

});



export function parseCustomTapeInput(raw, defaultN = 6) {
    if (!raw || !raw.trim()) return null;
    raw = raw.trim();

    // 1. Try to match coordinate pairs like x:v, x=v, or (x, v), [x, v]
    const pairRegex = /(?:\[|\()?\s*(-?\d+)\s*(?::|=|,)\s*(\d+)\s*(?:\]|\))?/g;
    const matches = Array.from(raw.matchAll(pairRegex));
    
    // If there are colon/equal matches, or bracketed tuples
    if (matches.length > 0 && (raw.includes(':') || raw.includes('=') || raw.includes('[') || raw.includes('('))) {
        const tape = [];
        for (const m of matches) {
            const x = parseInt(m[1], 10);
            const v = parseInt(m[2], 10);
            if (!isNaN(x) && !isNaN(v) && v > 0) {
                tape.push([x, v]);
            }
        }
        if (tape.length > 0) {
            tape.sort((a, b) => a[0] - b[0]);
            return tape;
        }
    }

    // 2. Otherwise treat as a sequence of decimal numbers (e.g. '1 0 10 1' or '11')
    const tokens = raw.split(/[\s,]+/).filter(t => t.length > 0);
    const nums = tokens.map(t => parseInt(t, 10)).filter(n => !isNaN(n));
    if (nums.length === 0) return null;

    if (nums.length === 1) {
        return [[0, nums[0]]];
    }

    // For a sequence, center around x=0
    const midIdx = Math.floor(nums.length / 2);
    const tape = [];
    nums.forEach((v, idx) => {
        if (v > 0) tape.push([idx - midIdx, v]);
    });
    return tape.length > 0 ? tape : null;
}

btnApplyTape.addEventListener("click", () => {
    const raw = inputCustomTape.value.trim();
    customTape = parseCustomTapeInput(raw, currentRule ? currentRule.n : 6);
    resetSimulation();
    renderTapeRibbon();
    fitToScreen();
});

if (inputCustomTape) {
    inputCustomTape.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            btnApplyTape.click();
        }
    });
}



// Tabs Switching

document.querySelectorAll(".tab-btn").forEach(btn => {

    btn.addEventListener("click", () => {

        document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));

        document.querySelectorAll(".tab-pane").forEach(p => p.classList.remove("active"));

        btn.classList.add("active");

        document.getElementById(btn.dataset.tab).classList.add("active");

    });

});



// Wiki Quick Load Buttons

document.querySelectorAll(".btn-load-wiki").forEach(btn => {

    btn.addEventListener("click", () => {

        const n = parseInt(btn.dataset.n);

        const rule = btn.dataset.rule;

        inputN.value = n;

        currentRule = PebbleRule.fromString(rule, n);

        inputRuleCode.value = currentRule.toShortString();

        finderN.value = n;

        updateQuickNPills(n);

        rebuildRuleTable();

        resetSimulation();

        fitToScreen();

    });

});



// Modal

const modal = document.getElementById("info-modal");

document.getElementById("btn-wiki-info").addEventListener("click", () => modal.classList.remove("hidden"));

document.getElementById("btn-close-modal").addEventListener("click", () => modal.classList.add("hidden"));

modal.querySelector(".modal-backdrop").addEventListener("click", () => modal.classList.add("hidden"));



// Keyboard Shortcuts

window.addEventListener("keydown", (e) => {

    if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;

    if (e.code === "Space") {

        e.preventDefault();

        togglePlay();

    } else if (e.code === "ArrowRight") {

        e.preventDefault();

        stopPlay();

        stepSimulation();

    } else if (e.code === "ArrowLeft") {

        e.preventDefault();

        stopPlay();

        if (simulator.step > 0) {

            simulator.step--;

            simulator.tape = new Map(simulator.history[simulator.step].tape);

            updateUI();

            renderDiagram();

        }

    } else if (e.key === "r" || e.key === "R") {

        resetSimulation();

    } else if (e.key === "f" || e.key === "F") {

        fitToScreen();

    }

});



// ==========================================

// SUPERCHARGED PEBBLE AUTOMATON FINDER

// ==========================================

let isSearching = false;

let finderStartTime = 0;

let finderLeaders = [];



btnStartFinder.addEventListener("click", startFinder);

btnStopFinder.addEventListener("click", stopFinder);



function startFinder() {

    if (isSearching) return;

    isSearching = true;



    btnStartFinder.classList.add("hidden");

    btnStopFinder.classList.remove("hidden");



    finderStartTime = performance.now();

    finderLeaders = [];

    leaderboardBody.innerHTML = `<tr><td colspan="5" class="empty-state">Searching at extreme speed...</td></tr>`;

    leaderboardCount.textContent = "0 champions found";

    finderProgressBar.style.width = "0%";



    currentHoldoutCount = 0;

    currentHoldoutSamples = [];

    currentHoldoutsAll = null;

    if (hudHoldouts) hudHoldouts.textContent = "0";

    if (holdoutsCountBadge) holdoutsCountBadge.textContent = "0 holdouts";

    if (btnDownloadHoldouts) btnDownloadHoldouts.disabled = true;

    if (holdoutsBody) holdoutsBody.innerHTML = '<tr><td colspan="3" class="empty-state">Searching for holdouts...</td></tr>';



    const n = parseInt(finderN.value) || 6;

    const mode = finderMode.value;

    const maxSteps = parseInt(finderMaxSteps.value) || 300;

    const rawDur = parseFloat(finderDuration.value);

    const duration = isNaN(rawDur) ? 5.0 : Math.max(0, rawDur);

    const threadsInput = document.getElementById("finder-threads");

    const threads = parseInt(threadsInput ? threadsInput.value : 0) || 0;



    if (nativeEngineAvailable) {

        // Stream results from high-performance C engine via SSE

        const url = `/api/find?mode=${encodeURIComponent(mode)}&n=${n}&max_steps=${maxSteps}&duration=${duration}&threads=${threads}`;

        activeEventSource = new EventSource(url);



        activeEventSource.onmessage = (e) => {

            try {

                const msg = JSON.parse(e.data);

                handleFinderMessage(msg);

            } catch (err) {

                console.error("Parse error:", err, e.data);

            }

        };



        activeEventSource.onerror = (err) => {

            console.warn("EventSource stream ended or error", err);

            stopFinder();

        };

    } else {

        // Fallback to client-side Web Worker

        if (!fallbackWorker) {

            fallbackWorker = new Worker("finder-worker.js");

        }

        fallbackWorker.onmessage = (e) => {

            handleFinderMessage(e.data);

        };

        fallbackWorker.postMessage({

            mode,

            n,

            maxSteps,

            duration

        });

    }



    // Animate progress bar over duration

    const progressInterval = setInterval(() => {

        if (!isSearching) {

            clearInterval(progressInterval);

            return;

        }

        const elapsed = (performance.now() - finderStartTime) / 1000;

        if (duration > 0) {

            const pct = Math.min(100, (elapsed / duration) * 100);

            finderProgressBar.style.width = `${pct}%`;

        } else {

            finderProgressBar.style.width = "100%";

        }

        hudTime.textContent = `${elapsed.toFixed(2)}s`;

    }, 100);

}



// Duration Preset Pills Click & Input Listeners

document.querySelectorAll(".dur-pill").forEach(pill => {

    pill.addEventListener("click", () => {

        document.querySelectorAll(".dur-pill").forEach(p => p.classList.remove("active"));

        pill.classList.add("active");

        if (finderDuration) {

            finderDuration.value = pill.dataset.dur;

        }

    });

});



if (finderDuration) {

    finderDuration.addEventListener("input", () => {

        const val = finderDuration.value;

        document.querySelectorAll(".dur-pill").forEach(p => {

            p.classList.toggle("active", p.dataset.dur === val);

        });

    });

}



function stopFinder() {

    isSearching = false;

    btnStartFinder.classList.remove("hidden");

    btnStopFinder.classList.add("hidden");

    finderProgressBar.style.width = "100%";



    if (activeEventSource) {

        activeEventSource.close();

        activeEventSource = null;

    }



    // Instantly kill the backend search process

    if (nativeEngineAvailable) {

        fetch("/api/stop", { method: "POST" }).catch(() => {

            fetch("/api/stop").catch(() => {});

        });

    }



    if (fallbackWorker) {

        fallbackWorker.terminate();

        fallbackWorker = null;

    }

}



function handleFinderMessage(msg) {

    if (msg.type === "progress") {

        hudEvaluated.textContent = msg.evaluated.toLocaleString();

        hudRate.textContent = (msg.rate_m_per_s || 0).toFixed(2);

        hudChampion.textContent = msg.champion || 0;

        hudTime.textContent = `${(msg.elapsed || 0).toFixed(2)}s`;

        if (msg.holdouts !== undefined) {

            currentHoldoutCount = msg.holdouts;

            if (hudHoldouts) hudHoldouts.textContent = msg.holdouts.toLocaleString();

            if (holdoutsCountBadge) holdoutsCountBadge.textContent = `${msg.holdouts.toLocaleString()} holdouts`;

            if (btnDownloadHoldouts && msg.holdouts > 0) btnDownloadHoldouts.disabled = false;

        }

    } else if (msg.type === "champion") {

        hudChampion.textContent = msg.steps;

        hudEvaluated.textContent = (msg.evaluated || 0).toLocaleString();

        addLeaderboardEntry(msg);

    } else if (msg.type === "holdout_samples") {

        currentHoldoutCount = msg.count !== undefined ? msg.count : currentHoldoutCount;

        currentHoldoutSamples = msg.samples || [];

        if (msg.all_holdouts) currentHoldoutsAll = msg.all_holdouts;

        if (hudHoldouts) hudHoldouts.textContent = currentHoldoutCount.toLocaleString();

        if (holdoutsCountBadge) holdoutsCountBadge.textContent = `${currentHoldoutCount.toLocaleString()} holdouts`;

        if (btnDownloadHoldouts && currentHoldoutCount > 0) btnDownloadHoldouts.disabled = false;

        renderHoldoutsTable();

    } else if (msg.type === "done") {

        hudEvaluated.textContent = (msg.evaluated || 0).toLocaleString();

        hudTime.textContent = `${(msg.elapsed || 0).toFixed(2)}s`;

        if (msg.champion_steps > 0) hudChampion.textContent = msg.champion_steps;

        if (msg.holdouts !== undefined) {

            currentHoldoutCount = msg.holdouts;

            if (hudHoldouts) hudHoldouts.textContent = msg.holdouts.toLocaleString();

            if (holdoutsCountBadge) holdoutsCountBadge.textContent = `${msg.holdouts.toLocaleString()} holdouts`;

            if (btnDownloadHoldouts && msg.holdouts > 0) btnDownloadHoldouts.disabled = false;

        }

        stopFinder();

    }

}



function renderHoldoutsTable() {

    if (!holdoutsBody) return;

    if (currentHoldoutSamples.length === 0) {

        holdoutsBody.innerHTML = '<tr><td colspan="3" class="empty-state">No holdouts found (or all decided).</td></tr>';

        return;

    }



    holdoutsBody.innerHTML = "";

    currentHoldoutSamples.forEach((rule, idx) => {

        const tr = document.createElement("tr");

        tr.innerHTML = `

            <td><strong>#${idx + 1}</strong></td>

            <td><code>${rule}</code></td>

            <td><button class="btn btn-xs btn-primary btn-load-holdout" data-rule="${rule}">⚡ Simulate</button></td>

        `;



        tr.querySelector(".btn-load-holdout").addEventListener("click", () => {

            const targetN = parseInt(finderN.value) || 6;

            inputN.value = targetN;

            currentRule = PebbleRule.fromString(rule, targetN);

            updateRuleCodeDisplay();

            updateQuickNPills(targetN);

            rebuildRuleTable();

            resetSimulation();

            fitToScreen();



            startPlay();

        });



        holdoutsBody.appendChild(tr);

    });

}



if (btnToggleHoldoutsTable) {

    btnToggleHoldoutsTable.addEventListener("click", () => {

        if (!holdoutsPreviewWrap) return;

        holdoutsPreviewWrap.classList.toggle("hidden");

        btnToggleHoldoutsTable.textContent = holdoutsPreviewWrap.classList.contains("hidden") ? "👁 View Samples" : "Hide Samples";

    });

}



if (btnDownloadHoldouts) {

    btnDownloadHoldouts.addEventListener("click", () => {

        const targetN = parseInt(finderN.value) || 6;

        const maxSteps = parseInt(finderMaxSteps.value) || 300;



        if (nativeEngineAvailable) {

            // Download the exact holdouts.txt generated by pebble_engine.exe

            window.location.href = `/api/download_holdouts?n=${targetN}&steps=${maxSteps}&file=holdouts.txt`;

        } else if (currentHoldoutsAll && currentHoldoutsAll.length > 0) {

            // Client worker fallback

            const header = `# Pebble Automaton Holdouts (Undecided Machines)\n# Target n: ${targetN}, Max Steps: ${maxSteps}\n# Total Holdouts: ${currentHoldoutsAll.length}\n#\n`;

            const blob = new Blob([header + currentHoldoutsAll.join("\n") + "\n"], { type: "text/plain;charset=utf-8" });

            const url = URL.createObjectURL(blob);

            const a = document.createElement("a");

            a.href = url;

            a.download = `pebble_holdouts_n${targetN}_steps${maxSteps}.txt`;

            document.body.appendChild(a);

            a.click();

            document.body.removeChild(a);

            URL.revokeObjectURL(url);

        } else {

            alert("No holdouts file available to download yet.");

        }

    });

}



function addLeaderboardEntry(entry) {

    // Check if already in leaderboard

    if (finderLeaders.some(l => l.rule === entry.rule)) return;



    finderLeaders.push(entry);

    finderLeaders.sort((a, b) => b.steps - a.steps);

    if (finderLeaders.length > 25) finderLeaders.length = 25;



    leaderboardCount.textContent = `${finderLeaders.length} champions ranked`;

    leaderboardBody.innerHTML = "";



    finderLeaders.forEach((item, idx) => {

        const tr = document.createElement("tr");

        tr.innerHTML = `

            <td><strong style="color:var(--accent-cyan)">#${idx + 1}</strong></td>

            <td><span style="font-weight:700;color:var(--accent-green)">${item.steps}</span></td>

            <td><code>${item.rule}</code></td>

            <td style="color:var(--text-muted)">${(item.elapsed || 0).toFixed(2)}s</td>

            <td><button class="btn btn-xs btn-primary btn-load-lead" data-rule="${item.rule}" data-steps="${item.steps}">⚡ Load</button></td>

        `;



        tr.querySelector(".btn-load-lead").addEventListener("click", () => {

            const ruleCode = item.rule;

            const n = parseInt(finderN.value) || 6;

            inputN.value = n;

            currentRule = PebbleRule.fromString(ruleCode, n);

            updateRuleCodeDisplay();

            updateQuickNPills(n);

            rebuildRuleTable();

            resetSimulation();

            fitToScreen();

            startPlay();

        });



        leaderboardBody.appendChild(tr);

    });

}



// Initial Boot

// ==========================================

// PEBBLE HOLDOUT BROWSER & SEARCHER (n=11 & n=12)

// ==========================================

let holdoutsData = [];

let currentHoldoutIdx = 0;

let currentHoldoutDomain = 12;



const holdoutDomainSelect = document.getElementById("holdout-domain-select");

const holdoutsSubnote = document.getElementById("holdouts-subnote");

const holdoutsSearch = document.getElementById("holdouts-search");

const holdoutsCount = document.getElementById("holdouts-count");

const holdoutsList = document.getElementById("holdouts-list");

const btnLoadHoldout1 = document.getElementById("btn-load-holdout-1");

const btnRandomHoldout = document.getElementById("btn-random-holdout");

const btnPrevHoldout = document.getElementById("btn-prev-holdout");

const btnNextHoldout = document.getElementById("btn-next-holdout");



async function loadHoldoutsData(domain = "11_elite") {

    currentHoldoutDomain = domain;

    if (holdoutsCount) holdoutsCount.textContent = "Loading...";

    let filename = "./holdouts_sz11_22.json";
    if (domain === 11 || domain === "11") {
        filename = "./holdouts_sz11.json";
    }

    if (holdoutsSubnote) {

        if (domain === "11_elite") {

            holdoutsSubnote.innerHTML = `Browse the <strong>final 22 holdouts</strong> for $n=11$ (narrowed down from 960 by bbchallenge in 24 hours!).`;

        } else {

            holdoutsSubnote.innerHTML = `Browse all <strong>960 holdout rules</strong> for $n=11$. Click any rule to load and simulate in the space-time diagrammer.`;

        }

    }



    try {

        const resp = await fetch(filename + "?t=" + Date.now());

        if (!resp.ok) throw new Error("Failed to load holdouts");

        holdoutsData = await resp.json();

        renderHoldoutsList(holdoutsSearch ? holdoutsSearch.value : "");

    } catch (err) {

        console.error("Holdout browser error:", err);

        if (holdoutsList) {

            holdoutsList.innerHTML = `<div class="subnote" style="color:var(--accent-pink)">Error loading holdouts: ${err.message}</div>`;

        }

    }

}



async function initHoldoutBrowser() {

    setupHoldoutEvents();

    if (holdoutDomainSelect) holdoutDomainSelect.value = "11_elite";

    await loadHoldoutsData("11_elite");

}



function renderHoldoutsList(filterText) {

    if (!holdoutsList) return;

    const query = (filterText || "").trim().toLowerCase();

    

    let filtered = holdoutsData;

    if (query) {

        if (query.startsWith("#")) {

            const num = parseInt(query.slice(1));

            filtered = holdoutsData.filter(h => h.id === num);

        } else {

            filtered = holdoutsData.filter(h => 

                h.code.toLowerCase().includes(query) || 

                (h.raw && h.raw.toLowerCase().includes(query)) ||

                String(h.id) === query

            );

        }

    }



    if (holdoutsCount) {

        holdoutsCount.textContent = `${filtered.length} of ${holdoutsData.length} holdouts`;

    }



    holdoutsList.innerHTML = "";

    if (filtered.length === 0) {

        holdoutsList.innerHTML = '<div class="subnote" style="text-align:center; padding:15px">No matching holdouts found.</div>';

        return;

    }



    // Render up to 100 items for silky-smooth performance

    const renderLimit = Math.min(filtered.length, 100);

    for (let i = 0; i < renderLimit; i++) {

        const item = filtered[i];

        const card = document.createElement("div");

        card.className = "holdout-card";

        card.id = `holdout-card-${item.id}`;

        

        let badgeHtml = '<span class="holdout-badge badge-unknown">UNKNOWN</span>';
        if (currentHoldoutDomain === "11_elite") {
            if (item.badge_type === "wall_builder") {
                badgeHtml = '<span class="holdout-badge" style="background:rgba(255,140,0,0.2); color:#ff9900; border:1px solid rgba(255,140,0,0.4)">⚠️ WALL-BUILDER</span>';
            } else if (item.badge_type === "bouncer") {
                badgeHtml = '<span class="holdout-badge" style="background:rgba(0,255,102,0.15); color:var(--accent-green); border:1px solid rgba(0,255,102,0.3)">⭐ BOUNCER</span>';
            } else {
                badgeHtml = '<span class="holdout-badge" style="background:rgba(255,0,119,0.15); color:var(--accent-pink); border:1px solid rgba(255,0,119,0.3)">🔥 ELITE HOLDOUT</span>';
            }
        } else if (currentHoldoutDomain === 11 && item.id === 1) {
            badgeHtml = '<span class="holdout-badge badge-analyzed">⭐ EXP DOUBLER</span>';
        } else if (currentHoldoutDomain === 12 || currentHoldoutDomain === "12") {
            if (item.decision === 'bouncer' || (item.type && item.type.includes('Bouncer'))) {
                const turns = item.turnarounds ? `${item.turnarounds} rebounds` : 'BOUNCER';
                badgeHtml = `<span class="holdout-badge badge-analyzed" style="background:rgba(0,255,102,0.15); color:var(--accent-green); border-color:rgba(0,255,102,0.3)">⭐ ${turns}</span>`;
            } else {
                badgeHtml = `<span class="holdout-badge badge-analyzed" style="background:rgba(180,70,255,0.15); color:#c084fc; border-color:rgba(180,70,255,0.3)">⭐ UNDECIDED</span>`;
            }
        }



        card.innerHTML = `

            <div class="holdout-info">

                <div class="holdout-title">

                    <span>#${item.id}${item.old_id ? ' <span style="font-size:0.7rem; color:var(--text-muted); font-weight:normal;">(was #' + item.old_id + ')</span>' : ''}</span>

                    ${badgeHtml}

                </div>

                <div class="holdout-code" title="${item.code}">${item.code}</div>
                <div class="holdout-sub" style="font-size:0.7rem; color:var(--text-muted);">${item.type || 'Complex Holdout'} (${item.steps || '≥ 1M steps'})</div>
            </div>

            <button class="btn btn-xs btn-primary btn-load-holdout" data-id="${item.id}">Load</button>

        `;



        card.querySelector(".btn-load-holdout").addEventListener("click", (e) => {

            e.stopPropagation();

            loadHoldout(item);

        });

        card.addEventListener("click", () => {

            loadHoldout(item);

        });



        holdoutsList.appendChild(card);

    }



    if (filtered.length > renderLimit) {

        const moreNote = document.createElement("div");

        moreNote.className = "subnote";

        moreNote.style.textAlign = "center";

        moreNote.style.padding = "8px";

        moreNote.textContent = `... and ${filtered.length - renderLimit} more (type in search filter to narrow down)`;

        holdoutsList.appendChild(moreNote);

    }

}



function loadHoldout(item) {

    if (!item) return;

    currentHoldoutIdx = item.id - 1;

    const n = item.n || (String(currentHoldoutDomain).startsWith("11") ? 11 : 12);

    inputN.value = n;

    currentRule = PebbleRule.fromString(item.code, n);

    inputRuleCode.value = currentRule.toShortString();

    finderN.value = n;

    updateQuickNPills(n);

    rebuildRuleTable();

    resetSimulation();

    fitToScreen();



    // Highlight active card

    document.querySelectorAll(".holdout-card").forEach(c => c.classList.remove("active-holdout"));

    const activeEl = document.getElementById(`holdout-card-${item.id}`);

    if (activeEl) {

        activeEl.classList.add("active-holdout");

        activeEl.scrollIntoView({ behavior: "smooth", block: "nearest" });

    }

}



function setupHoldoutEvents() {

    if (holdoutDomainSelect) {

        holdoutDomainSelect.addEventListener("change", (e) => {

            const val = e.target.value;
            loadHoldoutsData(val === "11" ? 11 : "11_elite");

        });

    }







    if (holdoutsSearch) {

        holdoutsSearch.addEventListener("input", (e) => {

            renderHoldoutsList(e.target.value);

        });

    }



    if (btnLoadHoldout1) {

        btnLoadHoldout1.addEventListener("click", () => {

            if (holdoutsData.length > 0) loadHoldout(holdoutsData[0]);

        });

    }



    if (btnRandomHoldout) {

        btnRandomHoldout.addEventListener("click", () => {

            if (holdoutsData.length > 0) {

                const randIdx = Math.floor(Math.random() * holdoutsData.length);

                loadHoldout(holdoutsData[randIdx]);

            }

        });

    }



    if (btnPrevHoldout) {

        btnPrevHoldout.addEventListener("click", () => {

            if (holdoutsData.length > 0) {

                currentHoldoutIdx = (currentHoldoutIdx - 1 + holdoutsData.length) % holdoutsData.length;

                loadHoldout(holdoutsData[currentHoldoutIdx]);

            }

        });

    }



    if (btnNextHoldout) {

        btnNextHoldout.addEventListener("click", () => {

            if (holdoutsData.length > 0) {

                currentHoldoutIdx = (currentHoldoutIdx + 1) % holdoutsData.length;

                loadHoldout(holdoutsData[currentHoldoutIdx]);

            }

        });

    }

}



function init() {

    initPresets();

    checkEngineStatus();

    initHoldoutBrowser();



    // Parse the default rule and ensure n is strictly synchronized

    const initialN = parseInt(inputN.value) || 6;

    const defaultCode = inputRuleCode.value.trim() || "00_11_03_21_40_15";

    currentRule = PebbleRule.fromString(defaultCode, initialN);

    updateRuleCodeDisplay();

    updateQuickNPills(initialN);



    resizeCanvas();

    centerCamera();

    rebuildRuleTable();

    resetSimulation();

    fitToScreen();

}



window.addEventListener("DOMContentLoaded", init);



// 4x9 Super-Automaton Setup
const TAPE_4X9_STR = "9 " + Array(44).fill(0).join(" ") + " 9 " + Array(44).fill(0).join(" ") + " 9 " + Array(44).fill(0).join(" ") + " 9";
const TAPE_4X9_ENTRIES = [[0, 9], [45, 9], [90, 9], [135, 9]];
const RULE_4X9_CODE = "00_02_01_40_14_12_00_52_81";

function load4x9SuperAutomaton() {
    stopPlay();
    const code = RULE_4X9_CODE;
    const n = 9;
    inputN.value = n;
    inputRuleCode.value = code;
    currentRule = PebbleRule.fromString(code, n);
    updateQuickNPills(n);
    rebuildRuleTable();

    customTape = [[0, 9], [45, 9], [90, 9], [135, 9]];
    if (inputCustomTape) inputCustomTape.value = TAPE_4X9_STR;
    if (tapeBody) tapeBody.classList.remove("hidden");

    // Set speed to Max Turbo 1,000,000 steps/s
    setSpeed(1000000);

    // Uncheck auto-stop decider so it can run long multi-million step waves
    if (autoStopDecider) autoStopDecider.checked = false;

    // Reset simulation and fit
    simulator.setRule(currentRule);
    simulator.reset(customTape);
    updateUI();
    fitToScreen();
}

const btnLoad4x9 = document.getElementById("btn-load-4x9");
if (btnLoad4x9) {
    btnLoad4x9.addEventListener("click", load4x9SuperAutomaton);
}

const btnPreset4x9Tape = document.getElementById("btn-preset-4x9-tape");
if (btnPreset4x9Tape) {
    btnPreset4x9Tape.addEventListener("click", () => {
        if (inputCustomTape) inputCustomTape.value = TAPE_4X9_STR;
        customTape = [[0, 9], [45, 9], [90, 9], [135, 9]];
        resetSimulation();
        fitToScreen();
    });
}


// Cosmic Leap Button Handlers (Googol 10^100)
const btnLeapGoogol = document.getElementById("btn-leap-googol");
if (btnLeapGoogol) {
    btnLeapGoogol.addEventListener("click", () => {
        stopPlay();
        const allowCont = autoStopDecider ? !autoStopDecider.checked : false;
        simulator.advanceCosmic(1, 100, 1, allowCont);
        updateUI();
        fitToScreen();
        renderDiagram();
    });
}

// ==========================================
// Interactive Visual Tape Ribbon Builder
// ==========================================
let ribbonCenterOffset = 0;
const ribbonContainer = document.getElementById("tape-ribbon-container");
const ribbonPebbleCount = document.getElementById("ribbon-pebble-count");
const btnRibbonShiftLeft = document.getElementById("btn-ribbon-shift-left");
const btnRibbonShiftRight = document.getElementById("btn-ribbon-shift-right");
const btnRibbonCenter = document.getElementById("btn-ribbon-center");
const btnRibbonClear = document.getElementById("btn-ribbon-clear");
const btnRibbonResetN = document.getElementById("btn-ribbon-reset-n");

function getCustomTapeMap() {
    const map = new Map();
    if (customTape && customTape.length > 0) {
        for (const [x, v] of customTape) {
            if (v > 0) map.set(x, v);
        }
    } else {
        map.set(0, currentRule ? currentRule.n : 6);
    }
    return map;
}

function syncCustomTapeFromMap(map) {
    customTape = [];
    let sum = 0;
    const sortedKeys = Array.from(map.keys()).sort((a, b) => a - b);
    for (const k of sortedKeys) {
        const v = map.get(k);
        if (v > 0) {
            customTape.push([k, v]);
            sum += v;
        }
    }
    if (customTape.length === 0) customTape = null;

    if (inputCustomTape) {
        if (!customTape) {
            inputCustomTape.value = "";
        } else {
            inputCustomTape.value = customTape.map(([x, v]) => `${x}:${v}`).join(" ");
        }
    }
    if (ribbonPebbleCount) {
        ribbonPebbleCount.textContent = `Sum: ${sum} pebbles`;
    }
    resetSimulation();
    renderTapeRibbon();
}

function renderTapeRibbon() {
    if (!ribbonContainer) return;
    const map = getCustomTapeMap();
    let totalPebbles = 0;
    for (const v of map.values()) totalPebbles += v;

    if (ribbonPebbleCount) {
        ribbonPebbleCount.textContent = `Sum: ${totalPebbles} pebbles`;
    }

    ribbonContainer.innerHTML = "";
    const rangeRadius = 7;
    for (let x = ribbonCenterOffset - rangeRadius; x <= ribbonCenterOffset + rangeRadius; x++) {
        const val = map.get(x) || 0;
        const cellBtn = document.createElement("div");
        cellBtn.className = `tape-cell-btn ${val > 0 ? "has-pebbles" : ""} ${x === 0 ? "is-origin" : ""}`;
        cellBtn.title = `Cell x = ${x}. Left-click to add, Right-click to subtract.`;

        const xLabel = document.createElement("span");
        xLabel.className = "tape-cell-x";
        xLabel.textContent = x === 0 ? "x=0" : (x > 0 ? `+${x}` : `${x}`);

        const vLabel = document.createElement("span");
        vLabel.className = "tape-cell-val";
        vLabel.textContent = val > 0 ? val : "·";

        cellBtn.appendChild(xLabel);
        cellBtn.appendChild(vLabel);

        cellBtn.addEventListener("click", (e) => {
            const current = map.get(x) || 0;
            if (e.shiftKey) {
                if (current > 0) map.set(x, current - 1);
            } else {
                map.set(x, current + 1);
            }
            syncCustomTapeFromMap(map);
        });

        cellBtn.addEventListener("contextmenu", (e) => {
            e.preventDefault();
            const current = map.get(x) || 0;
            if (current > 0) {
                map.set(x, current - 1);
                syncCustomTapeFromMap(map);
            }
        });

        ribbonContainer.appendChild(cellBtn);
    }
}

if (btnRibbonShiftLeft) {
    btnRibbonShiftLeft.addEventListener("click", () => {
        ribbonCenterOffset -= 5;
        renderTapeRibbon();
    });
}

if (btnRibbonShiftRight) {
    btnRibbonShiftRight.addEventListener("click", () => {
        ribbonCenterOffset += 5;
        renderTapeRibbon();
    });
}

if (btnRibbonCenter) {
    btnRibbonCenter.addEventListener("click", () => {
        ribbonCenterOffset = 0;
        renderTapeRibbon();
    });
}

if (btnRibbonClear) {
    btnRibbonClear.addEventListener("click", () => {
        const map = new Map();
        syncCustomTapeFromMap(map);
    });
}

if (btnRibbonResetN) {
    btnRibbonResetN.addEventListener("click", () => {
        customTape = null;
        if (inputCustomTape) inputCustomTape.value = "";
        resetSimulation();
        renderTapeRibbon();
    });
}

renderTapeRibbon();
