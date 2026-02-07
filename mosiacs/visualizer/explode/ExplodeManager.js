/**
 * ExplodeManager — Click a building to open a screen-pinned HTML inspector
 * that shows the real data behind that entity (from the JSON trace).
 *
 * The inspector cards are fixed to the viewport (not 3D), so they stay
 * readable as the camera moves.  Clicking the same building (or the
 * close button) collapses the inspector.
 */
class ExplodeManager {
    constructor(scene, camera, materialManager) {
        this.scene  = scene;
        this.camera = camera;
        this.materialManager = materialManager;

        /** Currently inspected building (null when nothing is open) */
        this.exploded = null;

        this._setupPointerObservable();
    }

    // ─── public ─────────────────────────────────────────────────────

    collapseIfExploded() {
        if (this.exploded) {
            this._collapse();
            return true;
        }
        return false;
    }

    // ─── click detection ────────────────────────────────────────────

    _setupPointerObservable() {
        this.scene.onPointerObservable.add((pointerInfo) => {
            if (pointerInfo.type !== BABYLON.PointerEventTypes.POINTERPICK) return;
            const pick = pointerInfo.pickInfo;
            if (!pick.hit || !pick.pickedMesh) return;

            const buildingMesh = this._findBuildingMesh(pick.pickedMesh);
            if (!buildingMesh) return;

            // Already inspecting this building → close
            if (this.exploded && this.exploded.mesh === buildingMesh) {
                this._collapse();
                return;
            }

            // Different building → close old, open new
            if (this.exploded) this._collapse();
            this._explode(buildingMesh);
        });
    }

    _findBuildingMesh(mesh) {
        let cur = mesh;
        while (cur) {
            if (cur._buildingData) return cur;
            if (cur.name && cur.name.startsWith('building_')) return cur;
            cur = cur.parent;
        }
        return null;
    }

    // ─── explode (open inspector) ───────────────────────────────────

    _explode(buildingMesh) {
        const bd = buildingMesh._buildingData;
        if (!bd) return;

        const entity = buildingMesh._entityData || {};

        // Build HTML inspector
        const panel = this._buildInspectorHTML(bd, entity);
        document.body.appendChild(panel);

        // Animate in
        requestAnimationFrame(() => panel.classList.add('open'));

        // Close button
        panel.querySelector('.inspector-close').addEventListener('click', () => {
            this._collapse();
        });

        this.exploded = { mesh: buildingMesh, buildingData: bd, panel };
    }

    // ─── build the inspector DOM from real data ─────────────────────

    _buildInspectorHTML(bd, entity) {
        const panel = document.createElement('div');
        panel.id = 'inspectorPanel';
        panel.className = 'inspector-panel';

        let html = '';

        // Close button
        html += `<button class="inspector-close">✕</button>`;

        switch (bd.type) {
            case 'CALL':
                html += this._buildFunctionInspector(bd, entity);
                break;
            case 'DECL':
                html += this._buildVariableInspector(bd, entity);
                break;
            case 'LOOP':
                html += this._buildLoopInspector(bd, entity);
                break;
            case 'CONDITION':
                html += this._buildBranchInspector(bd, entity);
                break;
            default:
                html += `<div class="inspector-header">${bd.type}</div>`;
                html += `<div class="inspector-row"><span class="inspector-label">Step</span><span class="inspector-val">${bd.step}</span></div>`;
        }

        panel.innerHTML = html;
        return panel;
    }

    // ── Function ────────────────────────────────────────────────────

    _buildFunctionInspector(bd, fn) {
        let h = '';
        h += `<div class="inspector-header fn-header">
            <span class="inspector-icon">🏛️</span>
            <span>${fn.name || bd.stepData.name}()</span>
        </div>`;
        h += `<div class="inspector-section">`;
        h += this._row('Type', 'Function Call');
        h += this._row('Depth', fn.depth !== undefined ? fn.depth : bd.stepData.depth);
        h += this._row('Enter step', fn.enterStep !== undefined ? fn.enterStep : bd.step);
        if (fn.exitStep !== null && fn.exitStep !== undefined)
            h += this._row('Exit step', fn.exitStep);
        h += this._row('Active', fn.active ? '✓ yes' : '✗ no');
        h += `</div>`;

        // Local variables
        if (fn.localVars && fn.localVars.length > 0) {
            h += `<div class="inspector-subtitle">Local Variables</div>`;
            h += `<div class="inspector-section">`;
            fn.localVars.forEach(vk => {
                h += `<div class="inspector-row"><span class="inspector-label var-chip">${vk}</span></div>`;
            });
            h += `</div>`;
        }

        // Return value
        if (fn.returnValue !== null && fn.returnValue !== undefined) {
            h += `<div class="inspector-subtitle">Return</div>`;
            h += `<div class="inspector-section">`;
            h += this._row('Value', fn.returnValue);
            h += `</div>`;
        }

        return h;
    }

