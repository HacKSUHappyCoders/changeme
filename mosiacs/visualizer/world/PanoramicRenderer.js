/**
 * PanoramicRenderer — Phase 3 Part 4: Low-quality total render
 *
 * When toggled on, this renderer simultaneously displays ALL buildings
 * with ALL their sub-spiral galaxies rendered at once — a purely visual
 * spectacle.  No labels, no hover, no data inspection — just the full
 * mosaic of spirals-within-spirals.
 *
 * ULTRA-LIGHTWEIGHT design for long-range viewing of recursive algorithms:
 *   - Every entity is a coloured dot (thin-instanced sphere)
 *   - ONE source mesh per colour type → thin instances stamp positions
 *     (thousands of dots = ~10 draw calls total)
 *   - Spiral paths and warp connections are CreateLines (zero geometry)
 *   - No labels, no hover, no pickability, no animations on meshes
 *   - Flat materials: diffuse only, no emissive, no specular
 *   - All world matrices frozen immediately
 *   - Camera fly is the only animation
 */
class PanoramicRenderer {
    constructor(scene, sceneManager, cityRenderer) {
        this.scene = scene;
        this.sceneManager = sceneManager;
        this.cityRenderer = cityRenderer;

        this._active = false;

        /** Lines + source meshes (for cleanup) */
        this._meshes = [];

        /** Source sphere per colorType for thin-instancing */
        this._sourceMeshes = new Map();

        /** Cached flat materials: colorType → StandardMaterial (≤10) */
        this._matCache = new Map();

        this._savedCameraPos = null;
        this._savedCameraTarget = null;
        this._mainSpiralHidden = false;

        // ── Galaxy spiral layout ──
        this._galaxyRadiusStart = 3.0;
        this._galaxyRadiusGrowth = 0.18;
        this._galaxyAngleStep = 0.7;
        this._galaxyHeightStep = 0.06;
        this._galaxyOffset = 12;
    }

    // ─── Public API ────────────────────────────────────────────────

    /**
     * Toggle panoramic render mode on/off.
     * @returns {boolean} Whether panoramic mode is now active.
     */
    toggle() {
        if (this._active) {
            this._deactivate();
        } else {
            this._activate();
        }
        return this._active;
    }

    /** @returns {boolean} */
    isActive() {
        return this._active;
    }

    /** Full cleanup (called when the city is cleared). */
    clear() {
        if (this._active) {
            this._deactivate();
        }
        this._disposeMeshes();
        this._disposeMaterials();
    }

    // ─── Activation / Deactivation ─────────────────────────────────

    _activate() {
        if (this._active) return;
        this._active = true;

        const snapshot = this.cityRenderer._lastSnapshot;
        const trace = this.cityRenderer._lastTrace || [];
        if (!snapshot) return;

        // Save camera state
        const camera = this.sceneManager.getCamera();
        this._savedCameraPos = camera.position.clone();
        this._savedCameraTarget = camera.target.clone();

        // Dim the main spiral to make room for the panoramic view
        this._dimMainSpiral(0.5);

        // Block material dirty notifications for bulk creation
        this.scene.blockMaterialDirtyMechanism = true;

        // Render all buildings with their galaxies
        this._renderPanoramic(snapshot, trace);

        this.scene.blockMaterialDirtyMechanism = false;

        // Fly camera to a grand overview position
        this._flyCameraToOverview();
    }

    _deactivate() {
        if (!this._active) return;
        this._active = false;

        // Remove all panoramic meshes
        this._disposeMeshes();

        // Restore main spiral visibility
        this._restoreMainSpiral();

        // Fly camera back to saved position
        if (this._savedCameraPos) {
            this._flyCamera(this._savedCameraPos, this._savedCameraTarget);
            this._savedCameraPos = null;
            this._savedCameraTarget = null;
        }
    }

    // ─── Core Rendering ────────────────────────────────────────────

