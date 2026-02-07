
/**
 * CityRenderer — Phase 2
 *
 * Translates WorldState snapshots into 3D Babylon.js meshes on a descending
 * spiral.  Now uses ColorHash for deterministic hash-based colours and
 * renders while-loops as a separate building type.
 *
 * Also owns SubSpiralRenderer which draws mini spirals emerging from
 * every container building (function, for, while, branch).
 */
class CityRenderer {
    constructor(scene) {
        this.scene = scene;

        // Helpers
        this.labelHelper = new LabelHelper(scene);
        this.meshFactory = new MeshFactory(scene, this.labelHelper);
        this.subSpiralRenderer = new SubSpiralRenderer(scene, this.labelHelper);

        // Phase 4: Bubble renderer for loops (for, while, do-while)
        this.loopBubbleRenderer = new LoopBubbleRenderer(scene, this.labelHelper);

        // Phase 4: Tree renderer for if-statements
        this.branchTreeRenderer = new BranchTreeRenderer(scene, this.labelHelper);

        // Wire up the sub-spiral toggle callback so we know when to push/restore
        this.subSpiralRenderer.onSubSpiralToggle = (action, key, boundingRadius, parentPos) => {
            this._onSubSpiralToggle(action, key, boundingRadius, parentPos);
        };

        // Wire up bubble toggle callback
        this.loopBubbleRenderer.onBubbleToggle = (action, key, boundingRadius, parentPos) => {
            this._onSubSpiralToggle(action, key, boundingRadius, parentPos);
        };

        // Wire up tree toggle callback (Phase 4: if-statement trees)
        this.branchTreeRenderer.onTreeToggle = (action, key, boundingRadius, parentPos) => {
            this._onSubSpiralToggle(action, key, boundingRadius, parentPos);
        };

        // Mesh caches:  entityKey → { mesh, extras… }
        this.functionMeshes = new Map();
        this.variableMeshes = new Map();
        this.loopMeshes = new Map();   // for-loops
        this.whileMeshes = new Map();   // while-loops (new)
        this.branchMeshes = new Map();
        this.blackHoleMeshes = new Map();  // external function calls
        this.blackHoleConnections = [];    // connection lines from spiral to black holes
        this.consoleBubbles = new Map();   // console output bubbles
        this.memoryLines = [];

        // Spiral layout config
        this.spiralRadiusStart = SPIRAL_CONFIG.radiusStart;
        this.spiralRadiusGrowth = SPIRAL_CONFIG.radiusGrowth;
        this.spiralAngleStep = SPIRAL_CONFIG.angleStep;
        this.spiralHeightStep = SPIRAL_CONFIG.heightStep;

        // Slot management
        this._nextSlot = 0;
        this._slotMap = new Map();

        this._spiralTube = null;
        this._spiralTubeError = null;

        // Hover
        this._hoveredLabel = null;
        this._hoverAttached = false;

        // ── Sub-spiral push-out tracking ──
        // Maps parentKey → { boundingRadius, parentPos, parentSlot }
        this._openSubSpirals = new Map();
    }

    // ─── Hover ─────────────────────────────────────────────────────

    _ensureHoverObserver() {
        if (this._hoverAttached) return;
        this._hoverAttached = true;

        // Throttle hover picking to every ~50ms (20 fps) instead of every frame
        let lastHoverTime = 0;
        const hoverInterval = 50; // ms

        this.scene.onPointerObservable.add((pointerInfo) => {
            if (pointerInfo.type !== BABYLON.PointerEventTypes.POINTERMOVE) return;

            const now = Date.now();
            if (now - lastHoverTime < hoverInterval) return;
            lastHoverTime = now;

            // Check for main buildings, sub-spiral dots, galaxy buildings, and bubble nodes
            const pick = this.scene.pick(
                this.scene.pointerX, this.scene.pointerY,
                (m) => m._buildingData != null || m._subSpiralDot != null || m._isGalaxyBuilding != null || m._isBubbleNode != null
            );

            if (pick && pick.hit && pick.pickedMesh) {
                // Handle main building hover
                if (pick.pickedMesh._buildingData) {
                    const entry = this._entryForMesh(pick.pickedMesh);
                    if (entry && entry.label) {
                        if (this._hoveredLabel && this._hoveredLabel !== entry.label)
                            this._hoveredLabel.isVisible = false;
                        entry.label.isVisible = true;
                        this._hoveredLabel = entry.label;
                    }
                }
                // Handle sub-spiral dot hover
                else if (pick.pickedMesh._subSpiralDot && pick.pickedMesh._label) {
                    if (this._hoveredLabel && this._hoveredLabel !== pick.pickedMesh._label)
                        this._hoveredLabel.isVisible = false;
                    pick.pickedMesh._label.isVisible = true;
                    this._hoveredLabel = pick.pickedMesh._label;
                }
                // Handle bubble node hover (Phase 4)
                else if (pick.pickedMesh._isBubbleNode && pick.pickedMesh._label) {
                    if (this._hoveredLabel && this._hoveredLabel !== pick.pickedMesh._label)
                        this._hoveredLabel.isVisible = false;
                    pick.pickedMesh._label.isVisible = true;
                    this._hoveredLabel = pick.pickedMesh._label;
                }
                // Handle galaxy building hover
                else if (pick.pickedMesh._isGalaxyBuilding && pick.pickedMesh._label) {
                    if (this._hoveredLabel && this._hoveredLabel !== pick.pickedMesh._label)
                        this._hoveredLabel.isVisible = false;
                    pick.pickedMesh._label.isVisible = true;
                    this._hoveredLabel = pick.pickedMesh._label;
                }
            } else if (this._hoveredLabel) {
                this._hoveredLabel.isVisible = false;
                this._hoveredLabel = null;
            }
        });
    }

    _entryForMesh(mesh) {
        for (const cache of [this.functionMeshes, this.variableMeshes, this.loopMeshes, this.whileMeshes, this.branchMeshes]) {
            for (const [, entry] of cache) {
                if (entry.mesh === mesh) return entry;
            }
        }
        return null;
    }

    // ─── Spiral geometry ───────────────────────────────────────────

    /**
     * Base spiral position (no push-out applied).
     */
    _spiralPositionBase(slot) {
        const angle = getSpiralAngle(slot);
        const radius = this.spiralRadiusStart + slot * this.spiralRadiusGrowth;
        const y = getSpiralY(slot, Math.max(this._nextSlot, 1));
        return new BABYLON.Vector3(
            Math.cos(angle) * radius, y, Math.sin(angle) * radius
        );
    }

    /**
     * Spiral position with push-out offset applied when sub-spirals are open.
     * Buildings near an open sub-spiral get pushed radially outward to
     * make room for the sub-spiral helix wrapping around the parent.
     */
    _spiralPosition(slot) {
        const basePos = this._spiralPositionBase(slot);

        if (this._openSubSpirals.size === 0) return basePos;

        // Accumulate push-out from all open sub-spirals
        let offsetX = 0;
        let offsetZ = 0;

        for (const [parentKey, info] of this._openSubSpirals) {
            const parentSlot = this._slotMap.get(parentKey);
            if (parentSlot === undefined) continue;

            // How far is this slot from the parent slot on the spiral?
            const slotDist = Math.abs(slot - parentSlot);

            // Only push buildings that are within a neighbourhood of the parent
            // The push-out influence fades with distance (slots)
            const influenceRange = 20;  // slots within this range are affected
            if (slotDist > influenceRange || slotDist === 0) continue;

            // Compute direction from origin to this building's base position
            const dirX = basePos.x;
            const dirZ = basePos.z;
            const dirLen = Math.sqrt(dirX * dirX + dirZ * dirZ);
            if (dirLen < 0.01) continue;

            // Push-out strength: strongest near the parent, fading out
            const falloff = 1.0 - (slotDist / influenceRange);
            const pushStrength = info.boundingRadius * falloff * 0.8;

            // Push radially outward from center
            offsetX += (dirX / dirLen) * pushStrength;
            offsetZ += (dirZ / dirLen) * pushStrength;
        }

        basePos.x += offsetX;
        basePos.z += offsetZ;
        return basePos;
    }

