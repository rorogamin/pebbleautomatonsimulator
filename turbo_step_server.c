#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>
#include <string.h>
#include <time.h>

#define TAPE_SIZE 2097152
#define TAPE_MID (TAPE_SIZE / 2)
#define MAX_ACTIVE 64
#define MAX_SAMPLES 2048

typedef struct {
    uint8_t L[64];
    uint8_t R[64];
    uint8_t S[64];
} RuleTable;

typedef struct {
    int64_t step;
    int minX;
    int maxX;
    int count;
    int xs[16];
    uint8_t vs[16];
} SampleSnap;

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
    int64_t total_steps = 10000000;
    int sample_stride = 50000;

    if (argc > 1) n = atoi(argv[1]);
    if (argc > 2) rule_str = argv[2];
    if (argc > 3) total_steps = atoll(argv[3]);
    if (argc > 4) sample_stride = atoi(argv[4]);

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

    SampleSnap *snaps = (SampleSnap*)malloc(sizeof(SampleSnap) * MAX_SAMPLES);
    int snap_count = 0;

    // Calculate adaptive stride so snaps <= MAX_SAMPLES
    if (total_steps / sample_stride >= MAX_SAMPLES) {
        sample_stride = (int)(total_steps / (MAX_SAMPLES - 10));
    }
    if (sample_stride < 1) sample_stride = 1;

    clock_t t0 = clock();
    int64_t step = 0;

    for (step = 0; step < total_steps; step++) {
        if (step > 0 && (step % sample_stride) == 0 && snap_count < MAX_SAMPLES) {
            int mn = 9999999, mx = -9999999;
            SampleSnap *sn = &snaps[snap_count++];
            sn->step = step;
            int c = (active_cnt <= 16) ? active_cnt : 16;
            sn->count = c;
            for (int j = 0; j < c; j++) {
                int x = active_pos[j];
                sn->xs[j] = x - TAPE_MID;
                sn->vs[j] = tape[x];
                if (sn->xs[j] < mn) mn = sn->xs[j];
                if (sn->xs[j] > mx) mx = sn->xs[j];
            }
            sn->minX = mn;
            sn->maxX = mx;
        }

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
    double m_steps_per_sec = (sec > 0.00001) ? ((double)step / (sec * 1000000.0)) : 9999.0;

    // Output JSON
    printf("{\"status\":\"ok\",\"executed\":%lld,\"sec\":%.4f,\"m_steps_per_sec\":%.1f,\"active\":%d,\"tape\":[", 
           (long long)step, sec, m_steps_per_sec, active_cnt);
    for (int i = 0; i < active_cnt; i++) {
        int x = active_pos[i];
        printf("[%d,%d]%s", x - TAPE_MID, tape[x], (i + 1 < active_cnt) ? "," : "");
    }
    printf("],\"history\":[");
    for (int i = 0; i < snap_count; i++) {
        SampleSnap *sn = &snaps[i];
        printf("{\"s\":%lld,\"min\":%d,\"max\":%d,\"cells\":[", (long long)sn->step, sn->minX, sn->maxX);
        for (int j = 0; j < sn->count; j++) {
            printf("[%d,%d]%s", sn->xs[j], sn->vs[j], (j + 1 < sn->count) ? "," : "");
        }
        printf("]}%s", (i + 1 < snap_count) ? "," : "");
    }
    printf("]}\n");
    return 0;
}