    /**
     * Render the full panoramic view.
     *
     * Two-pass approach for maximum GPU efficiency:
     *   Pass 1 — collect all dot positions grouped by colorType
     *   Pass 2 — create ONE source sphere per colorType, stamp all
     *            positions as thin instances (1 draw call per type)
     */
    _renderPanoramic(snapshot, trace) {
        this._disposeMeshes();

        // ── Pass 1: gather containers and collect dot positions ──
        // positionsByType: colorType → [ {x,y,z}, … ]
        // Also track bounding box for camera positioning
        const positionsByType = new Map();
        let bMinX = Infinity, bMinY = Infinity, bMinZ = Infinity;
        let bMaxX = -Infinity, bMaxY = -Infinity, bMaxZ = -Infinity;
        const addDot = (colorType, x, y, z) => {
            if (!positionsByType.has(colorType)) positionsByType.set(colorType, []);
            positionsByType.get(colorType).push(x, y, z);
            if (x < bMinX) bMinX = x; if (y < bMinY) bMinY = y; if (z < bMinZ) bMinZ = z;
            if (x > bMaxX) bMaxX = x; if (y > bMaxY) bMaxY = y; if (z > bMaxZ) bMaxZ = z;
        };

        const containers = this._gatherContainers(snapshot);

        for (const container of containers) {
            this._collectGalaxyDots(container, trace, addDot);
        }

        // ── Add standalone entities (black holes, console outputs) ──
        this._collectStandaloneDots(snapshot, addDot);

        // ── Pass 2: create thin-instanced source meshes ──
        for (const [colorType, flatPositions] of positionsByType) {
            this._stampDots(colorType, flatPositions);
        }

        // Include main spiral top/bottom in bounds
        const totalSlots = this.cityRenderer._nextSlot;
        if (totalSlots > 0) {
            const top = this.cityRenderer._spiralPositionBase(0);
            const bot = this.cityRenderer._spiralPositionBase(totalSlots - 1);
            for (const p of [top, bot]) {
                if (p.x < bMinX) bMinX = p.x; if (p.y < bMinY) bMinY = p.y; if (p.z < bMinZ) bMinZ = p.z;
                if (p.x > bMaxX) bMaxX = p.x; if (p.y > bMaxY) bMaxY = p.y; if (p.z > bMaxZ) bMaxZ = p.z;
            }
        }

        // Store bounds for camera positioning (scaled 1.5× from center for padding)
        const padScale = 1.13;
        const cX = (bMinX + bMaxX) / 2, cY = (bMinY + bMaxY) / 2, cZ = (bMinZ + bMaxZ) / 2;
        this._panoBounds = {
            min: new BABYLON.Vector3(cX + (bMinX - cX) * padScale, cY + (bMinY - cY) * padScale, cZ + (bMinZ - cZ) * padScale),
            max: new BABYLON.Vector3(cX + (bMaxX - cX) * padScale, cY + (bMaxY - cY) * padScale, cZ + (bMaxZ - cZ) * padScale)
        };

        // Freeze all panoramic meshes (lines + source spheres)
        for (const mesh of this._meshes) {
            try {
                if (mesh) {
                    mesh.computeWorldMatrix(true);
                    mesh.freezeWorldMatrix();
                }
            } catch (e) { /* skip disposed meshes */ }
        }
    }

