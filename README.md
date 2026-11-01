# ⚪⚫ Pebble Automaton Lab & Simulator

[![GitHub Pages](https://img.shields.io/badge/Demo-GitHub%20Pages-blue?style=flat-square&logo=github)](https://rorogamin.github.io/pebbleautomatonsimulator/)
[![Lean 4 Verified](https://img.shields.io/badge/Lean_4-Verified-darkgreen?style=flat-square&logo=lean)](formal/Holdout7.lean)
[![Rocq / Coq Verified](https://img.shields.io/badge/Rocq_9.1-Verified-blueviolet?style=flat-square)](formal/Holdout7.v)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](LICENSE)

An interactive visualizer, high-performance simulator, and macro-accelerated Busy Beaver search engine for **1D Pebble Automata** (as studied on [BusyBeaverWiki](https://wiki.bbchallenge.org/wiki/Pebble_Automaton)).

Featuring double formal proofs in **Lean 4** and **Rocq (Coq)**, visual 1D tape ribbon editing, space-time diagramming, animated GIF/video export, and cosmic leaps simulating billions of steps per second.

🔗 **Live Web App**: [https://rorogamin.github.io/pebbleautomatonsimulator/](https://rorogamin.github.io/pebbleautomatonsimulator/)

---

## ⚡ What is a Pebble Automaton?

A **1D Pebble Automaton** is a deterministic, totalistic-like cellular automaton governed by exact **conservation of mass**. For each active cell containing integer pebble count $k \in \{1, \dots, n\}$, a rule defines a split:
- $L(k) \ge 0$: pebbles dispatched to the left neighbor ($x - 1$)
- $R(k) \ge 0$: pebbles dispatched to the right neighbor ($x + 1$)
- $S(k) = k - L(k) - R(k) \ge 0$: pebbles that stay in place at $x$

### Evolution Equation
Starting at $t = 0$ with all $n$ pebbles placed in a single cell at $x = 0$ (or on a custom tape):
$$p(x, t+1) = R(p(x-1, t)) + S(p(x, t)) + L(p(x+1, t))$$

Because $\sum_x p(x, t+1) = \sum_x p(x, t) = n$, total pebble count is strictly conserved for all time $t \ge 0$.

### The Busy Beaver Function $\text{peBBle}(n)$
The maximum number of steps an $n$-pebble automaton executes before **stabilizing** into an inert configuration where no pebbles move:
$$\forall x, \quad L(p(x)) = 0 \quad \text{and} \quad R(p(x)) = 0$$

---

## 🏆 Official Champions & Leaderboard

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
| **peBBle(9)** | **63,577** | `00_02_01_40_14_12_00_52_81` | Collatz $3x+1$ parity bouncer ($x_0 = 4$) | **Proven Optimal** |
| **peBBle(10)** | **5,778** | `00_02_01_40_14_12_00_17_63_18` | Collatz parity bouncer ($x_0 = 5$) | **Proven Optimal** |
| **peBBle(11)** | **810,626,821** | `00_00_30_40_12_51_07_20_41_12_19` | 3-body expanding elastic counter (span: 28,303) | **Record Champion** |
| **peBBle(12)** | **311,680** | `00_00_30_40_12_51_07_20_41_24_63_1b` | 4-wall parabolic resonator (span: 535) | **Record Champion** |
| **peBBle(13)** | **1,774,252** | `00_00_30_40_12_51_07_20_41_10_1b_01_52` | Parabolic harmonic cavity (span: 1,295) | **Record Champion** |
| **peBBle(14)** | **218,353** | `00_00_30_40_12_51_07_20_41_10_1b_01_b1_04` | Dual-cavity resonator lock | **Record Champion** |
| **peBBle(15)** | **117,917** | `00_00_30_40_12_51_07_20_41_10_1b_01_b1_04_76` | Multi-barrier harmonic shuttle | **Record Champion** |
| **peBBle(16)** | **119,079** | `00_00_30_40_12_51_07_20_41_10_1b_01_b1_04_76_02` | 16-state resonator | **Record Champion** |

---

## 🔬 Formal Verification (Lean 4 & Rocq / Coq)

To rigorously verify non-halting holdout behaviors without heuristic speculation, the repository includes **dual formal machine-checked proofs** in both **Lean 4** and **Rocq** (formerly Coq):

- **Lean 4 Proof**: [`formal/Holdout7.lean`](formal/Holdout7.lean)
- **Rocq / Coq Proof**: [`formal/Holdout7.v`](formal/Holdout7.v)

### Holdout #7 Mechanical Analysis
- **Rule Code**: `00_00_30_10_02_06_31_07_00_17_1a` ($n=11$)
- **Glider Dynamics**:
  - Right Glider `[6]`: Moves right at speed $c = +1$ across empty vacuum: `rule(6) = ⟨0, 0, 6⟩`.
  - Left Glider `[3, 3]`: Moves left at speed $c = -1$ across empty vacuum: `rule(3) = ⟨3, 0, 0⟩`.
- **Wall Reflection Law**:
  - Right wall collision: When Right Glider `[6]` impacts static wall `[1]` at cell $w$, in exactly 2 steps it reflects into Left Glider `[3, 3]` at $(w-1, w)$ and advances the static wall to $w+1$:
    $$\text{Window}\langle 6, 1, 0\rangle \xrightarrow{t=1} \text{Window}\langle 0, 7, 0\rangle \xrightarrow{t=2} \text{Window}\langle 3, 3, 1\rangle$$
- **Accelerated Simulator**:
  - An accelerated macro-transition operator advances the glider across empty cavity space and computes boundary reflections in $O(1)$ time.
- **Non-Halting Invariant**:
  - Stable cell values are $\{0, 1, 2, 9\}$. The active glider contains $6$ pebbles that never decay into inert singletons or pairs, ensuring $\exists x, \operatorname{is\_stable}(p(x)) = \text{false}$ for all $t$. Thus, Holdout #7 **never stabilizes**.

### Verifying the Proofs Locally

```bash
# Verify with Lean 4
lean formal/Holdout7.lean

# Verify with Rocq / Coq
coqc formal/Holdout7.v
```

Both proofs compile cleanly with 0 errors and 0 warnings.

---

## 🎨 Interactive Features & UI

### 1. 🎛️ Interactive Visual 1D Tape Ribbon Editor
- Directly edit individual cell pebble counts on a ribbon tape.
- **Left-Click**: Increment pebble count in cell.
- **Right-Click / Shift-Click**: Decrement pebble count in cell.
- **Toolbar Actions**: Scroll view left/right, center on $x=0$, clear tape, and reset to standard $n$ pebbles at origin.
- Live tape synchronization updates the space-time canvas instantly.

### 2. 🌌 Macro Acceleration (Cosmic & Turbo Leaping)
- Simulates billions of steps per second using causal island decomposition and closed-form periodic leap prediction.
- Handles the 810M+ step $n=11$ champion in milliseconds.

### 3. 🎬 Animated GIF & WebM Export
- **GIF Export**: Full space-time diagram recording with verified LZW bitstream encoding and frozen palette quantization.
- **WebM Video Export**: Hardware-accelerated canvas video capture for high-resolution sharing.

---

## 💻 Quick Start & Running Locally

### 1. Start the Local Server
```bash
python server.py 8000
```
*(Or double-click `run.bat` on Windows)*.

Open your browser to **`http://localhost:8000`**.

### 2. Standalone Node.js Verification
```bash
node -e "
import('./engine.js').then(({ PebbleSimulator, PebbleRule }) => {
  const rule = PebbleRule.fromString('00_00_30_40_12_51_07_20_41_12_19', 11);
  const sim = new PebbleSimulator(rule);
  console.log('Stepping 1000 steps...');
  for (let i = 0; i < 1000; i++) sim.stepForward(true);
  console.log('Step:', sim.step, 'Active cells:', sim.tape.size);
});
"
```

---

## 📁 Repository Structure

```
├── index.html            # Web GUI, Canvas Diagrammer & Champion Board
├── style.css             # Dark-mode styling & Visual Ribbon UI
├── app.js                # Frontend controllers, ribbon editor & canvas rendering
├── engine.js             # Core simulation engine, CompactTape & preset champions
├── gif-encoder.js        # High-performance verified LZW GIF encoder
├── formal/
│   ├── Holdout7.lean     # Lean 4 formalization and non-halting proof
│   └── Holdout7.v        # Rocq / Coq formalization and non-halting proof
├── holdouts_sz11_22.json # Curated 22 non-halting holdout rules for n=11
├── server.py             # Local HTTP server with API endpoints
└── README.md             # Project documentation and leaderboard
```

---

## 📜 License
Created for research into 1D cellular automata and the Busy Beaver Challenge community.
Released under the [MIT License](LICENSE).