    _slotFor(key) {
        if (!this._slotMap.has(key)) {
            this._slotMap.set(key, this._nextSlot);
            this._nextSlot += 4;
        }
        return this._slotMap.get(key);
    }

    _spiralTangentAngle(slot) {
        const angle = getSpiralAngle(slot);
        const radius = this.spiralRadiusStart + slot * this.spiralRadiusGrowth;
        const dTheta = getSpiralAngleStep(slot);
        const dx = -Math.sin(angle) * dTheta * radius
            + Math.cos(angle) * this.spiralRadiusGrowth;
        const dz = Math.cos(angle) * dTheta * radius
            + Math.sin(angle) * this.spiralRadiusGrowth;
        return Math.atan2(dx, dz);
    }

    // ─── Main render ───────────────────────────────────────────────

    render(snapshot) {
        this._ensureHoverObserver();

        // Keep references for on-demand sub-spiral rendering and re-rendering
        this._lastTrace = snapshot.trace || [];
        this._lastSnapshot = snapshot;
        this._error = snapshot.error || null;

        // Pre-assign spiral slots in trace-creation order so that
        // buildings are interleaved along the spiral based on when they
        // first appeared in the execution trace, NOT grouped by type.
        if (snapshot.creationOrder) {
            for (const key of snapshot.creationOrder) {
                this._slotFor(key);   // assigns monotonically increasing slot
            }
        }

        this._renderFunctions(snapshot.functions, snapshot.callStack);
        this._renderVariables(snapshot.variables);
        this._renderLoops(snapshot.loops);
        this._renderWhileLoops(snapshot.whileLoops || []);
        this._renderBranches(snapshot.branches);
        this._renderConsoleOutputs(snapshot.consoleOutputs || []);
        this._updateBuildingPositions();
        this._renderMemoryLayer(snapshot.memory);
        this._renderSpiralPath();

        // Sub-spirals are rendered on-demand when a building is clicked
        // (see showSubSpiral / hideSubSpiral, called by ExplodeManager).

        // Freeze all meshes whose world matrix won't change any more
        this._freezeStaticMeshes();
    }

    // ─── Error checking ────────────────────────────────────────────

    /**
     * Check if a building is at or after an error line.
     * For compile errors with line numbers: colors nodes at/after the error line red.
     * For runtime errors without line numbers: doesn't color anything red (crash happened after trace).
     * @param {object} entity - The building entity (function, variable, etc.)
     * @returns {boolean} True if this entity is in error state
     */
    _isErrorNode(entity) {
        if (!this._error) return false;

        // Runtime errors without line numbers: don't color trace red (crash after trace)
        if (!this._error.line) return false;

        // Compile errors with line numbers: color nodes at/after error line red
        if (!entity.line) return false;
        return entity.line >= this._error.line;
    }

    /**
     * Check if a building is exactly at the error line, or is the last step for runtime errors.
     * @param {object} entity - The building entity
     * @returns {boolean} True if this is the error indicator node
     */
    _isExactErrorNode(entity) {
        if (!this._error) return false;

        // Compile error with line number: mark exact line
        if (this._error.line && entity.line) {
            return entity.line === this._error.line;
        }

        // Runtime error without line: mark the last step in the trace
        if (!this._error.line && this._error.stage === 'runtime') {
            return this._isLastStep(entity);
        }

        return false;
    }

    /**
     * Check if this entity is the last step in the trace.
     * @param {object} entity - The building entity
     * @returns {boolean} True if this is the last executed step
     */
    _isLastStep(entity) {
        if (!this._lastTrace || this._lastTrace.length === 0) return false;

        const lastStep = this._lastTrace.length - 1;

        // Check various step fields that might indicate this is the last step
        if (entity.enterStep === lastStep) return true;
        if (entity.declStep === lastStep) return true;
        if (entity.step === lastStep) return true;
        if (entity.steps && entity.steps.length > 0) {
            return entity.steps[entity.steps.length - 1] === lastStep;
        }

        return false;
    }

    /**
     * Create a visual error indicator above a building.
     * @param {string} key - Unique key for the error indicator
     * @param {BABYLON.Vector3} pos - Position of the building
     * @param {number} height - Height of the building
     * @returns {BABYLON.Mesh} The error indicator mesh
     */
    _createErrorIndicator(key, pos, height) {
        // Create a glowing sphere
        const size = 0.8;
        const indicator = BABYLON.MeshBuilder.CreateSphere(`errorIndicator_${key}`, {
            diameter: size, segments: 8
        }, this.scene);

        indicator.position = pos.clone();
        indicator.position.y += height + 1.5;

        // Bright red glowing material
        const mat = new BABYLON.StandardMaterial(`errorIndicatorMat_${key}`, this.scene);
        mat.diffuseColor = new BABYLON.Color3(1, 0.1, 0.1);
        mat.emissiveColor = new BABYLON.Color3(0.8, 0, 0);
        mat.alpha = 0.95;
        indicator.material = mat;
        indicator.isPickable = false;

        // Add error label
        const errorLabel = this._createFloatingLabel(
            `errorLabel_${key}`, '[!]', pos.clone(), height + 1.5,
            { r: 1, g: 0.2, b: 0.2, a: 1 }
        );
        errorLabel.isPickable = false;

        // Pulsing animation
        this._pulseAnimation(indicator);

        return indicator;
    }

    /**
     * Add a pulsing animation to a mesh.
     * @param {BABYLON.Mesh} mesh - The mesh to animate
     */
    _pulseAnimation(mesh) {
        const anim = new BABYLON.Animation(
            'errorPulse',
            'scaling',
            30,
            BABYLON.Animation.ANIMATIONTYPE_VECTOR3,
            BABYLON.Animation.ANIMATIONLOOPMODE_CYCLE
        );

        const keys = [
            { frame: 0, value: new BABYLON.Vector3(1, 1, 1) },
            { frame: 15, value: new BABYLON.Vector3(1.3, 1.3, 1.3) },
            { frame: 30, value: new BABYLON.Vector3(1, 1, 1) }
        ];

        anim.setKeys(keys);
        mesh.animations = [anim];
        this.scene.beginAnimation(mesh, 0, 30, true);
    }

    // ─── On-demand sub-spiral API (called by ExplodeManager) ───────

    /**
     * Show the sub-spiral for a specific building.
     * @param {BABYLON.AbstractMesh} buildingMesh – the clicked building
     */
    showSubSpiral(buildingMesh) {
        if (!buildingMesh || !buildingMesh._entityData) return;
        const entity = buildingMesh._entityData;
        const key = entity.key;
        const childIndices = entity.childStepIndices;
        if (!childIndices || childIndices.length === 0) return;

        const parentPos = buildingMesh.position.clone();
        this.subSpiralRenderer.renderSingle(key, childIndices, parentPos, this._lastTrace);
    }

    /**
     * Hide the sub-spiral for a specific building.
     * @param {BABYLON.AbstractMesh} buildingMesh – the building to collapse
     */
    hideSubSpiral(buildingMesh) {
        if (!buildingMesh || !buildingMesh._entityData) return;
        this.subSpiralRenderer.removeSingle(buildingMesh._entityData.key);
    }

