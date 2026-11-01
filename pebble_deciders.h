#ifndef PEBBLE_DECIDERS_H
#define PEBBLE_DECIDERS_H

#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>
#include <stdbool.h>
#include <string.h>

#define N_PEBBLES 12
#define TAPE_SIZE 2097152
#define TAPE_MID (TAPE_SIZE / 2)
#define HASH_TAB_SIZE 4096
#define HASH_TAB_MASK (HASH_TAB_SIZE - 1)

typedef struct {
    uint8_t L[N_PEBBLES + 1];
    uint8_t R[N_PEBBLES + 1];
    uint8_t S[N_PEBBLES + 1];
} RuleTable;

typedef struct {
    uint64_t full_hash;
    int len;
    int step;
    bool occupied;
} HashSlot;

typedef struct {
    uint64_t sig;
    uint8_t dir;
    int step;
    int min_x, max_x;
} BouncerSnap;

typedef struct {
    uint64_t sig;
    uint8_t dir;
    int gap;
    int step;
} TransBouncerSnap;

typedef struct {
    uint64_t p_sig;
    uint64_t p_lw;
    uint64_t p_rw;
    int p_anchor;
    int min_m, max_m;
    int min_x, max_x;
    int step;
} PufferSnap;

typedef struct {
    uint64_t r_key;
    int r_pkt_min;
    int step;
} IslandGliderSnap;

static inline uint64_t hash_slice(const uint8_t *tape, int start, int end) {
    uint64_t h = 14695981039346656037ULL;
    for (int x = start; x <= end; x++) {
        h = (h ^ tape[x]) * 1099511628211ULL;
    }
    return h;
}

static inline void format_rule_code(const RuleTable *rules, int n, char *out, size_t out_sz) {
    char *p = out;
    size_t rem = out_sz;
    for (int k = 1; k <= n; k++) {
        int l = rules->L[k];
        int r = rules->R[k];
        int w = 0;
        if (k < 16 && l < 16 && r < 16) {
            w = snprintf(p, rem, "%x%x%s", l, r, k == n ? "" : "_");
        } else {
            w = snprintf(p, rem, "%d,%d%s", l, r, k == n ? "" : "_");
        }
        if (w < 0 || (size_t)w >= rem) break;
        p += w;
        rem -= w;
    }
}

static inline bool parse_rule_str(const char *str, int n, RuleTable *rules) {
    memset(rules, 0, sizeof(*rules));
    for (int k = 1; k <= n; k++) {
        rules->L[k] = 0; rules->R[k] = 0; rules->S[k] = (uint8_t)k;
    }
    char buf[512];
    strncpy(buf, str, sizeof(buf) - 1);
    buf[sizeof(buf) - 1] = '\0';

    char *token = strtok(buf, "_");
    int k = 1;
    while (token && k <= n) {
        if (strchr(token, ',')) {
            int l, r;
            if (sscanf(token, "%d,%d", &l, &r) == 2) {
                rules->L[k] = (uint8_t)l;
                rules->R[k] = (uint8_t)r;
                rules->S[k] = (uint8_t)(k - l - r);
            }
        } else if (strlen(token) == 2) {
            char hl[2] = { token[0], '\0' };
            char hr[2] = { token[1], '\0' };
            int l = (int)strtol(hl, NULL, 16);
            int r = (int)strtol(hr, NULL, 16);
            rules->L[k] = (uint8_t)l;
            rules->R[k] = (uint8_t)r;
            rules->S[k] = (uint8_t)(k - l - r);
        }
        token = strtok(NULL, "_");
        k++;
    }
    return true;
}

