/**
 * ColorHash — Deterministic hash-based coloring for buildings.
 *
 * Uses a simple string hash to produce an X value (0-220), then selects
 * from the colour schema based on building type:
 *
 *   Functions:  (X, X, 255)    — blue family
 *   Variables:  (X, 255, 255)  — cyan family
 *   For Loops:  (255, 255, X)  — yellow family (was (255,255,255) but X keeps variety)
 *   While Loops:(X, 255, X)    — green family
 *   If/Branch:  (255, X, 255)  — magenta family
 *   Else:       (255, 255, X)  — yellow family
 *
 * The 255 slots are locked; the X slots are determined by the hash.
 * Same name → same hash → same colour across the entire visualization.
 */
class ColorHash {

    /**
     * Simple 32-bit hash of a string, returns 0..0xFFFFFFFF.
     */
    static _hash(str) {
        let h = 0x811c9dc5;                          // FNV-1a offset basis
        for (let i = 0; i < str.length; i++) {
            h ^= str.charCodeAt(i);
            h = Math.imul(h, 0x01000193);            // FNV-1a prime
        }
        return h >>> 0;                               // ensure unsigned
    }

    /**
     * Map a hash to a value in [40 .. 220] so colours are never too dark
     * or too close to 255.
     */
    static _xFromHash(hash) {
        return 40 + (hash % 181);                     // 40-220
    }

    /**
     * Return an {r, g, b, a} colour object (0-1 floats) for the given
     * building type and identifying name.
     *
     * @param {'function'|'variable'|'for'|'while'|'branch'|'else'} type
     * @param {string} name – the identifying string to hash (e.g. "factorial", "sum")
     * @returns {{r:number, g:number, b:number, a:number}}
     */
    static color(type, name) {
        const h   = ColorHash._hash(name);
        const x   = ColorHash._xFromHash(h) / 255;   // normalise to 0-1
        const one = 1.0;                              // stands for 255/255

        switch (type) {
            case 'function':  return { r: x,   g: x,   b: one, a: 0.85 };
            case 'variable':  return { r: x,   g: one,  b: one, a: 0.85 };
            case 'for':       return { r: one,  g: one,  b: x,   a: 0.85 };
            case 'while':     return { r: x,   g: one,  b: x,   a: 0.85 };
            case 'branch':    return { r: one,  g: x,   b: one, a: 0.85 };
            case 'else':      return { r: one,  g: one,  b: x,   a: 0.85 };
            default:          return { r: x,   g: x,   b: x,   a: 0.85 };
        }
    }

    /**
     * Generate a unique spiral-path colour from a hash, avoiding the
     * golden main-spiral colour.  Returns a Color3-compatible {r,g,b}.
     */
    static spiralColor(name) {
        const h  = ColorHash._hash(name + '_spiral');
        const x1 = 40 + (h % 181);
        const x2 = 40 + ((h >> 8) % 181);
        return {
            r: x1 / 255,
            g: x2 / 255,
            b: (255 - x1) / 255
        };
    }
}