    /**
     * Called by SubSpiralRenderer when a sub-spiral is opened or closed.
     * Handles pushing the main spiral outward and restoring it.
     */
    _onSubSpiralToggle(action, parentKey, boundingRadius, parentPos) {
        if (action === 'open') {
            this._openSubSpirals.set(parentKey, {
                boundingRadius: boundingRadius || 3,
                parentPos: parentPos ? parentPos.clone() : BABYLON.Vector3.Zero()
            });
        } else {
            this._openSubSpirals.delete(parentKey);
        }

        // Animate the main spiral to its new pushed / restored positions
        this._animateMainSpiralPush();
    }

    /**
     * Smoothly animate all main-spiral buildings and the spiral tube
     * to their new positions (pushed out or restored).
     */
    _animateMainSpiralPush() {
        // Unfreeze meshes that will move
        this._unfreezeAllMeshes();

        // Recompute positions for all buildings
        this._updateBuildingPositions();

        // Re-draw the spiral path tube to match new positions
        this._renderSpiralPath();

        // Re-draw memory layer lines
        if (this._lastSnapshot && this._lastSnapshot.memory) {
            this._renderMemoryLayer(this._lastSnapshot.memory);
        }

        // Re-freeze after repositioning
        this._freezeStaticMeshes();
    }

    /**
     * Unfreeze all building meshes so they can be repositioned.
     */
    _unfreezeAllMeshes() {
        const unfreezeEntry = (entry) => {
            if (!entry) return;
            const meshes = [entry.mesh, entry.cap, entry.roof, entry.chimney,
            entry.truePath, entry.falsePath];
            for (const m of meshes) {
                if (m && m._isFrozen) {
                    m.unfreezeWorldMatrix();
                    m._isFrozen = false;
                }
            }
        };
        for (const [, e] of this.functionMeshes) unfreezeEntry(e);
        for (const [, e] of this.variableMeshes) unfreezeEntry(e);
        for (const [, e] of this.loopMeshes) unfreezeEntry(e);
        for (const [, e] of this.whileMeshes) unfreezeEntry(e);
        for (const [, e] of this.branchMeshes) unfreezeEntry(e);
        for (const [, e] of this.blackHoleMeshes) unfreezeEntry(e);

        if (this._spiralTube) this._spiralTube.unfreezeWorldMatrix();
        if (this._spiralTubeError) this._spiralTubeError.unfreezeWorldMatrix();
    }

    clear() {
        [this.functionMeshes, this.variableMeshes, this.loopMeshes,
        this.whileMeshes, this.branchMeshes, this.blackHoleMeshes, this.consoleBubbles].forEach(cache => {
            cache.forEach(entry => this._disposeEntry(entry));
            cache.clear();
        });
        this.memoryLines.forEach(l => l.dispose());
        this.memoryLines = [];
        this.blackHoleConnections.forEach(c => c.dispose());
        this.blackHoleConnections = [];
        if (this._spiralTube) { this._spiralTube.dispose(); this._spiralTube = null; }
        if (this._spiralTubeError) { this._spiralTubeError.dispose(); this._spiralTubeError = null; }
        this._nextSlot = 0;
        this._slotMap.clear();
        this._openSubSpirals.clear();
        this._lastSnapshot = null;
        this.subSpiralRenderer.clear();
        this.loopBubbleRenderer.clearAll();
        this.branchTreeRenderer.clearAll();
    }

    /**
     * Return the outer radius of the spiral based on the number of slots used.
     * Useful for dynamically positioning the camera.
     */
    getSpiralRadius() {
        const maxSlot = Math.max(this._nextSlot - 1, 0);
        return this.spiralRadiusStart + maxSlot * this.spiralRadiusGrowth;
    }

    /**
     * Build a map from entity key → world position for the sub-spiral renderer.
     */
    _buildPositionMap() {
        const m = new Map();
        const add = (cache) => {
            for (const [key, entry] of cache) {
                if (entry.mesh) m.set(key, entry.mesh.position.clone());
            }
        };
        add(this.functionMeshes);
        add(this.variableMeshes);
        add(this.loopMeshes);
        add(this.whileMeshes);
        add(this.branchMeshes);
        return m;
    }

    // ─── Spiral tube ───────────────────────────────────────────────

    _renderSpiralPath() {
        if (this._spiralTube) { this._spiralTube.dispose(); this._spiralTube = null; }
        if (this._spiralTubeError) { this._spiralTubeError.dispose(); this._spiralTubeError = null; }
        if (this._nextSlot < 2) return;

        // Find the error split point (slot number where error occurs)
        const errorSlot = this._findErrorSlot();

        const points = [];
        const errorPoints = [];

        // For large spirals, compute every other point to reduce geometry
        const stride = this._nextSlot > 200 ? 2 : 1;
        for (let i = 0; i < this._nextSlot; i += stride) {
            const p = this._spiralPosition(i);
            p.y -= 0.05;

            if (errorSlot !== null && i >= errorSlot) {
                errorPoints.push(p);
            } else {
                points.push(p);
            }
        }

        // Create normal spiral tube (before error)
        if (points.length >= 2) {
            this._spiralTube = BABYLON.MeshBuilder.CreateTube('spiralTimeline', {
                path: points, radius: 0.12,
                tessellation: 8,
                sideOrientation: BABYLON.Mesh.DOUBLESIDE
            }, this.scene);
            const mat = new BABYLON.StandardMaterial('spiralMat', this.scene);
            mat.emissiveColor = new BABYLON.Color3(0.8, 0.7, 0.3);
            mat.diffuseColor  = new BABYLON.Color3(0.9, 0.8, 0.4);
            mat.alpha = 0.55;
            mat.freeze();
            this._spiralTube.material = mat;
            this._spiralTube.isPickable = false;
        }

        // Create error spiral tube (after error) in red
        if (errorPoints.length >= 2) {
            // Add transition point from normal path if needed
            if (points.length > 0 && errorSlot > 0) {
                const transitionPoint = this._spiralPosition(errorSlot);
                transitionPoint.y -= 0.05;
                errorPoints.unshift(transitionPoint);
            }

            this._spiralTubeError = BABYLON.MeshBuilder.CreateTube('spiralTimelineError', {
                path: errorPoints, radius: 0.12,
                tessellation: 8,
                sideOrientation: BABYLON.Mesh.DOUBLESIDE
            }, this.scene);
            const errorMat = new BABYLON.StandardMaterial('spiralErrorMat', this.scene);
            errorMat.emissiveColor = new BABYLON.Color3(0.9, 0.1, 0.1);
            errorMat.diffuseColor  = new BABYLON.Color3(1.0, 0.2, 0.2);
            errorMat.alpha = 0.65;
            errorMat.freeze();
            this._spiralTubeError.material = errorMat;
            this._spiralTubeError.isPickable = false;
        }
    }

