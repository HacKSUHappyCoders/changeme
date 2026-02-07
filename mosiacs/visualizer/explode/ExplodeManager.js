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
        this.scene = scene;

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

        /** Navigation for 'a' and 'd' keys */
        this._lastNavigatedMesh = null;

        /** Selection ring indicator — a glowing torus under the active node */
        this._selectionRing = null;
        this._selectionRingAnim = null;
        this._createSelectionRing();

        this._setupPointerObservable();
        this._setupNavigationKeys();
    }

    // ─── selection ring indicator ───────────────────────────────────

    /**
     * Create the reusable selection ring mesh (hidden initially).
     */
    _createSelectionRing() {
        const ring = BABYLON.MeshBuilder.CreateTorus('selectionRing', {
            diameter: 4,
            thickness: 0.35,
            tessellation: 24
        }, this.scene);

        const mat = new BABYLON.StandardMaterial('selectionRingMat', this.scene);
        mat.emissiveColor = new BABYLON.Color3(0.2, 1.0, 1.0);
        mat.diffuseColor = new BABYLON.Color3(0.1, 0.7, 1.0);
        mat.specularColor = new BABYLON.Color3(0.3, 0.9, 1.0);
        mat.alpha = 0.95;
        mat.disableLighting = true;
        ring.material = mat;

        ring.isPickable = false;
        ring.setEnabled(false);

        // Gentle pulsing animation on alpha
        const pulseAnim = new BABYLON.Animation(
            'selRingPulse', 'material.alpha', 30,
            BABYLON.Animation.ANIMATIONTYPE_FLOAT,
            BABYLON.Animation.ANIMATIONLOOPMODE_CYCLE
        );
        pulseAnim.setKeys([
            { frame: 0, value: 0.95 },
            { frame: 30, value: 0.65 },
            { frame: 60, value: 0.95 }
        ]);
        ring.animations = [pulseAnim];
        this._selectionRingAnim = this.scene.beginAnimation(ring, 0, 60, true);
        this._selectionRingAnim.pause();

        this._selectionRing = ring;

        // ── Camera-distance-based scaling ──
        // Store the base scale set by _showSelectionRing so we can multiply
        // by a camera-distance factor each frame.
        this._selectionRingBaseScale = 1;
        this._selectionRingTargetMesh = null;

        this.scene.onBeforeRenderObservable.add(() => {
            if (!this._selectionRing || !this._selectionRing.isEnabled()) return;

            const camera = this.scene.activeCamera;
            if (!camera) return;

            // Camera distance from the ring position
            const camDist = BABYLON.Vector3.Distance(
                camera.position, this._selectionRing.position
            );

            // Scale factor: at distance ≤ 20 use 1×, then grow gently beyond that.
            // The 0.25 multiplier keeps the ring from getting too large when zoomed out
            // while still being clearly visible.
            const minDist = 20;
            const distFactor = 1 + Math.max(0, (camDist - minDist) / minDist) * 0.25;

            const s = this._selectionRingBaseScale * distFactor;
            this._selectionRing.scaling.set(s, distFactor, s);
        });
    }

    /**
     * Move the selection ring underneath the given mesh and make it visible.
     * Automatically scales the ring to fit the building's footprint.
     */
    _showSelectionRing(mesh) {
        if (!this._selectionRing || !mesh || mesh.isDisposed()) {
            this._hideSelectionRing();
            return;
        }

        // Compute a bounding-based diameter
        mesh.computeWorldMatrix(true);
        const bounds = mesh.getBoundingInfo();
        const extents = bounds.boundingBox.extendSizeWorld;
        // Use the XZ footprint to size the ring
        const footprint = Math.max(extents.x, extents.z) * 2;
        const ringDiameter = Math.max(footprint + 1.2, 2.5);

        // Scale the torus uniformly — it was created with diameter=4
        const scale = ringDiameter / 4;
        this._selectionRingBaseScale = scale;
        this._selectionRingTargetMesh = mesh;
        this._selectionRing.scaling.set(scale, 1, scale);

        // Position under the mesh (at its base Y)
        const pos = mesh.getAbsolutePosition();
        const baseY = pos.y - extents.y;
        this._selectionRing.position.set(pos.x, baseY + 0.05, pos.z);

        this._selectionRing.setEnabled(true);
        if (this._selectionRingAnim) this._selectionRingAnim.restart();
    }

    /**
     * Hide the selection ring.
     */
    _hideSelectionRing() {
        if (!this._selectionRing) return;
        this._selectionRing.setEnabled(false);
        if (this._selectionRingAnim) this._selectionRingAnim.pause();
    }

    /**
     * Set the currently active/selected mesh and show the ring on it.
     * Use this instead of assigning _lastNavigatedMesh directly.
     */
    _setActiveMesh(mesh) {
        this._lastNavigatedMesh = mesh;
        if (mesh && !mesh.isDisposed()) {
            this._showSelectionRing(mesh);
        } else {
            this._hideSelectionRing();
        }
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

    // ─── sequential node navigation (a/d/w/s keys) ────────────────

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
            } else if (e.key === 'w' || e.key === 'W') {
                e.preventDefault();
                this._navigateWarpIn();
            } else if (e.key === 's' || e.key === 'S') {
                e.preventDefault();
                this._navigateWarpOut();
            }
        });
    }

    /**
     * Get an ordered list of all navigable meshes at the CURRENT level.
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
                    const bubbleData = galaxy.galaxyData.bubbleData;
                    if (bubbleData.nodes) {
                        for (const n of bubbleData.nodes) {
                            if (n.mesh && !n.mesh.isDisposed() && n.mesh._isBubbleNode) {
                                nodes.push({ mesh: n.mesh, type: 'bubble' });
                            }
                        }
                    }
                } else if (galaxy.isTree && galaxy.galaxyData && galaxy.galaxyData.meshes) {
                    // Phase 4: Tree nodes for if-statements
                    for (const m of galaxy.galaxyData.meshes) {
                        if (m && !m.isDisposed() && m._isTreeNode) {
                            nodes.push({ mesh: m, type: 'tree' });
                        }
                    }
                } else if (galaxy.galaxyData && galaxy.galaxyData.meshes) {
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
            this.cityRenderer.blackHoleMeshes,
            this.cityRenderer.consoleBubbles,
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
        if (this._lastNavigatedMesh && !this._lastNavigatedMesh.isDisposed()) {
            return this._lastNavigatedMesh;
        }
        if (this._dotPanel) {
            if (this._lastNavigatedMesh && !this._lastNavigatedMesh.isDisposed()) {
                return this._lastNavigatedMesh;
            }
        }
        if (this.exploded && this.exploded.mesh && !this.exploded.mesh.isDisposed()) {
            return this.exploded.mesh;
        }
        return null;
    }

    /**
     * Check whether a mesh can be warped into (has children in a sub-galaxy).
     */
    _canWarpInto(mesh) {
        return this.galaxyWarpManager && this.galaxyWarpManager.canWarp(mesh);
    }

    /**
     * Warp into a building's sub-galaxy and select its first or last child.
     * @param {BABYLON.AbstractMesh} mesh  – the parent building to warp into
     * @param {number} direction           – +1 selects first child, -1 selects last
     */
    _warpIntoAndSelect(mesh, direction) {
        // Close inspectors before warping
        if (this.exploded) this._collapse();
        this._closeDotInspector();

        // Perform the warp
        this.galaxyWarpManager.warpTo(mesh);

        // After warping, get the new child nodes
        const childNodes = this._getOrderedNodes();
        if (childNodes.length === 0) return;

        const target = direction > 0 ? childNodes[0] : childNodes[childNodes.length - 1];
        if (!target || !target.mesh || target.mesh.isDisposed()) return;

        this._openInspectorForNode(target);
        this._setActiveMesh(target.mesh);
    }

    /**
     * Warp back out to the parent level and select the parent building.
     * If we came from the main spiral, select the parent on the main spiral.
     * If we came from a parent galaxy, select the parent in that galaxy.
     */
    _warpOutAndSelect() {
        if (!this.galaxyWarpManager || !this.galaxyWarpManager.isWarped()) return;

        // Remember the parent building that spawned this galaxy
        const parentMesh = this.galaxyWarpManager.warpedGalaxy.buildingMesh;

        // Close inspectors before returning
        if (this.exploded) this._collapse();
        this._closeDotInspector();

        // Return one level
        this.galaxyWarpManager.returnToMainGalaxy(true);

        // Now select the parent building in whatever level we're on
        if (parentMesh && !parentMesh.isDisposed()) {
            // Determine the type of the parent mesh at the new level
            const nodes = this._getOrderedNodes();
            const parentNode = nodes.find(n => n.mesh === parentMesh);
            if (parentNode) {
                this._openInspectorForNode(parentNode);
            } else {
                // If we can't find it in the ordered list, open it as a building
                this._explode(parentMesh, true);
            }
            this._setActiveMesh(parentMesh);
        }
    }

    /**
     * Open the correct inspector for a given node entry.
     */
    _openInspectorForNode(node) {
        switch (node.type) {
            case 'building':
                this._explode(node.mesh, true);
                break;
            case 'galaxy':
                this._showGalaxyBuildingInspector(node.mesh, true);
                break;
            case 'bubble':
                this._showBubbleNodeInspector(node.mesh, true);
                break;
        }
    }

    /**
     * Step forward (+1) or backward (-1) through the ordered node list.
     *
     * Cross-level traversal:
     *   – Going forward ('d') past the last node of a sub-galaxy warps back
     *     out and selects the NEXT sibling after the parent on the parent level.
     *   – Going forward on a warpable building warps INTO it and selects
     *     the first child.
     *   – Going backward ('a') past the first node of a sub-galaxy warps
     *     back out and selects the parent building.
     *   – Going backward on a warpable building warps INTO it and selects
     *     the last child.
     */
    _navigateSequential(direction) {
        const nodes = this._getOrderedNodes();
        if (nodes.length === 0) {
            // No nodes at this level — try to warp out
            if (this.galaxyWarpManager && this.galaxyWarpManager.isWarped()) {
                this._warpOutAndSelect();
            }
            return;
        }

        const currentMesh = this._getCurrentMesh();

        let currentIdx = -1;
        if (currentMesh) {
            currentIdx = nodes.findIndex(n => n.mesh === currentMesh);
        }

        // ── Nothing selected yet: pick first or last ──
        if (currentIdx === -1) {
            // Close whatever might be open
            if (this.exploded) this._collapse();
            this._closeDotInspector();

            const target = direction > 0 ? nodes[0] : nodes[nodes.length - 1];
            if (!target || !target.mesh || target.mesh.isDisposed()) return;
            this._openInspectorForNode(target);
            this._setActiveMesh(target.mesh);
            return;
        }

        const nextIdx = currentIdx + direction;

        // ── Going past the beginning (a at first node) ──
        if (nextIdx < 0) {
            if (this.galaxyWarpManager && this.galaxyWarpManager.isWarped()) {
                // Warp out to parent level, selecting the parent building
                this._warpOutAndSelect();
            }
            // On the main spiral with no parent — do nothing (already at start)
            return;
        }

        // ── Going past the end (d at last node) ──
        if (nextIdx >= nodes.length) {
            if (this.galaxyWarpManager && this.galaxyWarpManager.isWarped()) {
                // Warp out and select the next sibling AFTER the parent
                this._warpOutAndSelectNext();
            }
            // On the main spiral with no further — do nothing (already at end)
            return;
        }

        // ── Normal step within this level ──
        const target = nodes[nextIdx];
        if (!target || !target.mesh || target.mesh.isDisposed()) return;

        // Close whatever is open
        if (this.exploded) this._collapse();
        this._closeDotInspector();

        this._openInspectorForNode(target);
        this._setActiveMesh(target.mesh);
    }

    /**
     * Warp out from a sub-galaxy and select the next sibling AFTER the
     * parent building on the parent level (used when pressing 'd' past
     * the last child in a sub-galaxy).
     */
    _warpOutAndSelectNext() {
        if (!this.galaxyWarpManager || !this.galaxyWarpManager.isWarped()) return;

        const parentMesh = this.galaxyWarpManager.warpedGalaxy.buildingMesh;

        // Close inspectors
        if (this.exploded) this._collapse();
        this._closeDotInspector();

        // Return one level
        this.galaxyWarpManager.returnToMainGalaxy(true);

        if (!parentMesh || parentMesh.isDisposed()) return;

        // Find the parent in the new level's ordered list
        const nodes = this._getOrderedNodes();
        const parentIdx = nodes.findIndex(n => n.mesh === parentMesh);

        if (parentIdx !== -1 && parentIdx + 1 < nodes.length) {
            // Select the next sibling after the parent
            const nextSibling = nodes[parentIdx + 1];
            if (nextSibling && nextSibling.mesh && !nextSibling.mesh.isDisposed()) {
                this._openInspectorForNode(nextSibling);
                this._setActiveMesh(nextSibling.mesh);
                return;
            }
        }

        // If parent was the last node, just select the parent
        if (parentIdx !== -1) {
            this._openInspectorForNode(nodes[parentIdx]);
            this._setActiveMesh(parentMesh);
        }
    }

    /**
     * 'w' key — warp INTO the currently selected building (descend one level).
     * The building must be warpable (has child steps).
     */
    _navigateWarpIn() {
        const currentMesh = this._getCurrentMesh();
        if (!currentMesh) return;

        if (this._canWarpInto(currentMesh)) {
            this._warpIntoAndSelect(currentMesh, +1);
        }
    }

    /**
     * 's' key — warp OUT from the current sub-galaxy back to the parent level.
     */
    _navigateWarpOut() {
        if (this.galaxyWarpManager && this.galaxyWarpManager.isWarped()) {
            this._warpOutAndSelect();
        }
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
        makeDraggable(panel, panel.querySelector('.inspector-header'));

        // Animate in
        requestAnimationFrame(() => panel.classList.add('open'));

        // Close button
        panel.querySelector('.inspector-close').addEventListener('click', () => {
            this._collapse();
        });

        this.exploded = { mesh: buildingMesh, buildingData: bd, panel };

        // Track as the last navigated mesh for a/d key navigation
        this._setActiveMesh(buildingMesh);

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

    /**
     * Generate error banner HTML if this building is at/after error line or is the last step for runtime errors
     */
    _getErrorBanner(entity) {
        if (!this.cityRenderer || !this.cityRenderer._error) return '';
        const error = this.cityRenderer._error;

        // Runtime error without line number - check if this is the last step
        if (!error.line && error.stage === 'runtime') {
            if (this.cityRenderer._isLastStep(entity)) {
                return `<div style="background: linear-gradient(135deg, rgba(139, 0, 0, 0.9) 0%, rgba(220, 20, 60, 0.9) 100%);
                             padding: 12px; margin: 10px; border-radius: 6px; border: 2px solid rgba(255, 69, 0, 0.8);">
                    <div style="font-weight: bold; margin-bottom: 6px;">LAST STEP BEFORE CRASH</div>
                    <div style="font-size: 11px; opacity: 0.9;">Stage: ${error.stage}</div>
                    <div style="font-size: 11px; margin-top: 4px; max-height: 100px; overflow-y: auto; background: rgba(0,0,0,0.3); padding: 6px; border-radius: 3px;">
                        ${error.message.replace(/\n/g, '<br>')}<br><br>
                        Program crashed after this step during execution.
                    </div>
                </div>`;
            }
            return '';
        }

        // Compile error with line number
        if (!error.line || !entity.line) return '';

        if (entity.line === error.line) {
            return `<div style="background: linear-gradient(135deg, rgba(139, 0, 0, 0.9) 0%, rgba(220, 20, 60, 0.9) 100%);
                         padding: 12px; margin: 10px; border-radius: 6px; border: 2px solid rgba(255, 69, 0, 0.8);">
                <div style="font-weight: bold; margin-bottom: 6px;">ERROR AT THIS LINE</div>
                <div style="font-size: 11px; opacity: 0.9;">Stage: ${error.stage || 'compile'}</div>
                <div style="font-size: 11px; margin-top: 4px; max-height: 100px; overflow-y: auto; background: rgba(0,0,0,0.3); padding: 6px; border-radius: 3px;">
                    ${error.message.replace(/\n/g, '<br>')}
                </div>
            </div>`;
        } else if (entity.line > error.line) {
            return `<div style="background: rgba(139, 0, 0, 0.6); padding: 8px; margin: 10px; border-radius: 4px; border: 1px solid rgba(255, 69, 0, 0.5);">
                <div style="font-size: 11px;">After error (line ${error.line})</div>
            </div>`;
        }

        return '';
    }

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
            case 'EXTERNAL_CALL':
                html += this._buildExternalCallInspector(bd, entity);
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
            <span class="inspector-icon">️</span>
            <span>${fn.name || bd.stepData.name}()</span>
        </div>`;
        h += this._getErrorBanner(fn);
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

    // ── External Call ───────────────────────────────────────────────

    _buildExternalCallInspector(bd, fn) {
        let h = '';
        h += `<div class="inspector-header" style="background: linear-gradient(135deg, #1a0033 0%, #4a148c 100%);">
            <span class="inspector-icon"></span>
            <span>${fn.name}()</span>
            <span style="opacity: 0.7; font-size: 0.9em; margin-left: 8px;">EXTERNAL</span>
        </div>`;
        h += this._getErrorBanner(fn);

        h += '<div class="inspector-body">';

        // Function info
        h += `<div class="inspector-row">
            <span class="inspector-label">Function:</span>
            <span class="inspector-value">${fn.name}</span>
        </div>`;

        if (fn.invocation !== undefined) {
            h += `<div class="inspector-row">
                <span class="inspector-label">Invocation:</span>
                <span class="inspector-value">#${fn.invocation}</span>
            </div>`;
        }

        if (fn.line !== undefined) {
            h += `<div class="inspector-row">
                <span class="inspector-label">Line:</span>
                <span class="inspector-value">${fn.line}</span>
            </div>`;
        }

        if (fn.depth !== undefined) {
            h += `<div class="inspector-row">
                <span class="inspector-label">Stack Depth:</span>
                <span class="inspector-value">${fn.depth}</span>
            </div>`;
        }

        if (fn.sourceFile) {
            h += `<div class="inspector-row">
                <span class="inspector-label">Source File:</span>
                <span class="inspector-value">${fn.sourceFile}</span>
            </div>`;
        }

        h += `<div class="inspector-row">
            <span class="inspector-label">Step:</span>
            <span class="inspector-value">${bd.stepIndex}</span>
        </div>`;

        // Arguments if available
        if (fn.args && fn.args.length > 0) {
            h += `<div class="inspector-row">
                <span class="inspector-label">Arguments:</span>
                <span class="inspector-value">${fn.args.join(', ')}</span>
            </div>`;
        }

        h += '</div>'; // close inspector-body
        return h;
    }

    // ── Variable ────────────────────────────────────────────────────

    _buildVariableInspector(bd, v) {
        let h = '';
        h += `<div class="inspector-header var-header">
            <span class="inspector-icon"></span>
            <span>${v.name || bd.stepData.name}</span>
        </div>`;
        h += this._getErrorBanner(v);
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
            <span class="inspector-icon"></span>
            <span>${(loop.subtype || 'loop').toUpperCase()}</span>
        </div>`;
        h += this._getErrorBanner(loop);
        h += `<div class="inspector-section">`;
        h += this._row('Type', (loop.subtype || 'loop').toUpperCase() + ' Loop');
        h += this._row('Condition', `<code>${loop.condition || bd.stepData.condition || '—'}</code>`);
        h += this._row('Iterations', loop.iterations !== undefined ? loop.iterations : '—');
        h += this._row('Running', loop.running ? 'yes' : '⏹ no');
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
            <span class="inspector-icon"></span>
            <span>CONDITION</span>
        </div>`;
        h += this._getErrorBanner(br);
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
        makeDraggable(panel, panel.querySelector('.inspector-header') || panel.querySelector('.dot-header'));
        requestAnimationFrame(() => panel.classList.add('open'));

        panel.querySelector('.inspector-close').addEventListener('click', () => {
            this._closeDotInspector();
        });

        this._dotPanel = panel;

        // Track as the last navigated mesh for a/d key navigation
        this._setActiveMesh(mesh);

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
                <span class="inspector-icon"></span>
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
                <span class="inspector-icon"></span>
                <span>${entity.label || 'Loop'}</span>
            </div>`;
            h += `<div class="inspector-section">`;
            h += this._row('Type', `${(entity.subtype || 'loop').toUpperCase()} Loop`);
            h += this._row('Condition', `<code>${entity.condition || '—'}</code>`);
            h += this._row('Iterations', entity.iterations || '—');
            h += this._row('Running', entity.running ? 'yes' : '⏹ no');
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
            const icon = entity.type === 'call' ? '️' : '↩️';
            h += `<div class="inspector-header fn-header">
                <span class="inspector-icon">${icon}</span>
                <span>${entity.label || entity.type.toUpperCase()}</span>
            </div>`;
            h += `<div class="inspector-section">`;
            h += this._row('Type', entity.type === 'call' ? 'Function Call' : 'Return');
            if (entity.firstStep) {
                const step = entity.firstStep;
                if (step.name) h += this._row('Name', step.name);
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
                <span class="inspector-icon"></span>
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
            if (step.name) h += this._row('Name', step.name);
            if (step.value !== undefined && step.value !== null)
                h += this._row('Value', `<strong>${step.value}</strong>`);
            if (step.line) h += this._row('Line', step.line);
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
        makeDraggable(panel, panel.querySelector('.inspector-header') || panel.querySelector('.dot-header'));
        requestAnimationFrame(() => panel.classList.add('open'));

        panel.querySelector('.inspector-close').addEventListener('click', () => {
            this._closeDotInspector();
        });

        this._dotPanel = panel;

        // Track as the last navigated mesh for a/d key navigation
        this._setActiveMesh(dotMesh);

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
        this._setActiveMesh(nodeMesh);

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
                <span class="inspector-icon"></span>
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
                <span class="inspector-icon"></span>
                <span>${entity.label}</span>
            </div>`;
            h += `<div class="inspector-section">`;
            h += this._row('Type', `${(entity.subtype || 'loop').toUpperCase()} Loop`);
            h += this._row('Condition', `<code>${entity.condition || '—'}</code>`);
            h += this._row('Iterations', entity.iterations);
            h += this._row('Running', entity.running ? 'yes' : '⏹ no');
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
        if (step.name) h += this._row('Name', step.name);
        if (step.value !== undefined && step.value !== null)
            h += this._row('Value', `<strong>${step.value}</strong>`);
        if (step.address) h += this._row('Address', step.address);
        if (step.line) h += this._row('Line', step.line);
        if (step.depth !== undefined)
            h += this._row('Stack Depth', step.depth);
        if (step.condition) h += this._row('Condition', `<code>${step.condition}</code>`);
        if (step.conditionResult !== undefined)
            h += this._row('Result', step.conditionResult ? '<span class="val-true">TRUE</span>' : '<span class="val-false">FALSE</span>');
        if (step.subtype) h += this._row('Subtype', step.subtype);
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
            case 'CALL': return '️';
            case 'RETURN': return '↩️';
            case 'DECL': return '';
            case 'ASSIGN': return '';
            case 'LOOP': return '';
            case 'CONDITION': return '';
            case 'BRANCH': return '';
            default: return '';
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

        // Hide the selection ring indicator
        this._hideSelectionRing();
        this._lastNavigatedMesh = null;

        // Hide the sub-spiral for this building
        if (this.cityRenderer) {
            this.cityRenderer.hideSubSpiral(mesh);
        }

        this.exploded = null;
    }
}
