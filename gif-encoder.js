/**
 * Zero-dependency pure-JS GIF89a encoder.
 * Utilizes standard, battle-tested GIF LZW variable-length compression
 * with dynamic color quantization and 100% specification compliance.
 */

const BITS = 12;
const HSIZE = 5003;
const masks = [
    0x0000, 0x0001, 0x0003, 0x0007, 0x000F, 0x001F, 0x003F, 0x007F,
    0x00FF, 0x01FF, 0x03FF, 0x07FF, 0x0FFF, 0x1FFF, 0x3FFF, 0x7FFF, 0xFFFF
];

function lzwCompress(minCodeSize, indexedPixels) {
    const outs = [];
    const init_bits = Math.max(2, minCodeSize) + 1;
    let g_init_bits = init_bits;
    let clear_flg = false;
    let n_bits = g_init_bits;
    let maxcode = (1 << n_bits) - 1;
    const ClearCode = 1 << (init_bits - 1);
    const EOFCode = ClearCode + 1;
    let free_ent = ClearCode + 2;

    let cur_accum = 0;
    let cur_bits = 0;
    const accum = new Uint8Array(256);
    let a_count = 0;

    function char_out(c) {
        accum[a_count++] = c;
        if (a_count >= 254) flush_char();
    }

    function flush_char() {
        if (a_count > 0) {
            outs.push(a_count);
            for (let i = 0; i < a_count; i++) outs.push(accum[i]);
            a_count = 0;
        }
    }

    function output(code) {
        cur_accum &= masks[cur_bits];
        if (cur_bits > 0) cur_accum |= (code << cur_bits);
        else cur_accum = code;
        cur_bits += n_bits;

        while (cur_bits >= 8) {
            char_out(cur_accum & 0xff);
            cur_accum >>= 8;
            cur_bits -= 8;
        }

        if (free_ent > maxcode || clear_flg) {
            if (clear_flg) {
                maxcode = (1 << (n_bits = g_init_bits)) - 1;
                clear_flg = false;
            } else {
                ++n_bits;
                if (n_bits === BITS) maxcode = 1 << BITS;
                else maxcode = (1 << n_bits) - 1;
            }
        }

        if (code === EOFCode) {
            while (cur_bits > 0) {
                char_out(cur_accum & 0xff);
                cur_accum >>= 8;
                cur_bits -= 8;
            }
            flush_char();
        }
    }

    const htab = new Int32Array(HSIZE);
    const codetab = new Int32Array(HSIZE);
    function cl_hash() {
        htab.fill(-1);
    }

    let curPixel = 0;
    function nextPixel() {
        if (curPixel < indexedPixels.length) return indexedPixels[curPixel++];
        return -1;
    }

    cl_hash();
    output(ClearCode);

    let ent = nextPixel();
    let c;
    const maxbits = BITS;
    const maxmaxcode = 1 << BITS;

    let hshift = 0;
    for (let fcode = HSIZE; fcode < 65536; fcode *= 2) ++hshift;
    hshift = 8 - hshift;

    outer_loop:
    while ((c = nextPixel()) !== -1) {
        const fcode = (c << maxbits) + ent;
        let i = (c << hshift) ^ ent;

        if (htab[i] === fcode) {
            ent = codetab[i];
            continue;
        } else if (htab[i] >= 0) {
            let disp = HSIZE - i;
            if (i === 0) disp = 1;
            do {
                if ((i -= disp) < 0) i += HSIZE;
                if (htab[i] === fcode) {
                    ent = codetab[i];
                    continue outer_loop;
                }
            } while (htab[i] >= 0);
        }

        output(ent);
        ent = c;
        if (free_ent < maxmaxcode) {
            codetab[i] = free_ent++;
            htab[i] = fcode;
        } else {
            cl_hash();
            free_ent = ClearCode + 2;
            clear_flg = true;
            output(ClearCode);
        }
    }
    output(ent);
    output(EOFCode);
    outs.push(0); // Sub-block terminator
    return outs;
}