    /** Gather all container buildings that have child step indices. */
    _gatherContainers(snapshot) {
        const containers = [];

        // Functions
        for (const fn of (snapshot.functions || [])) {
            if (fn.childStepIndices && fn.childStepIndices.length > 0) {
                const slot = this.cityRenderer._slotMap.get(fn.key);
                if (slot === undefined) continue;
                const pos = this.cityRenderer._spiralPosition(slot);
                containers.push({
                    key: fn.key, type: 'function',
                    childIndices: fn.childStepIndices, pos,
                    color: ColorHash.color('function', fn.name)
                });
            }
        }
        // For loops
        for (const loop of (snapshot.loops || [])) {
            if (loop.childStepIndices && loop.childStepIndices.length > 0) {
                const slot = this.cityRenderer._slotMap.get(loop.key);
                if (slot === undefined) continue;
                const pos = this.cityRenderer._spiralPosition(slot);
                containers.push({
                    key: loop.key, type: 'for',
                    childIndices: loop.childStepIndices, pos,
                    color: ColorHash.color('for', loop.condition)
                });
            }
        }
        // While loops
        for (const loop of (snapshot.whileLoops || [])) {
            if (loop.childStepIndices && loop.childStepIndices.length > 0) {
                const slot = this.cityRenderer._slotMap.get(loop.key);
                if (slot === undefined) continue;
                const pos = this.cityRenderer._spiralPosition(slot);
                containers.push({
                    key: loop.key, type: 'while',
                    childIndices: loop.childStepIndices, pos,
                    color: ColorHash.color('while', loop.condition)
                });
            }
        }
        // Branches
        for (const br of (snapshot.branches || [])) {
            if (br.childStepIndices && br.childStepIndices.length > 0) {
                const slot = this.cityRenderer._slotMap.get(br.key);
                if (slot === undefined) continue;
                const pos = this.cityRenderer._spiralPosition(slot);
                containers.push({
                    key: br.key, type: 'branch',
                    childIndices: br.childStepIndices, pos,
                    color: ColorHash.color('branch', br.condition)
                });
            }
        }
        return containers;
    }

    /**
     * Collect dot positions for a single galaxy.
     * Entities are capped at MAX_ENTITIES_PER_GALAXY with uniform
     * downsampling to preserve the spiral shape.
     * Also emits the spiral-path line and warp line.
     *
     * Dispatches to specialised layouts based on container type:
     *   - 'for'    → bubble layout (compact ring of dots)
     *   - 'branch' → tree layout  (branching Y-shape with dots)
     *   - others   → spiral galaxy layout
     */
    _collectGalaxyDots(container, trace, addDot) {
        const { key, type, childIndices, pos: parentPos, color: parentColor } = container;

        const renderer = this.cityRenderer.subSpiralRenderer;
        const entities = renderer._consolidateChildren(childIndices, trace);
        if (entities.length === 0) return;

        // ── Galaxy center — offset radially outward from parent ──
        const dirX = parentPos.x || 1;
        const dirZ = parentPos.z || 1;
        const dirLen = Math.sqrt(dirX * dirX + dirZ * dirZ) || 1;
        const galaxyCenter = new BABYLON.Vector3(
            parentPos.x + (dirX / dirLen) * this._galaxyOffset,
            parentPos.y + 3,
            parentPos.z + (dirZ / dirLen) * this._galaxyOffset
        );

        if (type === 'for') {
            this._collectBubbleDots(key, entities, galaxyCenter, parentPos, parentColor, addDot);
        } else if (type === 'branch') {
            this._collectTreeDots(key, entities, childIndices, trace, galaxyCenter, parentPos, parentColor, addDot);
        } else {
            this._collectSpiralDots(key, entities, galaxyCenter, parentPos, parentColor, addDot);
        }
    }

    /**
     * Collect dots for standalone entities (black holes, console outputs).
     * These don't have galaxies, they're just individual dots on the main spiral.
     */
    _collectStandaloneDots(snapshot, addDot) {
        // External function calls (black holes)
        for (const fn of (snapshot.functions || [])) {
            if (fn.isExternal) {
                const slot = this.cityRenderer._slotMap.get(fn.key);
                if (slot === undefined) continue;
                const pos = this.cityRenderer._spiralPosition(slot);

                // Get the black hole position (offset from spiral)
                const angle = getSpiralAngle(slot);
                const radius = this.cityRenderer.spiralRadiusStart + slot * this.cityRenderer.spiralRadiusGrowth;
                const offsetDistance = radius * 0.5 + 5;

                const x = Math.cos(angle) * (radius + offsetDistance);
                const y = pos.y;
                const z = Math.sin(angle) * (radius + offsetDistance);

                addDot('EXTERNAL_CALL', x, y, z);
            }
        }

        // Console outputs
        for (const output of (snapshot.consoleOutputs || [])) {
            const slot = this.cityRenderer._slotMap.get(output.key);
            if (slot === undefined) continue;
            const pos = this.cityRenderer._spiralPosition(slot);

            // Get the console bubble position (offset inward from spiral)
            const angle = getSpiralAngle(slot);
            const radius = this.cityRenderer.spiralRadiusStart + slot * this.cityRenderer.spiralRadiusGrowth;

            const x = Math.cos(angle) * (radius - 2);
            const y = pos.y + 1.5;
            const z = Math.sin(angle) * (radius - 2);

            addDot('UNKNOWN', x, y, z);
        }
    }

