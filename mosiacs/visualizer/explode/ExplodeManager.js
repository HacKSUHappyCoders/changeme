/**
 * ExplodeManager — Click a building to open a screen-pinned HTML inspector
 * that shows the real data behind that entity (from the JSON trace).
 *
 * The inspector cards are fixed to the viewport (not 3D), so they stay
 * readable as the camera moves.  Clicking the same building (or the
 * close button) collapses the inspector.
 */
class ExplodeManager {
    constructor(scene, cityRenderer) {
        this.scene  = scene;

        /** Reference to CityRenderer for on-demand sub-spiral rendering */
        this.cityRenderer = cityRenderer || null;

        /** GalaxyWarpManager — set by CodeVisualizer after construction */
        this.galaxyWarpManager = null;

        /** Currently inspected building (null when nothing is open) */
        this.exploded = null;

        /** Double-click detection via delayed single-click pattern */
        this._pendingClickTimer = null;
        this._pendingClickMesh = null;
        this._dblClickThreshold = 300; // ms

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

            // ── Check if a sub-spiral dot was clicked ──
            if (pick.pickedMesh._subSpiralDot) {
                this._cancelPendingClick();
                this._showDotInspector(pick.pickedMesh);
                return;
            }

            // ── Check if a galaxy building was clicked ──
            if (pick.pickedMesh._isGalaxyBuilding) {
                this._cancelPendingClick();
                this._showGalaxyBuildingInspector(pick.pickedMesh);
                return;
            }

            const buildingMesh = this._findBuildingMesh(pick.pickedMesh);
            if (!buildingMesh) return;

            // ── Delayed single-click / double-click detection ──
            // If we already have a pending click on the SAME mesh, this is
            // the second click → treat as double-click immediately.
            if (this._pendingClickMesh === buildingMesh && this._pendingClickTimer) {
                this._cancelPendingClick();

                // Collapse any open inspector first
                if (this.exploded) this._collapse();

                // Warp to galaxy if this building has child steps
                if (this.galaxyWarpManager && this.galaxyWarpManager.canWarp(buildingMesh)) {
                    this.galaxyWarpManager.warpTo(buildingMesh);
                    return;
                }
                // If it can't warp, fall through to single-click behaviour
                this._handleSingleClick(buildingMesh);
                return;
            }

            // Cancel any pending click on a different mesh
            this._cancelPendingClick();

            // Schedule a delayed single-click. If the user clicks again
            // before the timeout, the double-click branch above fires instead.
            this._pendingClickMesh = buildingMesh;
            this._pendingClickTimer = setTimeout(() => {
                this._pendingClickTimer = null;
                this._pendingClickMesh = null;
                this._handleSingleClick(buildingMesh);
            }, this._dblClickThreshold);
        });
    }

    /** Cancel any pending delayed single-click. */
    _cancelPendingClick() {
        if (this._pendingClickTimer) {
            clearTimeout(this._pendingClickTimer);
            this._pendingClickTimer = null;
        }
        this._pendingClickMesh = null;
    }

    /** Execute a single-click action on a building (open/close inspector). */
    _handleSingleClick(buildingMesh) {
        // Already inspecting this building → close
        if (this.exploded && this.exploded.mesh === buildingMesh) {
            this._collapse();
            return;
        }
        // Different building → close old, open new
        if (this.exploded) this._collapse();
        this._explode(buildingMesh);
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

        // Show the sub-spiral for this building
        if (this.cityRenderer) {
            this.cityRenderer.showSubSpiral(buildingMesh);
        }
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

    // ─── galaxy building inspector ────────────────────────────────

    /**
     * Show an inspector panel for a clicked galaxy building.
     * Reuses the dot inspector panel slot (secondary overlay).
     */
    _showGalaxyBuildingInspector(mesh) {
        this._closeDotInspector();

        const entity = mesh._entityData;
        if (!entity) return;

        // Reuse the consolidated-entity display from the dot inspector
        this._currentDotEntity = entity;

        const panel = document.createElement('div');
        panel.id = 'dotInspectorPanel';
        panel.className = 'inspector-panel dot-inspector';

        let html = `<button class="inspector-close">✕</button>`;
        html += this._buildGalaxyBuildingInspectorHTML(entity);
        panel.innerHTML = html;

        document.body.appendChild(panel);
        requestAnimationFrame(() => panel.classList.add('open'));

        panel.querySelector('.inspector-close').addEventListener('click', () => {
            this._closeDotInspector();
        });

        this._dotPanel = panel;

        // Brief highlight pulse
        if (!mesh.isDisposed()) {
            const origScale = mesh.scaling.clone();
            mesh.scaling = new BABYLON.Vector3(1.15, 1.15, 1.15);
            setTimeout(() => {
                if (mesh && !mesh.isDisposed()) mesh.scaling.copyFrom(origScale);
            }, 250);
        }
    }

    _buildGalaxyBuildingInspectorHTML(entity) {
        let h = '';

        // ── Variable entity ──
        if (entity.type === 'variable') {
            h += `<div class="inspector-header var-header">
                <span class="inspector-icon">🏠</span>
                <span>${entity.subject || entity.label}</span>
            </div>`;
            h += `<div class="inspector-section">`;
            h += this._row('Type', 'Variable');
            h += this._row('Current value', `<strong>${entity.currentValue}</strong>`);
            if (entity.address) h += this._row('Address', entity.address);
            h += this._row('Assignments', entity.values ? entity.values.length : '—');
            h += `</div>`;

            if (entity.values && entity.values.length > 0) {
                h += `<div class="inspector-subtitle">Value History</div>`;
                h += `<div class="inspector-section inspector-history">`;
                entity.values.forEach((entry, i) => {
                    const isCurrent = (i === entity.values.length - 1);
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

        // ── Loop entity ──
        if (entity.type === 'loop') {
            h += `<div class="inspector-header loop-header">
                <span class="inspector-icon">🏭</span>
                <span>${entity.label || 'Loop'}</span>
            </div>`;
            h += `<div class="inspector-section">`;
            h += this._row('Type', `${(entity.subtype || 'loop').toUpperCase()} Loop`);
            h += this._row('Condition', `<code>${entity.condition || '—'}</code>`);
            h += this._row('Iterations', entity.iterations || '—');
            h += this._row('Running', entity.running ? '🔄 yes' : '⏹ no');
            h += `</div>`;

            if (entity.stepIndices && entity.stepIndices.length > 0) {
                h += `<div class="inspector-subtitle">Iteration Steps</div>`;
                h += `<div class="inspector-section inspector-history">`;
                entity.stepIndices.forEach((s, i) => {
                    const isLast = (i === entity.stepIndices.length - 1);
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

        // ── Call / Return entity ──
        if (entity.type === 'call' || entity.type === 'return') {
            const icon = entity.type === 'call' ? '🏛️' : '↩️';
            h += `<div class="inspector-header fn-header">
                <span class="inspector-icon">${icon}</span>
                <span>${entity.label || entity.type.toUpperCase()}</span>
            </div>`;
            h += `<div class="inspector-section">`;
            h += this._row('Type', entity.type === 'call' ? 'Function Call' : 'Return');
            if (entity.firstStep) {
                const step = entity.firstStep;
                if (step.name)    h += this._row('Name', step.name);
                if (step.subject) h += this._row('Subject', step.subject);
                if (step.value !== undefined && step.value !== null)
                    h += this._row('Value', `<strong>${step.value}</strong>`);
                if (step.stack_depth !== undefined)
                    h += this._row('Stack Depth', step.stack_depth);
                if (step.line_number)
                    h += this._row('Line', step.line_number);
            }
            h += `</div>`;
            return h;
        }

        // ── Condition / Branch entity ──
        if (entity.type === 'condition' || entity.type === 'branch') {
            h += `<div class="inspector-header cond-header">
                <span class="inspector-icon">🔀</span>
                <span>${entity.label || 'Condition'}</span>
            </div>`;
            h += `<div class="inspector-section">`;
            h += this._row('Type', 'Branch / Condition');
            if (entity.firstStep) {
                const step = entity.firstStep;
                if (step.condition) h += this._row('Condition', `<code>${step.condition}</code>`);
                if (step.condition_result !== undefined)
                    h += this._row('Result', step.condition_result
                        ? '<span class="val-true">TRUE</span>'
                        : '<span class="val-false">FALSE</span>');
                if (step.subtype)
                    h += this._row('Branch', step.subtype);
            }
            h += `</div>`;
            return h;
        }

        // ── Generic fallback ──
        const icon = this._iconForType((entity.colorType || entity.type || '').toUpperCase());
        h += `<div class="inspector-header dot-header">
            <span class="inspector-icon">${icon}</span>
            <span>${entity.label || entity.type || 'Entity'}</span>
        </div>`;
        h += `<div class="inspector-section">`;
        h += this._row('Type', entity.type || '—');
        if (entity.firstStep) {
            const step = entity.firstStep;
            if (step.subject)     h += this._row('Subject', step.subject);
            if (step.name)        h += this._row('Name', step.name);
            if (step.value !== undefined && step.value !== null)
                h += this._row('Value', `<strong>${step.value}</strong>`);
            if (step.line_number) h += this._row('Line', step.line_number);
        }
        if (entity.stepIndices)
            h += this._row('Steps', entity.stepIndices.length);
        h += `</div>`;
        return h;
    }

    // ─── sub-spiral dot inspector ───────────────────────────────────

    /**
     * Show a small inspector panel for a clicked sub-spiral dot.
     * This doesn't collapse the parent building inspector — it overlays
     * a secondary panel with the trace-step data for that dot.
     */
    _showDotInspector(dotMesh) {
        // Remove any existing dot inspector
        this._closeDotInspector();

        const step = dotMesh._stepData;
        if (!step) return;

        // Store the consolidated entity so _buildDotInspectorHTML can use it
        this._currentDotEntity = dotMesh._entityData || null;

        const panel = document.createElement('div');
        panel.id = 'dotInspectorPanel';
        panel.className = 'inspector-panel dot-inspector';

        let html = `<button class="inspector-close">✕</button>`;
        html += this._buildDotInspectorHTML(step, dotMesh._stepIndex);
        panel.innerHTML = html;

        document.body.appendChild(panel);
        requestAnimationFrame(() => panel.classList.add('open'));

        panel.querySelector('.inspector-close').addEventListener('click', () => {
            this._closeDotInspector();
        });

        this._dotPanel = panel;

        // Briefly highlight the clicked dot
        const origScale = dotMesh.scaling.clone();
        dotMesh.scaling = new BABYLON.Vector3(1.4, 1.4, 1.4);
        setTimeout(() => {
            if (dotMesh && !dotMesh.isDisposed()) dotMesh.scaling.copyFrom(origScale);
        }, 300);
    }

    _closeDotInspector() {
        if (this._dotPanel) {
            this._dotPanel.classList.remove('open');
            const p = this._dotPanel;
            setTimeout(() => { if (p.parentNode) p.parentNode.removeChild(p); }, 300);
            this._dotPanel = null;
        }
    }

    _buildDotInspectorHTML(step, stepIndex) {
        // If the dot has a consolidated entity, use it for richer display
        const entity = this._currentDotEntity;

        let h = '';
        const icon = this._iconForType(step.type);

        // ── Variable entity (consolidated DECL + ASSIGNs) ──
        if (entity && entity.type === 'variable') {
            h += `<div class="inspector-header var-header">
                <span class="inspector-icon">🏠</span>
                <span>${entity.subject}</span>
            </div>`;
            h += `<div class="inspector-section">`;
            h += this._row('Type', 'Variable');
            h += this._row('Current value', `<strong>${entity.currentValue}</strong>`);
            if (entity.address) h += this._row('Address', entity.address);
            h += this._row('Assignments', entity.values.length);
            h += `</div>`;

            if (entity.values.length > 0) {
                h += `<div class="inspector-subtitle">Value History</div>`;
                h += `<div class="inspector-section inspector-history">`;
                entity.values.forEach((entry, i) => {
                    const isCurrent = (i === entity.values.length - 1);
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

        // ── Loop entity (consolidated iterations) ──
        if (entity && entity.type === 'loop') {
            h += `<div class="inspector-header loop-header">
                <span class="inspector-icon">🏭</span>
                <span>${entity.label}</span>
            </div>`;
            h += `<div class="inspector-section">`;
            h += this._row('Type', `${(entity.subtype || 'loop').toUpperCase()} Loop`);
            h += this._row('Condition', `<code>${entity.condition || '—'}</code>`);
            h += this._row('Iterations', entity.iterations);
            h += this._row('Running', entity.running ? '🔄 yes' : '⏹ no');
            h += `</div>`;

            if (entity.stepIndices.length > 0) {
                h += `<div class="inspector-subtitle">Iteration Steps</div>`;
                h += `<div class="inspector-section inspector-history">`;
                entity.stepIndices.forEach((s, i) => {
                    const isLast = (i === entity.stepIndices.length - 1);
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

        // ── Default: single-event display ──
        h += `<div class="inspector-header dot-header">
            <span class="inspector-icon">${icon}</span>
            <span>${step.type}</span>
        </div>`;
        h += `<div class="inspector-section">`;
        h += this._row('Event Type', step.type);
        h += this._row('Trace Step', stepIndex !== undefined ? stepIndex : '—');
        if (step.subject)     h += this._row('Subject', step.subject);
        if (step.name)        h += this._row('Name', step.name);
        if (step.value !== undefined && step.value !== null)
            h += this._row('Value', `<strong>${step.value}</strong>`);
        if (step.address)     h += this._row('Address', step.address);
        if (step.line_number) h += this._row('Line', step.line_number);
        if (step.stack_depth !== undefined)
            h += this._row('Stack Depth', step.stack_depth);
        if (step.condition)   h += this._row('Condition', `<code>${step.condition}</code>`);
        if (step.condition_result !== undefined)
            h += this._row('Result', step.condition_result ? '<span class="val-true">TRUE</span>' : '<span class="val-false">FALSE</span>');
        if (step.subtype)     h += this._row('Subtype', step.subtype);
        h += `</div>`;
        return h;
    }

    _iconForType(type) {
        switch (type) {
            case 'CALL':      return '🏛️';
            case 'RETURN':    return '↩️';
            case 'DECL':      return '🏠';
            case 'ASSIGN':    return '📝';
            case 'LOOP':      return '🏭';
            case 'CONDITION': return '🔀';
            case 'BRANCH':    return '🔀';
            default:          return '📌';
        }
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

        // Also close any dot inspector
        this._closeDotInspector();

        // Hide the sub-spiral for this building
        if (this.cityRenderer) {
            this.cityRenderer.hideSubSpiral(mesh);
        }

        this.exploded = null;
    }
}
