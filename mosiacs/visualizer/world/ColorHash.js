/**
 * ColorHash — Deterministic hash-based coloring for buildings.
 *
 * Phase 3.5: More extreme color variation between same-type buildings.
 *
 * Uses a FNV-1a hash to produce TWO independent X values from different
 * bit ranges of the hash.  This gives much more spread between buildings
 * of the same type (e.g. two different functions will look visually
 * distinct instead of nearly the same shade).
 *
 * Color schema (RGB, 0-255):
 *   Functions:  (X1, X2, 255)   — blue family, wide hue variation
 *   Variables:  (X1, 255, X2)   — cyan-green family
 *   For Loops:  (255, X1, X2)   — warm red-orange-yellow family
 *   While Loops:(X1, 255, X2)   — green family, offset from variables
 *   If/Branch:  (255, X1, 255)  — magenta family
 *   Else:       (X1, 255, X2)   — lime-teal family
 *
 * The 255 slots are locked; X1 and X2 are derived from independent bits
 * of the hash.  Same name → same hash → same colour everywhere.
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
     * Extract two independent X values from different bit ranges.
     * Range [20 .. 235] gives wider spread than the old [40..220].
     */
    static _xPairFromHash(hash) {
        const x1 = 20 + (hash % 216);                // bits 0-7 ish → 20-235
        const x2 = 20 + ((hash >>> 11) % 216);       // bits 11-18 → 20-235
        return [x1, x2];
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
        const h = ColorHash._hash(name);
        const [x1, x2] = ColorHash._xPairFromHash(h);
        const n1 = x1 / 255;
        const n2 = x2 / 255;
        const one = 1.0;

        switch (type) {
            case 'function':  return { r: n1,  g: n2,  b: one, a: 0.85 };
            case 'variable':  return { r: n1,  g: one, b: n2,  a: 0.85 };
            case 'for':       return { r: one, g: n1,  b: n2,  a: 0.85 };
            case 'while':     return { r: n2,  g: one, b: n1,  a: 0.85 };
            case 'branch':    return { r: one, g: n1,  b: one, a: 0.85 };
            case 'else':      return { r: n1,  g: one, b: n2,  a: 0.85 };
            default:          return { r: n1,  g: n2,  b: n1,  a: 0.85 };
        }
    }

    /**
     * Generate a unique spiral-path colour from a hash, avoiding the
     * golden main-spiral colour.  Returns a Color3-compatible {r,g,b}.
     */
    static spiralColor(name) {
        const h  = ColorHash._hash(name + '_spiral');
        const [x1, x2] = ColorHash._xPairFromHash(h);
        return {
            r: x1 / 255,
            g: x2 / 255,
            b: (255 - x1) / 255
        };
    }

    /**
     * Generate color with file-specific tint for multi-file visualizations.
     * Applies a subtle brightness variation based on source file to help
     * distinguish buildings from different files while maintaining the
     * type-based color scheme.
     *
     * @param {'function'|'variable'|'for'|'while'|'branch'|'else'} type
     * @param {string} name - Entity name
     * @param {string} sourceFile - Source file name (optional)
     * @returns {{r:number, g:number, b:number, a:number}}
     */
    static colorWithFile(type, name, sourceFile) {
        if (!sourceFile || sourceFile === 'unknown') {
            return ColorHash.color(type, name);
        }

        // Get base color
        const baseColor = ColorHash.color(type, name);

        // Compute file-specific tint
        const fileHash = ColorHash._hash(sourceFile);
        const fileTintFactor = (fileHash % 100) / 200; // 0.0 to 0.5 range

        // Alternate files between slightly brighter and slightly darker
        const fileMod = fileHash % 2 === 0
            ? 1.0 + fileTintFactor           // brighten
            : 1.0 - fileTintFactor * 0.5;    // darken

        return {
            r: Math.min(baseColor.r * fileMod, 1.0),
            g: Math.min(baseColor.g * fileMod, 1.0),
            b: Math.min(baseColor.b * fileMod, 1.0),
            a: baseColor.a
        };
    }
}