    /**
     * Spiral galaxy layout (for functions, while-loops, generic containers).
     */
    _collectSpiralDots(key, entities, galaxyCenter, parentPos, parentColor, addDot) {
        const pathPoints = [];

        for (let i = 0; i < entities.length; i++) {
            const angle = i * this._galaxyAngleStep;
            const radius = this._galaxyRadiusStart + i * this._galaxyRadiusGrowth;
            const y = galaxyCenter.y + 0.3 + i * this._galaxyHeightStep;
            const x = galaxyCenter.x + Math.cos(angle) * radius;
            const z = galaxyCenter.z + Math.sin(angle) * radius;

            pathPoints.push(new BABYLON.Vector3(x, y, z));
            const colorType = entities[i].colorType || entities[i].type || 'CALL';
            addDot(colorType, x, y, z);
        }

        // Spiral path line
        if (pathPoints.length >= 2) {
            const pathColor = ColorHash.spiralColor(key + '_panoramic');
            const lines = BABYLON.MeshBuilder.CreateLines(
                `pano_path_${key}`,
                { points: pathPoints, updatable: false },
                this.scene
            );
            lines.color = new BABYLON.Color3(pathColor.r, pathColor.g, pathColor.b);
            lines.alpha = 0.5;
            lines.isPickable = false;
            this._meshes.push(lines);
        }

        // Warp connection line
        this._createWarpLine(key, parentPos, galaxyCenter, parentColor);
    }

    /**
     * Bubble layout for for-loops: dots arranged in a compact ring/helix
     * with a faint circle outline representing the bubble.
     */
    _collectBubbleDots(key, entities, bubbleCenter, parentPos, parentColor, addDot) {
        const count = entities.length;
        const bubbleRadius = 2.0 + count * 0.08;
        const pathPoints = [];

        for (let i = 0; i < count; i++) {
            // Compact ring with slight height variation
            const angle = (i / Math.max(count, 1)) * Math.PI * 2 * 1.3;
            const r = bubbleRadius * (0.4 + 0.5 * Math.sin((i / count) * Math.PI));
            const x = bubbleCenter.x + Math.cos(angle) * r;
            const y = bubbleCenter.y + 0.2 + (i * 0.04);
            const z = bubbleCenter.z + Math.sin(angle) * r;

            pathPoints.push(new BABYLON.Vector3(x, y, z));
            const colorType = entities[i].colorType || entities[i].type || 'LOOP';
            addDot(colorType, x, y, z);
        }

        // Ring path
        if (pathPoints.length >= 2) {
            const lines = BABYLON.MeshBuilder.CreateLines(
                `pano_bubble_path_${key}`,
                { points: pathPoints, updatable: false },
                this.scene
            );
            lines.color = new BABYLON.Color3(parentColor.r, parentColor.g, parentColor.b);
            lines.alpha = 0.4;
            lines.isPickable = false;
            this._meshes.push(lines);
        }

        // Faint bubble outline circle (16-segment ring)
        const ringPoints = [];
        const ringSegments = 16;
        for (let i = 0; i <= ringSegments; i++) {
            const a = (i / ringSegments) * Math.PI * 2;
            ringPoints.push(new BABYLON.Vector3(
                bubbleCenter.x + Math.cos(a) * bubbleRadius,
                bubbleCenter.y,
                bubbleCenter.z + Math.sin(a) * bubbleRadius
            ));
        }
        const ring = BABYLON.MeshBuilder.CreateLines(
            `pano_bubble_ring_${key}`,
            { points: ringPoints, updatable: false },
            this.scene
        );
        ring.color = new BABYLON.Color3(parentColor.r * 0.7, parentColor.g * 0.7, parentColor.b * 0.7);
        ring.alpha = 0.25;
        ring.isPickable = false;
        this._meshes.push(ring);

        // Warp connection line
        this._createWarpLine(key, parentPos, bubbleCenter, parentColor);
    }

