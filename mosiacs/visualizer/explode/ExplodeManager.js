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

        /** Callback when a node is selected: (lineNumber) => void */
        this.onNodeSelect = null;

        /** Double-click detection via delayed single-click pattern */
        this._pendingClickTimer = null;
        this._pendingClickMesh = null;
        this._dblClickThreshold = 350; // ms (slightly generous for reliability)
        this._lastClickTime = 0;
        this._lastClickMesh = null;

        /** Navigation history for 'a' and 'd' keys */
        this._lastNavigatedMesh = null;

        this._setupPointerObservable();
        this._setupNavigationKeys();
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

            const now = Date.now();

            // ── Check if a sub-spiral dot was clicked ──
            if (pick.pickedMesh._subSpiralDot) {
                this._cancelPendingClick();
                this._showDotInspector(pick.pickedMesh);
                return;
            }

            // ── Phase 4: Check if a bubble node was clicked ──
            if (pick.pickedMesh._isBubbleNode) {
                this._cancelPendingClick();
                this._showBubbleNodeInspector(pick.pickedMesh);
                return;
            }

            // ── Check if a galaxy building was clicked ──
            if (pick.pickedMesh._isGalaxyBuilding) {
                const galaxyMesh = pick.pickedMesh;

                // Double-click detection: check if we clicked the same mesh recently
                const isDoubleClick = (
                    this._lastClickMesh === galaxyMesh &&
                    (now - this._lastClickTime) < this._dblClickThreshold
                );

                this._lastClickTime = now;
                this._lastClickMesh = galaxyMesh;

                if (isDoubleClick) {
                    this._cancelPendingClick();
                    this._closeDotInspector();

                    // Warp deeper if this galaxy building has children
                    if (this.galaxyWarpManager && this.galaxyWarpManager.canWarp(galaxyMesh)) {
                        this.galaxyWarpManager.warpTo(galaxyMesh);
                        return;
                    }
                    // Otherwise fall through to single-click (inspector)
                    this._showGalaxyBuildingInspector(galaxyMesh);
                    return;
                }

                // Schedule delayed single-click
                this._cancelPendingClick();
                this._pendingClickMesh = galaxyMesh;
                this._pendingClickTimer = setTimeout(() => {
                    this._pendingClickTimer = null;
                    this._pendingClickMesh = null;
                    this._showGalaxyBuildingInspector(galaxyMesh);
                }, this._dblClickThreshold);
                return;
            }

            const buildingMesh = this._findBuildingMesh(pick.pickedMesh);
            if (!buildingMesh) return;

            // ── Double-click detection using timestamps ──
            const isDoubleClick = (
                this._lastClickMesh === buildingMesh &&
                (now - this._lastClickTime) < this._dblClickThreshold
            );

            this._lastClickTime = now;
            this._lastClickMesh = buildingMesh;

            if (isDoubleClick) {
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

    // ─── sequential node navigation (a/d keys) ───────────────────

    _setupNavigationKeys() {
        window.addEventListener('keydown', (e) => {
            // Don't interfere if user is typing in an input field
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;

            if (e.key === 'a' || e.key === 'A') {
                e.preventDefault();
                this._navigateSequential(-1);
            } else if (e.key === 'd' || e.key === 'D') {
                e.preventDefault();
                this._navigateSequential(+1);
            }
        });
    }

    /**
     * Get an ordered list of all navigable meshes in the current context.
     *
     * If we're inside a galaxy warp, return that galaxy's building meshes.
     * Otherwise, return the main spiral's building meshes sorted by slot.
     *
     * Each entry is { mesh, type } where type is 'building', 'galaxy', or 'bubble'.
     */
    _getOrderedNodes() {
        const nodes = [];

        // ── Inside a galaxy warp? ──
        if (this.galaxyWarpManager && this.galaxyWarpManager.isWarped()) {
            const galaxy = this.galaxyWarpManager.warpedGalaxy;
            if (galaxy) {
                if (galaxy.isBubble && galaxy.galaxyData && galaxy.galaxyData.bubbleData) {
                    // Bubble nodes from a for-loop galaxy
                    const bubbleData = galaxy.galaxyData.bubbleData;
                    if (bubbleData.nodes) {
                        for (const n of bubbleData.nodes) {
                            if (n.mesh && !n.mesh.isDisposed() && n.mesh._isBubbleNode) {
                                nodes.push({ mesh: n.mesh, type: 'bubble' });
                            }
                        }
                    }
                } else if (galaxy.galaxyData && galaxy.galaxyData.meshes) {
                    // Galaxy spiral buildings
                    for (const m of galaxy.galaxyData.meshes) {
                        if (m && !m.isDisposed() && m._isGalaxyBuilding) {
                            nodes.push({ mesh: m, type: 'galaxy' });
                        }
                    }
                }
            }
            return nodes;
        }

        // ── Main spiral: collect from all mesh caches ──
        if (!this.cityRenderer) return nodes;

        const caches = [
            this.cityRenderer.functionMeshes,
            this.cityRenderer.variableMeshes,
            this.cityRenderer.loopMeshes,
            this.cityRenderer.whileMeshes,
            this.cityRenderer.branchMeshes,
        ];

        const unsorted = [];
        for (const cache of caches) {
            if (!cache) continue;
            for (const [key, entry] of cache) {
                if (!entry.mesh || entry.mesh.isDisposed()) continue;
                const slot = this.cityRenderer._slotMap
                    ? this.cityRenderer._slotMap.get(key)
                    : undefined;
                unsorted.push({ mesh: entry.mesh, type: 'building', slot: slot ?? Infinity });
            }
        }

        // Sort by spiral slot so navigation follows the spiral path
        unsorted.sort((a, b) => a.slot - b.slot);
        for (const item of unsorted) {
            nodes.push({ mesh: item.mesh, type: item.type });
        }

        return nodes;
    }

    /**
     * Find the currently active mesh — whatever is being inspected right now.
     */
    _getCurrentMesh() {
        // Dot / galaxy / bubble inspector takes priority (secondary overlay)
        if (this._dotPanel) {
            // The dot panel can be for a dot, galaxy building, or bubble node.
            // Check what we last opened:
            if (this._lastNavigatedMesh && !this._lastNavigatedMesh.isDisposed()) {
                return this._lastNavigatedMesh;
            }
        }
        // Primary building inspector
        if (this.exploded && this.exploded.mesh && !this.exploded.mesh.isDisposed()) {
            return this.exploded.mesh;
        }
        return null;
    }

    /**
     * Step forward (+1) or backward (-1) through the ordered node list.
     */
    _navigateSequential(direction) {
        const nodes = this._getOrderedNodes();
        if (nodes.length === 0) return;

        const currentMesh = this._getCurrentMesh();

        let currentIdx = -1;
        if (currentMesh) {
            currentIdx = nodes.findIndex(n => n.mesh === currentMesh);
        }

        let nextIdx;
        if (currentIdx === -1) {
            // Nothing selected yet — pick first (d) or last (a) node
            nextIdx = direction > 0 ? 0 : nodes.length - 1;
        } else {
            nextIdx = currentIdx + direction;
            // Wrap around
            if (nextIdx < 0) nextIdx = nodes.length - 1;
            if (nextIdx >= nodes.length) nextIdx = 0;
        }

        const target = nodes[nextIdx];
        if (!target || !target.mesh || target.mesh.isDisposed()) return;

        // Close whatever is open
        if (this.exploded) this._collapse();
        this._closeDotInspector();

        // Open the correct inspector for this node type
        switch (target.type) {
            case 'building':
                this._explode(target.mesh, false);
                break;
            case 'galaxy':
                this._showGalaxyBuildingInspector(target.mesh, false);
                break;
            case 'bubble':
                this._showBubbleNodeInspector(target.mesh, false);
                break;
        }

        // Track so we can find it next time
        this._lastNavigatedMesh = target.mesh;
    }

    // ─── click detection ────────────────────────────────────────────

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
        let depth = 0;
        while (cur && depth < 10) {
            if (cur._buildingData) return cur;
            if (cur.name && cur.name.startsWith('building_')) return cur;
            cur = cur.parent;
            depth++;
        }
        return null;
    }

    // ─── explode (open inspector) ───────────────────────────────────

    _explode(buildingMesh, fromNavigation = false) {
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

        // Track as the last navigated mesh for a/d key navigation
        this._lastNavigatedMesh = buildingMesh;

        // Highlight the source line for this node
        if (this.onNodeSelect) {
            this.onNodeSelect(this._getLineForBuilding(buildingMesh));
        }

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
    _showGalaxyBuildingInspector(mesh, fromNavigation = false) {
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

        // Track as the last navigated mesh for a/d key navigation
        this._lastNavigatedMesh = mesh;

        // Highlight source line if available
        if (this.onNodeSelect) {
            const line = this._getLineForEntity(entity);
            this.onNodeSelect(line);
        }

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
                if (step.value !== undefined && step.value !== null)
                    h += this._row('Value', `<strong>${step.value}</strong>`);
                if (step.depth !== undefined)
                    h += this._row('Stack Depth', step.depth);
                if (step.line)
                    h += this._row('Line', step.line);
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
                if (step.conditionResult !== undefined)
                    h += this._row('Result', step.conditionResult
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
            if (step.name)        h += this._row('Name', step.name);
            if (step.value !== undefined && step.value !== null)
                h += this._row('Value', `<strong>${step.value}</strong>`);
            if (step.line)        h += this._row('Line', step.line);
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
    _showDotInspector(dotMesh, fromNavigation = false) {
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

        // Track as the last navigated mesh for a/d key navigation
        this._lastNavigatedMesh = dotMesh;

        // Highlight source line for this step
        if (this.onNodeSelect) {
            const line = step.line || this._getLineForEntity(dotMesh._entityData);
            this.onNodeSelect(line);
        }

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
        // Restore highlight to the parent building's line (if one is open)
        if (this.onNodeSelect) {
            if (this.exploded && this.exploded.mesh) {
                this.onNodeSelect(this._getLineForBuilding(this.exploded.mesh));
            } else {
                this.onNodeSelect(null);
            }
        }
    }

    // ─── Phase 4: Bubble Node Inspector ────────────────────────────

    _showBubbleNodeInspector(nodeMesh, fromNavigation = false) {
        // Remove any existing inspector
        this._closeDotInspector();

        const nodeData = nodeMesh._bubbleNodeData;
        if (!nodeData) return;

        const step = nodeData.stepData;
        if (!step) return;

        const panel = document.createElement('div');
        panel.id = 'dotInspectorPanel';
        panel.className = 'inspector-panel dot-inspector bubble-node-inspector';

        let html = `<button class="inspector-close">✕</button>`;
        html += this._buildBubbleNodeHTML(step, nodeData);
        panel.innerHTML = html;

        document.body.appendChild(panel);
        requestAnimationFrame(() => panel.classList.add('open'));

        panel.querySelector('.inspector-close').addEventListener('click', () => {
            this._closeDotInspector();
        });

        this._dotPanel = panel;

        // Track as the last navigated mesh for a/d key navigation
        this._lastNavigatedMesh = nodeMesh;

        // Highlight source line for this step
        if (this.onNodeSelect && step.line) {
            this.onNodeSelect(step.line);
        }

        // Briefly highlight the clicked node
        const origScale = nodeMesh.scaling.clone();
        nodeMesh.scaling = new BABYLON.Vector3(1.4, 1.4, 1.4);
        setTimeout(() => {
            if (nodeMesh && !nodeMesh.isDisposed()) nodeMesh.scaling.copyFrom(origScale);
        }, 300);
    }

    _buildBubbleNodeHTML(step, nodeData) {
        let h = '';
        const entity = nodeData.entity;
        const icon = this._iconForType(entity ? entity.type : (step.type || nodeData.type));

        // Use entity label (variable name, function name, etc.) as the header
        const headerText = entity ? (entity.label || entity.subject || entity.type) : (step.name || step.var || step.type || nodeData.type);

        h += `<div class="inspector-header">
            <span class="inspector-icon">${icon}</span>
            <span>${headerText}</span>
        </div>`;

        h += `<div class="inspector-section">`;

        // Entity-based rendering (consolidated buildings)
        if (entity) {
            switch (entity.type) {
                case 'variable':
                    h += this._row('Variable', `<strong>${entity.label || '?'}</strong>`);
                    h += this._row('Current value', `<code>${entity.currentValue}</code>`);
                    if (entity.address) h += this._row('Address', entity.address);
                    h += this._row('Assignments', entity.values.length);
                    
                    if (entity.values.length > 1) {
                        h += `</div>`;
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
                    }
                    break;

                case 'call':
                    h += this._row('Function', `<strong>${entity.name || '?'}</strong>`);
                    if (entity.firstStep && entity.firstStep.line) h += this._row('Line', entity.firstStep.line);
                    break;

                case 'return':
                    if (entity.value !== undefined) {
                        h += this._row('Return value', `<code>${entity.value}</code>`);
                    }
                    if (entity.firstStep && entity.firstStep.line) h += this._row('Line', entity.firstStep.line);
                    break;

                case 'condition':
                    h += this._row('Condition', `<code>${entity.condition || '?'}</code>`);
                    h += this._row('Result', entity.result ? '✓ True' : '✗ False');
                    if (entity.firstStep && entity.firstStep.line) h += this._row('Line', entity.firstStep.line);
                    break;

                case 'branch':
                    h += this._row('Branch', `<strong>${entity.branch || '?'}</strong>`);
                    if (entity.firstStep && entity.firstStep.line) h += this._row('Line', entity.firstStep.line);
                    break;

                case 'loop':
                    if (entity.condition) h += this._row('Condition', `<code>${entity.condition}</code>`);
                    if (entity.subtype) h += this._row('Type', entity.subtype);
                    h += this._row('Iterations', entity.iterations);
                    if (entity.firstStep && entity.firstStep.line) h += this._row('Line', entity.firstStep.line);
                    break;

                default:
                    if (entity.label) h += this._row('Label', entity.label);
                    if (entity.firstStep && entity.firstStep.line) h += this._row('Line', entity.firstStep.line);
            }
        } else {
            // Fallback to raw step data if no entity
            // Type-specific rendering
            switch (step.type || nodeData.type) {
                case 'DECL':
                    h += this._row('Variable', `<strong>${step.var || '?'}</strong>`);
                    if (step.address) h += this._row('Address', step.address);
                    if (step.line) h += this._row('Line', step.line);
                    break;

                case 'ASSIGN':
                    h += this._row('Variable', `<strong>${step.var || '?'}</strong>`);
                    h += this._row('Value', `<code>${step.value || '?'}</code>`);
                    if (step.line) h += this._row('Line', step.line);
                    break;

                case 'CALL':
                    h += this._row('Function', `<strong>${step.name || '?'}</strong>`);
                    if (step.line) h += this._row('Line', step.line);
                    break;

                case 'RETURN':
                    if (step.value !== undefined) {
                        h += this._row('Return value', `<code>${step.value}</code>`);
                    }
                    if (step.line) h += this._row('Line', step.line);
                    break;

                case 'CONDITION':
                    h += this._row('Condition', `<code>${step.condition || '?'}</code>`);
                    h += this._row('Result', step.result ? '✓ True' : '✗ False');
                    if (step.line) h += this._row('Line', step.line);
                    break;

                case 'BRANCH':
                    h += this._row('Branch', `<strong>${step.branch || '?'}</strong>`);
                    if (step.line) h += this._row('Line', step.line);
                    break;

                case 'LOOP':
                    if (step.condition) h += this._row('Condition', `<code>${step.condition}</code>`);
                    if (step.subtype) h += this._row('Type', step.subtype);
                    if (step.line) h += this._row('Line', step.line);
                    break;

                default:
                    // Generic display
                    if (step.name) h += this._row('Name', step.name);
                    if (step.line) h += this._row('Line', step.line);
                    Object.keys(step).forEach(key => {
                        if (!['type', 'name', 'line'].includes(key)) {
                            h += this._row(key, JSON.stringify(step[key]));
                        }
                    });
            }
        }

        h += `</div>`;

        // Position in chain
        h += `<div class="inspector-subtitle">Node Position</div>`;
        h += `<div class="inspector-section">`;
        h += this._row('Index in loop', nodeData.index);
        h += this._row('Step', nodeData.step);
        h += `</div>`;

        return h;
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
                <span>${entity.subject || entity.label || 'Variable'}</span>
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
        if (step.name)        h += this._row('Name', step.name);
        if (step.value !== undefined && step.value !== null)
            h += this._row('Value', `<strong>${step.value}</strong>`);
        if (step.address)     h += this._row('Address', step.address);
        if (step.line)        h += this._row('Line', step.line);
        if (step.depth !== undefined)
            h += this._row('Stack Depth', step.depth);
        if (step.condition)   h += this._row('Condition', `<code>${step.condition}</code>`);
        if (step.conditionResult !== undefined)
            h += this._row('Result', step.conditionResult ? '<span class="val-true">TRUE</span>' : '<span class="val-false">FALSE</span>');
        if (step.subtype)     h += this._row('Subtype', step.subtype);
        h += `</div>`;
        return h;
    }

    /**
     * Get the best available source line for a building mesh.
     * Falls back through: stepData.line → trace step → first child with a line.
     */
    _getLineForBuilding(buildingMesh) {
        const bd = buildingMesh._buildingData;
        if (!bd) return 0;

        // 1. Direct line from stepData
        if (bd.stepData && bd.stepData.line) return bd.stepData.line;

        // 2. Look up the trace step at this building's step index
        if (this.cityRenderer && this.cityRenderer._lastTrace) {
            const trace = this.cityRenderer._lastTrace;
            const step = trace[bd.step];
            if (step && step.line) return step.line;
        }

        // 3. Try the first child step that has a line number
        const entity = buildingMesh._entityData;
        if (entity && entity.childStepIndices && this.cityRenderer && this.cityRenderer._lastTrace) {
            const trace = this.cityRenderer._lastTrace;
            for (const idx of entity.childStepIndices) {
                const childStep = trace[idx];
                if (childStep && childStep.line) return childStep.line;
            }
        }

        return 0;
    }

    /**
     * Get the best available source line for a consolidated entity
     * (used by galaxy buildings and dot inspector entities).
     */
    _getLineForEntity(entity) {
        if (!entity) return 0;

        // 1. Direct line on the entity
        if (entity.line) return entity.line;

        // 2. firstStep line
        if (entity.firstStep && entity.firstStep.line) return entity.firstStep.line;

        // 3. Search stepIndices in the trace for the first one with a line
        if (entity.stepIndices && this.cityRenderer && this.cityRenderer._lastTrace) {
            const trace = this.cityRenderer._lastTrace;
            for (const idx of entity.stepIndices) {
                const step = trace[idx];
                if (step && step.line) return step.line;
            }
        }

        return 0;
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

        // Clear code panel highlight
        if (this.onNodeSelect) this.onNodeSelect(null);

        // Also close any dot inspector
        this._closeDotInspector();

        // Hide the sub-spiral for this building
        if (this.cityRenderer) {
            this.cityRenderer.hideSubSpiral(mesh);
        }

        this.exploded = null;
    }
}
