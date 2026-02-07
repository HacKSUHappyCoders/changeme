/**
 * Parser for the C code runtime model
 * Accepts JSON trace data with metadata and traces arrays.
 *
 * Input JSON shape:
 *   { metadata: { … }, traces: [ { type, subject, value, address, line_number, stack_depth, … }, … ] }
 *
 * Each trace entry is normalised into a step object that the rest of
 * the visualizer understands.
 */
class CodeParser {
    constructor() {
        this.executionTrace = [];
        this.metadata = null;
    }

    /**
     * Parse a JSON code-trace.
     * @param {object|string} jsonData – the full JSON object (or a JSON string)
     * @returns {Array} Parsed execution steps
     */
    parse(jsonData) {
        const data = typeof jsonData === 'string' ? JSON.parse(jsonData) : jsonData;

        this.metadata = data.metadata || null;

        const traces = data.traces || [];

        this.executionTrace = traces.map((t, index) => {
            return {
                step:       index,
                type:       t.type,                          // CALL, DECL, LOOP, ASSIGN, RETURN, CONDITION, BRANCH, READ
                name:       t.subject || '',                 // primary identifier
                value:      t.value !== undefined ? String(t.value) : '',
                address:    t.address || '0',
                line:       Number(t.line_number) || 0,      // ensure numeric
                depth:      Number(t.stack_depth) || 0,      // ensure numeric
                // New fields from JSON
                subtype:    t.subtype || '',                 // e.g. "for", "else", "literal"
                condition:  t.condition || '',               // e.g. "i<5", "sum < 10"
                conditionResult: t.condition_result !== undefined ? Number(t.condition_result) : null,
                // READ-specific: the value that was read (format_spec in the raw trace)
                readValue:  t.format_spec !== undefined ? String(t.format_spec) : '',
                raw:        t
            };
        });

        return this.executionTrace;
    }

    /**
     * Fetch trace data from the Flask API.
     * @param {string} [filename='big_test_data.json'] – JSON file in data/
     * @returns {Promise<object>} The trace JSON object
     */
    static getExampleTrace(filename) {
        const url = filename ? `/api/trace/${filename}` : '/api/trace';
        return fetch(url)
            .then(res => {
                if (!res.ok) throw new Error(`Failed to load trace: ${res.status}`);
                return res.json();
            });
    }

    /**
     * Upload a source file (.c or .py) to the server for processing.
     * @param {File} file – the File object from an <input type="file">
     * @returns {Promise<object>} The processed trace JSON
     */
    static upload(file) {
        const formData = new FormData();
        formData.append('file', file);
        return fetch('/api/upload', { method: 'POST', body: formData })
            .then(res => res.json());
    }
}