static inline bool verify_isolated_glider(const RuleTable *rules, const uint8_t *pattern, int pat_len, int period, int dx, int dir, int *max_rear_exc, int *max_front_exc) {
    if (pat_len <= 0 || pat_len > 32 || period <= 0 || period > 64) return false;
    uint8_t tape[256] = {0};
    uint8_t next[256] = {0};
    int start_pos = 96;
    for (int i = 0; i < pat_len; i++) tape[start_pos + i] = pattern[i];
    int cur_min = start_pos;
    int cur_max = start_pos + pat_len - 1;
    *max_rear_exc = 0;
    if (max_front_exc) *max_front_exc = 0;

    for (int s = 0; s < period; s++) {
        int next_min = cur_min - 1;
        int next_max = cur_max + 1;
        if (next_min < 2 || next_max > 253) return false;
        memset(&next[next_min], 0, next_max - next_min + 1);

        for (int x = cur_min; x <= cur_max; x++) {
            uint8_t v = tape[x];
            if (v == 0) continue;
            uint8_t L = rules->L[v];
            uint8_t R = rules->R[v];
            uint8_t S = rules->S[v];
            if (S > 0) next[x] += S;
            if (L > 0) next[x - 1] += L;
            if (R > 0) next[x + 1] += R;
        }

        while (next_min <= next_max && next[next_min] == 0) next_min++;
        if (next_min > next_max) return false;
        while (next_max >= next_min && next[next_max] == 0) next_max--;

        memcpy(tape, next, 256);
        cur_min = next_min;
        cur_max = next_max;

        int rear_exc = (dir == 1) ? (start_pos - cur_min) : (cur_max - (start_pos + pat_len - 1));
        if (rear_exc > *max_rear_exc) *max_rear_exc = rear_exc;
        if (max_front_exc) {
            int front_exc = (dir == 1) ? (cur_max - (start_pos + pat_len - 1) - dx) : (start_pos - cur_min - (-dx));
            if (front_exc > *max_front_exc) *max_front_exc = front_exc;
        }
    }

    int expected_min = start_pos + dx;
    int expected_max = start_pos + pat_len - 1 + dx;
    if (cur_min != expected_min || cur_max != expected_max) return false;
    for (int i = 0; i < pat_len; i++) {
        if (tape[expected_min + i] != pattern[i]) return false;
    }
    return true;
}

static inline bool verify_isolated_cycler(const RuleTable *rules, const uint8_t *tape_slice, int slice_len, int max_period, int dir_exc_check, int *exc) {
    if (slice_len <= 0 || slice_len > 32) return false;
    uint8_t tape[256] = {0};
    uint8_t next[256] = {0};
    int start_pos = 96;
    for (int i = 0; i < slice_len; i++) tape[start_pos + i] = tape_slice[i];
    int cur_min = start_pos;
    int cur_max = start_pos + slice_len - 1;
    *exc = 0;

    for (int s = 1; s <= max_period; s++) {
        int next_min = cur_min - 1;
        int next_max = cur_max + 1;
        if (next_min < 2 || next_max > 253) return false;
        memset(&next[next_min], 0, next_max - next_min + 1);

        for (int x = cur_min; x <= cur_max; x++) {
            uint8_t v = tape[x];
            if (v == 0) continue;
            uint8_t L = rules->L[v];
            uint8_t R = rules->R[v];
            uint8_t S = rules->S[v];
            if (S > 0) next[x] += S;
            if (L > 0) next[x - 1] += L;
            if (R > 0) next[x + 1] += R;
        }

        while (next_min <= next_max && next[next_min] == 0) next_min++;
        if (next_min > next_max) return false;
        while (next_max >= next_min && next[next_max] == 0) next_max--;

        memcpy(tape, next, 256);
        cur_min = next_min;
        cur_max = next_max;

        if (dir_exc_check == 1) {
            int right_reach = cur_max - (start_pos + slice_len - 1);
            if (right_reach > *exc) *exc = right_reach;
        } else if (dir_exc_check == -1) {
            int left_reach = start_pos - cur_min;
            if (left_reach > *exc) *exc = left_reach;
        }

        if (cur_min == start_pos && cur_max == start_pos + slice_len - 1) {
            bool match = true;
            for (int i = 0; i < slice_len; i++) {
                if (tape[start_pos + i] != tape_slice[i]) { match = false; break; }
            }
            if (match) return true;
        }
    }
    return false;
}

