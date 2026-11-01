#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>
#include <string.h>
#include <time.h>

#define TAPE_SIZE 4194304
#define TAPE_MID (TAPE_SIZE / 2)
#define MAX_ACTIVE 64

typedef struct {
    uint8_t L[64];
    uint8_t R[64];
    uint8_t S[64];
} RuleTable;

void parse_rule(const char *str, int n, RuleTable *rule) {
    memset(rule, 0, sizeof(RuleTable));
    const char *p = str;
    for (int k = 1; k <= n; k++) {
        if (!*p) break;
        int l = p[0] - '0';
        int r = p[1] - '0';
        if (l < 0 || l > 9) l = 0;
        if (r < 0 || r > 9) r = 0;
        rule->L[k] = l;
        rule->R[k] = r;
        rule->S[k] = (k >= l + r) ? (k - l - r) : 0;
        p += 2;
        if (*p == '_' || *p == ',') p++;
    }
}

int main(int argc, char **argv) {
    int n = 11;
    const char *rule_str = "00_00_30_13_11_06_12_17_08_00_18";
    int64_t total_steps = 20000000;

    if (argc > 1) n = atoi(argv[1]);
    if (argc > 2) rule_str = argv[2];
    if (argc > 3) total_steps = atoll(argv[3]);

    RuleTable rule;
    parse_rule(rule_str, n, &rule);

    uint8_t *tape = (uint8_t*)calloc(TAPE_SIZE, 1);
    int active_pos[MAX_ACTIVE];
    int next_pos[MAX_ACTIVE];
    int active_cnt = 1;
    active_pos[0] = TAPE_MID;
    tape[TAPE_MID] = n;

    const uint8_t * __restrict__ L = rule.L;
    const uint8_t * __restrict__ R = rule.R;
    const uint8_t * __restrict__ S = rule.S;

    clock_t t0 = clock();
    int64_t step = 0;

    for (step = 0; step < total_steps; step++) {
        int next_cnt = 0;
        #pragma GCC unroll 8
        for (int i = 0; i < active_cnt; i++) {
            int x = active_pos[i];
            uint8_t v = tape[x];
            tape[x] = 0;
            if (__builtin_expect(!v, 0)) continue;

            uint8_t l = L[v];
            uint8_t s = S[v];
            uint8_t r = R[v];

            if (l) {
                int xl = x - 1;
                if (!tape[xl]) next_pos[next_cnt++] = xl;
                tape[xl] += l;
            }
            if (s) {
                if (!tape[x]) next_pos[next_cnt++] = x;
                tape[x] += s;
            }
            if (r) {
                int xr = x + 1;
                if (!tape[xr]) next_pos[next_cnt++] = xr;
                tape[xr] += r;
            }
        }
        active_cnt = next_cnt;
        #pragma GCC unroll 8
        for (int i = 0; i < next_cnt; i++) active_pos[i] = next_pos[i];

        if (__builtin_expect(!active_cnt, 0)) break;
    }

    clock_t t1 = clock();
    double sec = (double)(t1 - t0) / CLOCKS_PER_SEC;
    double m_steps = (double)step / 1000000.0;
    printf("Simulated %lld steps in %.3f s (%.1f M steps/s), %d active cells left\n", 
           (long long)step, sec, m_steps / (sec > 0 ? sec : 0.0001), active_cnt);
    return 0;
}