    /**
     * Find the slot number where the error occurs.
     * @returns {number|null} The slot number, or null if no error
     */
    _findErrorSlot() {
        if (!this._error) return null;

        // For compile errors with line numbers, find the first building at/after that line
        if (this._error.line) {
            let minSlot = Infinity;
            let found = false;

            // Check all entity types
            const allEntities = [
                ...this.functionMeshes.entries(),
                ...this.variableMeshes.entries(),
                ...this.loopMeshes.entries(),
                ...this.whileMeshes.entries(),
                ...this.branchMeshes.entries()
            ];

            for (const [key, entry] of allEntities) {
                const entity = entry.mesh?._entityData;
                if (!entity || !entity.line) continue;

                if (entity.line >= this._error.line) {
                    const slot = this._slotMap.get(key);
                    if (slot !== undefined && slot < minSlot) {
                        minSlot = slot;
                        found = true;
                    }
                }
            }

            return found ? minSlot : null;
        }

        // For runtime errors without line numbers, find the last step's slot
        if (this._error.stage === 'runtime' && this._lastTrace && this._lastTrace.length > 0) {
            const lastStepIndex = this._lastTrace.length - 1;
            let maxSlot = -1;
            let found = false;

            const allEntities = [
                ...this.functionMeshes.entries(),
                ...this.variableMeshes.entries(),
                ...this.loopMeshes.entries(),
                ...this.whileMeshes.entries(),
                ...this.branchMeshes.entries()
            ];

            for (const [key, entry] of allEntities) {
                const entity = entry.mesh?._entityData;
                if (!entity) continue;

                // Check if this entity corresponds to the last step
                if (entity.enterStep === lastStepIndex ||
                    entity.declStep === lastStepIndex ||
                    entity.step === lastStepIndex) {
                    const slot = this._slotMap.get(key);
                    if (slot !== undefined && slot > maxSlot) {
                        maxSlot = slot;
                        found = true;
                    }
                }
            }

            // Return slot AFTER the last step for runtime errors
            return found ? maxSlot + 1 : null;
        }

        return null;
    }

    // ─── Reposition buildings ──────────────────────────────────────