#define DEC_HALTED 0
#define DEC_CYCLE -1
#define DEC_WALL_BUILDER -2
#define DEC_GLIDER -3
#define DEC_BOUNCER -4
#define DEC_UNDECIDED -5

typedef struct {
    int decision;
    int step;
    int bouncer_type;
    int turnarounds;
} EvalResult;

static inline void sort_pos(int *arr, int n) {
    for (int i = 1; i < n; i++) {
        int key = arr[i];
        int j = i - 1;
        while (j >= 0 && arr[j] > key) {
            arr[j + 1] = arr[j];
            j--;
        }
        arr[j + 1] = key;
    }
}

static inline void evaluate_rule_fast(const RuleTable *rules, int n, int max_steps, uint8_t *tape, HashSlot *hash_tab, EvalResult *out) {
    memset(out, 0, sizeof(*out));
    memset(hash_tab, 0, sizeof(HashSlot) * HASH_TAB_SIZE);

    int nz_pos[32];
    int num_nz = 1;
    nz_pos[0] = TAPE_MID;
    tape[TAPE_MID] = (uint8_t)n;

    BouncerSnap bouncer_hist[32];
    int bouncer_cnt = 0;

    TransBouncerSnap trans_hist[32];
    int trans_cnt = 0;

    PufferSnap puffer_hist[32];
    int puffer_cnt = 0;

    IslandGliderSnap r_island_hist[32];
    int r_island_cnt = 0;

    bool is_bouncer = false;
    int b_type = 0;
    int rebounds = 0;

    int next_pos[32];

    for (int step = 0; step < max_steps; step++) {
        sort_pos(nz_pos, num_nz);

        int cur_min = nz_pos[0];
        int cur_max = nz_pos[num_nz - 1];

        if (cur_min <= 16 || cur_max >= TAPE_SIZE - 17) {
            for (int i = 0; i < num_nz; i++) tape[nz_pos[i]] = 0;
            if (is_bouncer) {
                out->decision = DEC_BOUNCER;
                out->step = step;
                out->bouncer_type = b_type;
                out->turnarounds = rebounds;
            } else {
                out->decision = DEC_GLIDER;
                out->step = step;
            }
            return;
        }

        bool moving = false;
        int min_moving = 9999999, max_moving = -9999999;
        int net_l = 0, net_r = 0;

        for (int i = 0; i < num_nz; i++) {
            int x = nz_pos[i];
            uint8_t v = tape[x];
            if (rules->L[v] > 0 || rules->R[v] > 0) {
                moving = true;
                if (x < min_moving) min_moving = x;
                if (x > max_moving) max_moving = x;
                net_l += rules->L[v];
                net_r += rules->R[v];
            }
        }

        if (!moving) {
            out->decision = DEC_HALTED;
            out->step = step;
            for (int i = 0; i < num_nz; i++) tape[nz_pos[i]] = 0;
            return;
        }

        // Run full deciders during first 3000 steps
        if (step < 3000) {
            // 1. Cycle Check (Static or pure translated) using O(1) hash table
            int len = cur_max - cur_min + 1;
            uint64_t full_hash = 14695981039346656037ULL;
            for (int i = 0; i < num_nz; i++) {
                full_hash = (full_hash ^ (nz_pos[i] - cur_min)) * 1099511628211ULL;
                full_hash = (full_hash ^ tape[nz_pos[i]]) * 1099511628211ULL;
            }
            uint32_t slot = (uint32_t)(full_hash & HASH_TAB_MASK);
            if (hash_tab[slot].occupied && hash_tab[slot].full_hash == full_hash && hash_tab[slot].len == len) {
                int period = step - hash_tab[slot].step;
                out->decision = (period == 1) ? DEC_HALTED : DEC_CYCLE;
                out->step = step;
                for (int i = 0; i < num_nz; i++) tape[nz_pos[i]] = 0;
                return;
            }
            hash_tab[slot].occupied = true;
            hash_tab[slot].full_hash = full_hash;
            hash_tab[slot].len = len;
            hash_tab[slot].step = step;

            // Static clusters check
            int lw_start = 9999999, lw_end = -9999999;
            bool left_has_nz = false;
            int rw_start = 9999999, rw_end = -9999999;
            bool right_has_nz = false;
            bool all_other_static = true;

            for (int i = 0; i < num_nz; i++) {
                int x = nz_pos[i];
                uint8_t v = tape[x];
                if (x < min_moving) {
                    left_has_nz = true;
                    if (x < lw_start) lw_start = x;
                    if (x > lw_end) lw_end = x;
                    if (rules->L[v] > 0 || rules->R[v] > 0) all_other_static = false;
                } else if (x > max_moving) {
                    right_has_nz = true;
                    if (x < rw_start) rw_start = x;
                    if (x > rw_end) rw_end = x;
                    if (rules->L[v] > 0 || rules->R[v] > 0) all_other_static = false;
                }
            }

            // 2. Strict Two-Wall Bouncer
            if (all_other_static && left_has_nz && right_has_nz) {
                if ((lw_end - lw_start <= 8) && (rw_end - rw_start <= 8)) {
                    int gap_L = min_moving - lw_end - 1;
                    int gap_R = rw_start - max_moving - 1;
                    if (gap_L >= 0 && gap_R >= 0) {
                        uint8_t b_dir = 255;
                        if (net_r > 0 && net_l == 0 && gap_R >= 0) b_dir = 1;
                        else if (net_l > 0 && net_r == 0 && gap_L >= 0) b_dir = 0;

                        if (b_dir != 255) {
                            uint64_t b_shuttle = hash_slice(tape, min_moving, max_moving);
                            uint64_t b_lw = hash_slice(tape, lw_start, lw_end);
                            uint64_t b_rw = hash_slice(tape, rw_start, rw_end);
                            uint64_t b_sig = b_shuttle ^ (b_lw * 31) ^ (b_rw * 1009);

                            for (int i = 0; i < bouncer_cnt; i++) {
                                if (bouncer_hist[i].sig == b_sig && bouncer_hist[i].dir == b_dir) {
                                    bool opp_seen = false;
                                    for (int j = i + 1; j < bouncer_cnt; j++) {
                                        if (bouncer_hist[j].dir != b_dir) { opp_seen = true; break; }
                                    }
                                    if (opp_seen && (cur_max - cur_min) >= (bouncer_hist[i].max_x - bouncer_hist[i].min_x)) {
                                        is_bouncer = true;
                                        b_type = 1;
                                        rebounds++;
                                    }
                                }
                            }
                            if (bouncer_cnt < 32) bouncer_hist[bouncer_cnt++] = (BouncerSnap){ b_sig, b_dir, step, cur_min, cur_max };
                            else bouncer_hist[step % 32] = (BouncerSnap){ b_sig, b_dir, step, cur_min, cur_max };
                        }
                    }
                }
            }

            // 3. Puffer / Wall-Builder -> PRUNE!
            if (all_other_static) {
                uint64_t p_shuttle = hash_slice(tape, min_moving, max_moving);
                if (right_has_nz) {
                    int p_lw_end_idx = (cur_min + 4 < max_moving) ? cur_min + 4 : max_moving;
                    uint64_t p_lw = hash_slice(tape, cur_min, p_lw_end_idx);
                    uint64_t p_rw = hash_slice(tape, rw_start, cur_max);

                    for (int i = 0; i < puffer_cnt; i++) {
                        if (puffer_hist[i].p_sig == p_shuttle && puffer_hist[i].p_lw == p_lw &&
                            puffer_hist[i].p_rw == p_rw && puffer_hist[i].p_anchor == rw_start) {
                            int dx = min_moving - puffer_hist[i].min_m;
                            if (dx < 0 && cur_max == puffer_hist[i].max_x && (cur_min - puffer_hist[i].min_x == dx)) {
                                out->decision = DEC_WALL_BUILDER;
                                out->step = step;
                                for (int k = 0; k < num_nz; k++) tape[nz_pos[k]] = 0;
                                return;
                            }
                        }
                    }
                    if (puffer_cnt < 32) puffer_hist[puffer_cnt++] = (PufferSnap){ p_shuttle, p_lw, p_rw, rw_start, min_moving, max_moving, cur_min, cur_max, step };
                }

                if (left_has_nz) {
                    int p_rw_start_idx = (cur_max - 4 > min_moving) ? cur_max - 4 : min_moving;
                    uint64_t p_rw = hash_slice(tape, p_rw_start_idx, cur_max);
                    uint64_t p_lw = hash_slice(tape, cur_min, lw_end);

                    for (int i = 0; i < puffer_cnt; i++) {
                        if (puffer_hist[i].p_sig == p_shuttle && puffer_hist[i].p_rw == p_rw &&
                            puffer_hist[i].p_lw == p_lw && puffer_hist[i].p_anchor == lw_end) {
                        int dx = min_moving - puffer_hist[i].min_m;
                            if (dx > 0 && cur_min == puffer_hist[i].min_x && (cur_max - puffer_hist[i].max_x == dx)) {
                                out->decision = DEC_WALL_BUILDER;
                                out->step = step;
                                for (int k = 0; k < num_nz; k++) tape[nz_pos[k]] = 0;
                                return;
                            }
                        }
                    }
                    if (puffer_cnt < 32) puffer_hist[puffer_cnt++] = (PufferSnap){ p_shuttle, p_lw, p_rw, lw_end, min_moving, max_moving, cur_min, cur_max, step };
                }
            }

            // 4. Disconnected Right Island Glider
            int r_pkt_max = cur_max;
            int r_pkt_min = r_pkt_max;
            int r_left_anchor = -1;
            for (int i = num_nz - 1; i >= 1; i--) {
                if (nz_pos[i] - nz_pos[i - 1] >= 3) {
                    r_left_anchor = nz_pos[i - 1];
                    r_pkt_min = nz_pos[i];
                    break;
                }
            }

            if (r_left_anchor >= cur_min && (r_pkt_max - r_pkt_min + 1 <= 32)) {
                int r_pat_len = r_pkt_max - r_pkt_min + 1;
                bool has_m = false;
                for (int x = r_pkt_min; x <= r_pkt_max; x++) {
                    uint8_t v = tape[x];
                    if (rules->L[v] > 0 || rules->R[v] > 0) { has_m = true; break; }
                }
                if (has_m) {
                    uint64_t r_key = hash_slice(tape, r_pkt_min, r_pkt_max);
                    for (int i = 0; i < r_island_cnt; i++) {
                        if (r_island_hist[i].r_key == r_key) {
                            int period = step - r_island_hist[i].step;
                            int dx = r_pkt_min - r_island_hist[i].r_pkt_min;
                            if (dx > 0 && period > 0 && period <= 64) {
                                int max_rear = 0, max_front = 0;
                                if (verify_isolated_glider(rules, &tape[r_pkt_min], r_pat_len, period, dx, 1, &max_rear, &max_front)) {
                                    int left_slice_len = r_left_anchor - cur_min + 1;
                                    int right_exc = 0;
                                    if (verify_isolated_cycler(rules, &tape[cur_min], left_slice_len, 64, 1, &right_exc) && right_exc <= 0) {
                                        int gap = r_pkt_min - r_left_anchor - 1;
                                        if (gap >= max_rear) {
                                            out->decision = DEC_GLIDER;
                                            out->step = step;
                                            for (int k = 0; k < num_nz; k++) tape[nz_pos[k]] = 0;
                                            return;
                                        }
                                    }
                                }
                            }
                        }
                    }
                    if (r_island_cnt < 32) r_island_hist[r_island_cnt++] = (IslandGliderSnap){ r_key, r_pkt_min, step };
                    else r_island_hist[step % 32] = (IslandGliderSnap){ r_key, r_pkt_min, step };
                }
            }

            // 5. Expanding / Translating Turnaround Bouncer
            int tb_lw_end = cur_min;
            int tb_rw_start = cur_max;
            for (int i = 0; i < num_nz - 1; i++) {
                if (nz_pos[i + 1] - nz_pos[i] >= 3) {
                    tb_lw_end = nz_pos[i];
                    tb_rw_start = nz_pos[i + 1];
                    break;
                }
            }

            if (tb_lw_end < tb_rw_start && (tb_rw_start - tb_lw_end - 1 >= 2) &&
                (tb_lw_end - cur_min + 1 <= 8) && (cur_max - tb_rw_start + 1 <= 8)) {
                uint64_t tb_lw = hash_slice(tape, cur_min, tb_lw_end);
                uint64_t tb_rw = hash_slice(tape, tb_rw_start, cur_max);
                uint64_t tb_sig = tb_lw ^ (tb_rw * 10007);
                int tb_gap = tb_rw_start - tb_lw_end - 1;
                uint8_t tb_dir = (net_r > net_l) ? 1 : ((net_l > net_r) ? 0 : 255);

                for (int i = 0; i < trans_cnt; i++) {
                    if (trans_hist[i].sig == tb_sig && tb_gap >= trans_hist[i].gap) {
                        bool opp_seen = false;
                        for (int j = i + 1; j < trans_cnt; j++) {
                            if (trans_hist[j].dir != 255 && trans_hist[j].dir != tb_dir) {
                                opp_seen = true; break;
                            }
                        }
                        if (opp_seen) {
                            is_bouncer = true;
                            b_type = 3;
                            rebounds++;
                        }
                    }
                }
                if (trans_cnt < 32) trans_hist[trans_cnt++] = (TransBouncerSnap){ tb_sig, tb_dir, tb_gap, step };
                else trans_hist[step % 32] = (TransBouncerSnap){ tb_sig, tb_dir, tb_gap, step };
            }
        }

        // Fast Step Advance
        int next_cnt = 0;
        uint8_t s_vals[32], l_vals[32], r_vals[32];
        for (int i = 0; i < num_nz; i++) {
            int x = nz_pos[i];
            uint8_t v = tape[x];
            s_vals[i] = rules->S[v];
            l_vals[i] = rules->L[v];
            r_vals[i] = rules->R[v];
            tape[x] = 0;
        }

        for (int i = 0; i < num_nz; i++) {
            int x = nz_pos[i];
            if (s_vals[i] > 0) {
                if (tape[x] == 0) next_pos[next_cnt++] = x;
                tape[x] += s_vals[i];
            }
            if (l_vals[i] > 0) {
                int nx = x - 1;
                if (tape[nx] == 0) next_pos[next_cnt++] = nx;
                tape[nx] += l_vals[i];
            }
            if (r_vals[i] > 0) {
                int nx = x + 1;
                if (tape[nx] == 0) next_pos[next_cnt++] = nx;
                tape[nx] += r_vals[i];
            }
        }

        num_nz = next_cnt;
        for (int i = 0; i < num_nz; i++) nz_pos[i] = next_pos[i];
    }

    for (int i = 0; i < num_nz; i++) tape[nz_pos[i]] = 0;
    out->step = max_steps;
    if (is_bouncer) {
        out->decision = DEC_BOUNCER;
        out->bouncer_type = b_type;
        out->turnarounds = rebounds;
    } else {
        out->decision = DEC_UNDECIDED;
    }
}

#endif // PEBBLE_DECIDERS_H
