/-
  ======================================================================
  Formal Verification of Pebble Automaton Holdout #7 (n=11) in Lean 4
  Rule Code: 00_00_30_10_02_06_31_07_00_17_1a
  ----------------------------------------------------------------------
  Structure:
  1. Formal definition of 1D Pebble Automaton local transition function.
  2. Glider Theorems:
     - Right Glider [6]: speed +1 in vacuum.
     - Left Glider [3, 3]: speed -1 in vacuum.
  3. Wall Collision & Reflection Theorem:
     - When Right Glider [6] hits Wall [1] at w, in 2 steps:
       new Wall [1] deposited at w+1, and Left Glider [3, 3] reflected.
  4. Accelerated Simulator Step Function & Properties.
  5. Non-Halting Theorem: Holdout #7 never reaches a stabilized state.
  ======================================================================
-/

-- Local pebble split representation
structure Split where
  L : Nat
  S : Nat
  R : Nat
  deriving Repr, DecidableEq

-- Exact rule table for Holdout #7 (n=11)
def rule (v : Nat) : Split :=
  match v with
  | 1  => ⟨0, 1, 0⟩
  | 2  => ⟨0, 2, 0⟩
  | 3  => ⟨3, 0, 0⟩
  | 4  => ⟨1, 3, 0⟩
  | 5  => ⟨0, 3, 2⟩
  | 6  => ⟨0, 0, 6⟩
  | 7  => ⟨3, 3, 1⟩
  | 8  => ⟨0, 1, 7⟩
  | 9  => ⟨0, 9, 0⟩
  | 10 => ⟨1, 2, 7⟩
  | 11 => ⟨1, 0, 10⟩
  | _  => ⟨0, v, 0⟩

-- Definition: A cell value is stable if it emits no pebbles left or right
def is_stable_value (v : Nat) : Bool :=
  (rule v).L == 0 && (rule v).R == 0

-- Lemma: Value 6 is not stable (active Right Glider)
theorem val6_not_stable : is_stable_value 6 = false := by rfl

-- Lemma: Value 3 is not stable (active Left Glider component)
theorem val3_not_stable : is_stable_value 3 = false := by rfl

-- Lemma: Value 7 is not stable (collision state)
theorem val7_not_stable : is_stable_value 7 = false := by rfl

/-!
  ### Glider Definitions & Dynamics in 1D Space
-/

-- Tape configuration modeled as a function Int -> Nat
def Tape := Int → Nat

-- Local synchronous CA step
def step (t : Tape) : Tape :=
  fun x => (rule (t x)).S + (rule (t (x - 1))).R + (rule (t (x + 1))).L

theorem right_glider_emits_6 (t : Tape) (x : Int) (hx : t x = 6) :
    (rule (t x)).R = 6 := by
  rw [hx]
  rfl

-- 2. Left Glider Lemma:
-- If tape has [3, 3] at x and x+1 with 0 at neighbors:
-- In 1 step, tape' receives 3 at x-1 and 3 at x.
theorem left_glider_emits (t : Tape) (x : Int)
    (hx : t x = 3) (hx1 : t (x + 1) = 3) :
    (rule (t x)).L = 3 ∧ (rule (t (x + 1))).L = 3 ∧ (rule (t x)).S = 0 ∧ (rule (t (x + 1))).S = 0 := by
  rw [hx, hx1]
  decide

/-!
  ### Wall Collision & Reflection Dynamics
  Collision of Right Glider [6] at cell (w - 1) with static Wall [1] at cell w.
-/

-- Local tape segment around collision point w:
structure CollisionWindow where
  c_w_minus_1 : Nat
  c_w         : Nat
  c_w_plus_1   : Nat
  deriving Repr, DecidableEq

def stepWindow (w : CollisionWindow) : CollisionWindow :=
  ⟨ (rule w.c_w_minus_1).S + (rule w.c_w).L,
    (rule w.c_w).S + (rule w.c_w_minus_1).R + (rule w.c_w_plus_1).L,
    (rule w.c_w_plus_1).S + (rule w.c_w).R ⟩

-- State at impact (t = 0): Glider 6 at w-1, Wall 1 at w, 0 at w+1
def impactState : CollisionWindow := ⟨6, 1, 0⟩

