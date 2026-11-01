#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <stdbool.h>
#include <time.h>
#include <omp.h>

#define MAX_N 128
#define TAPE_SIZE 4096
#define TAPE_MID (TAPE_SIZE / 2)
#define UNASSIGNED 255
#define MAX_HIST 128

typedef struct {
    uint8_t L[MAX_N + 1];
    uint8_t R[MAX_N + 1];
    uint8_t S[MAX_N + 1];
} RuleTable;

typedef struct {
    uint8_t L;
    uint8_t R;
} Pair;

static Pair pairs[MAX_N + 1][1024];
static int pair_count[MAX_N + 1];

static void init_pairs(int max_n) {
    for (int k = 1; k <= max_n; k++) {
        int count = 0;
        for (int l = 0; l <= k; l++) {
            for (int r = 0; r <= k - l; r++) {
                pairs[k][count].L = (uint8_t)l;
                pairs[k][count].R = (uint8_t)r;
                count++;
            }
        }
        pair_count[k] = count;
    }
}

// Format rule table into short string e.g. "00_11_03_21_04"
static void format_rule(const RuleTable *rules, int n, char *out, size_t out_size) {
    char *p = out;
    size_t rem = out_size;
    for (int k = 1; k <= n; k++) {
        uint8_t l = rules->L[k];
        uint8_t r = rules->R[k];
        int written = 0;
        if (l == UNASSIGNED || r == UNASSIGNED) {
            written = snprintf(p, rem, "??%s", k == n ? "" : "_");
        } else if (k < 16 && l < 16 && r < 16) {
            written = snprintf(p, rem, "%x%x%s", l, r, k == n ? "" : "_");
        } else {
            written = snprintf(p, rem, "%d,%d%s", l, r, k == n ? "" : "_");
        }
        if (written < 0 || (size_t)written >= rem) break;
        p += written;
        rem -= written;
    }
}

// Parse rule string into RuleTable
static bool parse_rule(const char *str, int n, RuleTable *rules) {
    memset(rules, 0, sizeof(RuleTable));
    char copy[1024];
    strncpy(copy, str, sizeof(copy) - 1);
    copy[sizeof(copy) - 1] = '\0';

    char *token = strtok(copy, "_ \t\r\n");
    int k = 1;
    while (token && k <= n) {
        if (strchr(token, ',')) {
            int l, r;
            if (sscanf(token, "%d,%d", &l, &r) == 2) {
                rules->L[k] = (uint8_t)l;
                rules->R[k] = (uint8_t)r;
            }
        } else if (strlen(token) >= 2) {
            char l_ch = token[0];
            char r_ch = token[1];
            int l = (l_ch >= 'a' && l_ch <= 'f') ? (l_ch - 'a' + 10) : (l_ch - '0');
            int r = (r_ch >= 'a' && r_ch <= 'f') ? (r_ch - 'a' + 10) : (r_ch - '0');
            rules->L[k] = (uint8_t)l;
            rules->R[k] = (uint8_t)r;
        }
        rules->S[k] = (uint8_t)(k - rules->L[k] - rules->R[k]);
        token = strtok(NULL, "_ \t\r\n");
        k++;
    }
    return (k > n);
}

// History snapshot for cycle, bouncer, wall-builder, and glider detection
typedef struct {
    uint64_t full_hash;
    int16_t min_x;
    int16_t max_x;
    int16_t len;
    int16_t min_m;
    int16_t max_m;
    int16_t step;

    // Two-wall Bouncer signature
    uint8_t has_bouncer;
    uint8_t b_dir; // 0: L, 1: R
    uint64_t b_shuttle_hash;
    uint64_t b_lw_hash;
    uint64_t b_rw_hash;
    int16_t b_dist;

    // Open Bouncer signature
    uint8_t has_open_bouncer;
    uint8_t open_dir; // 0: open_L, 1: open_R
    uint64_t open_shuttle_hash;
    uint64_t open_wall_hash;

    // Puffer / Wall-builder signature
    uint8_t has_puffer_L;
    uint64_t p_sig_L_shuttle;
    uint64_t p_sig_L_lw;
    uint64_t p_sig_L_rw;
    int16_t p_rw_start;

    uint8_t has_puffer_R;
    uint64_t p_sig_R_shuttle;
    uint64_t p_sig_R_rw;
    uint64_t p_sig_R_lw;
    int16_t p_lw_end;

    // Glider
    uint64_t g_hash;
    int16_t g_len;

    // Edge Gliders (Right & Left)
    uint8_t has_r_glider;
    uint64_t r_g_hash;
    int16_t r_g_len;
    int16_t r_g_min;
    int16_t r_g_max;
    int16_t r_left_anchor;

    uint8_t has_l_glider;
    uint64_t l_g_hash;
    int16_t l_g_len;
    int16_t l_g_min;
    int16_t l_g_max;
    int16_t l_right_anchor;

    // Multi-Island Decider (M >= 2: Dual, Tripled, Quadrupled Gliders/Cyclers)
    uint8_t m_isl_count;
    uint64_t m_isl_combo_hash;
    int16_t m_isl_starts[8];
    int16_t m_isl_ends[8];

    // Translating/Expanding Turnaround Bouncer
    uint8_t has_trans_bouncer;
    uint8_t tb_dir;
    uint64_t tb_lw_hash;
    uint64_t tb_rw_hash;
    int16_t tb_gap;
} StepHistory;

static inline uint64_t hash_slice(const uint8_t *tape, int start, int end) {
    uint64_t h = 14695981039346656037ULL;
    for (int x = start; x <= end; x++) {
        h = (h ^ tape[x]) * 1099511628211ULL;
    }
    return h;
}

static bool verify_isolated_glider(const RuleTable *rules, const uint8_t *pattern, int pat_len, int period, int dx, int dir, int *max_rear_exc, int *max_front_exc) {
    if (pat_len <= 0 || pat_len > 32 || period <= 0 || period > 64) return false;
    
    uint8_t tape[256];
    uint8_t next[256];
    memset(tape, 0, sizeof(tape));
    
    int start_pos = 96;
    int total_sum = 0;
    for (int i = 0; i < pat_len; i++) {
        tape[start_pos + i] = pattern[i];
        total_sum += pattern[i];
    }
    
    int min_orig = start_pos;
    int max_orig = start_pos + pat_len - 1;
    *max_rear_exc = 0;
    if (max_front_exc) *max_front_exc = 0;
    
    int cur_min = min_orig;
    int cur_max = max_orig;
    
    for (int s = 0; s < period; s++) {
        int next_min = cur_min - 1;
        int next_max = cur_max + 1;
        if (next_min < 2 || next_max > 253) return false;
        memset(&next[next_min], 0, next_max - next_min + 1);
        
        bool any_moving = false;
        int act_min = 999, act_max = -999;
        
        for (int x = cur_min; x <= cur_max; x++) {
            uint8_t v = tape[x];
            if (v == 0) continue;
            if (rules->L[v] == UNASSIGNED) return false; // unassigned rule encountered
            uint8_t L = rules->L[v];
            uint8_t R = rules->R[v];
            uint8_t S = rules->S[v];
            if (S > 0) next[x] += S;
            if (L > 0) next[x - 1] += L;
            if (R > 0) next[x + 1] += R;
            if (L > 0 || R > 0) {
                any_moving = true;
                if (x < act_min) act_min = x;
                if (x > act_max) act_max = x;
            }
        }
        
        if (!any_moving) return false;
        
        if (dir == 1) { // R
            int rear = min_orig - act_min;
            if (rear > *max_rear_exc) *max_rear_exc = rear;
            if (max_front_exc) {
                int front = act_max - max_orig;
                if (front > *max_front_exc) *max_front_exc = front;
            }
        } else { // L
            int rear = act_max - max_orig;
            if (rear > *max_rear_exc) *max_rear_exc = rear;
            if (max_front_exc) {
                int front = min_orig - act_min;
                if (front > *max_front_exc) *max_front_exc = front;
            }
        }
        
        while (next_min <= next_max && next[next_min] == 0) next_min++;
        if (next_min > next_max) return false;
        while (next_max >= next_min && next[next_max] == 0) next_max--;
        
        memcpy(tape + next_min, next + next_min, next_max - next_min + 1);
        cur_min = next_min;
        cur_max = next_max;
    }
    
    if (cur_min != min_orig + dx) return false;
    if (cur_max - cur_min + 1 != pat_len) return false;
    
    int cur_sum = 0;
    for (int i = 0; i < pat_len; i++) {
        if (tape[cur_min + i] != pattern[i]) return false;
        cur_sum += tape[cur_min + i];
    }
    if (cur_sum != total_sum) return false;
    
    return true;
}

