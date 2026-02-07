/**
 * StepLabelHelper - Provides label text and color mappings for code steps.
 *
 * Works with the normalised step objects produced by CodeParser.parse():
 *   { type, name, value, address, line, depth, subtype, condition, conditionResult }
 */
class StepLabelHelper {

    /**
     * Return a human-readable label for a parsed trace step.
     */
    static labelForStep(step) {
        switch (step.type) {
            case 'DECL':
                return `DECL  ${step.name} = ${step.value}`;
            case 'ASSIGN':
                return `${step.name} = ${step.value}`;
            case 'LOOP': {
                const loopKind = step.subtype ? step.subtype : 'loop';
                const cond = step.condition ? `  (${step.condition})` : '';
                const result = step.conditionResult !== null
                    ? (step.conditionResult ? ' ✓' : ' ✗')
                    : '';
                return `${loopKind.toUpperCase()}${cond}${result}`;
            }
            case 'CONDITION': {
                const result = step.conditionResult !== null
                    ? (step.conditionResult ? '  TRUE' : '  FALSE')
                    : '';
                return `IF  (${step.name})${result}`;
            }
            case 'BRANCH': {
                const branchKind = step.subtype ? step.subtype.toUpperCase() : 'BRANCH';
                const cond = step.condition ? `  (${step.condition})` : '';
                return `${branchKind}${cond}`;
            }
            case 'IF':
                return `IF  ${step.name}  (${step.value})`;
            case 'ELSE':
                return `ELSE`;
            case 'RETURN': {
                const retKind = step.subtype ? `(${step.subtype})` : '';
                return `RETURN  ${step.value} ${retKind}`.trim();
            }
            case 'CALL':
                return `CALL  ${step.name}`;
            default:
                return `${step.type}  ${step.name || ''} ${step.value || ''}`.trim();
        }
    }

    /**
     * Return an RGBA colour object for a given child step type.
     */
    static colorForChild(step) {
        const map = {
            'DECL':      { r: 0.2, g: 0.4, b: 0.8, a: 0.85 },
            'ASSIGN':    { r: 0.2, g: 0.8, b: 0.4, a: 0.85 },
            'LOOP':      { r: 0.6, g: 0.2, b: 0.8, a: 0.85 },
            'CONDITION': { r: 0.9, g: 0.4, b: 0.2, a: 0.85 },
            'BRANCH':    { r: 0.4, g: 0.7, b: 0.9, a: 0.85 },
            'IF':        { r: 0.9, g: 0.4, b: 0.2, a: 0.85 },
            'ELSE':      { r: 0.4, g: 0.7, b: 0.9, a: 0.85 },
            'RETURN':    { r: 0.9, g: 0.7, b: 0.1, a: 0.85 },
            'CALL':      { r: 0.8, g: 0.2, b: 0.2, a: 0.85 }
        };
        return map[step.type] || { r: 0.6, g: 0.6, b: 0.6, a: 0.85 };
    }
}