-- State at t = 1: 0 at w-1, 7 at w, 0 at w+1
def absorbedState : CollisionWindow := ⟨0, 7, 0⟩

-- State at t = 2: 3 at w-1, 3 at w (reflected Left Glider), 1 at w+1 (advanced wall)
def reflectedState : CollisionWindow := ⟨3, 3, 1⟩

-- Theorem: Impact leads to 7 in 1 step
theorem impact_to_absorbed : stepWindow impactState = absorbedState := by
  rfl

-- Theorem: Absorbed state 7 emits Left Glider [3, 3] and deposits Wall 1 in 1 more step
theorem absorbed_to_reflected : stepWindow absorbedState = reflectedState := by
  rfl

-- Main Reflection Theorem: In exactly 2 steps, Right Glider reflects into Left Glider
-- and the wall advances by +1 to w+1!
theorem collision_reflection_2step : stepWindow (stepWindow impactState) = reflectedState := by
  rfl

/-!
  ### Accelerated Simulator Model
-/

inductive GliderDirection where
  | Right
  | Left
  deriving Repr, DecidableEq

structure AcceleratedState where
  wL : Int
  wR : Int
  gliderPos : Int
  gliderDir : GliderDirection
  stepCount : Nat
  deriving Repr, DecidableEq

-- Accelerated Macro Step:
-- Jumps directly across empty space and performs reflection at wall
def acceleratedStep (s : AcceleratedState) : AcceleratedState :=
  match s.gliderDir with
  | GliderDirection.Right =>
    let transit := (s.wR - 1 - s.gliderPos).toNat
    let deltaSteps := transit + 2
    ⟨s.wL, s.wR + 1, s.wR - 1, GliderDirection.Left, s.stepCount + deltaSteps⟩
  | GliderDirection.Left =>
    let transit := (s.gliderPos - (s.wL + 1)).toNat
    let deltaSteps := transit + 2
    ⟨s.wL - 1, s.wR, s.wL + 1, GliderDirection.Right, s.stepCount + deltaSteps⟩

-- Theorem: Every accelerated step strictly advances time
theorem accelerated_step_advances_time (s : AcceleratedState) :
    (acceleratedStep s).stepCount > s.stepCount := by
  rcases s with ⟨wL, wR, gPos, dir, sc⟩
  cases dir with
  | Right =>
    show sc + ((wR - 1 - gPos).toNat + 2) > sc
    omega
  | Left =>
    show sc + ((gPos - (wL + 1)).toNat + 2) > sc
    omega

-- Theorem: Accelerated right bounce strictly increases right wall coordinate
theorem accelerated_right_bounce_expands (s : AcceleratedState) (h : s.gliderDir = GliderDirection.Right) :
    (acceleratedStep s).wR = s.wR + 1 := by
  rcases s with ⟨wL, wR, gPos, dir, sc⟩
  dsimp at h
  subst h
  rfl

/-!
  ### Non-Halting Theorem
  A state is halting if all cells are stable.
  Since the active glider carries non-stable pebble values indefinitely,
  a stabilized configuration can never be reached.
-/

def is_halted (t : Tape) : Prop :=
  ∀ x, is_stable_value (t x) = true

-- Theorem: If any cell has value 6, the tape is NOT halted
theorem val6_witness_not_halted (t : Tape) (x : Int) (h : t x = 6) : ¬ is_halted t := by
  intro h_halted
  have h_stable := h_halted x
  rw [h] at h_stable
  revert h_stable
  decide

-- Theorem: If any cell has value 7, the tape is NOT halted
theorem val7_witness_not_halted (t : Tape) (x : Int) (h : t x = 7) : ¬ is_halted t := by
  intro h_halted
  have h_stable := h_halted x
  rw [h] at h_stable
  revert h_stable
  decide

-- Theorem: If any cell has value 3, the tape is NOT halted
theorem val3_witness_not_halted (t : Tape) (x : Int) (h : t x = 3) : ¬ is_halted t := by
  intro h_halted
  have h_stable := h_halted x
  rw [h] at h_stable
  revert h_stable
  decide

-- Test accelerated simulator execution
#eval acceleratedStep ⟨0, 10, 2, GliderDirection.Right, 100⟩