    _updateBuildingPositions() {
        // Functions
        for (const [key, entry] of this.functionMeshes) {
            const slot = this._slotMap.get(key);
            if (slot === undefined || !entry.mesh) continue;
            const pos = this._spiralPosition(slot);
            entry.mesh.position.copyFrom(pos);
            if (entry.cap) { entry.cap.position.set(pos.x, pos.y + entry.height + 0.15, pos.z); }
            if (entry.label) { entry.label.position.set(pos.x, pos.y + entry.height + 0.5, pos.z); }
        }
        // Variables
        for (const [key, entry] of this.variableMeshes) {
            const slot = this._slotMap.get(key);
            if (slot === undefined || !entry.mesh) continue;
            const pos = this._spiralPosition(slot);
            entry.mesh.position.set(pos.x, pos.y + entry.height / 2, pos.z);
            if (entry.roof) { entry.roof.position.set(pos.x, pos.y + entry.height + 0.35, pos.z); }
            if (entry.label) { entry.label.position.set(pos.x, pos.y + entry.height + 1.3, pos.z); }
        }
        // For loops
        for (const [key, entry] of this.loopMeshes) {
            const slot = this._slotMap.get(key);
            if (slot === undefined || !entry.mesh) continue;
            const pos = this._spiralPosition(slot);
            const ta = this._spiralTangentAngle(slot);
            entry.mesh.position.set(pos.x, pos.y + entry.height / 2, pos.z);
            if (entry.chimney) entry.chimney.position.set(
                pos.x + 0.7 * Math.cos(ta), pos.y + entry.height + 0.65, pos.z + 0.7 * Math.sin(ta)
            );
            if (entry.label) entry.label.position.set(pos.x, pos.y + entry.height + 2, pos.z);
        }
        // While loops (same shape as for-loops)
        for (const [key, entry] of this.whileMeshes) {
            const slot = this._slotMap.get(key);
            if (slot === undefined || !entry.mesh) continue;
            const pos = this._spiralPosition(slot);
            const ta = this._spiralTangentAngle(slot);
            entry.mesh.position.set(pos.x, pos.y + entry.height / 2, pos.z);
            if (entry.chimney) entry.chimney.position.set(
                pos.x + 0.7 * Math.cos(ta), pos.y + entry.height + 0.65, pos.z + 0.7 * Math.sin(ta)
            );
            if (entry.label) entry.label.position.set(pos.x, pos.y + entry.height + 2, pos.z);
        }
        // Branches
        for (const [key, entry] of this.branchMeshes) {
            const slot = this._slotMap.get(key);
            if (slot === undefined || !entry.mesh) continue;
            const pos = this._spiralPosition(slot);
            const ta = this._spiralTangentAngle(slot);
            entry.mesh.position.copyFrom(pos);
            if (entry.truePath) {
                const a = ta + Math.PI / 6;
                entry.truePath.position.set(pos.x + Math.cos(a) * 0.8, pos.y + 0.1, pos.z + Math.sin(a) * 0.8);
            }
            if (entry.falsePath) {
                const a = ta - Math.PI / 6;
                entry.falsePath.position.set(pos.x + Math.cos(a) * 0.8, pos.y + 0.1, pos.z + Math.sin(a) * 0.8);
            }
            if (entry.label) entry.label.position.set(pos.x, pos.y + entry.height + 1, pos.z);
        }
        // Black holes - update connection lines based on spiral position changes
        for (const [key, entry] of this.blackHoleMeshes) {
            const slot = this._slotMap.get(key);
            if (slot === undefined || !entry.mesh) continue;
            const spiralPos = this._spiralPosition(slot);

            // Black hole position stays fixed (off to the side)
            // But update the connection line
            if (entry.connection) {
                entry.connection.dispose();
                entry.connection = BABYLON.MeshBuilder.CreateLines(`connection_${key}`, {
                    points: [spiralPos, entry.mesh.position],
                    updatable: false
                }, this.scene);
                entry.connection.color = new BABYLON.Color3(0.5, 0.3, 0.7);
                entry.connection.alpha = 0.4;
                entry.connection.isPickable = false;
            }
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // ─── Function Districts ────────────────────────────────────────
    // ═══════════════════════════════════════════════════════════════

    _renderFunctions(functions, callStack) {
        const activeKeys = new Set();
        const activeBlackHoleKeys = new Set();

        functions.forEach(fn => {
            if (fn.isExternal) {
                // External functions become black holes
                activeBlackHoleKeys.add(fn.key);
                if (!this.blackHoleMeshes.has(fn.key)) {
                    const slot = this._slotFor(fn.key);
                    const spiralPos = this._spiralPosition(slot);
                    this.blackHoleMeshes.set(fn.key, this._createBlackHole(fn, spiralPos, slot));
                }
            } else {
                // Internal functions get normal buildings
                activeKeys.add(fn.key);
                if (!this.functionMeshes.has(fn.key)) {
                    const slot = this._slotFor(fn.key);
                    const pos = this._spiralPosition(slot);
                    this.functionMeshes.set(fn.key, this._createFunctionDistrict(fn, pos, slot));
                }
                this._updateFunctionState(this.functionMeshes.get(fn.key), fn);
            }
        });

        this.functionMeshes.forEach((entry, key) => {
            if (!activeKeys.has(key)) this._setInactive(entry);
        });
        this.blackHoleMeshes.forEach((entry, key) => {
            if (!activeBlackHoleKeys.has(key)) this._setInactive(entry);
        });
    }

    _createBlackHole(fn, spiralPos, slot) {
        // Position black hole off to the side of the spiral
        const angle = getSpiralAngle(slot);
        const radius = this.spiralRadiusStart + slot * this.spiralRadiusGrowth;
        const offsetDistance = radius * 0.5 + 5; // Push outward from spiral

        const blackHolePos = new BABYLON.Vector3(
            Math.cos(angle) * (radius + offsetDistance),
            spiralPos.y,
            Math.sin(angle) * (radius + offsetDistance)
        );

        // Create black sphere with event horizon effect
        const size = 1.2;
        const sphere = BABYLON.MeshBuilder.CreateSphere(`blackhole_${fn.key}`, {
            diameter: size, segments: 16
        }, this.scene);
        sphere.position = blackHolePos;

        // Dark material with subtle purple glow
        const mat = new BABYLON.StandardMaterial(`blackholeMat_${fn.key}`, this.scene);
        mat.diffuseColor = new BABYLON.Color3(0.05, 0.0, 0.1);
        mat.emissiveColor = new BABYLON.Color3(0.15, 0.05, 0.25);
        mat.specularColor = new BABYLON.Color3(0.3, 0.1, 0.4);
        mat.alpha = 0.95;
        sphere.material = mat;
        sphere.isPickable = true;

        // Accretion disk (glowing ring)
        const disk = BABYLON.MeshBuilder.CreateTorus(`blackholeDisk_${fn.key}`, {
            diameter: size * 2.2, thickness: size * 0.15, tessellation: 24
        }, this.scene);
        disk.position = blackHolePos;
        disk.rotation.x = Math.PI / 2;

        const diskMat = new BABYLON.StandardMaterial(`blackholeDiskMat_${fn.key}`, this.scene);
        diskMat.diffuseColor = new BABYLON.Color3(0.4, 0.2, 0.6);
        diskMat.emissiveColor = new BABYLON.Color3(0.6, 0.3, 0.8);
        diskMat.alpha = 0.7;
        disk.material = diskMat;
        disk.isPickable = false;

        // Connection line from spiral to black hole
        const connectionLine = BABYLON.MeshBuilder.CreateLines(`connection_${fn.key}`, {
            points: [spiralPos, blackHolePos],
            updatable: false
        }, this.scene);
        connectionLine.color = new BABYLON.Color3(0.5, 0.3, 0.7);
        connectionLine.alpha = 0.4;
        connectionLine.isPickable = false;
        this.blackHoleConnections.push(connectionLine);

        // Enhanced label with subject, line number, and invocation info
        const invLabel = fn.invocation > 1 ? ` #${fn.invocation}` : '';
        const lineInfo = fn.line ? ` @L${fn.line}` : '';
        const labelText = `${fn.name}()${invLabel}${lineInfo}`;

        const labelColor = { r: 0.8, g: 0.5, b: 0.95, a: 1.0 };
        const label = this._createFloatingLabel(
            `blackholeLabel_${fn.key}`, labelText, blackHolePos.clone(), size + 0.8, labelColor
        );
        label.isPickable = false;

        // Add a secondary label below showing "EXTERNAL CALL"
        const typeLabel = this._createFloatingLabel(
            `blackholeType_${fn.key}`,
            'EXTERNAL',
            blackHolePos.clone(),
            -size * 0.3,
            { r: 0.6, g: 0.4, b: 0.7, a: 0.9 }
        );
        typeLabel.isPickable = false;

        this._animateScaleIn(sphere);
        this._animateScaleIn(disk);

        sphere._buildingData = {
            step: fn.enterStep,
            stepData: { type: 'EXTERNAL_CALL', name: fn.name, depth: fn.depth, line: fn.line || 0 },
            color: labelColor,
            type: 'EXTERNAL_CALL',
            childSteps: [],
            capMesh: disk
        };
        sphere._trapHeight = size;
        sphere._entityData = fn;

        return {
            mesh: sphere,
            disk,
            label,
            typeLabel,
            connection: connectionLine,
            height: size,
            color: labelColor,
            type: 'blackhole'
        };
    }

    _createFunctionDistrict(fn, pos, slot) {
        const height = 4 + fn.depth * 2.5;
        const width = 3.5;
        const tangentAngle = this._spiralTangentAngle(slot);

        // Check for error state - use red if at/after error line
        let color;
        if (this._isErrorNode(fn)) {
            color = { r: 0.9, g: 0.1, b: 0.1, a: 1.0 };  // Red for error
        } else {
            color = ColorHash.colorWithFile('function', fn.name, fn.sourceFile);
        }

        const mesh = BABYLON.MeshBuilder.CreateCylinder(`building_${fn.key}`, {
            height, diameterTop: width * 0.5, diameterBottom: width, tessellation: 4, subdivisions: 1
        }, this.scene);
        const bake = BABYLON.Matrix.RotationY(Math.PI / 4)
            .multiply(BABYLON.Matrix.Translation(0, height / 2, 0));
        mesh.bakeTransformIntoVertices(bake);
        mesh.position = pos.clone();
        mesh.rotation.y = tangentAngle;
        mesh.material = this._glowMaterial(`fnMat_${fn.key}`, color);
        mesh.isPickable = true;

        const cap = BABYLON.MeshBuilder.CreateBox(`fnCap_${fn.key}`, {
            height: 0.3, width: width * 0.7, depth: width * 0.7
        }, this.scene);
        cap.position = pos.clone();
        cap.position.y += height + 0.15;
        cap.rotation.y = tangentAngle;
        cap.material = this._glowMaterial(`fnCapMat_${fn.key}`, {
            r: Math.min(color.r * 1.5, 1), g: Math.min(color.g * 1.5, 1),
            b: Math.min(color.b * 1.5, 1), a: 0.9
        });
        cap.isPickable = false;

        this._animateScaleIn(mesh);
        this._animateScaleIn(cap);

        const invLabel = fn.invocation > 1 ? ` #${fn.invocation}` : '';
        const externalMark = fn.isExternal ? ' ' : '';
        const fileLabel = fn.sourceFile && fn.sourceFile !== 'unknown' ? ` [${fn.sourceFile}]` : '';
        const errorMark = this._isExactErrorNode(fn) ? ' [!]' : '';
        const labelText = `${fn.name}()${invLabel}${externalMark}${errorMark}${fileLabel}`;
        const label = this._createFloatingLabel(
            `fnLabel_${fn.key}`, labelText, pos.clone(), height + 0.5, color
        );
        label.isPickable = false;

        // Add exclamation mark indicator for exact error node
        let errorIndicator = null;
        if (this._isExactErrorNode(fn)) {
            errorIndicator = this._createErrorIndicator(fn.key, pos.clone(), height);
        }

        mesh._buildingData = {
            step: fn.enterStep,
            stepData: { type: 'CALL', name: fn.name, depth: fn.depth, line: fn.line || 0 },
            color, type: 'CALL',
            childSteps: this._fnChildSteps(fn),
            capMesh: cap
        };
        mesh._trapHeight = height;
        mesh._entityData = fn;

        return { mesh, cap, label, errorIndicator, height, color, type: 'function' };
    }

    _fnChildSteps(fn) {
        const children = [];
        fn.localVars.forEach(vk => {
            children.push({ type: 'DECL', name: vk, value: '', address: '0', line: 0 });
        });
        if (fn.returnValue !== null && fn.returnValue !== undefined) {
            children.push({ type: 'RETURN', name: '', value: String(fn.returnValue), address: '0', line: 0, subtype: '' });
        }
        return children;
    }

    _updateFunctionState(entry, fn) {
        if (!entry.mesh) return;
        if (entry.mesh.material) entry.mesh.material.alpha = 0.85;
        if (entry.cap && entry.cap.material) entry.cap.material.alpha = 0.9;
        if (entry.mesh._buildingData) {
            entry.mesh._buildingData.childSteps = this._fnChildSteps(fn);
        }
        if (fn.returnValue !== null && fn.returnValue !== undefined) {
            const invLabel = fn.invocation > 1 ? ` #${fn.invocation}` : '';
            this.labelHelper.update(entry.label, `${fn.name}()${invLabel} → ${fn.returnValue}`);
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // ─── Variable Houses ───────────────────────────────────────────
    // ═══════════════════════════════════════════════════════════════

    _renderVariables(variables) {
        const activeKeys = new Set();
        variables.forEach(v => {
            activeKeys.add(v.key);
            if (!this.variableMeshes.has(v.key)) {
                const slot = this._slotFor(v.key);
                const pos = this._spiralPosition(slot);
                this.variableMeshes.set(v.key, this._createVariableHouse(v, pos, slot));
            }
            this._updateVariableState(this.variableMeshes.get(v.key), v);
        });
        this.variableMeshes.forEach((entry, key) => {
            if (!activeKeys.has(key)) this._setInactive(entry);
        });
    }

    _createVariableHouse(v, pos, slot) {
        const height = 2;
        const width = 1.4;
        const tangentAngle = this._spiralTangentAngle(slot);

        // Check for error state - use red if at/after error line
        let color;
        if (this._isErrorNode(v)) {
            color = { r: 0.9, g: 0.1, b: 0.1, a: 1.0 };  // Red for error
        } else {
            color = ColorHash.colorWithFile('variable', v.name, v.sourceFile);
        }

        const mesh = BABYLON.MeshBuilder.CreateBox(`building_${v.key}`, {
            height, width, depth: width
        }, this.scene);
        mesh.position = pos.clone();
        mesh.position.y += height / 2;
        mesh.rotation.y = tangentAngle;
        mesh.material = this._glowMaterial(`varMat_${v.key}`, color);

        const roof = BABYLON.MeshBuilder.CreateCylinder(`varRoof_${v.key}`, {
            height: 0.7, diameterTop: 0, diameterBottom: width * 1.5, tessellation: 4
        }, this.scene);
        roof.bakeTransformIntoVertices(BABYLON.Matrix.RotationY(Math.PI / 4));
        roof.position = pos.clone();
        roof.position.y += height + 0.35;
        roof.rotation.y = tangentAngle;
        roof.material = this._glowMaterial(`varRoofMat_${v.key}`, {
            r: Math.min(color.r * 1.4, 1), g: Math.min(color.g * 1.4, 1),
            b: Math.min(color.b * 1.4, 1), a: 0.9
        });
        roof.isPickable = false;

        this._animateScaleIn(mesh);
        this._animateScaleIn(roof);

        const errorMark = this._isExactErrorNode(v) ? ' [!]' : '';
        const labelText = `${v.name} = ${v.currentValue}${errorMark}`;
        const label = this._createFloatingLabel(`varLabel_${v.key}`, labelText, pos.clone(), height + 1.3, color);
        label.isPickable = false;

        // Add error indicator for exact error node
        let errorIndicator = null;
        if (this._isExactErrorNode(v)) {
            errorIndicator = this._createErrorIndicator(v.key, pos.clone(), height);
        }

        mesh._buildingData = {
            step: v.declStep,
            stepData: { type: 'DECL', name: v.name, value: v.currentValue, address: v.address, line: v.line || 0 },
            color, type: 'DECL',
            childSteps: this._varChildSteps(v),
            capMesh: roof
        };
        mesh._trapHeight = height;
        mesh._entityData = v;

        return { mesh, roof, label, errorIndicator, height, color, type: 'variable' };
    }

    _varChildSteps(v) {
        return v.values.map(entry => ({
            type: 'ASSIGN', name: v.name, value: String(entry.value),
            address: v.address, line: 0, step: entry.step
        }));
    }

    _updateVariableState(entry, v) {
        if (!entry.mesh) return;
        if (entry.mesh.material) {
            entry.mesh.material.alpha = 0.85;
            entry.mesh.material.emissiveColor = new BABYLON.Color3(
                entry.color.r * 0.5, entry.color.g * 0.5, entry.color.b * 0.5
            );
        }
        if (entry.roof && entry.roof.material) entry.roof.material.alpha = 0.9;
        if (entry.mesh._buildingData) {
            entry.mesh._buildingData.childSteps = this._varChildSteps(v);
            entry.mesh._buildingData.stepData.value = v.currentValue;
        }
        if (entry.label) {
            this.labelHelper.update(entry.label, `${v.name} = ${v.currentValue}`);
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // ─── For-Loop Factories ────────────────────────────────────────
    // ═══════════════════════════════════════════════════════════════

    _renderLoops(loops) {
        const activeKeys = new Set();
        loops.forEach(loop => {
            activeKeys.add(loop.key);
            if (!this.loopMeshes.has(loop.key)) {
                const slot = this._slotFor(loop.key);
                const pos = this._spiralPosition(slot);
                this.loopMeshes.set(loop.key, this._createLoopFactory(loop, pos, slot, 'for'));
            }
            this._updateLoopState(this.loopMeshes.get(loop.key), loop);
        });
        this.loopMeshes.forEach((entry, key) => {
            if (!activeKeys.has(key)) this._setInactive(entry);
        });
    }

    // ═══════════════════════════════════════════════════════════════
    // ─── While-Loop Factories (new building type) ──────────────────
    // ═══════════════════════════════════════════════════════════════

    _renderWhileLoops(whileLoops) {
        const activeKeys = new Set();
        whileLoops.forEach(loop => {
            activeKeys.add(loop.key);
            if (!this.whileMeshes.has(loop.key)) {
                const slot = this._slotFor(loop.key);
                const pos = this._spiralPosition(slot);
                this.whileMeshes.set(loop.key, this._createLoopFactory(loop, pos, slot, 'while'));
            }
            this._updateLoopState(this.whileMeshes.get(loop.key), loop);
        });
        this.whileMeshes.forEach((entry, key) => {
            if (!activeKeys.has(key)) this._setInactive(entry);
        });
    }

    /**
     * Shared factory builder for both for-loops and while-loops.
     * The colour differs based on loopType.
     */
    _createLoopFactory(loop, pos, slot, loopType) {
        const height = 3;
        const width = 2.6;
        const tangentAngle = this._spiralTangentAngle(slot);

        // Check for error state - use red if at/after error line
        let color;
        if (this._isErrorNode(loop)) {
            color = { r: 0.9, g: 0.1, b: 0.1, a: 1.0 };  // Red for error
        } else {
            color = ColorHash.colorWithFile(loopType, loop.condition, loop.sourceFile);
        }

        const mesh = BABYLON.MeshBuilder.CreateCylinder(`building_${loop.key}`, {
            height, diameterTop: width * 0.75, diameterBottom: width, tessellation: 6
        }, this.scene);
        mesh.position = pos.clone();
        mesh.position.y += height / 2;
        mesh.rotation.y = tangentAngle;
        mesh.material = this._glowMaterial(`loopMat_${loop.key}`, color);

        const chimney = BABYLON.MeshBuilder.CreateCylinder(`loopChimney_${loop.key}`, {
            height: 1.3, diameter: 0.45, tessellation: 6
        }, this.scene);
        chimney.position = pos.clone();
        chimney.position.y += height + 0.65;
        chimney.position.x += 0.7 * Math.cos(tangentAngle);
        chimney.position.z += 0.7 * Math.sin(tangentAngle);
        chimney.material = this._glowMaterial(`loopChimneyMat_${loop.key}`, {
            r: Math.min(color.r * 0.7, 1), g: Math.min(color.g * 0.7, 1),
            b: Math.min(color.b * 0.7, 1), a: 0.9
        });
        chimney.isPickable = false;

        this._animateScaleIn(mesh);
        this._animateScaleIn(chimney);

        const typeLabel = loopType.toUpperCase();
        const errorMark = this._isExactErrorNode(loop) ? ' [!]' : '';
        const labelText = `${typeLabel} (${loop.condition}) ×${loop.iterations}${errorMark}`;
        const label = this._createFloatingLabel(`loopLabel_${loop.key}`, labelText, pos.clone(), height + 2, color);
        label.isPickable = false;

        // Add error indicator for exact error node
        let errorIndicator = null;
        if (this._isExactErrorNode(loop)) {
            errorIndicator = this._createErrorIndicator(loop.key, pos.clone(), height);
        }

        mesh._buildingData = {
            step: loop.steps[0] || 0,
            stepData: { type: 'LOOP', name: '', subtype: loop.subtype, condition: loop.condition, line: loop.line || 0 },
            color, type: 'LOOP',
            childSteps: this._loopChildSteps(loop),
            capMesh: chimney
        };
        mesh._trapHeight = height;
        mesh._entityData = loop;

        return { mesh, chimney, label, errorIndicator, height, color, type: loopType };
    }

    _loopChildSteps(loop) {
        return loop.steps.map((s, i) => ({
            type: 'LOOP', name: `iteration ${i + 1}`,
            value: i < loop.iterations ? '✓' : '✗',
            address: '0', line: 0, condition: loop.condition
        }));
    }

    _updateLoopState(entry, loop) {
        if (!entry.mesh) return;
        if (entry.mesh.material) {
            entry.mesh.material.alpha = 0.85;
            entry.mesh.material.emissiveColor = new BABYLON.Color3(
                entry.color.r * 0.6, entry.color.g * 0.6, entry.color.b * 0.6
            );
        }
        if (entry.chimney && entry.chimney.material) entry.chimney.material.alpha = 0.9;
        if (entry.mesh._buildingData) {
            entry.mesh._buildingData.childSteps = this._loopChildSteps(loop);
        }
        if (entry.label) {
            const typeLabel = (entry.type || 'loop').toUpperCase();
            this.labelHelper.update(entry.label, `${typeLabel} (${loop.condition}) ×${loop.iterations}`);
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // ─── Branch Intersections ──────────────────────────────────────
    // ═══════════════════════════════════════════════════════════════

    _renderBranches(branches) {
        const activeKeys = new Set();
        branches.forEach(br => {
            activeKeys.add(br.key);
            if (!this.branchMeshes.has(br.key)) {
                const slot = this._slotFor(br.key);
                const pos = this._spiralPosition(slot);
                this.branchMeshes.set(br.key, this._createBranchIntersection(br, pos, slot));
            }
            this._updateBranchState(this.branchMeshes.get(br.key), br);
        });
        this.branchMeshes.forEach((entry, key) => {
            if (!activeKeys.has(key)) this._setInactive(entry);
        });
    }

    // ═══════════════════════════════════════════════════════════════
    // ─── Console Output Bubbles ────────────────────────────────────
    // ═══════════════════════════════════════════════════════════════

    _renderConsoleOutputs(outputs) {
        const activeKeys = new Set();
        outputs.forEach(out => {
            activeKeys.add(out.key);
            if (!this.consoleBubbles.has(out.key)) {
                const slot = this._slotFor(out.key);
                const pos = this._spiralPosition(slot);
                this.consoleBubbles.set(out.key, this._createConsoleBubble(out, pos, slot));
            }
        });
        this.consoleBubbles.forEach((entry, key) => {
            if (!activeKeys.has(key)) this._setInactive(entry);
        });
    }

    _createConsoleBubble(output, pos, slot) {
        const angle = getSpiralAngle(slot);
        const radius = this.spiralRadiusStart + slot * this.spiralRadiusGrowth;

        // Position bubble slightly inward and elevated from spiral
        const bubblePos = new BABYLON.Vector3(
            Math.cos(angle) * (radius - 2),
            pos.y + 1.5,
            Math.sin(angle) * (radius - 2)
        );

        // Create semi-transparent card/bubble
        const width = Math.min(output.message.length * 0.12 + 1, 4);
        const height = 0.8;
        const depth = 0.1;

        const card = BABYLON.MeshBuilder.CreateBox(`console_${output.key}`, {
            width, height, depth
        }, this.scene);
        card.position = bubblePos;
        card.rotation.y = angle + Math.PI / 2; // Face outward

        // Glass-like material
        const mat = new BABYLON.StandardMaterial(`consoleMat_${output.key}`, this.scene);
        mat.diffuseColor = new BABYLON.Color3(0.9, 0.95, 1.0);
        mat.emissiveColor = new BABYLON.Color3(0.4, 0.5, 0.6);
        mat.specularColor = new BABYLON.Color3(0.8, 0.9, 1.0);
        mat.alpha = 0.3;
        card.material = mat;
        card.isPickable = false;

        // Glowing border
        const border = BABYLON.MeshBuilder.CreateBox(`consoleBorder_${output.key}`, {
            width: width + 0.1, height: height + 0.1, depth: 0.05
        }, this.scene);
        border.position = bubblePos;
        border.rotation.y = angle + Math.PI / 2;

        const borderMat = new BABYLON.StandardMaterial(`consoleBorderMat_${output.key}`, this.scene);
        borderMat.emissiveColor = new BABYLON.Color3(0.3, 0.7, 0.9);
        borderMat.alpha = 0.6;
        border.material = borderMat;
        border.isPickable = false;

        // Text label showing the message
        const labelColor = { r: 0.9, g: 0.95, b: 1.0, a: 1.0 };
        const label = this._createFloatingLabel(
            `consoleLabel_${output.key}`,
            `${output.message}`,
            bubblePos.clone(),
            0,
            labelColor
        );
        label.isPickable = false;

        // Connection line from spiral to bubble
        const connectionLine = BABYLON.MeshBuilder.CreateLines(`consoleConnection_${output.key}`, {
            points: [pos, bubblePos],
            updatable: false
        }, this.scene);
        connectionLine.color = new BABYLON.Color3(0.4, 0.6, 0.8);
        connectionLine.alpha = 0.3;
        connectionLine.isPickable = false;

        this._animateScaleIn(card);
        this._animateScaleIn(border);

        return {
            mesh: card,
            border,
            label,
            connection: connectionLine,
            height: 0,
            color: labelColor,
            type: 'console'
        };
    }

    _createBranchIntersection(br, pos, slot) {
        const height = 2.2;
        const width = 2.2;
        const tangentAngle = this._spiralTangentAngle(slot);
        const branchType = br.chosenBranch === 'else' ? 'else' : 'branch';

        // Check for error state - use red if at/after error line
        let color;
        if (this._isErrorNode(br)) {
            color = { r: 0.9, g: 0.1, b: 0.1, a: 1.0 };  // Red for error
        } else {
            color = ColorHash.colorWithFile(branchType, br.condition, br.sourceFile);
        }

        const mesh = BABYLON.MeshBuilder.CreateCylinder(`building_${br.key}`, {
            height, diameterTop: 0.3, diameterBottom: width, tessellation: 4
        }, this.scene);
        const bake = BABYLON.Matrix.RotationY(Math.PI / 4)
            .multiply(BABYLON.Matrix.Translation(0, height / 2, 0));
        mesh.bakeTransformIntoVertices(bake);
        mesh.position = pos.clone();
        mesh.rotation.y = tangentAngle;
        mesh.material = this._glowMaterial(`branchMat_${br.key}`, color);

        const truePath = this._createPathIndicator(`brTrue_${br.key}`, pos, 1.6, tangentAngle + Math.PI / 6, true);
        const falsePath = this._createPathIndicator(`brFalse_${br.key}`, pos, 1.6, tangentAngle - Math.PI / 6, false);
        truePath.isPickable = false;
        falsePath.isPickable = false;

        this._animateScaleIn(mesh);

        const errorMark = this._isExactErrorNode(br) ? ' [!]' : '';
        const labelText = `IF (${br.condition}) → ${br.result ? 'true' : 'false'}${errorMark}`;
        const label = this._createFloatingLabel(`brLabel_${br.key}`, labelText, pos.clone(), height + 1, color);
        label.isPickable = false;

        // Add error indicator for exact error node
        let errorIndicator = null;
        if (this._isExactErrorNode(br)) {
            errorIndicator = this._createErrorIndicator(br.key, pos.clone(), height);
        }

        mesh._buildingData = {
            step: br.step,
            stepData: { type: 'CONDITION', name: br.condition, conditionResult: br.result, line: br.line || 0 },
            color, type: 'CONDITION',
            childSteps: [
                { type: 'CONDITION', name: br.condition, value: br.result ? 'true' : 'false', address: '0', line: br.line || 0 },
                ...(br.chosenBranch
                    ? [{ type: 'BRANCH', name: br.chosenBranch, value: '', address: '0', line: br.line || 0, subtype: br.chosenBranch }]
                    : [])
            ],
            capMesh: null
        };
        mesh._trapHeight = height;
        mesh._entityData = br;

        return { mesh, truePath, falsePath, label, errorIndicator, height, color, type: 'branch' };
    }

    _createPathIndicator(name, basePos, length, angle, isTrue) {
        const path = BABYLON.MeshBuilder.CreateBox(name, {
            width: length, height: 0.15, depth: 0.35
        }, this.scene);
        path.position = basePos.clone();
        path.position.y += 0.1;
        path.position.x += Math.cos(angle) * length / 2;
        path.position.z += Math.sin(angle) * length / 2;
        path.rotation.y = -angle;

        const color = isTrue
            ? { r: 0.2, g: 0.9, b: 0.3, a: 0.8 }
            : { r: 0.9, g: 0.2, b: 0.2, a: 0.8 };
        path.material = this._glowMaterial(name + '_mat', color);
        return path;
    }

    _updateBranchState(entry, br) {
        if (!entry.mesh) return;
        if (entry.truePath && entry.truePath.material) entry.truePath.material.alpha = 0.9;
        if (entry.falsePath && entry.falsePath.material) entry.falsePath.material.alpha = 0.9;
        if (entry.label) {
            this.labelHelper.update(entry.label, `IF (${br.condition}) → ${br.result ? 'true' : 'false'}`);
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // ─── Memory Layer — address-colored rings under variables ───────
    // ═══════════════════════════════════════════════════════════════

    _renderMemoryLayer(memoryNodes) {
        this.memoryLines.forEach(l => {
            if (l.material) l.material.dispose();
            l.dispose();
        });
        this.memoryLines = [];

        // For each memory address that has 2+ active variables, draw a
        // glowing ring under each variable sharing that address. Variables
        // that share an address get the same colour ring, making the
        // relationship visible at a glance without confusing floor-lines.
        memoryNodes.forEach(node => {
            // Collect only active variables for this address
            const activeEntries = [];
            node.variables.forEach(varKey => {
                const entry = this.variableMeshes.get(varKey);
                if (!entry || !entry.mesh) return;
                const entityData = entry.mesh._entityData;
                if (!entityData || !entityData.active) return;
                activeEntries.push(entry);
            });
            if (activeEntries.length < 2) return;

            // Deterministic colour for this address
            const addrColor = ColorHash.color('memory', node.address);

            for (const entry of activeEntries) {
                const pos = entry.mesh.position;
                const ring = BABYLON.MeshBuilder.CreateTorus(
                    `memRing_${node.address}_${entry.mesh.name}`, {
                    diameter: 2.2,
                    thickness: 0.12,
                    tessellation: 12
                }, this.scene
                );
                ring.position = new BABYLON.Vector3(pos.x, pos.y - 0.8, pos.z);
                ring.rotation.x = 0; // flat on the ground plane

                const mat = new BABYLON.StandardMaterial(
                    `memRingMat_${node.address}_${entry.mesh.name}`, this.scene
                );
                mat.emissiveColor = new BABYLON.Color3(
                    addrColor.r * 0.8, addrColor.g * 0.8, addrColor.b * 0.8
                );
                mat.diffuseColor = new BABYLON.Color3(addrColor.r, addrColor.g, addrColor.b);
                mat.alpha = 0.5;
                mat.freeze();
                ring.material = mat;
                ring.isPickable = false;
                ring.freezeWorldMatrix();

                this.memoryLines.push(ring);
            }
        });
    }

    // ═══════════════════════════════════════════════════════════════
    // ─── Shared helpers ────────────────────────────────────────────
    // ═══════════════════════════════════════════════════════════════

    /**
     * Freeze the world matrices of meshes that are fully positioned.
     * This tells Babylon.js to skip recomputing their matrices each
     * frame, significantly improving render-loop performance for large
     * scenes.
     */
    _freezeStaticMeshes() {
        const freezeEntry = (entry) => {
            if (!entry) return;
            const meshes = [entry.mesh, entry.cap, entry.roof, entry.chimney,
            entry.truePath, entry.falsePath];
            for (const m of meshes) {
                if (m && !m._isFrozen) {
                    m.computeWorldMatrix(true); // ensure world matrix is up to date
                    m.freezeWorldMatrix();
                    m._isFrozen = true;
                }
            }
        };
        for (const [, e] of this.functionMeshes) freezeEntry(e);
        for (const [, e] of this.variableMeshes) freezeEntry(e);
        for (const [, e] of this.loopMeshes) freezeEntry(e);
        for (const [, e] of this.whileMeshes) freezeEntry(e);
        for (const [, e] of this.branchMeshes) freezeEntry(e);
        for (const [, e] of this.blackHoleMeshes) freezeEntry(e);

        // Freeze the spiral tubes
        if (this._spiralTube) this._spiralTube.freezeWorldMatrix();
        if (this._spiralTubeError) this._spiralTubeError.freezeWorldMatrix();
    }

    _setInactive(entry) {
        if (!entry) return;
        if (entry.mesh && entry.mesh.material) entry.mesh.material.alpha = 0.85;
        if (entry.cap && entry.cap.material) entry.cap.material.alpha = 0.9;
        if (entry.roof && entry.roof.material) entry.roof.material.alpha = 0.9;
        if (entry.chimney && entry.chimney.material) entry.chimney.material.alpha = 0.9;
        if (entry.truePath && entry.truePath.material) entry.truePath.material.alpha = 0.9;
        if (entry.falsePath && entry.falsePath.material) entry.falsePath.material.alpha = 0.9;
    }

    _disposeEntry(entry) {
        if (!entry) return;
        const disposable = ['mesh', 'cap', 'roof', 'chimney', 'truePath', 'falsePath', 'label', 'typeLabel', 'disk', 'connection', 'border'];
        disposable.forEach(k => {
            if (entry[k]) {
                if (entry[k].material) entry[k].material.dispose();
                entry[k].dispose();
            }
        });
    }

    // ─── Delegates to MeshFactory / LabelHelper ────────────────────

    _glowMaterial(name, color) {
        const mat = this.meshFactory.glowMaterial(name, color);
        mat.freeze();           // performance: skip redundant shader recompilation
        return mat;
    }

    _animateScaleIn(mesh) {
        this.meshFactory.animateScaleIn(mesh);
    }

    _createFloatingLabel(name, text, pos, yOffset, color, scale) {
        return this.labelHelper.create(name, text, pos, yOffset, color, scale);
    }
}