    // ── Variable ────────────────────────────────────────────────────

    _buildVariableInspector(bd, v) {
        let h = '';
        h += `<div class="inspector-header var-header">
            <span class="inspector-icon">🏠</span>
            <span>${v.name || bd.stepData.name}</span>
        </div>`;
        h += `<div class="inspector-section">`;
        h += this._row('Type', 'Variable');
        h += this._row('Current value', `<strong>${v.currentValue !== undefined ? v.currentValue : bd.stepData.value}</strong>`);
        h += this._row('Address', v.address || bd.stepData.address || '—');
        h += this._row('Scope', v.scope || '—');
        h += this._row('Declared at step', v.declStep !== undefined ? v.declStep : bd.step);
        h += this._row('Active', v.active ? '✓ yes' : '✗ no');
        h += `</div>`;

        // Value history (from actual trace data)
        if (v.values && v.values.length > 0) {
            h += `<div class="inspector-subtitle">Value History</div>`;
            h += `<div class="inspector-section inspector-history">`;
            v.values.forEach((entry, i) => {
                const isCurrent = (i === v.values.length - 1);
                h += `<div class="history-row ${isCurrent ? 'current' : ''}">
                    <span class="history-step">step ${entry.step}</span>
                    <span class="history-arrow">→</span>
                    <span class="history-value">${entry.value}</span>
                </div>`;
            });
            h += `</div>`;
        }

        return h;
    }

    // ── Loop ────────────────────────────────────────────────────────

    _buildLoopInspector(bd, loop) {
        let h = '';
        h += `<div class="inspector-header loop-header">
            <span class="inspector-icon">🏭</span>
            <span>${(loop.subtype || 'loop').toUpperCase()}</span>
        </div>`;
        h += `<div class="inspector-section">`;
        h += this._row('Type', (loop.subtype || 'loop').toUpperCase() + ' Loop');
        h += this._row('Condition', `<code>${loop.condition || bd.stepData.condition || '—'}</code>`);
        h += this._row('Iterations', loop.iterations !== undefined ? loop.iterations : '—');
        h += this._row('Running', loop.running ? '🔄 yes' : '⏹ no');
        h += this._row('Active', loop.active ? '✓ yes' : '✗ no');
        h += `</div>`;

        // Iteration steps
        if (loop.steps && loop.steps.length > 0) {
            h += `<div class="inspector-subtitle">Iteration Steps</div>`;
            h += `<div class="inspector-section inspector-history">`;
            loop.steps.forEach((s, i) => {
                const isLast = (i === loop.steps.length - 1);
                h += `<div class="history-row ${isLast ? 'current' : ''}">
                    <span class="history-step">step ${s}</span>
                    <span class="history-arrow">→</span>
                    <span class="history-value">iteration ${i + 1}</span>
                </div>`;
            });
            h += `</div>`;
        }

        return h;
    }

    // ── Branch ──────────────────────────────────────────────────────

    _buildBranchInspector(bd, br) {
        let h = '';
        h += `<div class="inspector-header cond-header">
            <span class="inspector-icon">🔀</span>
            <span>CONDITION</span>
        </div>`;
        h += `<div class="inspector-section">`;
        h += this._row('Type', 'Branch / Condition');
        h += this._row('Condition', `<code>${br.condition || bd.stepData.name || '—'}</code>`);
        h += this._row('Result', br.result ? '<span class="val-true">TRUE</span>' : '<span class="val-false">FALSE</span>');
        if (br.chosenBranch)
            h += this._row('Branch taken', br.chosenBranch);
        h += this._row('Step', br.step !== undefined ? br.step : bd.step);
        h += `</div>`;

        return h;
    }

    // ── helpers ─────────────────────────────────────────────────────

    _row(label, value) {
        return `<div class="inspector-row"><span class="inspector-label">${label}</span><span class="inspector-val">${value}</span></div>`;
    }

    // ─── collapse ───────────────────────────────────────────────────

    _collapse() {
        if (!this.exploded) return;

        const { mesh, buildingData, panel } = this.exploded;

        // Remove inspector
        panel.classList.remove('open');
        setTimeout(() => {
            if (panel.parentNode) panel.parentNode.removeChild(panel);
        }, 300);

        this.exploded = null;
    }
}