    /**
     * Tree layout for if-statements: dots arranged in a branching Y-shape.
     * Root dot at top, two (or more) arms fanning downward with child dots.
     */
    _collectTreeDots(key, entities, childIndices, trace, treeCenter, parentPos, parentColor, addDot) {
        // Place root condition dot
        addDot('CONDITION', treeCenter.x, treeCenter.y, treeCenter.z);

        // Try to split entities into taken/not-taken arms
        // Simple heuristic: if we have BRANCH events, split around them
        const takenEntities = [];
        const otherEntities = [];

        for (const ent of entities) {
            if (ent.colorType === 'CONDITION' || ent.colorType === 'BRANCH') {
                otherEntities.push(ent);
            } else {
                takenEntities.push(ent);
            }
        }

        const allLeaves = takenEntities.length > 0 ? takenEntities : entities;

        // Split leaves into two arms (taken / not-taken approximation)
        const armCount = Math.min(2, Math.max(1, Math.ceil(allLeaves.length / 3)));
        const armSpread = 3.0;
        const leafDrop = 1.0;
        const allPathPoints = [new BABYLON.Vector3(treeCenter.x, treeCenter.y, treeCenter.z)];

        for (let arm = 0; arm < armCount; arm++) {
            const armX = treeCenter.x + (arm - (armCount - 1) / 2) * armSpread;
            const armY = treeCenter.y - 2.0;
            const armZ = treeCenter.z;

            // Arm branch dot
            addDot('BRANCH', armX, armY, armZ);

            // Line from root to arm
            const armLine = BABYLON.MeshBuilder.CreateLines(
                `pano_tree_arm_${key}_${arm}`,
                {
                    points: [
                        new BABYLON.Vector3(treeCenter.x, treeCenter.y, treeCenter.z),
                        new BABYLON.Vector3(armX, armY, armZ)
                    ],
                    updatable: false
                },
                this.scene
            );
            armLine.color = new BABYLON.Color3(parentColor.r, parentColor.g, parentColor.b);
            armLine.alpha = 0.45;
            armLine.isPickable = false;
            this._meshes.push(armLine);

            // Distribute child dots down each arm
            const armStart = Math.floor((arm / armCount) * allLeaves.length);
            const armEnd = Math.floor(((arm + 1) / armCount) * allLeaves.length);
            const armLeafPoints = [];

            let prevPoint = new BABYLON.Vector3(armX, armY, armZ);
            for (let l = armStart; l < armEnd; l++) {
                const leafY = armY - (l - armStart + 1) * leafDrop;
                const leafX = armX + ((l - armStart) % 2 === 0 ? 0.2 : -0.2);
                const leafZ = armZ;

                const colorType = allLeaves[l].colorType || allLeaves[l].type || 'DECL';
                addDot(colorType, leafX, leafY, leafZ);

                const leafPoint = new BABYLON.Vector3(leafX, leafY, leafZ);
                armLeafPoints.push(prevPoint, leafPoint);
                prevPoint = leafPoint;
            }

            // Leaf chain line
            if (armLeafPoints.length >= 2) {
                const leafLine = BABYLON.MeshBuilder.CreateLines(
                    `pano_tree_leaves_${key}_${arm}`,
                    { points: armLeafPoints, updatable: false },
                    this.scene
                );
                leafLine.color = new BABYLON.Color3(parentColor.r * 0.8, parentColor.g * 0.8, parentColor.b * 0.8);
                leafLine.alpha = 0.35;
                leafLine.isPickable = false;
                this._meshes.push(leafLine);
            }
        }

        // Warp connection line
        this._createWarpLine(key, parentPos, treeCenter, parentColor);
    }

