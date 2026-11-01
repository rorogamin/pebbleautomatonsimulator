/**
 * Zero-dependency pure-JS GIF89a encoder with LZW compression.
 * High-performance, memory-efficient canvas frame compiler for Pebble Automata diagrams.
 */

export function encodeGIF(width, height, frames, delayCentis = 8) {
    if (!frames || frames.length === 0) return new Uint8Array(0);

    const colorMap = new Map();
    const palette = [];

    function getColorIndex(r, g, b) {
        // Quantize slightly to 5-bit color per channel if palette gets full
        const key = (r << 16) | (g << 8) | b;
        if (colorMap.has(key)) return colorMap.get(key);
        if (palette.length >= 256) {
            // Find nearest color in palette
            let bestIdx = 0;
            let bestDist = Infinity;
            for (let i = 0; i < palette.length; i++) {
                const [pr, pg, pb] = palette[i];
                const d = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2;
                if (d < bestDist) {
                    bestDist = d;
                    bestIdx = i;
                }
            }
            return bestIdx;
        }
        const idx = palette.length;
        palette.push([r, g, b]);
        colorMap.set(key, idx);
        return idx;
    }

    // Pass 1: Build palette from all frames (or sample)
    for (let f = 0; f < frames.length; f++) {
        const frame = frames[f];
        const step = frames.length > 5 ? 8 : 4; // Sample step
        for (let i = 0; i < frame.length; i += step * 4) {
            getColorIndex(frame[i], frame[i + 1], frame[i + 2]);
            if (palette.length >= 256) break;
        }
        if (palette.length >= 256) break;
    }

    while (palette.length < 2) palette.push([0, 0, 0]);

    // Calculate required color depth
    let colorDepth = 1;
    while ((1 << colorDepth) < palette.length) colorDepth++;
    if (colorDepth < 1) colorDepth = 1;
    while (palette.length < (1 << colorDepth)) palette.push([0, 0, 0]);

    const bytes = [];
    function writeByte(b) { bytes.push(b & 0xFF); }
    function writeShort(v) { bytes.push(v & 0xFF, (v >> 8) & 0xFF); }
    function writeString(s) { for (let i = 0; i < s.length; i++) bytes.push(s.charCodeAt(i)); }

    // Header & Logical Screen Descriptor
    writeString('GIF89a');
    writeShort(width);
    writeShort(height);
    writeByte(0x80 | ((colorDepth - 1) << 4) | (colorDepth - 1)); // GCT flag & color resolution
    writeByte(0); // background color index
    writeByte(0); // pixel aspect ratio

    // Global Color Table
    for (const [r, g, b] of palette) {
        writeByte(r);
        writeByte(g);
        writeByte(b);
    }

    // Netscape Application Extension for infinite looping
    writeByte(0x21); writeByte(0xFF); writeByte(11);
    writeString('NETSCAPE2.0');
    writeByte(3); writeByte(1); writeShort(0); writeByte(0);

    // LZW Compression
    function lzw(minCodeSize, indexedPixels) {
        const clearCode = 1 << minCodeSize;
        const eoiCode = clearCode + 1;
        let codeSize = minCodeSize + 1;
        let nextCode = eoiCode + 1;
        const table = new Map();

        function initTable() {
            table.clear();
            for (let i = 0; i < clearCode; i++) table.set(String(i), i);
            codeSize = minCodeSize + 1;
            nextCode = eoiCode + 1;
        }

        const bitBuffer = [];
        let curBit = 0;
        let curByte = 0;

        function emitCode(code) {
            for (let i = 0; i < codeSize; i++) {
                if (code & (1 << i)) curByte |= (1 << curBit);
                curBit++;
                if (curBit === 8) {
                    bitBuffer.push(curByte);
                    curByte = 0;
                    curBit = 0;
                }
            }
        }

        initTable();
        emitCode(clearCode);

        let prefix = '';
        for (let i = 0; i < indexedPixels.length; i++) {
            const k = indexedPixels[i];
            const entry = prefix === '' ? String(k) : prefix + ',' + k;
            if (table.has(entry)) {
                prefix = entry;
            } else {
                emitCode(table.get(prefix));
                if (nextCode < 4096) {
                    table.set(entry, nextCode++);
                    if (nextCode === (1 << codeSize) && codeSize < 12) {
                        codeSize++;
                    }
                } else {
                    emitCode(clearCode);
                    initTable();
                }
                prefix = String(k);
            }
        }
        if (prefix !== '') emitCode(table.get(prefix));
        emitCode(eoiCode);
        if (curBit > 0) bitBuffer.push(curByte);

        // Pack into sub-blocks of max 254 bytes
        const stream = [];
        for (let i = 0; i < bitBuffer.length; i += 254) {
            const block = bitBuffer.slice(i, i + 254);
            stream.push(block.length, ...block);
        }
        stream.push(0); // block terminator
        return stream;
    }

    const minCodeSize = Math.max(2, colorDepth);

    // Frame blocks
    for (const frame of frames) {
        // Graphic Control Extension
        writeByte(0x21); writeByte(0xF9); writeByte(4);
        writeByte(0x04); // disposal method: restore to background
        writeShort(delayCentis); // delay time in 1/100s
        writeByte(0); // transparent color index
        writeByte(0); // block terminator

        // Image Descriptor
        writeByte(0x2C);
        writeShort(0); writeShort(0); // left, top
        writeShort(width); writeShort(height);
        writeByte(0); // local color table flag

        // Indexed pixel array
        const indexed = new Uint8Array(width * height);
        for (let i = 0, p = 0; i < frame.length; i += 4, p++) {
            indexed[p] = getColorIndex(frame[i], frame[i + 1], frame[i + 2]);
        }

        // Write compressed image data
        writeByte(minCodeSize);
        const lzwBytes = lzw(minCodeSize, indexed);
        for (let i = 0; i < lzwBytes.length; i++) writeByte(lzwBytes[i]);
    }

    writeByte(0x3B); // GIF file trailer
    return new Uint8Array(bytes);
}