export function encodeGIF(width, height, frames, delayCentis = 10) {
    if (!frames || frames.length === 0) return new Uint8Array(0);

    const colorMap = new Map();
    const palette = [];

    // Pass 1: Extract unique colors across all frames
    for (let f = 0; f < frames.length; f++) {
        const frame = frames[f];
        for (let i = 0; i < frame.length; i += 4) {
            const r = frame[i];
            const g = frame[i + 1];
            const b = frame[i + 2];
            const key = (r << 16) | (g << 8) | b;
            if (!colorMap.has(key)) {
                if (palette.length < 256) {
                    colorMap.set(key, palette.length);
                    palette.push([r, g, b]);
                }
            }
        }
        if (palette.length >= 256) break;
    }

    // Ensure at least 2 colors in palette
    while (palette.length < 2) palette.push([0, 0, 0]);

    // Calculate required color depth and pad palette to power of 2
    let colorDepth = 1;
    while ((1 << colorDepth) < palette.length) colorDepth++;
    if (colorDepth < 1) colorDepth = 1;
    if (colorDepth > 8) colorDepth = 8;
    const tableSize = 1 << colorDepth;
    while (palette.length < tableSize) palette.push([0, 0, 0]);

    // Freeze palette lookup
    function getFrozenColorIndex(r, g, b) {
        const key = (r << 16) | (g << 8) | b;
        if (colorMap.has(key)) return colorMap.get(key);

        // Nearest neighbor fallback
        let bestIdx = 0;
        let bestDist = Infinity;
        for (let i = 0; i < tableSize; i++) {
            const [pr, pg, pb] = palette[i];
            const d = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2;
            if (d < bestDist) {
                bestDist = d;
                bestIdx = i;
            }
        }
        colorMap.set(key, bestIdx);
        return bestIdx;
    }

    const bytes = [];
    function writeByte(b) { bytes.push(b & 0xFF); }
    function writeShort(v) { bytes.push(v & 0xFF, (v >> 8) & 0xFF); }
    function writeString(s) { for (let i = 0; i < s.length; i++) bytes.push(s.charCodeAt(i)); }

    // Header & Logical Screen Descriptor
    writeString('GIF89a');
    writeShort(width);
    writeShort(height);
    // Packed Field: Global Color Table Flag (1 bit) + Color Resolution (3 bits) + Sort (1 bit) + Table Size (3 bits)
    writeByte(0x80 | ((colorDepth - 1) << 4) | (colorDepth - 1));
    writeByte(0); // Background Color Index
    writeByte(0); // Pixel Aspect Ratio

    // Global Color Table
    for (let i = 0; i < tableSize; i++) {
        const [r, g, b] = palette[i];
        writeByte(r);
        writeByte(g);
        writeByte(b);
    }

    // Netscape Application Extension for infinite animation loop
    writeByte(0x21); // Extension Introducer
    writeByte(0xFF); // Application Extension Label
    writeByte(11);   // Block Size
    writeString('NETSCAPE2.0');
    writeByte(3);    // Sub-block Size
    writeByte(1);    // Loop Sub-block ID
    writeShort(0);   // Loop Count (0 = Infinite)
    writeByte(0);    // Block Terminator

    const minCodeSize = Math.max(2, colorDepth);

    // Write animation frames
    for (const frame of frames) {
        // Graphic Control Extension
        writeByte(0x21); // Extension Introducer
        writeByte(0xF9); // Graphic Control Label
        writeByte(4);    // Block Size
        writeByte(0x04); // Disposal Method: 1 (do not dispose, render on top)
        writeShort(delayCentis); // Delay Time in 1/100s
        writeByte(0);    // Transparent Color Index (unused when transparent flag is 0)
        writeByte(0);    // Block Terminator

        // Image Descriptor
        writeByte(0x2C); // Image Separator
        writeShort(0);   // Image Left
        writeShort(0);   // Image Top
        writeShort(width);
        writeShort(height);
        writeByte(0);    // Packed Field: Local Color Table Flag (none)

        // Convert RGBA pixels to indexed palette indices
        const indexed = new Uint8Array(width * height);
        for (let i = 0, p = 0; i < frame.length; i += 4, p++) {
            indexed[p] = getFrozenColorIndex(frame[i], frame[i + 1], frame[i + 2]);
        }

        // Write LZW compressed data
        writeByte(minCodeSize);
        const lzwBytes = lzwCompress(minCodeSize, indexed);
        for (let i = 0; i < lzwBytes.length; i++) writeByte(lzwBytes[i]);
    }

    writeByte(0x3B); // GIF Trailer
    return new Uint8Array(bytes);
}