    /**
     * Helper: create a warp connection line from parent building to galaxy/bubble/tree center.
     */
    _createWarpLine(key, parentPos, targetCenter, parentColor) {
        const warpLine = BABYLON.MeshBuilder.CreateLines(
            `pano_warp_${key}`,
            { points: [parentPos, targetCenter], updatable: false },
            this.scene
        );
        warpLine.color = new BABYLON.Color3(
            parentColor.r * 0.8, parentColor.g * 0.8, parentColor.b * 0.8
        );
        warpLine.alpha = 0.45;
        warpLine.isPickable = false;
        this._meshes.push(warpLine);
    }

    /**
     * Create a single low-poly source sphere for this colorType, then
     * stamp all collected positions as thin instances.
     * Result: 1 draw call for all dots of this type across ALL galaxies.
     */
    _stampDots(colorType, flatPositions) {
        const count = flatPositions.length / 3;
        if (count === 0) return;

        // Create the source sphere (2-segment = icosahedron-like, very cheap)
        const src = BABYLON.MeshBuilder.CreateSphere(
            `pano_src_${colorType}`,
            { diameter: 0.6, segments: 2 },
            this.scene
        );
        src.material = this._getCachedMat(colorType);
        src.isPickable = false;
        // Hide the source mesh itself (we only want instances)
        src.setEnabled(false);

        // Pre-allocate the thin-instance buffer
        // Each instance needs a 4×4 float matrix (16 floats)
        const matrices = new Float32Array(count * 16);
        const identity = BABYLON.Matrix.Identity();

        for (let i = 0; i < count; i++) {
            const x = flatPositions[i * 3];
            const y = flatPositions[i * 3 + 1];
            const z = flatPositions[i * 3 + 2];
            // Translation-only matrix (no rotation/scale needed for dots)
            identity.copyToArray(matrices, i * 16);
            matrices[i * 16 + 12] = x;
            matrices[i * 16 + 13] = y;
            matrices[i * 16 + 14] = z;
        }

        src.thinInstanceSetBuffer('matrix', matrices, 16, false);
        src.setEnabled(true);

        this._sourceMeshes.set(colorType, src);
        this._meshes.push(src);
    }

    // ─── Camera ────────────────────────────────────────────────────

    /**
     * Two-phase camera fly:
     *   1. Place camera under the first building at the top, looking straight up
     *   2. Descend to the very bottom of the spiral, still looking straight up
     */
    _flyCameraToOverview() {
        const camera = this.sceneManager.getCamera();
        this.scene.stopAnimation(camera);

        const bounds = this._panoBounds;
        if (!bounds) {
            this._flyCamera(new BABYLON.Vector3(10, 180, 10), BABYLON.Vector3.Zero());
            return;
        }

        // Get the position of the first building (slot 0 = top of spiral)
        const topPos = this.cityRenderer._spiralPositionBase(0);
        const bottomY = bounds.min.y;

        // Always look straight up from current position
        const lookUpOffset = 100;

        // Phase 1: snap under the first building, looking straight up
        const startPos = new BABYLON.Vector3(topPos.x, topPos.y - 2, topPos.z);
        const startTarget = new BABYLON.Vector3(topPos.x, topPos.y + lookUpOffset, topPos.z);

        // Phase 2: descend far below the bottom so the full scene fits in frame
        // Drop distance based on the widest horizontal extent and a ~60° FOV
        const width = Math.max(bounds.max.x - bounds.min.x, bounds.max.z - bounds.min.z);
        const dropBelow = Math.max(width * 1.2, 20);
        const endPos = new BABYLON.Vector3(topPos.x, bottomY - dropBelow, topPos.z);
        const endTarget = new BABYLON.Vector3(topPos.x, bottomY + lookUpOffset, topPos.z);

        this._flyCamera(startPos, startTarget, () => {
            this._flyCamera(endPos, endTarget);
        });
    }

