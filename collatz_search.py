# Trace the Collatz map:
# A(3k+1) -> B(11k+5) in 20k+12 steps
# A(3k+2) -> HALT in 8k+7 steps
# A(3k+3) -> B(11k+12) in 20k+26 steps
# B(3k)   -> HALT in 8k+3 steps
# B(3k+1) -> A(11k+7) in 20k+16 steps
# B(3k+2) -> A(11k+11) in 20k+22 steps

def run_collatz(start_type, start_n):
    t = start_type
    n = start_n
    total_steps = 0
    history = []
    seen = set()
    
    while True:
        state = (t, n)
        if state in seen:
            return 'CYCLE', total_steps, history
        seen.add(state)
        history.append(state)
        
        if t == 'A':
            rem = n % 3
            if rem == 1:
                k = (n - 1) // 3
                total_steps += 20 * k + 12
                t = 'B'
                n = 11 * k + 5
            elif rem == 2:
                k = (n - 2) // 3
                total_steps += 8 * k + 7
                return 'HALT', total_steps, history
            else: # rem == 0, n = 3(k+1)
                k = (n // 3) - 1
                total_steps += 20 * k + 26
                t = 'B'
                n = 11 * k + 12
        else: # t == 'B'
            rem = n % 3
            if rem == 0:
                k = n // 3
                total_steps += 8 * k + 3
                return 'HALT', total_steps, history
            elif rem == 1:
                k = (n - 1) // 3
                total_steps += 20 * k + 16
                t = 'A'
                n = 11 * k + 7
            else: # rem == 2
                k = (n - 2) // 3
                total_steps += 20 * k + 22
                t = 'A'
                n = 11 * k + 11

print("Testing starting values B(n) and A(n):")
champions = []
for n in range(1, 100):
    res_b, steps_b, hist_b = run_collatz('B', n)
    if res_b == 'HALT':
        champions.append((steps_b, 'B', n, len(hist_b)))
    res_a, steps_a, hist_a = run_collatz('A', n)
    if res_a == 'HALT':
        champions.append((steps_a, 'A', n, len(hist_a)))

champions.sort(reverse=True)
print("Top 15 halting trajectories:")
for steps, t, n, hops in champions[:15]:
    print(f"Start {t}({n:2d}): {steps:,} steps ({hops} hops)")