static bool verify_isolated_cycler(const RuleTable *rules, const uint8_t *tape_slice, int slice_len, int max_period, int dir_exc_check, int *exc) {
    if (slice_len <= 0 || slice_len > 128) return false;
    uint8_t tape[256];
    uint8_t next[256];
    memset(tape, 0, sizeof(tape));

    int start_pos = 64;
    bool all_static = true;
    for (int i = 0; i < slice_len; i++) {
        uint8_t v = tape_slice[i];
        tape[start_pos + i] = v;
        if (v > 0) {
            if (rules->L[v] == UNASSIGNED) return false;
            if (rules->L[v] > 0 || rules->R[v] > 0) all_static = false;
        }
    }
    *exc = 0;
    if (all_static) return true; // Static wall: 0 excursion

    int init_min = start_pos;
    int init_max = start_pos + slice_len - 1;
    int max_right_reach = init_max;
    int min_left_reach = init_min;

    int cur_min = init_min;
    int cur_max = init_max;

    for (int s = 1; s <= max_period; s++) {
        int next_min = cur_min - 1;
        int next_max = cur_max + 1;
        if (next_min < 2 || next_max > 253) return false;
        memset(&next[next_min], 0, next_max - next_min + 1);

        for (int x = cur_min; x <= cur_max; x++) {
            uint8_t v = tape[x];
            if (v == 0) continue;
            if (rules->L[v] == UNASSIGNED) return false;
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

        if (next_max > max_right_reach) max_right_reach = next_max;
        if (next_min < min_left_reach) min_left_reach = next_min;

        if (next_min == init_min && next_max == init_max) {
            bool matches = true;
            for (int i = 0; i < slice_len; i++) {
                if (next[init_min + i] != tape_slice[i]) { matches = false; break; }
            }
            if (matches) {
                if (dir_exc_check == 1) *exc = max_right_reach - init_max;
                else if (dir_exc_check == -1) *exc = init_min - min_left_reach;
                return true;
            }
        }

        memcpy(tape + next_min, next + next_min, next_max - next_min + 1);
        cur_min = next_min;
        cur_max = next_max;
    }
    return false;
}

// Simulates a single machine with full translated cycle, bouncer, and separated glider deciders.
// Returns: steps if stabilized, -1 if cycle/glider/bouncer/timeout.
static inline int simulate_fast(const RuleTable *rules, int n, int max_steps) {
    uint8_t tapeA[TAPE_SIZE] = {0};
    uint8_t tapeB[TAPE_SIZE] = {0};

    uint8_t *curr = tapeA;
    uint8_t *next = tapeB;

    curr[TAPE_MID] = (uint8_t)n;
    int cur_min = TAPE_MID;
    int cur_max = TAPE_MID;

    StepHistory hist[MAX_HIST];
    int hist_count = 0;

    for (int step = 0; step < max_steps; step++) {
        bool moving = false;
        int min_moving = 9999, max_moving = -9999;

        for (int x = cur_min; x <= cur_max; x++) {
            uint8_t v = curr[x];
            if (v > 0 && (rules->L[v] > 0 || rules->R[v] > 0)) {
                moving = true;
                if (x < min_moving) min_moving = x;
                if (x > max_moving) max_moving = x;
            }
        }

        if (!moving) {
            return step; // Stabilized!
        }

        if (cur_min <= 4 || cur_max >= TAPE_SIZE - 5) return -1;

        // 1. Full Cycle Check
        int len = cur_max - cur_min + 1;
        uint64_t full_hash = hash_slice(curr, cur_min, cur_max);
        for (int i = 0; i < hist_count; i++) {
            if (hist[i].full_hash == full_hash && hist[i].len == len) {
                return -1; // Cycle pruned!
            }
        }

        // Identify nonzeros outside moving packet
        int lw_start = 9999, lw_end = -9999;
        bool left_has_nz = false;
        int rw_start = 9999, rw_end = -9999;
        bool right_has_nz = false;
        bool all_other_static = true;

        for (int x = cur_min; x < min_moving; x++) {
            uint8_t v = curr[x];
            if (v > 0) {
                left_has_nz = true;
                if (x < lw_start) lw_start = x;
                if (x > lw_end) lw_end = x;
                if (rules->L[v] > 0 || rules->R[v] > 0) all_other_static = false;
            }
        }

        for (int x = max_moving + 1; x <= cur_max; x++) {
            uint8_t v = curr[x];
            if (v > 0) {
                right_has_nz = true;
                if (x < rw_start) rw_start = x;
                if (x > rw_end) rw_end = x;
                if (rules->L[v] > 0 || rules->R[v] > 0) all_other_static = false;
            }
        }

        int net_l = 0, net_r = 0;
        for (int x = min_moving; x <= max_moving; x++) {
            uint8_t v = curr[x];
            net_l += rules->L[v];
            net_r += rules->R[v];
        }

        StepHistory snap;
        memset(&snap, 0, sizeof(snap));
        snap.full_hash = full_hash;
        snap.min_x = cur_min;
        snap.max_x = cur_max;
        snap.len = len;
        snap.min_m = min_moving;
        snap.max_m = max_moving;
        snap.step = step;

        // 2. Strict Two-Wall Bouncer
        if (all_other_static && left_has_nz && right_has_nz) {
            if ((lw_end - lw_start <= 8) && (rw_end - rw_start <= 8)) {
                int gap_L = min_moving - lw_end - 1;
                int gap_R = rw_start - max_moving - 1;
                if (gap_L >= 0 && gap_R >= 0) {
                    uint8_t b_dir = 255;
                    int b_dist = 0;
                    if (net_r > 0 && net_l == 0 && gap_R >= 0) {
                        b_dir = 1; b_dist = min_moving - lw_end;
                    } else if (net_l > 0 && net_r == 0 && gap_L >= 0) {
                        b_dir = 0; b_dist = rw_start - max_moving;
                    }

                    if (b_dir != 255) {
                        uint64_t b_shuttle = hash_slice(curr, min_moving, max_moving);
                        uint64_t b_lw = hash_slice(curr, lw_start, lw_end);
                        uint64_t b_rw = hash_slice(curr, rw_start, rw_end);

                        for (int i = 0; i < hist_count; i++) {
                            if (hist[i].has_bouncer && hist[i].b_dir == b_dir &&
                                hist[i].b_shuttle_hash == b_shuttle &&
                                hist[i].b_lw_hash == b_lw &&
                                hist[i].b_rw_hash == b_rw &&
                                hist[i].b_dist == b_dist) {
                                bool opp_seen = false;
                                for (int j = i + 1; j < hist_count; j++) {
                                    if (hist[j].has_bouncer && hist[j].b_dir != b_dir) {
                                        opp_seen = true; break;
                                    }
                                }
                                if (opp_seen && (cur_max - cur_min) >= (hist[i].max_x - hist[i].min_x)) {
                                    return -1; // Two-wall bouncer pruned!
                                }
                            }
                        }
                        snap.has_bouncer = 1;
                        snap.b_dir = b_dir;
                        snap.b_shuttle_hash = b_shuttle;
                        snap.b_lw_hash = b_lw;
                        snap.b_rw_hash = b_rw;
                        snap.b_dist = b_dist;
                    }
                }
            }
        }

        // 3. Open Turnaround Bouncer
        if (all_other_static) {
            if (left_has_nz && !right_has_nz) {
                if (lw_end - lw_start <= 3 && (min_moving - lw_end - 1 >= 0)) {
                    if (net_l > 0 && net_r == 0) {
                        uint64_t b_shuttle = hash_slice(curr, min_moving, max_moving);
                        uint64_t b_lw = hash_slice(curr, lw_start, lw_end);
                        for (int i = 0; i < hist_count; i++) {
                            if (hist[i].has_open_bouncer && hist[i].open_dir == 1 &&
                                hist[i].open_shuttle_hash == b_shuttle &&
                                hist[i].open_wall_hash == b_lw) {
                                if (cur_min == hist[i].min_x && cur_max > hist[i].max_x) {
                                    return -1; // Open R bouncer pruned!
                                }
                            }
                        }
                        snap.has_open_bouncer = 1;
                        snap.open_dir = 1;
                        snap.open_shuttle_hash = b_shuttle;
                        snap.open_wall_hash = b_lw;
                    }
                }
            }

            if (right_has_nz && !left_has_nz) {
                if (rw_end - rw_start <= 3 && (rw_start - max_moving - 1 >= 0)) {
                    if (net_r > 0 && net_l == 0) {
                        uint64_t b_shuttle = hash_slice(curr, min_moving, max_moving);
                        uint64_t b_rw = hash_slice(curr, rw_start, rw_end);
                        for (int i = 0; i < hist_count; i++) {
                            if (hist[i].has_open_bouncer && hist[i].open_dir == 0 &&
                                hist[i].open_shuttle_hash == b_shuttle &&
                                hist[i].open_wall_hash == b_rw) {
                                if (cur_max == hist[i].max_x && cur_min < hist[i].min_x) {
                                    return -1; // Open L bouncer pruned!
                                }
                            }
                        }
                        snap.has_open_bouncer = 1;
                        snap.open_dir = 0;
                        snap.open_shuttle_hash = b_shuttle;
                        snap.open_wall_hash = b_rw;
                    }
                }
            }
        }

        // 4. Puffer / Wall-Builder
        if (all_other_static) {
            uint64_t p_shuttle = hash_slice(curr, min_moving, max_moving);

            // Left expanding away from static right anchor:
            if (right_has_nz) {
                int p_lw_end_idx = (cur_min + 4 < max_moving) ? cur_min + 4 : max_moving;
                uint64_t p_lw = hash_slice(curr, cur_min, p_lw_end_idx);
                uint64_t p_rw = hash_slice(curr, rw_start, cur_max);

                for (int i = 0; i < hist_count; i++) {
                    if (hist[i].has_puffer_L &&
                        hist[i].p_sig_L_shuttle == p_shuttle &&
                        hist[i].p_sig_L_lw == p_lw &&
                        hist[i].p_sig_L_rw == p_rw &&
                        hist[i].p_rw_start == rw_start) {
                        int dx = min_moving - hist[i].min_m;
                        if (dx < 0 && cur_max == hist[i].max_x && (cur_min - hist[i].min_x == dx)) {
                            int max_reach = -9999;
                            for (int j = i; j < hist_count; j++) {
                                if (hist[j].max_m > max_reach) max_reach = hist[j].max_m;
                            }
                            if (max_moving > max_reach) max_reach = max_moving;
                            if (max_reach < rw_start) {
                                return -1; // Wall-builder L pruned!
                            }
                        }
                    }
                }
                snap.has_puffer_L = 1;
                snap.p_sig_L_shuttle = p_shuttle;
                snap.p_sig_L_lw = p_lw;
                snap.p_sig_L_rw = p_rw;
                snap.p_rw_start = rw_start;
            }

            // Right expanding away from static left anchor:
            if (left_has_nz) {
                int p_rw_start_idx = (cur_max - 4 > min_moving) ? cur_max - 4 : min_moving;
                uint64_t p_rw = hash_slice(curr, p_rw_start_idx, cur_max);
                uint64_t p_lw = hash_slice(curr, cur_min, lw_end);

                for (int i = 0; i < hist_count; i++) {
                    if (hist[i].has_puffer_R &&
                        hist[i].p_sig_R_shuttle == p_shuttle &&
                        hist[i].p_sig_R_rw == p_rw &&
                        hist[i].p_sig_R_lw == p_lw &&
                        hist[i].p_lw_end == lw_end) {
                        int dx = min_moving - hist[i].min_m;
                        if (dx > 0 && cur_min == hist[i].min_x && (cur_max - hist[i].max_x == dx)) {
                            int min_reach = 9999;
                            for (int j = i; j < hist_count; j++) {
                                if (hist[j].min_m < min_reach) min_reach = hist[j].min_m;
                            }
                            if (min_moving < min_reach) min_reach = min_moving;
                            if (min_reach > lw_end) {
                                return -1; // Wall-builder R pruned!
                            }
                        }
                    }
                }
                snap.has_puffer_R = 1;
                snap.p_sig_R_shuttle = p_shuttle;
                snap.p_sig_R_rw = p_rw;
                snap.p_sig_R_lw = p_lw;
                snap.p_lw_end = lw_end;
            }
        }

        // 5. Strict Escaping Glider (Must be at edge and sole active)
        if (all_other_static) {
            int pat_len = max_moving - min_moving + 1;
            uint64_t g_hash = hash_slice(curr, min_moving, max_moving);

            if (max_moving == cur_max && pat_len <= 32) {
                for (int i = 0; i < hist_count; i++) {
                    if (hist[i].g_hash == g_hash && hist[i].g_len == pat_len) {
                        int dx = min_moving - hist[i].min_m;
                        int period = step - hist[i].step;
                        if (dx > 0 && period > 0 && period <= 64) {
                            int max_rear = 0, max_front = 0;
                            if (verify_isolated_glider(rules, &curr[min_moving], pat_len, period, dx, 1, &max_rear, &max_front)) {
                                int gap = left_has_nz ? (min_moving - lw_end) : 9999;
                                if (gap > max_rear) {
                                    return -1; // Right glider pruned!
                                }
                            }
                        }
                    }
                }
            }

            if (min_moving == cur_min && pat_len <= 32) {
                for (int i = 0; i < hist_count; i++) {
                    if (hist[i].g_hash == g_hash && hist[i].g_len == pat_len) {
                        int dx = min_moving - hist[i].min_m;
                        int period = step - hist[i].step;
                        if (dx < 0 && period > 0 && period <= 64) {
                            int max_rear = 0, max_front = 0;
                            if (verify_isolated_glider(rules, &curr[min_moving], pat_len, period, dx, 0, &max_rear, &max_front)) {
                                int gap = right_has_nz ? (rw_start - max_moving) : 9999;
                                if (gap > max_rear) {
                                    return -1; // Left glider pruned!
                                }
                            }
                        }
                    }
                }
            }
            snap.g_hash = g_hash;
            snap.g_len = pat_len;
        }

        // 6. Disconnected Right Island Glider
        int r_pkt_max = cur_max;
        int r_pkt_min = r_pkt_max;
        int r_zero_run = 0;
        int r_left_anchor = -1;
        for (int x = cur_max - 1; x >= cur_min; x--) {
            if (curr[x] == 0) {
                r_zero_run++;
            } else {
                if (r_zero_run >= 2) {
                    r_left_anchor = x;
                    break;
                } else {
                    r_zero_run = 0;
                    r_pkt_min = x;
                    if (r_pkt_max - r_pkt_min + 1 > 32) break;
                }
            }
        }
        if (r_left_anchor != -1) {
            int r_pat_len = r_pkt_max - r_pkt_min + 1;
            if (r_pat_len <= 32) {
                bool has_m = false;
                for (int x = r_pkt_min; x <= r_pkt_max; x++) {
                    uint8_t v = curr[x];
                    if (v > 0 && (rules->L[v] > 0 || rules->R[v] > 0)) { has_m = true; break; }
                }
                if (has_m) {
                    uint64_t r_hash = hash_slice(curr, r_pkt_min, r_pkt_max);
                    for (int i = 0; i < hist_count; i++) {
                        if (hist[i].has_r_glider && hist[i].r_g_hash == r_hash && hist[i].r_g_len == r_pat_len) {
                            int period = step - hist[i].step;
                            int dx = r_pkt_min - hist[i].r_g_min;
                            if (dx > 0 && period > 0 && period <= 64) {
                                int max_rear = 0, max_front = 0;
                                if (verify_isolated_glider(rules, &curr[r_pkt_min], r_pat_len, period, dx, 1, &max_rear, &max_front)) {
                                    int right_exc = 0;
                                    int left_slice_len = r_left_anchor - cur_min + 1;
                                    if (verify_isolated_cycler(rules, &curr[cur_min], left_slice_len, 64, 1, &right_exc)) {
                                        if (right_exc <= 0) {
                                            int gap = r_pkt_min - r_left_anchor - 1;
                                            if (gap >= max_rear) {
                                                return -1; // Disconnected Right Glider pruned!
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                    snap.has_r_glider = 1;
                    snap.r_g_hash = r_hash;
                    snap.r_g_len = r_pat_len;
                    snap.r_g_min = r_pkt_min;
                    snap.r_g_max = r_pkt_max;
                    snap.r_left_anchor = r_left_anchor;
                }
            }
        }

        // 7. Disconnected Left Island Glider
        int l_pkt_min = cur_min;
        int l_pkt_max = l_pkt_min;
        int l_zero_run = 0;
        int l_right_anchor = -1;
        for (int x = cur_min + 1; x <= cur_max; x++) {
            if (curr[x] == 0) {
                l_zero_run++;
            } else {
                if (l_zero_run >= 2) {
                    l_right_anchor = x;
                    break;
                } else {
                    l_zero_run = 0;
                    l_pkt_max = x;
                    if (l_pkt_max - l_pkt_min + 1 > 32) break;
                }
            }
        }
        if (l_right_anchor != -1) {
            int l_pat_len = l_pkt_max - l_pkt_min + 1;
            if (l_pat_len <= 32) {
                bool has_m = false;
                for (int x = l_pkt_min; x <= l_pkt_max; x++) {
                    uint8_t v = curr[x];
                    if (v > 0 && (rules->L[v] > 0 || rules->R[v] > 0)) { has_m = true; break; }
                }
                if (has_m) {
                    uint64_t l_hash = hash_slice(curr, l_pkt_min, l_pkt_max);
                    for (int i = 0; i < hist_count; i++) {
                        if (hist[i].has_l_glider && hist[i].l_g_hash == l_hash && hist[i].l_g_len == l_pat_len) {
                            int period = step - hist[i].step;
                            int dx = l_pkt_min - hist[i].l_g_min;
                            if (dx < 0 && period > 0 && period <= 64) {
                                int max_rear = 0, max_front = 0;
                                if (verify_isolated_glider(rules, &curr[l_pkt_min], l_pat_len, period, dx, 0, &max_rear, &max_front)) {
                                    int left_exc = 0;
                                    int right_slice_len = cur_max - l_right_anchor + 1;
                                    if (verify_isolated_cycler(rules, &curr[l_right_anchor], right_slice_len, 64, -1, &left_exc)) {
                                        if (left_exc <= 0) {
                                            int gap = l_right_anchor - l_pkt_max - 1;
                                            if (gap >= max_rear) {
                                                return -1; // Disconnected Left Glider pruned!
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                    snap.has_l_glider = 1;
                    snap.l_g_hash = l_hash;
                    snap.l_g_len = l_pat_len;
                    snap.l_g_min = l_pkt_min;
                    snap.l_g_max = l_pkt_max;
                    snap.l_right_anchor = l_right_anchor;
                }
            }
        }

        // 8. Dual Gliders Check (Combined Left & Right Islands)
        if (snap.has_l_glider && snap.has_r_glider && l_pkt_max < r_pkt_min) {
            bool mid_empty = true;
            bool mid_static = true;
            for (int x = l_pkt_max + 1; x < r_pkt_min; x++) {
                uint8_t v = curr[x];
                if (v > 0) {
                    mid_empty = false;
                    if (rules->L[v] > 0 || rules->R[v] > 0) { mid_static = false; break; }
                }
            }
            if (mid_static) {
                for (int i = 0; i < hist_count; i++) {
                    if (hist[i].has_l_glider && hist[i].has_r_glider &&
                        hist[i].l_g_hash == snap.l_g_hash && hist[i].r_g_hash == snap.r_g_hash &&
                        hist[i].l_g_len == snap.l_g_len && hist[i].r_g_len == snap.r_g_len) {
                        int period = step - hist[i].step;
                        int dx_l = l_pkt_min - hist[i].l_g_min;
                        int dx_r = r_pkt_min - hist[i].r_g_min;
                        if (period > 0 && period <= 64 && (dx_l != 0 || dx_r != 0)) {
                            int rear_l = 0, front_l = 0;
                            int rear_r = 0, front_r = 0;
                            bool ok_l = (dx_l != 0) ? verify_isolated_glider(rules, &curr[l_pkt_min], snap.l_g_len, period, dx_l, 0, &rear_l, &front_l) : false;
                            bool ok_r = (dx_r != 0) ? verify_isolated_glider(rules, &curr[r_pkt_min], snap.r_g_len, period, dx_r, 1, &rear_r, &front_r) : false;

                            int gap = r_pkt_min - l_pkt_max - 1;
                            // Opposite directions
                            if (ok_l && ok_r && dx_l < 0 && dx_r > 0) {
                                if (gap >= rear_l + rear_r) {
                                    return -1; // Dual opposite gliders pruned!
                                }
                            }
                            // Dual leftward (v_left >= v_right)
                            else if (ok_l && ok_r && dx_l < 0 && dx_r < 0 && mid_empty) {
                                if (abs(dx_l) >= abs(dx_r) && gap >= rear_l + front_r + 2) {
                                    return -1; // Dual leftward gliders pruned!
                                }
                            }
                            // Dual rightward (v_right >= v_left)
                            else if (ok_l && ok_r && dx_l > 0 && dx_r > 0 && mid_empty) {
                                if (dx_r >= dx_l && gap >= rear_r + front_l + 2) {
                                    return -1; // Dual rightward gliders pruned!
                                }
                            }
                        }
                    }
                }
            }
        }

        // 9. Multi-Island Decider (M >= 2: Dual, Tripled, Quadrupled Gliders/Cyclers)
        int isl_s[8], isl_e[8];
        int M = 0;
        int c_s = cur_min, c_e = cur_min;
        int zero_gap = 0;
        for (int x = cur_min + 1; x <= cur_max; x++) {
            if (curr[x] == 0) {
                zero_gap++;
            } else {
                if (zero_gap >= 2) {
                    if (M < 8) { isl_s[M] = c_s; isl_e[M] = c_e; M++; }
                    c_s = x; c_e = x;
                } else {
                    c_e = x;
                }
                zero_gap = 0;
            }
        }
        if (M < 8) { isl_s[M] = c_s; isl_e[M] = c_e; M++; }

        if (M >= 2 && M <= 8) {
            uint64_t combo_hash = 14695981039346656037ULL;
            for (int m = 0; m < M; m++) {
                uint64_t ph = hash_slice(curr, isl_s[m], isl_e[m]);
                combo_hash = (combo_hash ^ ph) * 1099511628211ULL;
            }
            snap.m_isl_count = M;
            snap.m_isl_combo_hash = combo_hash;
            for (int m = 0; m < M; m++) {
                snap.m_isl_starts[m] = isl_s[m];
                snap.m_isl_ends[m] = isl_e[m];
            }

            for (int i = 0; i < hist_count; i++) {
                if (hist[i].m_isl_count == M && hist[i].m_isl_combo_hash == combo_hash) {
                    int period = step - hist[i].step;
                    if (period > 0 && period <= 64) {
                        int dxs[8];
                        int rears[8], fronts[8];
                        bool all_valid = true;
                        for (int m = 0; m < M; m++) {
                            int pat_len = isl_e[m] - isl_s[m] + 1;
                            dxs[m] = isl_s[m] - hist[i].m_isl_starts[m];
                            rears[m] = 0; fronts[m] = 0;
                            if (dxs[m] != 0) {
                                int dir_g = (dxs[m] > 0) ? 1 : 0;
                                if (!verify_isolated_glider(rules, &curr[isl_s[m]], pat_len, period, dxs[m], dir_g, &rears[m], &fronts[m])) {
                                    all_valid = false; break;
                                }
                            } else {
                                int exc = 0;
                                if (!verify_isolated_cycler(rules, &curr[isl_s[m]], pat_len, 64, 0, &exc)) {
                                    all_valid = false; break;
                                }
                                rears[m] = exc; fronts[m] = exc;
                            }
                        }

                        if (all_valid) {
                            bool safe = true;
                            for (int k = 0; k < M - 1; k++) {
                                if (dxs[k + 1] < dxs[k]) { safe = false; break; }
                                int gap = isl_s[k + 1] - isl_e[k] - 1;
                                int dx_k = dxs[k];
                                int dx_k1 = dxs[k + 1];
                                if (dx_k <= 0 && dx_k1 >= 0) {
                                    if (gap < rears[k] + rears[k + 1]) { safe = false; break; }
                                } else if (dx_k < 0 && dx_k1 < 0) {
                                    if (gap < rears[k] + fronts[k + 1] + 2) { safe = false; break; }
                                } else if (dx_k > 0 && dx_k1 > 0) {
                                    if (gap < rears[k + 1] + fronts[k] + 2) { safe = false; break; }
                                }
                            }
                            if (safe) {
                                return -1; // Multi-island cycler / glider pruned!
                            }
                        }
                    }
                }
            }
        }

        // 10. Expanding / Translating Turnaround Bouncer
        int tb_lw_end = cur_min;
        int tb_z_run = 0;
        for (int x = cur_min + 1; x <= cur_max; x++) {
            if (curr[x] == 0) {
                tb_z_run++;
                if (tb_z_run >= 2) break;
            } else {
                tb_z_run = 0;
                tb_lw_end = x;
                if (tb_lw_end - cur_min + 1 > 8) break;
            }
        }

        int tb_rw_start = cur_max;
        tb_z_run = 0;
        for (int x = cur_max - 1; x >= cur_min; x--) {
            if (curr[x] == 0) {
                tb_z_run++;
                if (tb_z_run >= 2) break;
            } else {
                tb_z_run = 0;
                tb_rw_start = x;
                if (cur_max - tb_rw_start + 1 > 8) break;
            }
        }

        if (tb_lw_end < tb_rw_start && (tb_rw_start - tb_lw_end - 1 >= 2)) {
            bool tb_mid_empty = true;
            for (int x = tb_lw_end + 1; x < tb_rw_start; x++) {
                if (curr[x] > 0) { tb_mid_empty = false; break; }
            }
            if (tb_mid_empty) {
                uint64_t tb_lw = hash_slice(curr, cur_min, tb_lw_end);
                uint64_t tb_rw = hash_slice(curr, tb_rw_start, cur_max);
                int tb_gap = tb_rw_start - tb_lw_end - 1;
                uint8_t tb_dir = (net_r > net_l) ? 1 : ((net_l > net_r) ? 0 : 255);

                for (int i = 0; i < hist_count; i++) {
                    if (hist[i].has_trans_bouncer && hist[i].tb_dir == tb_dir &&
                        hist[i].tb_lw_hash == tb_lw && hist[i].tb_rw_hash == tb_rw &&
                        tb_gap >= hist[i].tb_gap) {
                        bool opp_seen = false;
                        for (int j = i + 1; j < hist_count; j++) {
                            if (hist[j].has_trans_bouncer && hist[j].tb_dir != 255 && hist[j].tb_dir != tb_dir) {
                                opp_seen = true; break;
                            }
                        }
                        if (opp_seen) {
                            int r_exc = 0, f_exc = 0;
                            int rw_len = cur_max - tb_rw_start + 1;
                            bool rw_is_glider = false;
                            for (int p = 1; p <= 8; p++) {
                                for (int dx = 1; dx <= p; dx++) {
                                    if (verify_isolated_glider(rules, &curr[tb_rw_start], rw_len, p, dx, 1, &r_exc, &f_exc) && r_exc == 0) {
                                        rw_is_glider = true; break;
                                    }
                                }
                                if (rw_is_glider) break;
                            }
                            if (rw_is_glider) continue;

                            int lw_len = tb_lw_end - cur_min + 1;
                            bool lw_is_glider = false;
                            for (int p = 1; p <= 8; p++) {
                                for (int dx = 1; dx <= p; dx++) {
                                    if (verify_isolated_glider(rules, &curr[cur_min], lw_len, p, -dx, 0, &r_exc, &f_exc) && r_exc == 0) {
                                        lw_is_glider = true; break;
                                    }
                                }
                                if (lw_is_glider) break;
                            }
                            if (lw_is_glider) continue;

                            return -1; // Expanding Translating Bouncer pruned!
                        }
                    }
                }
                snap.has_trans_bouncer = 1;
                snap.tb_dir = tb_dir;
                snap.tb_lw_hash = tb_lw;
                snap.tb_rw_hash = tb_rw;
                snap.tb_gap = tb_gap;
            }
        }

        if (hist_count < MAX_HIST) {
            hist[hist_count++] = snap;
        } else {
            hist[step % MAX_HIST] = snap;
        }

        // Advance one step
        int new_min = cur_min - 1;
        int new_max = cur_max + 1;
        memset(&next[new_min], 0, new_max - new_min + 1);

        for (int x = cur_min; x <= cur_max; x++) {
            uint8_t v = curr[x];
            if (v == 0) continue;
            uint8_t L = rules->L[v];
            uint8_t R = rules->R[v];
            uint8_t S = rules->S[v];

            if (S > 0) next[x] += S;
            if (L > 0) next[x - 1] += L;
            if (R > 0) next[x + 1] += R;
        }

        while (new_min <= new_max && next[new_min] == 0) new_min++;
        if (new_min > new_max) return step + 1;
        while (new_max >= new_min && next[new_max] == 0) new_max--;

        uint8_t *tmp = curr;
        curr = next;
        next = tmp;

        cur_min = new_min;
        cur_max = new_max;
    }

    return -2; // Reached max_steps without halting and without cycle/glider -> Holdout!
}

// Structure to track top findings
typedef struct {
    int steps;
    char rule_str[256];
} LeaderEntry;

#define MAX_LEADERS 25
static LeaderEntry g_leaders[MAX_LEADERS];
static int g_leader_count = 0;
static long long g_eval_count = 0;
static long long g_holdouts_count = 0;
static double g_start_time = 0;
static double g_last_tree_progress = 0;
static double g_max_duration = 0.0;

static FILE *g_holdout_file = NULL;
static char g_holdout_filename[512] = "holdouts.txt";

#define MAX_HOLDOUT_SAMPLES 200
typedef struct {
    char rule_str[256];
} HoldoutSample;

static HoldoutSample g_holdout_samples[MAX_HOLDOUT_SAMPLES];
static int g_holdout_sample_count = 0;

static void record_holdout(const RuleTable *table, int n) {
    #pragma omp atomic
    g_holdouts_count++;

    #pragma omp critical(holdout_lock)
    {
        char str[256];
        format_rule(table, n, str, sizeof(str));

        if (g_holdout_file) {
            fprintf(g_holdout_file, "%s\n", str);
        }

        if (g_holdout_sample_count < MAX_HOLDOUT_SAMPLES) {
            strncpy(g_holdout_samples[g_holdout_sample_count].rule_str, str, sizeof(g_holdout_samples[0].rule_str) - 1);
            g_holdout_sample_count++;
        }
    }
}

static void record_leader(int steps, const RuleTable *table, int n) {
    #pragma omp critical
    {
        char str[256];
        format_rule(table, n, str, sizeof(str));
        bool exists = false;
        for (int i = 0; i < g_leader_count; i++) {
            if (strcmp(g_leaders[i].rule_str, str) == 0) {
                exists = true;
                break;
            }
        }

        if (!exists) {
            if (g_leader_count < MAX_LEADERS || steps > g_leaders[g_leader_count - 1].steps) {
                int insert_pos = g_leader_count < MAX_LEADERS ? g_leader_count : g_leader_count - 1;
                while (insert_pos > 0 && steps > g_leaders[insert_pos - 1].steps) {
                    insert_pos--;
                }
                for (int i = (g_leader_count < MAX_LEADERS ? g_leader_count : MAX_LEADERS - 1); i > insert_pos; i--) {
                    g_leaders[i] = g_leaders[i - 1];
                }
                g_leaders[insert_pos].steps = steps;
                strncpy(g_leaders[insert_pos].rule_str, str, sizeof(g_leaders[insert_pos].rule_str) - 1);
                if (g_leader_count < MAX_LEADERS) g_leader_count++;

                double elapsed = omp_get_wtime() - g_start_time;
                printf("{\"type\":\"champion\",\"rank\":%d,\"steps\":%d,\"rule\":\"%s\",\"elapsed\":%.3f,\"evaluated\":%lld}\n",
                       insert_pos + 1, steps, str, elapsed, g_eval_count);
                fflush(stdout);
            }
        }
    }
}

// Tree search worker
static void tree_search_rec(RuleTable *table, uint8_t *curr_tape, int min_x, int max_x, int step, int n, int max_steps, StepHistory *hist, int h_count) {
    #pragma omp atomic
    g_eval_count++;

    if (g_max_duration > 0.0 && (g_eval_count & 0x7FFF) == 0) {
        if (omp_get_wtime() - g_start_time >= g_max_duration) {
            return;
        }
    }

    if (g_eval_count % 250000 == 0) {
        #pragma omp critical(tree_prog_lock)
        {
            double now = omp_get_wtime();
            if (now - g_last_tree_progress > 0.25) {
                g_last_tree_progress = now;
                double rate = (g_eval_count / (now - g_start_time)) / 1e6;
                printf("{\"type\":\"progress\",\"elapsed\":%.2f,\"evaluated\":%lld,\"rate_m_per_s\":%.2f,\"champion\":%d,\"holdouts\":%lld}\n",
                       now - g_start_time, g_eval_count, rate, g_leaders[0].steps, g_holdouts_count);
                fflush(stdout);
            }
        }
    }

    uint8_t curr[TAPE_SIZE];
    uint8_t next[TAPE_SIZE];
    memcpy(curr, curr_tape, TAPE_SIZE);

    int cur_min = min_x;
    int cur_max = max_x;

    StepHistory local_hist[MAX_HIST];
    int local_h_count = h_count;
    if (local_h_count > 0) memcpy(local_hist, hist, local_h_count * sizeof(StepHistory));

    while (step < max_steps) {
        int missing_v = -1;
        bool any_moving = false;
        int min_moving = 9999, max_moving = -9999;
        int min_static = 9999, max_static = -9999;
        int num_moving = 0, num_static = 0;

        for (int x = cur_min; x <= cur_max; x++) {
            uint8_t v = curr[x];
            if (v > 0) {
                if (table->L[v] == UNASSIGNED) {
                    missing_v = v;
                    break;
                }
                if (table->L[v] > 0 || table->R[v] > 0) {
                    any_moving = true;
                    num_moving++;
                    if (x < min_moving) min_moving = x;
                    if (x > max_moving) max_moving = x;
                } else {
                    num_static++;
                    if (x < min_static) min_static = x;
                    if (x > max_static) max_static = x;
                }
            }
        }

        if (missing_v != -1) {
            for (int i = 0; i < pair_count[missing_v]; i++) {
                table->L[missing_v] = pairs[missing_v][i].L;
                table->R[missing_v] = pairs[missing_v][i].R;
                table->S[missing_v] = missing_v - table->L[missing_v] - table->R[missing_v];

                tree_search_rec(table, curr, cur_min, cur_max, step, n, max_steps, local_hist, local_h_count);

                table->L[missing_v] = UNASSIGNED;
                table->R[missing_v] = UNASSIGNED;
                table->S[missing_v] = UNASSIGNED;
            }
            return;
        }

        if (!any_moving) {
            record_leader(step, table, n);
            return;
        }

        uint8_t left_v = curr[cur_min];
        if (table->L[left_v] == left_v && cur_min < TAPE_MID) return;
        uint8_t right_v = curr[cur_max];
        if (table->R[right_v] == right_v && cur_max > TAPE_MID) return;

        // 1. Full Cycle Check
        int len = cur_max - cur_min + 1;
        uint64_t full_hash = hash_slice(curr, cur_min, cur_max);
        for (int i = 0; i < local_h_count; i++) {
            if (local_hist[i].full_hash == full_hash && local_hist[i].len == len) {
                return; // Cycle pruned!
            }
        }

        // Identify nonzeros outside moving packet
        int lw_start = 9999, lw_end = -9999;
        bool left_has_nz = false;
        int rw_start = 9999, rw_end = -9999;
        bool right_has_nz = false;
        bool all_other_static = true;

        for (int x = cur_min; x < min_moving; x++) {
            uint8_t v = curr[x];
            if (v > 0) {
                left_has_nz = true;
                if (x < lw_start) lw_start = x;
                if (x > lw_end) lw_end = x;
                if (table->L[v] > 0 || table->R[v] > 0) all_other_static = false;
            }
        }

        for (int x = max_moving + 1; x <= cur_max; x++) {
            uint8_t v = curr[x];
            if (v > 0) {
                right_has_nz = true;
                if (x < rw_start) rw_start = x;
                if (x > rw_end) rw_end = x;
                if (table->L[v] > 0 || table->R[v] > 0) all_other_static = false;
            }
        }

        int net_l = 0, net_r = 0;
        for (int x = min_moving; x <= max_moving; x++) {
            uint8_t v = curr[x];
            net_l += table->L[v];
            net_r += table->R[v];
        }

        StepHistory snap;
        memset(&snap, 0, sizeof(snap));
        snap.full_hash = full_hash;
        snap.min_x = cur_min;
        snap.max_x = cur_max;
        snap.len = len;
        snap.min_m = min_moving;
        snap.max_m = max_moving;
        snap.step = step;

        // 2. Strict Two-Wall Bouncer
        if (all_other_static && left_has_nz && right_has_nz) {
            if ((lw_end - lw_start <= 8) && (rw_end - rw_start <= 8)) {
                int gap_L = min_moving - lw_end - 1;
                int gap_R = rw_start - max_moving - 1;
                if (gap_L >= 0 && gap_R >= 0) {
                    uint8_t b_dir = 255;
                    int b_dist = 0;
                    if (net_r > 0 && net_l == 0 && gap_R >= 0) {
                        b_dir = 1; b_dist = min_moving - lw_end;
                    } else if (net_l > 0 && net_r == 0 && gap_L >= 0) {
                        b_dir = 0; b_dist = rw_start - max_moving;
                    }

                    if (b_dir != 255) {
                        uint64_t b_shuttle = hash_slice(curr, min_moving, max_moving);
                        uint64_t b_lw = hash_slice(curr, lw_start, lw_end);
                        uint64_t b_rw = hash_slice(curr, rw_start, rw_end);

                        for (int i = 0; i < local_h_count; i++) {
                            if (local_hist[i].has_bouncer && local_hist[i].b_dir == b_dir &&
                                local_hist[i].b_shuttle_hash == b_shuttle &&
                                local_hist[i].b_lw_hash == b_lw &&
                                local_hist[i].b_rw_hash == b_rw &&
                                local_hist[i].b_dist == b_dist) {
                                bool opp_seen = false;
                                for (int j = i + 1; j < local_h_count; j++) {
                                    if (local_hist[j].has_bouncer && local_hist[j].b_dir != b_dir) {
                                        opp_seen = true; break;
                                    }
                                }
                                if (opp_seen && (cur_max - cur_min) >= (local_hist[i].max_x - local_hist[i].min_x)) {
                                    return; // Two-wall bouncer pruned!
                                }
                            }
                        }
                        snap.has_bouncer = 1;
                        snap.b_dir = b_dir;
                        snap.b_shuttle_hash = b_shuttle;
                        snap.b_lw_hash = b_lw;
                        snap.b_rw_hash = b_rw;
                        snap.b_dist = b_dist;
                    }
                }
            }
        }

        // 3. Open Turnaround Bouncer
        if (all_other_static) {
            if (left_has_nz && !right_has_nz) {
                if (lw_end - lw_start <= 3 && (min_moving - lw_end - 1 >= 0)) {
                    if (net_l > 0 && net_r == 0) {
                        uint64_t b_shuttle = hash_slice(curr, min_moving, max_moving);
                        uint64_t b_lw = hash_slice(curr, lw_start, lw_end);
                        for (int i = 0; i < local_h_count; i++) {
                            if (local_hist[i].has_open_bouncer && local_hist[i].open_dir == 1 &&
                                local_hist[i].open_shuttle_hash == b_shuttle &&
                                local_hist[i].open_wall_hash == b_lw) {
                                if (cur_min == local_hist[i].min_x && cur_max > local_hist[i].max_x) {
                                    return; // Open R bouncer pruned!
                                }
                            }
                        }
                        snap.has_open_bouncer = 1;
                        snap.open_dir = 1;
                        snap.open_shuttle_hash = b_shuttle;
                        snap.open_wall_hash = b_lw;
                    }
                }
            }

            if (right_has_nz && !left_has_nz) {
                if (rw_end - rw_start <= 3 && (rw_start - max_moving - 1 >= 0)) {
                    if (net_r > 0 && net_l == 0) {
                        uint64_t b_shuttle = hash_slice(curr, min_moving, max_moving);
                        uint64_t b_rw = hash_slice(curr, rw_start, rw_end);
                        for (int i = 0; i < local_h_count; i++) {
                            if (local_hist[i].has_open_bouncer && local_hist[i].open_dir == 0 &&
                                local_hist[i].open_shuttle_hash == b_shuttle &&
                                local_hist[i].open_wall_hash == b_rw) {
                                if (cur_max == local_hist[i].max_x && cur_min < local_hist[i].min_x) {
                                    return; // Open L bouncer pruned!
                                }
                            }
                        }
                        snap.has_open_bouncer = 1;
                        snap.open_dir = 0;
                        snap.open_shuttle_hash = b_shuttle;
                        snap.open_wall_hash = b_rw;
                    }
                }
            }
        }

        // 4. Puffer / Wall-Builder
        if (all_other_static) {
            uint64_t p_shuttle = hash_slice(curr, min_moving, max_moving);

            // Left expanding away from static right anchor:
            if (right_has_nz) {
                int p_lw_end_idx = (cur_min + 4 < max_moving) ? cur_min + 4 : max_moving;
                uint64_t p_lw = hash_slice(curr, cur_min, p_lw_end_idx);
                uint64_t p_rw = hash_slice(curr, rw_start, cur_max);

                for (int i = 0; i < local_h_count; i++) {
                    if (local_hist[i].has_puffer_L &&
                        local_hist[i].p_sig_L_shuttle == p_shuttle &&
                        local_hist[i].p_sig_L_lw == p_lw &&
                        local_hist[i].p_sig_L_rw == p_rw &&
                        local_hist[i].p_rw_start == rw_start) {
                        int dx = min_moving - local_hist[i].min_m;
                        if (dx < 0 && cur_max == local_hist[i].max_x && (cur_min - local_hist[i].min_x == dx)) {
                            int max_reach = -9999;
                            for (int j = i; j < local_h_count; j++) {
                                if (local_hist[j].max_m > max_reach) max_reach = local_hist[j].max_m;
                            }
                            if (max_moving > max_reach) max_reach = max_moving;
                            if (max_reach < rw_start) {
                                return; // Wall-builder L pruned!
                            }
                        }
                    }
                }
                snap.has_puffer_L = 1;
                snap.p_sig_L_shuttle = p_shuttle;
                snap.p_sig_L_lw = p_lw;
                snap.p_sig_L_rw = p_rw;
                snap.p_rw_start = rw_start;
            }

            // Right expanding away from static left anchor:
            if (left_has_nz) {
                int p_rw_start_idx = (cur_max - 4 > min_moving) ? cur_max - 4 : min_moving;
                uint64_t p_rw = hash_slice(curr, p_rw_start_idx, cur_max);
                uint64_t p_lw = hash_slice(curr, cur_min, lw_end);

                for (int i = 0; i < local_h_count; i++) {
                    if (local_hist[i].has_puffer_R &&
                        local_hist[i].p_sig_R_shuttle == p_shuttle &&
                        local_hist[i].p_sig_R_rw == p_rw &&
                        local_hist[i].p_sig_R_lw == p_lw &&
                        local_hist[i].p_lw_end == lw_end) {
                        int dx = min_moving - local_hist[i].min_m;
                        if (dx > 0 && cur_min == local_hist[i].min_x && (cur_max - local_hist[i].max_x == dx)) {
                            int min_reach = 9999;
                            for (int j = i; j < local_h_count; j++) {
                                if (local_hist[j].min_m < min_reach) min_reach = local_hist[j].min_m;
                            }
                            if (min_moving < min_reach) min_reach = min_moving;
                            if (min_reach > lw_end) {
                                return; // Wall-builder R pruned!
                            }
                        }
                    }
                }
                snap.has_puffer_R = 1;
                snap.p_sig_R_shuttle = p_shuttle;
                snap.p_sig_R_rw = p_rw;
                snap.p_sig_R_lw = p_lw;
                snap.p_lw_end = lw_end;
            }
        }

        // 5. Strict Escaping Glider (Must be at edge and sole active)
        if (all_other_static) {
            int pat_len = max_moving - min_moving + 1;
            uint64_t g_hash = hash_slice(curr, min_moving, max_moving);

            if (max_moving == cur_max && pat_len <= 32) {
                for (int i = 0; i < local_h_count; i++) {
                    if (local_hist[i].g_hash == g_hash && local_hist[i].g_len == pat_len) {
                        int dx = min_moving - local_hist[i].min_m;
                        int period = step - local_hist[i].step;
                        if (dx > 0 && period > 0 && period <= 64) {
                            int max_rear = 0, max_front = 0;
                            if (verify_isolated_glider(table, &curr[min_moving], pat_len, period, dx, 1, &max_rear, &max_front)) {
                                int gap = left_has_nz ? (min_moving - lw_end) : 9999;
                                if (gap > max_rear) {
                                    return; // Right glider pruned!
                                }
                            }
                        }
                    }
                }
            }

            if (min_moving == cur_min && pat_len <= 32) {
                for (int i = 0; i < local_h_count; i++) {
                    if (local_hist[i].g_hash == g_hash && local_hist[i].g_len == pat_len) {
                        int dx = min_moving - local_hist[i].min_m;
                        int period = step - local_hist[i].step;
                        if (dx < 0 && period > 0 && period <= 64) {
                            int max_rear = 0, max_front = 0;
                            if (verify_isolated_glider(table, &curr[min_moving], pat_len, period, dx, 0, &max_rear, &max_front)) {
                                int gap = right_has_nz ? (rw_start - max_moving) : 9999;
                                if (gap > max_rear) {
                                    return; // Left glider pruned!
                                }
                            }
                        }
                    }
                }
            }
            snap.g_hash = g_hash;
            snap.g_len = pat_len;
        }

        // 6. Disconnected Right Island Glider
        int r_pkt_max = cur_max;
        int r_pkt_min = r_pkt_max;
        int r_zero_run = 0;
        int r_left_anchor = -1;
        for (int x = cur_max - 1; x >= cur_min; x--) {
            if (curr[x] == 0) {
                r_zero_run++;
            } else {
                if (r_zero_run >= 2) {
                    r_left_anchor = x;
                    break;
                } else {
                    r_zero_run = 0;
                    r_pkt_min = x;
                    if (r_pkt_max - r_pkt_min + 1 > 32) break;
                }
            }
        }
        if (r_left_anchor != -1) {
            int r_pat_len = r_pkt_max - r_pkt_min + 1;
            if (r_pat_len <= 32) {
                bool has_m = false;
                for (int x = r_pkt_min; x <= r_pkt_max; x++) {
                    uint8_t v = curr[x];
                    if (v > 0 && (table->L[v] > 0 || table->R[v] > 0)) { has_m = true; break; }
                }
                if (has_m) {
                    uint64_t r_hash = hash_slice(curr, r_pkt_min, r_pkt_max);
                    for (int i = 0; i < local_h_count; i++) {
                        if (local_hist[i].has_r_glider && local_hist[i].r_g_hash == r_hash && local_hist[i].r_g_len == r_pat_len) {
                            int period = step - local_hist[i].step;
                            int dx = r_pkt_min - local_hist[i].r_g_min;
                            if (dx > 0 && period > 0 && period <= 64) {
                                int max_rear = 0, max_front = 0;
                                if (verify_isolated_glider(table, &curr[r_pkt_min], r_pat_len, period, dx, 1, &max_rear, &max_front)) {
                                    int right_exc = 0;
                                    int left_slice_len = r_left_anchor - cur_min + 1;
                                    if (verify_isolated_cycler(table, &curr[cur_min], left_slice_len, 64, 1, &right_exc)) {
                                        if (right_exc <= 0) {
                                            int gap = r_pkt_min - r_left_anchor - 1;
                                            if (gap >= max_rear) {
                                                return; // Disconnected Right Glider pruned!
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                    snap.has_r_glider = 1;
                    snap.r_g_hash = r_hash;
                    snap.r_g_len = r_pat_len;
                    snap.r_g_min = r_pkt_min;
                    snap.r_g_max = r_pkt_max;
                    snap.r_left_anchor = r_left_anchor;
                }
            }
        }

        // 7. Disconnected Left Island Glider
        int l_pkt_min = cur_min;
        int l_pkt_max = l_pkt_min;
        int l_zero_run = 0;
        int l_right_anchor = -1;
        for (int x = cur_min + 1; x <= cur_max; x++) {
            if (curr[x] == 0) {
                l_zero_run++;
            } else {
                if (l_zero_run >= 2) {
                    l_right_anchor = x;
                    break;
                } else {
                    l_zero_run = 0;
                    l_pkt_max = x;
                    if (l_pkt_max - l_pkt_min + 1 > 32) break;
                }
            }
        }
        if (l_right_anchor != -1) {
            int l_pat_len = l_pkt_max - l_pkt_min + 1;
            if (l_pat_len <= 32) {
                bool has_m = false;
                for (int x = l_pkt_min; x <= l_pkt_max; x++) {
                    uint8_t v = curr[x];
                    if (v > 0 && (table->L[v] > 0 || table->R[v] > 0)) { has_m = true; break; }
                }
                if (has_m) {
                    uint64_t l_hash = hash_slice(curr, l_pkt_min, l_pkt_max);
                    for (int i = 0; i < local_h_count; i++) {
                        if (local_hist[i].has_l_glider && local_hist[i].l_g_hash == l_hash && local_hist[i].l_g_len == l_pat_len) {
                            int period = step - local_hist[i].step;
                            int dx = l_pkt_min - local_hist[i].l_g_min;
                            if (dx < 0 && period > 0 && period <= 64) {
                                int max_rear = 0, max_front = 0;
                                if (verify_isolated_glider(table, &curr[l_pkt_min], l_pat_len, period, dx, 0, &max_rear, &max_front)) {
                                    int left_exc = 0;
                                    int right_slice_len = cur_max - l_right_anchor + 1;
                                    if (verify_isolated_cycler(table, &curr[l_right_anchor], right_slice_len, 64, -1, &left_exc)) {
                                        if (left_exc <= 0) {
                                            int gap = l_right_anchor - l_pkt_max - 1;
                                            if (gap >= max_rear) {
                                                return; // Disconnected Left Glider pruned!
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                    snap.has_l_glider = 1;
                    snap.l_g_hash = l_hash;
                    snap.l_g_len = l_pat_len;
                    snap.l_g_min = l_pkt_min;
                    snap.l_g_max = l_pkt_max;
                    snap.l_right_anchor = l_right_anchor;
                }
            }
        }

        // 8. Dual Gliders Check (Combined Left & Right Islands)
        if (snap.has_l_glider && snap.has_r_glider && l_pkt_max < r_pkt_min) {
            bool mid_empty = true;
            bool mid_static = true;
            for (int x = l_pkt_max + 1; x < r_pkt_min; x++) {
                uint8_t v = curr[x];
                if (v > 0) {
                    mid_empty = false;
                    if (table->L[v] > 0 || table->R[v] > 0) { mid_static = false; break; }
                }
            }
            if (mid_static) {
                for (int i = 0; i < local_h_count; i++) {
                    if (local_hist[i].has_l_glider && local_hist[i].has_r_glider &&
                        local_hist[i].l_g_hash == snap.l_g_hash && local_hist[i].r_g_hash == snap.r_g_hash &&
                        local_hist[i].l_g_len == snap.l_g_len && local_hist[i].r_g_len == snap.r_g_len) {
                        int period = step - local_hist[i].step;
                        int dx_l = l_pkt_min - local_hist[i].l_g_min;
                        int dx_r = r_pkt_min - local_hist[i].r_g_min;
                        if (period > 0 && period <= 64 && (dx_l != 0 || dx_r != 0)) {
                            int rear_l = 0, front_l = 0;
                            int rear_r = 0, front_r = 0;
                            bool ok_l = (dx_l != 0) ? verify_isolated_glider(table, &curr[l_pkt_min], snap.l_g_len, period, dx_l, 0, &rear_l, &front_l) : false;
                            bool ok_r = (dx_r != 0) ? verify_isolated_glider(table, &curr[r_pkt_min], snap.r_g_len, period, dx_r, 1, &rear_r, &front_r) : false;

                            int gap = r_pkt_min - l_pkt_max - 1;
                            // Opposite directions
                            if (ok_l && ok_r && dx_l < 0 && dx_r > 0) {
                                if (gap >= rear_l + rear_r) {
                                    return; // Dual opposite gliders pruned!
                                }
                            }
                            // Dual leftward (v_left >= v_right)
                            else if (ok_l && ok_r && dx_l < 0 && dx_r < 0 && mid_empty) {
                                if (abs(dx_l) >= abs(dx_r) && gap >= rear_l + front_r + 2) {
                                    return; // Dual leftward gliders pruned!
                                }
                            }
                            // Dual rightward (v_right >= v_left)
                            else if (ok_l && ok_r && dx_l > 0 && dx_r > 0 && mid_empty) {
                                if (dx_r >= dx_l && gap >= rear_r + front_l + 2) {
                                    return; // Dual rightward gliders pruned!
                                }
                            }
                        }
                    }
                }
            }
        }

        // 9. Multi-Island Decider (M >= 2: Dual, Tripled, Quadrupled Gliders/Cyclers)
        int isl_s[8], isl_e[8];
        int M = 0;
        int c_s = cur_min, c_e = cur_min;
        int zero_gap = 0;
        for (int x = cur_min + 1; x <= cur_max; x++) {
            if (curr[x] == 0) {
                zero_gap++;
            } else {
                if (zero_gap >= 2) {
                    if (M < 8) { isl_s[M] = c_s; isl_e[M] = c_e; M++; }
                    c_s = x; c_e = x;
                } else {
                    c_e = x;
                }
                zero_gap = 0;
            }
        }
        if (M < 8) { isl_s[M] = c_s; isl_e[M] = c_e; M++; }

        if (M >= 2 && M <= 8) {
            uint64_t combo_hash = 14695981039346656037ULL;
            for (int m = 0; m < M; m++) {
                uint64_t ph = hash_slice(curr, isl_s[m], isl_e[m]);
                combo_hash = (combo_hash ^ ph) * 1099511628211ULL;
            }
            snap.m_isl_count = M;
            snap.m_isl_combo_hash = combo_hash;
            for (int m = 0; m < M; m++) {
                snap.m_isl_starts[m] = isl_s[m];
                snap.m_isl_ends[m] = isl_e[m];
            }

            for (int i = 0; i < local_h_count; i++) {
                if (local_hist[i].m_isl_count == M && local_hist[i].m_isl_combo_hash == combo_hash) {
                    int period = step - local_hist[i].step;
                    if (period > 0 && period <= 64) {
                        int dxs[8];
                        int rears[8], fronts[8];
                        bool all_valid = true;
                        for (int m = 0; m < M; m++) {
                            int pat_len = isl_e[m] - isl_s[m] + 1;
                            dxs[m] = isl_s[m] - local_hist[i].m_isl_starts[m];
                            rears[m] = 0; fronts[m] = 0;
                            if (dxs[m] != 0) {
                                int dir_g = (dxs[m] > 0) ? 1 : 0;
                                if (!verify_isolated_glider(table, &curr[isl_s[m]], pat_len, period, dxs[m], dir_g, &rears[m], &fronts[m])) {
                                    all_valid = false; break;
                                }
                            } else {
                                int exc = 0;
                                if (!verify_isolated_cycler(table, &curr[isl_s[m]], pat_len, 64, 0, &exc)) {
                                    all_valid = false; break;
                                }
                                rears[m] = exc; fronts[m] = exc;
                            }
                        }

                        if (all_valid) {
                            bool safe = true;
                            for (int k = 0; k < M - 1; k++) {
                                if (dxs[k + 1] < dxs[k]) { safe = false; break; }
                                int gap = isl_s[k + 1] - isl_e[k] - 1;
                                int dx_k = dxs[k];
                                int dx_k1 = dxs[k + 1];
                                if (dx_k <= 0 && dx_k1 >= 0) {
                                    if (gap < rears[k] + rears[k + 1]) { safe = false; break; }
                                } else if (dx_k < 0 && dx_k1 < 0) {
                                    if (gap < rears[k] + fronts[k + 1] + 2) { safe = false; break; }
                                } else if (dx_k > 0 && dx_k1 > 0) {
                                    if (gap < rears[k + 1] + fronts[k] + 2) { safe = false; break; }
                                }
                            }
                            if (safe) {
                                return; // Multi-island cycler / glider pruned!
                            }
                        }
                    }
                }
            }
        }

        // 10. Expanding / Translating Turnaround Bouncer
        int tb_lw_end = cur_min;
        int tb_z_run = 0;
        for (int x = cur_min + 1; x <= cur_max; x++) {
            if (curr[x] == 0) {
                tb_z_run++;
                if (tb_z_run >= 2) break;
            } else {
                tb_z_run = 0;
                tb_lw_end = x;
                if (tb_lw_end - cur_min + 1 > 8) break;
            }
        }

        int tb_rw_start = cur_max;
        tb_z_run = 0;
        for (int x = cur_max - 1; x >= cur_min; x--) {
            if (curr[x] == 0) {
                tb_z_run++;
                if (tb_z_run >= 2) break;
            } else {
                tb_z_run = 0;
                tb_rw_start = x;
                if (cur_max - tb_rw_start + 1 > 8) break;
            }
        }

        if (tb_lw_end < tb_rw_start && (tb_rw_start - tb_lw_end - 1 >= 2)) {
            bool tb_mid_empty = true;
            for (int x = tb_lw_end + 1; x < tb_rw_start; x++) {
                if (curr[x] > 0) { tb_mid_empty = false; break; }
            }
            if (tb_mid_empty) {
                uint64_t tb_lw = hash_slice(curr, cur_min, tb_lw_end);
                uint64_t tb_rw = hash_slice(curr, tb_rw_start, cur_max);
                int tb_gap = tb_rw_start - tb_lw_end - 1;
                uint8_t tb_dir = (net_r > net_l) ? 1 : ((net_l > net_r) ? 0 : 255);

                for (int i = 0; i < local_h_count; i++) {
                    if (local_hist[i].has_trans_bouncer && local_hist[i].tb_dir == tb_dir &&
                        local_hist[i].tb_lw_hash == tb_lw && local_hist[i].tb_rw_hash == tb_rw &&
                        tb_gap >= local_hist[i].tb_gap) {
                        bool opp_seen = false;
                        for (int j = i + 1; j < local_h_count; j++) {
                            if (local_hist[j].has_trans_bouncer && local_hist[j].tb_dir != 255 && local_hist[j].tb_dir != tb_dir) {
                                opp_seen = true; break;
                            }
                        }
                        if (opp_seen) {
                            int r_exc = 0, f_exc = 0;
                            int rw_len = cur_max - tb_rw_start + 1;
                            bool rw_is_glider = false;
                            for (int p = 1; p <= 8; p++) {
                                for (int dx = 1; dx <= p; dx++) {
                                    if (verify_isolated_glider(table, &curr[tb_rw_start], rw_len, p, dx, 1, &r_exc, &f_exc) && r_exc == 0) {
                                        rw_is_glider = true; break;
                                    }
                                }
                                if (rw_is_glider) break;
                            }
                            if (rw_is_glider) continue;

                            int lw_len = tb_lw_end - cur_min + 1;
                            bool lw_is_glider = false;
                            for (int p = 1; p <= 8; p++) {
                                for (int dx = 1; dx <= p; dx++) {
                                    if (verify_isolated_glider(table, &curr[cur_min], lw_len, p, -dx, 0, &r_exc, &f_exc) && r_exc == 0) {
                                        lw_is_glider = true; break;
                                    }
                                }
                                if (lw_is_glider) break;
                            }
                            if (lw_is_glider) continue;

                            return; // Expanding Translating Bouncer pruned!
                        }
                    }
                }
                snap.has_trans_bouncer = 1;
                snap.tb_dir = tb_dir;
                snap.tb_lw_hash = tb_lw;
                snap.tb_rw_hash = tb_rw;
                snap.tb_gap = tb_gap;
            }
        }

        int slot = step % MAX_HIST;
        local_hist[slot] = snap;
        if (local_h_count < MAX_HIST) local_h_count++;

        int new_min = cur_min - 1;
        int new_max = cur_max + 1;
        if (new_min <= 2 || new_max >= TAPE_SIZE - 3) return;

        memset(&next[new_min], 0, new_max - new_min + 1);
        for (int x = cur_min; x <= cur_max; x++) {
            uint8_t v = curr[x];
            if (v == 0) continue;
            uint8_t L = table->L[v];
            uint8_t R = table->R[v];
            uint8_t S = table->S[v];
            if (S > 0) next[x] += S;
            if (L > 0) next[x - 1] += L;
            if (R > 0) next[x + 1] += R;
        }

        while (new_min <= new_max && next[new_min] == 0) new_min++;
        if (new_min > new_max) return;
        while (new_max >= new_min && next[new_max] == 0) new_max--;

        memcpy(curr, next, TAPE_SIZE);
        cur_min = new_min;
        cur_max = new_max;
        step++;
    }

    record_holdout(table, n);
}

// Run Tree Search
static void run_tree_search(int n, int max_steps, double duration_sec, int threads) {
    if (threads > 0) omp_set_num_threads(threads);
    init_pairs(n);
    g_start_time = omp_get_wtime();
    g_last_tree_progress = g_start_time;
    g_max_duration = duration_sec;
    g_eval_count = 0;
    g_leader_count = 0;
    g_holdouts_count = 0;
    g_holdout_sample_count = 0;

    g_holdout_file = fopen(g_holdout_filename, "w");
    if (g_holdout_file) {
        setvbuf(g_holdout_file, NULL, _IOFBF, 65536);
        fprintf(g_holdout_file, "# Pebble Automaton Holdouts (Undecided Machines)\n");
        fprintf(g_holdout_file, "# Target n: %d, Max Steps: %d, Mode: tree\n", n, max_steps);
        fprintf(g_holdout_file, "# Format: Underscore-delimited hex pairs for k = 1..%d ('\\?\\?' indicates unreached rule)\n#\n", n);
    }

    printf("{\"type\":\"start\",\"mode\":\"tree\",\"n\":%d,\"max_steps\":%d,\"duration\":%.1f,\"threads\":%d}\n",
           n, max_steps, duration_sec, omp_get_max_threads());
    fflush(stdout);

    #pragma omp parallel for schedule(dynamic, 1)
    for (int top_idx = 0; top_idx < pair_count[n]; top_idx++) {
        uint8_t top_L = pairs[n][top_idx].L;
        uint8_t top_R = pairs[n][top_idx].R;
        if (top_L > top_R) continue; // mirror symmetry
        if (top_L == 0 && top_R == n) continue; // pure shift

        RuleTable table;
        memset(&table, UNASSIGNED, sizeof(table));
        table.L[n] = top_L;
        table.R[n] = top_R;
        table.S[n] = n - top_L - top_R;

        uint8_t init_tape[TAPE_SIZE] = {0};
        init_tape[TAPE_MID] = (uint8_t)n;

        tree_search_rec(&table, init_tape, TAPE_MID, TAPE_MID, 0, n, max_steps, NULL, 0);
    }

    if (g_holdout_file) {
        fclose(g_holdout_file);
        g_holdout_file = NULL;
    }

    int emit_count = g_holdout_sample_count < 100 ? g_holdout_sample_count : 100;
    if (emit_count > 0) {
        printf("{\"type\":\"holdout_samples\",\"count\":%lld,\"samples\":[", g_holdouts_count);
        for (int i = 0; i < emit_count; i++) {
            printf("\"%s\"%s", g_holdout_samples[i].rule_str, i == emit_count - 1 ? "" : ",");
        }
        printf("]}\n");
        fflush(stdout);
    }

    double elapsed = omp_get_wtime() - g_start_time;
    printf("{\"type\":\"done\",\"elapsed\":%.3f,\"evaluated\":%lld,\"champion_steps\":%d,\"champion_rule\":\"%s\",\"holdouts\":%lld,\"holdout_file\":\"%s\"}\n",
           elapsed, g_eval_count, g_leaders[0].steps, g_leaders[0].rule_str, g_holdouts_count, g_holdout_filename);
    fflush(stdout);
}

// Fast xorshift PRNG for threads
static inline uint64_t xorshift64(uint64_t *state) {
    uint64_t x = *state;
    x ^= x << 13;
    x ^= x >> 7;
    x ^= x << 17;
    return *state = x;
}

// Heuristic / Genetic Search for arbitrary large n
static void run_heuristic_search(int n, int max_steps, double duration_sec, int threads) {
    if (threads > 0) omp_set_num_threads(threads);
    init_pairs(n);
    g_start_time = omp_get_wtime();
    g_eval_count = 0;
    g_leader_count = 0;
    g_holdouts_count = 0;
    g_holdout_sample_count = 0;

    g_holdout_file = fopen(g_holdout_filename, "w");
    if (g_holdout_file) {
        setvbuf(g_holdout_file, NULL, _IOFBF, 65536);
        fprintf(g_holdout_file, "# Pebble Automaton Holdouts (Undecided Machines)\n");
        fprintf(g_holdout_file, "# Target n: %d, Max Steps: %d, Mode: heuristic\n", n, max_steps);
        fprintf(g_holdout_file, "# Format: Underscore-delimited hex pairs for k = 1..%d\n#\n", n);
    }

    printf("{\"type\":\"start\",\"mode\":\"heuristic\",\"n\":%d,\"max_steps\":%d,\"duration\":%.1f,\"threads\":%d}\n",
           n, max_steps, duration_sec, omp_get_max_threads());
    fflush(stdout);

    #pragma omp parallel
    {
        uint64_t rng = (uint64_t)time(NULL) ^ ((uint64_t)omp_get_thread_num() << 32) ^ 0x9e3779b97f4a7c15ULL;
        RuleTable current;
        int current_score = 0;

        for (int k = 1; k <= n; k++) {
            int p = (int)(xorshift64(&rng) % pair_count[k]);
            current.L[k] = pairs[k][p].L;
            current.R[k] = pairs[k][p].R;
            current.S[k] = k - current.L[k] - current.R[k];
        }
        current.L[1] = 0; current.R[1] = 0; current.S[1] = 1;

        double last_progress = omp_get_wtime();

        while (1) {
            double now = omp_get_wtime();
            if (now - g_start_time >= duration_sec) break;

            #pragma omp atomic
            g_eval_count++;

            RuleTable candidate = current;
            int num_mutations = 1 + (int)(xorshift64(&rng) % 3);
            for (int m = 0; m < num_mutations; m++) {
                int k = 1 + (int)(xorshift64(&rng) % n);
                int p = (int)(xorshift64(&rng) % pair_count[k]);
                candidate.L[k] = pairs[k][p].L;
                candidate.R[k] = pairs[k][p].R;
                candidate.S[k] = k - candidate.L[k] - candidate.R[k];
            }

            bool has_halt = false;
            for (int k = 1; k <= n; k++) {
                if (candidate.L[k] == 0 && candidate.R[k] == 0) {
                    has_halt = true;
                    break;
                }
            }
            if (!has_halt) {
                candidate.L[1] = 0; candidate.R[1] = 0; candidate.S[1] = 1;
            }

            int score = simulate_fast(&candidate, n, max_steps);
            if (score > 0) {
                record_leader(score, &candidate, n);
                if (score >= current_score) {
                    current = candidate;
                    current_score = score;
                }
            } else if (score == -2) {
                record_holdout(&candidate, n);
            } else if (score == -1 && current_score == 0) {
                if ((xorshift64(&rng) % 100) < 5) {
                    current = candidate;
                }
            }

            if (omp_get_thread_num() == 0 && now - last_progress > 0.3) {
                last_progress = now;
                double rate = (g_eval_count / (now - g_start_time)) / 1e6;
                printf("{\"type\":\"progress\",\"elapsed\":%.2f,\"evaluated\":%lld,\"rate_m_per_s\":%.2f,\"champion\":%d,\"holdouts\":%lld}\n",
                       now - g_start_time, g_eval_count, rate, g_leaders[0].steps, g_holdouts_count);
                fflush(stdout);
            }
        }
    }

    if (g_holdout_file) {
        fclose(g_holdout_file);
        g_holdout_file = NULL;
    }

    int emit_count = g_holdout_sample_count < 100 ? g_holdout_sample_count : 100;
    if (emit_count > 0) {
        printf("{\"type\":\"holdout_samples\",\"count\":%lld,\"samples\":[", g_holdouts_count);
        for (int i = 0; i < emit_count; i++) {
            printf("\"%s\"%s", g_holdout_samples[i].rule_str, i == emit_count - 1 ? "" : ",");
        }
        printf("]}\n");
        fflush(stdout);
    }

    double elapsed = omp_get_wtime() - g_start_time;
    printf("{\"type\":\"done\",\"elapsed\":%.3f,\"evaluated\":%lld,\"champion_steps\":%d,\"champion_rule\":\"%s\",\"holdouts\":%lld,\"holdout_file\":\"%s\"}\n",
           elapsed, g_eval_count, g_leaders[0].steps, g_leaders[0].rule_str, g_holdouts_count, g_holdout_filename);
    fflush(stdout);
}

// Single machine detailed simulation output in JSON
static void run_simulate_json(const char *rule_str, int n, int max_steps, int max_history_rows) {
    RuleTable rules;
    parse_rule(rule_str, n, &rules);

    uint8_t tapeA[TAPE_SIZE] = {0};
    uint8_t tapeB[TAPE_SIZE] = {0};

    uint8_t *curr = tapeA;
    uint8_t *next = tapeB;

    curr[TAPE_MID] = (uint8_t)n;
    int min_x = TAPE_MID;
    int max_x = TAPE_MID;

    printf("{\"type\":\"simulation_start\",\"n\":%d,\"rule\":\"%s\",\"max_steps\":%d}\n", n, rule_str, max_steps);
    printf("{\"type\":\"history\",\"rows\":[\n");

    int step = 0;
    bool halted = false;

    while (step < max_steps) {
        if (step < max_history_rows) {
            printf("  {\"step\":%d,\"min_x\":%d,\"max_x\":%d,\"cells\":[",
                   step, min_x - TAPE_MID, max_x - TAPE_MID);
            for (int x = min_x; x <= max_x; x++) {
                printf("%d%s", curr[x], x == max_x ? "" : ",");
            }
            printf("]}%s\n", (step == max_history_rows - 1) ? "" : ",");
        }

        bool moving = false;
        for (int x = min_x; x <= max_x; x++) {
            uint8_t v = curr[x];
            if (v > 0 && (rules.L[v] > 0 || rules.R[v] > 0)) {
                moving = true;
                break;
            }
        }
        if (!moving) {
            halted = true;
            break;
        }

        int new_min = min_x - 1;
        int new_max = max_x + 1;
        if (new_min <= 2 || new_max >= TAPE_SIZE - 3) break;
        memset(&next[new_min], 0, new_max - new_min + 1);

        for (int x = min_x; x <= max_x; x++) {
            uint8_t v = curr[x];
            if (v == 0) continue;
            uint8_t L = rules.L[v];
            uint8_t R = rules.R[v];
            uint8_t S = rules.S[v];
            if (S > 0) next[x] += S;
            if (L > 0) next[x - 1] += L;
            if (R > 0) next[x + 1] += R;
        }

        while (new_min <= new_max && next[new_min] == 0) new_min++;
        if (new_min > new_max) { halted = true; step++; break; }
        while (new_max >= new_min && next[new_max] == 0) new_max--;

        uint8_t *tmp = curr;
        curr = next;
        next = tmp;
        min_x = new_min;
        max_x = new_max;
        step++;
    }

    printf("],\n\"final_step\":%d,\"halted\":%s}\n", step, halted ? "true" : "false");
    fflush(stdout);
}

int main(int argc, char **argv) {
    int n = 6;
    int max_steps = 300;
    int threads = 0;
    double duration = 5.0;
    char mode[32] = "tree";
    char rule_str[512] = "";

    for (int i = 1; i < argc; i++) {
        if (strcmp(argv[i], "--mode") == 0 && i + 1 < argc) {
            strncpy(mode, argv[++i], sizeof(mode) - 1);
        } else if (strcmp(argv[i], "--n") == 0 && i + 1 < argc) {
            n = atoi(argv[++i]);
        } else if (strcmp(argv[i], "--max-steps") == 0 && i + 1 < argc) {
            max_steps = atoi(argv[++i]);
        } else if (strcmp(argv[i], "--threads") == 0 && i + 1 < argc) {
            threads = atoi(argv[++i]);
        } else if (strcmp(argv[i], "--duration") == 0 && i + 1 < argc) {
            duration = atof(argv[++i]);
        } else if (strcmp(argv[i], "--rule") == 0 && i + 1 < argc) {
            strncpy(rule_str, argv[++i], sizeof(rule_str) - 1);
        } else if (strcmp(argv[i], "--holdouts-file") == 0 && i + 1 < argc) {
            strncpy(g_holdout_filename, argv[++i], sizeof(g_holdout_filename) - 1);
        }
    }

    if (strcmp(mode, "tree") == 0) {
        run_tree_search(n, max_steps, duration, threads);
    } else if (strcmp(mode, "heuristic") == 0) {
        run_heuristic_search(n, max_steps, duration, threads);
    } else if (strcmp(mode, "simulate") == 0) {
        if (strlen(rule_str) == 0) {
            fprintf(stderr, "Error: --rule required for simulate mode\n");
            return 1;
        }
        run_simulate_json(rule_str, n, max_steps, 500);
    } else {
        fprintf(stderr, "Unknown mode: %s\n", mode);
        return 1;
    }

    return 0;
}
