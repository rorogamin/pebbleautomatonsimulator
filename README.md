# ⚪⚫ Pebble Automaton Lab & Supercharged Simulator

A high-performance simulator, space-time diagrammer, and **macro-accelerated** Busy Beaver finder for **1D Pebble Automata** (as explored on [BusyBeaverWiki](https://wiki.bbchallenge.org/wiki/Pebble_Automaton)).

Built for the **bbchallenge community**, this repository provides both an interactive, hardware-accelerated web GUI and high-throughput native C simulation/search engines capable of leaping through **billions of steps per second**.

---

## ⚡ What is a Pebble Automaton?

A **1D Pebble Automaton** is a totalistic-like cellular automaton governed by conservation of mass. For each active cell with integer pebble count $k \ge 1$, a rule defines:
- $L(k) \ge 0$ (pebbles sent to the **left** neighbor $x - 1$)
- $R(k) \ge 0$ (pebbles sent to the **right** neighbor $x + 1$)
- $S(k) = k - L(k) - R(k) \ge 0$ (pebbles that **stay** in place at $x$)

### Evolution Rule
Starting at $t = 0$ with all $n$ pebbles concentrated in a single cell at $x = 0$:
$$p(x, t+1) = R(p(x-1, t)) + S(p(x, t)) + L(p(x+1, t))$$

### The Busy Beaver Function $\text{peBBle}(n)$
The maximum number of steps an $n$-pebble automaton takes before it **stabilizes** (i.e. no pebbles move anymore: $L(p(x)) = R(p(x)) = 0$ for all cells).

---

## 🏆 Current Busy Beaver Champions & Records

| Domain | Steps to Halt | Exact Rule String | Architecture / Mechanism | Status |
| :--- | :--- | :--- | :--- | :--- |
| **peBBle(1)** | **1** | `00` | Immediate inert freeze | Proven Optimal |
| **peBBle(2)** | **2** | `00_01` | Single step shift | Proven Optimal |
| **peBBle(3)** | **4** | `00_01_01` | 2-step reflection cascade | Proven Optimal |
| **peBBle(4)** | **7** | `00_01_20_03` | 3-cell displacement pulse | Proven Optimal |
| **peBBle(5)** | **11** | `00_11_03_21_04` | Asymmetric 2-phase reflection | Proven Optimal |
| **peBBle(6)** | **17** | `00_11_03_21_40_15` | Dual-flank ripple collision | Proven Optimal |
| **peBBle(7)** | **28** | `00_11_03_21_10_33_61` | 4-cell staggered echo cascade | Proven Optimal |
| **peBBle(8)** | **63** | `00_11_03_21_50_30_24_70` | Multi-splitter cascade | Proven Optimal |
| **peBBle(9)** | **63,577** | `00_02_01_40_14_12_00_52_81` | Collatz $3x+1$ parity bouncer ($x_0 = 4$) | Proven Record |
| **peBBle(10)** | **5,778** | `00_02_01_40_14_12_00_17_63_18` | Collatz parity bouncer ($x_0 = 5$) | Proven Optimal |
| **peBBle(11)** | **810,626,821** | `00_00_30_40_12_51_07_20_41_12_19` | 3-body expanding counter (span: 28,303) | **Record Champion** (All 22 holdouts non-halting > 100B) |
| **peBBle(12)** | **311,680** | `00_00_30_40_12_51_07_20_41_24_63_1b` | 4-wall parabolic resonator (span: 535) | **Record Champion** (Apex of 56k sweep) |
| **peBBle(13)** | **1,774,252** | `00_00_30_40_12_51_07_20_41_10_1b_01_52` | Parabolic harmonic cavity (span: 1,295) | **Record Champion** |
| **peBBle(14)** | **218,353** | `00_00_30_40_12_51_07_20_41_10_1b_01_b1_04` | Dual-cavity resonator lock | **Record Champion** |
| **peBBle(15)** | **117,917** | `00_00_30_40_12_51_07_20_41_10_1b_01_b1_04_76` | Multi-barrier harmonic shuttle | **Record Champion** |
| **peBBle(16)** | **119,079** | `00_00_30_40_12_51_07_20_41_10_1b_01_b1_04_76_02` | 16-state resonator | **Record Champion** |

---

## 🚀 Key Features

### 1. 🌌 Macro-Accelerated Simulation Engine (`engine.js`)
- **Turbo / Cosmic Leaping (`stepTurbo`, `advanceCosmic`)**: Uses causal island decomposition, periodic pattern recognition, and closed-form trajectory prediction to advance millions of steps per millisecond.
  - Simulates the **810,626,821-step** $n=11$ champion in **~85 ms**.
  - Simulates the **1,774,252-step** $n=13$ champion in **~165 ms**.
- **Compact Tape**: Memory-efficient sparse tape representation capable of tracking wide spatial expansions spanning tens of thousands of cells.
- **Automated Deciders**: High-accuracy heuristics for detecting escaping gliders, static wall puffers, periodic bouncers, and isolated cyclic domains.

### 2. ⚡ Native C Engine & Deciders (`pebble_engine.c`, `pebble_deciders.h`)
- OpenMP multi-threading with bitwise hashing and branch-and-bound pruning.
- Exhaustive tree search for small $n$ (proves $n=6$ in 16ms, $n=7$ in 0.49s, $n=8$ in 8.1s).
- Standalone CLI support for headless verification and holdout classification.

### 3. 🎨 Interactive Web GUI & Space-Time Diagrammer
- Real-time 2D Canvas space-time diagram with smooth pan and zoom.
- Inspect any cell $(x, t)$ on hover to see pebble distributions and flow breakdown.
- Visual Rule Editor: interactive sliders for $L(k)$ and $R(k)$, automatic mass conservation check, rule mirroring, and custom initial tape configurations.
- Preset Library: instant 1-click loading of all Busy Beaver champions and famous cryptids (e.g. Exponential Period-Doubler, BMO1 Piecewise Affine, Hydra).

---

## 💻 Quick Start

### Running the Web GUI
1. Run the Python backend:
   ```bash
   python server.py 8000
   ```
   *(Or double-click `run.bat` on Windows)*.
2. Open your browser to **`http://localhost:8000`**.
3. Select any champion from the **Busy Beaver Champion Board** or preset dropdown to view its space-time diagram and run macro leaps.

### Standalone Node.js Verification
You can verify any rule directly in terminal without starting a server:
```bash
node -e "
const { PebbleSimulator, PebbleRule } = require('./engine.js');
const sim = new PebbleSimulator();
sim.setRule(PebbleRule.fromString('00_00_30_40_12_51_07_20_41_10_1b_01_52'));
sim.reset();
console.log(sim.stepTurbo(5000000n, true, 500));
"
```

### Compiling the Native C Engine
Using GCC / MinGW / Clang:
```bash
# High-performance multi-threaded search engine
gcc -O3 -fopenmp -mavx2 pebble_engine.c -o pebble_engine

# Turbo step server binary
gcc -O3 turbo_step_server.c -o turbo_step_server
```

Run CLI search:
```bash
# Tree search for n=6
./pebble_engine --mode tree --n 6 --max-steps 100

# Heuristic genetic search for n=12
./pebble_engine --mode heuristic --n 12 --duration 10.0 --max-steps 100000
```

---

## 📁 Repository Structure

```
├── index.html            # Interactive Web App UI & Champion Board
├── style.css             # Modern dark-mode diagram styling
├── app.js                # Frontend controller & canvas rendering
├── engine.js             # Core macro simulator, CompactTape, & presets
├── finder-worker.js      # Background web worker for browser search
├── server.py             # Multi-threaded Python server & API endpoints
├── run.bat               # Windows one-click start script
├── pebble_engine.c       # High-performance C engine (OpenMP + AVX2)
├── pebble_deciders.h     # Native C decider algorithms
├── turbo_step_server.c   # C backend for fast step bursts
├── holdouts_sz11_22.json # Final 22 non-halting holdouts for n=11
├── holdouts_sz12.json    # Verified holdouts dataset for n=12
├── collatz_search.py     # Theoretical Collatz map transition tracer
└── README.md             # Documentation and usage guide
```

---

## 📜 License & Acknowledgments
Created for research into cellular automata and the Busy Beaver Challenge community.
Released under the MIT License.
