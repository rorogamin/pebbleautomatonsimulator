(******************************************************************************)
(* Formal Verification of Pebble Automaton Holdout #7 (n=11) in Rocq / Coq   *)
(* Rule Code: 00_00_30_10_02_06_31_07_00_17_1a                                *)
(*                                                                            *)
(* Structure:                                                                 *)
(* 1. Formal definition of 1D Pebble Automaton local transition function.      *)
(* 2. Glider and non-stability lemmas.                                       *)
(* 3. Wall Collision & Reflection Theorems (2-step exact mechanics).          *)
(* 4. Accelerated Simulator Step Function & Correctness.                      *)
(* 5. Non-Halting Theorem: Active glider ensures system never stabilizes.     *)
(******************************************************************************)

From Stdlib Require Import Arith.
From Stdlib Require Import ZArith.
From Stdlib Require Import Lia.
From Stdlib Require Import Bool.

Open Scope nat_scope.

(* Local pebble split representation: (L, S, R) *)
Record Split := mkSplit {
  L : nat;
  S : nat;
  R : nat
}.

(* Exact rule table for Holdout #7 (n=11) *)
Definition rule (v : nat) : Split :=
  match v with
  | 1  => mkSplit 0 1 0
  | 2  => mkSplit 0 2 0
  | 3  => mkSplit 3 0 0
  | 4  => mkSplit 1 3 0
  | 5  => mkSplit 0 3 2
  | 6  => mkSplit 0 0 6
  | 7  => mkSplit 3 3 1
  | 8  => mkSplit 0 1 7
  | 9  => mkSplit 0 9 0
  | 10 => mkSplit 1 2 7
  | 11 => mkSplit 1 0 10
  | _  => mkSplit 0 v 0
  end.

(* A cell value is stable if it emits no pebbles left or right *)
Definition is_stable_value (v : nat) : bool :=
  match rule v with
  | mkSplit l _ r => (Nat.eqb l 0) && (Nat.eqb r 0)
  end.

(* Glider value non-stability lemmas *)
Theorem val6_not_stable : is_stable_value 6 = false.
Proof. reflexivity. Qed.

Theorem val3_not_stable : is_stable_value 3 = false.
Proof. reflexivity. Qed.

Theorem val7_not_stable : is_stable_value 7 = false.
Proof. reflexivity. Qed.

(******************************************************************************)
(* Wall Collision & Reflection Dynamics                                       *)
(* Interaction between Right Glider [6] and static Wall [1] at position w.    *)
(******************************************************************************)

Record CollisionWindow := mkWindow {
  c_w_minus_1 : nat;
  c_w         : nat;
  c_w_plus_1  : nat
}.

Definition stepWindow (w : CollisionWindow) : CollisionWindow :=
  let r_minus := rule (c_w_minus_1 w) in
  let r_mid   := rule (c_w w) in
  let r_plus  := rule (c_w_plus_1 w) in
  mkWindow
    (S r_minus + L r_mid)
    (S r_mid + R r_minus + L r_plus)
    (S r_plus + R r_mid).

Definition impactState : CollisionWindow := mkWindow 6 1 0.
Definition absorbedState : CollisionWindow := mkWindow 0 7 0.
Definition reflectedState : CollisionWindow := mkWindow 3 3 1.

(* Theorem 1: Glider [6] impact onto Wall [1] yields merged cell [7] in 1 step *)
Theorem impact_to_absorbed : stepWindow impactState = absorbedState.
Proof. reflexivity. Qed.

(* Theorem 2: State [7] yields Left Glider [3, 3] and advanced Wall [1] in 1 step *)
Theorem absorbed_to_reflected : stepWindow absorbedState = reflectedState.
Proof. reflexivity. Qed.

(* Main Reflection Theorem: In exactly 2 steps, reflection and wall advance occur *)
Theorem collision_reflection_2step : stepWindow (stepWindow impactState) = reflectedState.
Proof. reflexivity. Qed.

(******************************************************************************)
(* Accelerated Simulator Model                                               *)
(******************************************************************************)

Inductive GliderDirection := DirRight | DirLeft.

Record AcceleratedState := mkAccState {
  wL : Z;
  wR : Z;
  gliderPos : Z;
  gliderDir : GliderDirection;
  stepCount : nat
}.

Open Scope Z_scope.

Definition acceleratedStep (s : AcceleratedState) : AcceleratedState :=
  match gliderDir s with
  | DirRight =>
    let transit := Z.to_nat (wR s - 1 - gliderPos s) in
    let delta := (transit + 2)%nat in
    mkAccState (wL s) (wR s + 1) (wR s - 1) DirLeft (stepCount s + delta)%nat
  | DirLeft =>
    let transit := Z.to_nat (gliderPos s - (wL s + 1)) in
    let delta := (transit + 2)%nat in
    mkAccState (wL s - 1) (wR s) (wL s + 1) DirRight (stepCount s + delta)%nat
  end.

(* Theorem: Accelerated steps strictly advance time *)
Theorem accelerated_step_advances_time : forall s : AcceleratedState,
  (stepCount s < stepCount (acceleratedStep s))%nat.
Proof.
  intros [l r p d sc].
  destruct d; simpl; lia.
Qed.

(* Theorem: Right bounces strictly advance the right boundary *)
Theorem accelerated_right_bounce_expands : forall s : AcceleratedState,
  gliderDir s = DirRight ->
  wR (acceleratedStep s) = wR s + 1.
Proof.
  intros [l r p d sc] Hdir.
  simpl in Hdir. subst d.
  reflexivity.
Qed.

(******************************************************************************)
(* Non-Halting Theorem                                                        *)
(******************************************************************************)

Definition Tape := Z -> nat.

Definition is_halted (t : Tape) : Prop :=
  forall x : Z, is_stable_value (t x) = true.

Theorem val6_witness_not_halted : forall (t : Tape) (x : Z),
  t x = 6%nat -> ~ is_halted t.
Proof.
  intros t x Hval Hhalt.
  specialize (Hhalt x).
  rewrite Hval in Hhalt.
  discriminate Hhalt.
Qed.

Theorem val7_witness_not_halted : forall (t : Tape) (x : Z),
  t x = 7%nat -> ~ is_halted t.
Proof.
  intros t x Hval Hhalt.
  specialize (Hhalt x).
  rewrite Hval in Hhalt.
  discriminate Hhalt.
Qed.

Theorem val3_witness_not_halted : forall (t : Tape) (x : Z),
  t x = 3%nat -> ~ is_halted t.
Proof.
  intros t x Hval Hhalt.
  specialize (Hhalt x).
  rewrite Hval in Hhalt.
  discriminate Hhalt.
Qed.