    _flyCamera(newPos, newTarget, onComplete) {
        const camera = this.sceneManager.getCamera();
        this.scene.stopAnimation(camera);

        const posAnim = new BABYLON.Animation(
            'panoCameraPos', 'position', 30,
            BABYLON.Animation.ANIMATIONTYPE_VECTOR3,
            BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT
        );
        posAnim.setKeys([
            { frame: 0, value: camera.position.clone() },
            { frame: 60, value: newPos }
        ]);
        const ease = new BABYLON.CubicEase();
        ease.setEasingMode(BABYLON.EasingFunction.EASINGMODE_EASEINOUT);
        posAnim.setEasingFunction(ease);

        const targetAnim = new BABYLON.Animation(
            'panoCameraTarget', 'target', 30,
            BABYLON.Animation.ANIMATIONTYPE_VECTOR3,
            BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT
        );
        targetAnim.setKeys([
            { frame: 0, value: camera.target.clone() },
            { frame: 60, value: newTarget }
        ]);
        targetAnim.setEasingFunction(ease);

        const anim = this.scene.beginDirectAnimation(camera, [posAnim, targetAnim], 0, 60, false);
        if (onComplete) {
            anim.onAnimationEnd = onComplete;
        }
    }

    // ─── Main Spiral Dim/Restore ───────────────────────────────────

    _dimMainSpiral(alpha) {
        this._mainSpiralHidden = true;
        const cr = this.cityRenderer;

        const dimEntry = (entry) => {
            if (!entry) return;
            for (const part of ['mesh', 'cap', 'roof', 'chimney', 'truePath', 'falsePath']) {
                if (entry[part] && entry[part].material) {
                    if (entry[part].material.isFrozen) entry[part].material.unfreeze();
                    entry[part].material.alpha *= alpha;
                }
            }
            // Hide labels entirely in panoramic mode
            if (entry.label) entry.label.setEnabled(false);
        };

        for (const [, e] of cr.functionMeshes) dimEntry(e);
        for (const [, e] of cr.variableMeshes) dimEntry(e);
        for (const [, e] of cr.loopMeshes)     dimEntry(e);
        for (const [, e] of cr.whileMeshes)    dimEntry(e);
        for (const [, e] of cr.branchMeshes)   dimEntry(e);

        // Dim black holes and accretion disks
        for (const [, e] of cr.blackHoleMeshes) {
            if (e.mesh && e.mesh.material) {
                if (e.mesh.material.isFrozen) e.mesh.material.unfreeze();
                e.mesh.material.alpha *= alpha;
            }
            if (e.disk && e.disk.material) {
                if (e.disk.material.isFrozen) e.disk.material.unfreeze();
                e.disk.material.alpha *= alpha;
            }
            if (e.label) e.label.setEnabled(false);
            if (e.typeLabel) e.typeLabel.setEnabled(false);
        }

        // Dim console output bubbles
        for (const [, e] of cr.consoleBubbles) dimEntry(e);

        // Dim connection lines
        for (const conn of cr.blackHoleConnections) {
            if (conn) conn.alpha *= alpha;
        }

        if (cr._spiralTube && cr._spiralTube.material) {
            if (cr._spiralTube.material.isFrozen) cr._spiralTube.material.unfreeze();
            cr._spiralTube.material.alpha *= alpha;
        }

        // Hide memory rings
        for (const ring of cr.memoryLines) {
            if (ring && ring.material) {
                if (ring.material.isFrozen) ring.material.unfreeze();
                ring.material.alpha = 0;
            }
        }
    }

