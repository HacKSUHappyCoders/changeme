/**
 * Parser for the C code runtime model
 * Format: TYPE|name|value|address|line|depth
 */
class CodeParser {
    constructor() {
        this.executionTrace = [];
    }

    /**
     * Parse the raw code trace string
     * @param {string} codeTrace - Multi-line string of execution trace
     * @returns {Array} Parsed execution steps
     */
    parse(codeTrace) {
        const lines = codeTrace.trim().split('\n');
        this.executionTrace = lines.map((line, index) => {
            const parts = line.split('|');
            return {
                step: index,
                type: parts[0],
                name: parts[1],
                value: parts[2],
                address: parts[3],
                line: parseInt(parts[4]) || 0,
                depth: parseInt(parts[5]) || 0,
                raw: line
            };
        });
        return this.executionTrace;
    }

    /**
     * Get color based on operation type (stained glass colors)
     */
    getColorForType(type) {
        const colors = {
            'CALL': { r: 0.8, g: 0.2, b: 0.2, a: 0.8 },      // Ruby red
            'DECL': { r: 0.2, g: 0.4, b: 0.8, a: 0.8 },      // Sapphire blue
            'LOOP': { r: 0.6, g: 0.2, b: 0.8, a: 0.8 },      // Amethyst purple
            'ASSIGN': { r: 0.2, g: 0.8, b: 0.4, a: 0.8 },    // Emerald green
            'RETURN': { r: 0.9, g: 0.7, b: 0.1, a: 0.8 },    // Amber gold
            'IF': { r: 0.9, g: 0.4, b: 0.2, a: 0.8 },        // Topaz orange
            'ELSE': { r: 0.4, g: 0.7, b: 0.9, a: 0.8 },      // Aquamarine
            'DEFAULT': { r: 0.7, g: 0.7, b: 0.7, a: 0.8 }    // Crystal clear
        };
        return colors[type] || colors['DEFAULT'];
    }

    /**
     * Get example code trace
     */
    static getExampleTrace() {
        return `CALL|main|||1
DECL|sum|0|00000049923FF88C|2|1
LOOP|iter|3|1
DECL|i|0|00000049923FF888|3|1
ASSIGN|sum|0|00000049923FF88C|4|1
LOOP|iter|3|1
DECL|i|1|00000049923FF888|3|1
ASSIGN|sum|1|00000049923FF88C|4|1
LOOP|iter|3|1
DECL|i|2|00000049923FF888|3|1
ASSIGN|sum|3|00000049923FF88C|4|1
LOOP|iter|3|1
DECL|i|3|00000049923FF888|3|1
ASSIGN|sum|6|00000049923FF88C|4|1
LOOP|iter|3|1
DECL|i|4|00000049923FF888|3|1
ASSIGN|sum|10|00000049923FF88C|4|1
RETURN|literal|0|0|7|1
CALL|main|||1
DECL|sum|0|00000049923FF88C|2|1
LOOP|iter|3|1
DECL|i|0|00000049923FF888|3|1
ASSIGN|sum|0|00000049923FF88C|4|1
LOOP|iter|3|1
DECL|i|1|00000049923FF888|3|1
ASSIGN|sum|1|00000049923FF88C|4|1
LOOP|iter|3|1
DECL|i|2|00000049923FF888|3|1
ASSIGN|sum|3|00000049923FF88C|4|1
LOOP|iter|3|1
DECL|i|3|00000049923FF888|3|1
ASSIGN|sum|6|00000049923FF88C|4|1
LOOP|iter|3|1
DECL|i|4|00000049923FF888|3|1
ASSIGN|sum|10|00000049923FF88C|4|1
RETURN|literal|0|0|7|1
CALL|main|||1
DECL|sum|0|00000049923FF88C|2|1
LOOP|iter|3|1
DECL|i|0|00000049923FF888|3|1
ASSIGN|sum|0|00000049923FF88C|4|1
LOOP|iter|3|1
DECL|i|1|00000049923FF888|3|1
ASSIGN|sum|1|00000049923FF88C|4|1
LOOP|iter|3|1
DECL|i|2|00000049923FF888|3|1
ASSIGN|sum|3|00000049923FF88C|4|1
LOOP|iter|3|1
DECL|i|3|00000049923FF888|3|1
ASSIGN|sum|6|00000049923FF88C|4|1
LOOP|iter|3|1
DECL|i|4|00000049923FF888|3|1
ASSIGN|sum|10|00000049923FF88C|4|1
RETURN|literal|0|0|7|1
CALL|main|||1
DECL|sum|0|00000049923FF88C|2|1
LOOP|iter|3|1
DECL|i|0|00000049923FF888|3|1
ASSIGN|sum|0|00000049923FF88C|4|1
LOOP|iter|3|1
DECL|i|1|00000049923FF888|3|1
ASSIGN|sum|1|00000049923FF88C|4|1
LOOP|iter|3|1
DECL|i|2|00000049923FF888|3|1
ASSIGN|sum|3|00000049923FF88C|4|1
LOOP|iter|3|1
DECL|i|3|00000049923FF888|3|1
ASSIGN|sum|6|00000049923FF88C|4|1
LOOP|iter|3|1
DECL|i|4|00000049923FF888|3|1
ASSIGN|sum|10|00000049923FF88C|4|1
RETURN|literal|0|0|7|1`;
    }
}