    _restoreMainSpiral() {
        if (!this._mainSpiralHidden) return;
        this._mainSpiralHidden = false;
        const cr = this.cityRenderer;

        const restoreEntry = (entry) => {
            if (!entry) return;
            if (entry.mesh && entry.mesh.material) {
                if (entry.mesh.material.isFrozen) entry.mesh.material.unfreeze();
                entry.mesh.material.alpha = 0.85;
            }
            for (const part of ['cap', 'roof', 'chimney', 'truePath', 'falsePath']) {
                if (entry[part] && entry[part].material) {
                    if (entry[part].material.isFrozen) entry[part].material.unfreeze();
                    entry[part].material.alpha = 0.9;
                }
            }
            // Re-enable labels
            if (entry.label) entry.label.setEnabled(true);
        };

        for (const [, e] of cr.functionMeshes) restoreEntry(e);
        for (const [, e] of cr.variableMeshes) restoreEntry(e);
        for (const [, e] of cr.loopMeshes)     restoreEntry(e);
        for (const [, e] of cr.whileMeshes)    restoreEntry(e);
        for (const [, e] of cr.branchMeshes)   restoreEntry(e);

        // Restore black holes and accretion disks
        for (const [, e] of cr.blackHoleMeshes) {
            if (e.mesh && e.mesh.material) {
                if (e.mesh.material.isFrozen) e.mesh.material.unfreeze();
                e.mesh.material.alpha = 0.95;
            }
            if (e.disk && e.disk.material) {
                if (e.disk.material.isFrozen) e.disk.material.unfreeze();
                e.disk.material.alpha = 0.7;
            }
            if (e.label) e.label.setEnabled(true);
            if (e.typeLabel) e.typeLabel.setEnabled(true);
        }

        // Restore console output bubbles
        for (const [, e] of cr.consoleBubbles) restoreEntry(e);

        // Restore connection lines
        for (const conn of cr.blackHoleConnections) {
            if (conn) conn.alpha = 0.4;
        }

        if (cr._spiralTube && cr._spiralTube.material) {
            if (cr._spiralTube.material.isFrozen) cr._spiralTube.material.unfreeze();
            cr._spiralTube.material.alpha = 0.55;
        }

        // Restore memory rings
        for (const ring of cr.memoryLines) {
            if (ring && ring.material) {
                if (ring.material.isFrozen) ring.material.unfreeze();
                ring.material.alpha = 0.5;
            }
        }
    }

    // ─── Material Cache (flat, no emissive/specular — max ~10 materials) ──

    _getCachedMat(colorType) {
        if (this._matCache.has(colorType)) return this._matCache.get(colorType);
        const color = this._colorForType(colorType);
        const mat = new BABYLON.StandardMaterial(`panoMat_${colorType}`, this.scene);
        mat.diffuseColor = new BABYLON.Color3(color.r, color.g, color.b);
        mat.specularColor = BABYLON.Color3.Black();
        mat.emissiveColor = BABYLON.Color3.Black();
        mat.alpha = color.a !== undefined ? color.a : 0.8;
        mat.disableLighting = false;
        mat.freeze();
        this._matCache.set(colorType, mat);
        return mat;
    }

    /** Colour palette: colorType (uppercase) → {r,g,b,a}. */
    _colorForType(type) {
        switch (type) {
            case 'CALL':         return { r: 0.9, g: 0.3, b: 0.3, a: 0.75 };
            case 'RETURN':       return { r: 0.9, g: 0.6, b: 0.2, a: 0.75 };
            case 'DECL':         return { r: 0.3, g: 0.5, b: 0.9, a: 0.75 };
            case 'PARAM':        return { r: 0.4, g: 0.6, b: 1.0, a: 0.75 };
            case 'ASSIGN':       return { r: 0.3, g: 0.8, b: 0.9, a: 0.75 };
            case 'LOOP':         return { r: 0.7, g: 0.3, b: 0.9, a: 0.75 };
            case 'CONDITION':    return { r: 0.9, g: 0.5, b: 0.2, a: 0.75 };
            case 'BRANCH':       return { r: 0.9, g: 0.8, b: 0.2, a: 0.75 };
            case 'EXTERNAL_CALL': return { r: 0.6, g: 0.3, b: 0.8, a: 0.9 };  // Purple for black holes
            case 'UNKNOWN':      return { r: 0.4, g: 0.6, b: 0.8, a: 0.6 };   // Light blue for console
            default:             return { r: 0.5, g: 0.5, b: 0.5, a: 0.75 };
        }
    }

    // ─── Disposal ──────────────────────────────────────────────────

    _disposeMeshes() {
        for (const mesh of this._meshes) {
            try {
                if (mesh) {
                    mesh.material = null;
                    mesh.dispose();
                }
            } catch (e) { /* already disposed */ }
        }
        this._meshes = [];
        this._sourceMeshes.clear();
    }

    _disposeMaterials() {
        this._matCache.forEach(mat => {
            try { if (mat) mat.dispose(); } catch (e) { /* already disposed */ }
        });
        this._matCache.clear();
    }
}
