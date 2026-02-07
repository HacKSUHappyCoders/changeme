/**
 * GalaxyWarpManager — "Warp to Galaxy" feature
 *
 * When the user double-clicks a building that has child steps (a sub-spiral),
 * this manager:
 *   1. Creates a full-size spiral "galaxy" at an offset position, built from
 *      the building's child trace data.
 *   2. Draws a colorful animated warp line connecting the original building
 *      to the new galaxy.
 *   3. Smoothly flies the camera to the new galaxy.
 *   4. Provides returnToMainGalaxy() to fly back and clean up.
 *
 * The galaxy is rendered using a dedicated WorldState + CityRenderer pair
 * so it gets the full spiral treatment (buildings, labels, spiral tube, etc).
 */
class GalaxyWarpManager {
    constructor(scene, sceneManager, mainCityRenderer) {
        this.scene = scene;
        this.sceneManager = sceneManager;
        this.mainCityRenderer = mainCityRenderer;

        /** Currently warped galaxy info, or null */
        this.warpedGalaxy = null;

        /** Galaxy stack for recursive warping (each entry = a warpedGalaxy) */
        this._galaxyStack = [];

        // Offset distance — how far from the main spiral the galaxy spawns
        this.galaxyOffset = 200;

        // Warp line
        this._warpLine = null;
        this._warpLineMat = null;
        this._warpParticles = [];

        // Glow ring around source building
        this._sourceGlow = null;

        // Label at the galaxy
        this._galaxyLabel = null;

        // All meshes created for the sub-galaxy (so we can dispose them)
        this._galaxyMeshes = [];

        // All extra meshes (roofs, labels) created inside _createGalaxyBuilding
        this._galaxyExtraMeshes = [];

        // The sub-galaxy's own spiral data
        this._galaxySlots = [];
        this._galaxySpiralTube = null;

        // Pending setTimeout IDs for staggered animations
        this._pendingTimers = [];

        // ── Performance: shared material cache (type → StandardMaterial) ──
        this._matCache = new Map();
    }

    // ─── Public API ────────────────────────────────────────────────

    /**
     * Check if a building has child steps that can be warped to.
     * Works for both main-spiral buildings and galaxy buildings.
     */
    canWarp(buildingMesh) {
        if (!buildingMesh || !buildingMesh._entityData) return false;
        const entity = buildingMesh._entityData;
        // Main spiral buildings have childStepIndices
        if (entity.childStepIndices && entity.childStepIndices.length > 0) return true;
        // Galaxy buildings have _galaxyChildIndices (relative to their sub-trace)
        if (buildingMesh._galaxyChildIndices && buildingMesh._galaxyChildIndices.length > 0) return true;
        // Galaxy buildings for calls/loops/conditions may have step indices that indicate sub-steps
        if (entity.type === 'call' || entity.type === 'loop' || entity.type === 'condition') {
            if (entity.stepIndices && entity.stepIndices.length > 1) return true;
        }
        return false;
    }

    /**
     * Is the user currently in a warped galaxy?
     */
    isWarped() {
        return this.warpedGalaxy !== null;
    }

    /**
     * Warp to the galaxy for the given building.
     * Supports both main-spiral buildings and galaxy buildings (recursive warp).
     */
    warpTo(buildingMesh) {
        if (!this.canWarp(buildingMesh)) return;

        const entity = buildingMesh._entityData;
        const sourcePos = buildingMesh.position.clone();

        // Determine the sub-trace for this galaxy
        let subTrace;
        if (buildingMesh._galaxySubTrace && buildingMesh._galaxyChildIndices && buildingMesh._galaxyChildIndices.length > 0) {
            // Recursive warp: galaxy building → use its stored sub-trace slice
            const parentSubTrace = buildingMesh._galaxySubTrace;
            const childIndices = buildingMesh._galaxyChildIndices;
            subTrace = childIndices.map(idx => parentSubTrace[idx]).filter(Boolean);
        } else if (buildingMesh._galaxySubTrace && entity.stepIndices && entity.stepIndices.length > 0) {
            // Galaxy building without explicit child indices but with stepIndices
            // Use a broader range: from the first step index to the end of the
            // entity's scope in the parent sub-trace
            const parentSubTrace = buildingMesh._galaxySubTrace;
            const firstIdx = entity.stepIndices[0];
            
            // For calls, collect all steps following the call until matching RETURN
            if (entity.type === 'call') {
                const callStep = parentSubTrace[firstIdx];
                const callDepth = Number(callStep && callStep.depth) || 0;
                const children = [];
                let callBalance = 1; // We've seen 1 CALL, need to match its RETURN
                for (let j = firstIdx + 1; j < parentSubTrace.length; j++) {
                    const step = parentSubTrace[j];
                    if (!step) continue;
                    const d = Number(step.depth) || 0;
                    // Track nested calls to match the right RETURN
                    if (step.type === 'CALL' && d <= callDepth) callBalance++;
                    if (step.type === 'RETURN' && d <= callDepth) {
                        callBalance--;
                        if (callBalance <= 0) {
                            children.push(parentSubTrace[j]);
                            break;
                        }
                    }
                    if (d < callDepth) break;
                    children.push(parentSubTrace[j]);
                }
                subTrace = children;
            } else {
                // For loops/conditions, use step indices to gather surrounding steps
                const minIdx = Math.min(...entity.stepIndices);
                const maxIdx = Math.max(...entity.stepIndices);
                // Expand range to include child steps between the entity's steps
                const expandedEnd = Math.min(maxIdx + 20, parentSubTrace.length - 1);
                const collected = [];
                for (let j = minIdx; j <= expandedEnd; j++) {
                    if (parentSubTrace[j]) collected.push(parentSubTrace[j]);
                }
                subTrace = collected;
            }
        } else {
            // Main-spiral building → use the full trace with childStepIndices
            const trace = this.mainCityRenderer._lastTrace || [];
            const childIndices = entity.childStepIndices;
            subTrace = childIndices.map(idx => trace[idx]).filter(Boolean);
        }
        if (subTrace.length === 0) return;

        // If already in a galaxy, push current state onto the stack
        if (this.warpedGalaxy) {
            this._galaxyStack.push(this.warpedGalaxy);
            // Don't dispose the current galaxy — just dim it further
            this._dimGalaxyMeshes(this.warpedGalaxy, 0.15);
        } else {
            // First warp — dim the main spiral
            this._dimMainSpiral(0.3);
        }

        // Determine galaxy center — offset from source building
        const stackDepth = this._galaxyStack.length;
        const dirX = sourcePos.x || 1;
        const dirZ = sourcePos.z || 1;
        const dirLen = Math.sqrt(dirX * dirX + dirZ * dirZ) || 1;
        const offset = this.galaxyOffset + stackDepth * 60;
        const galaxyCenter = new BABYLON.Vector3(
            sourcePos.x + (dirX / dirLen) * offset,
            sourcePos.y + 10 + stackDepth * 15,
            sourcePos.z + (dirZ / dirLen) * offset
        );

        // Get building color for the warp line
        const bd = buildingMesh._buildingData || {};
        const color = bd.color || this._colorForType(entity.colorType || entity.type || 'CALL');

        // Create the galaxy — pass the subTrace so galaxy buildings can reference it
        const galaxyData = this._buildGalaxy(subTrace, galaxyCenter, entity);

        // Create the warp line
        this._createWarpLine(sourcePos, galaxyCenter, color);

        // Create glow ring on source building
        this._createSourceGlow(sourcePos, color);

        // Create label at galaxy
        this._createGalaxyLabel(galaxyCenter, entity);

        // Store state
        this.warpedGalaxy = {
            buildingMesh,
            entity,
            sourcePos,
            galaxyCenter,
            galaxyData,
            color,
            // Keep references for cleanup
            galaxyMeshes: [...this._galaxyMeshes],
            galaxyExtraMeshes: [...this._galaxyExtraMeshes],
            galaxySpiralTube: this._galaxySpiralTube,
            warpLine: this._warpLine,
            warpLineMat: this._warpLineMat,
            warpParticles: [...this._warpParticles],
            warpParticleSharedMat: this._warpParticleSharedMat || null,
            sourceGlow: this._sourceGlow,
            galaxyLabel: this._galaxyLabel,
            subTrace  // stored so child galaxies can slice into it
        };

        // Clear current references (they're now owned by the stacked warpedGalaxy)
        this._galaxyMeshes = [];
        this._galaxyExtraMeshes = [];
        this._galaxySpiralTube = null;
        this._warpLine = null;
        this._warpLineMat = null;
        this._warpParticles = [];
        this._warpParticleSharedMat = null;
        this._sourceGlow = null;
        this._galaxyLabel = null;

        // Fly the camera to the galaxy
        this._flyCamera(galaxyCenter, true);

        // Show the return button
        this._showReturnButton(true);
    }

    /**
     * Return from the warped galaxy.
     * If there's a parent galaxy on the stack, go back to it.
     * Otherwise, return to the main spiral.
     * @param {boolean} animate — whether to animate the camera fly-back
     */
    returnToMainGalaxy(animate = true) {
        if (!this.warpedGalaxy) return;

        // Stop any in-progress camera animation
        const camera = this.sceneManager.getCamera();
        this.scene.stopAnimation(camera);

        // Cancel pending stagger timers
        this._pendingTimers.forEach(id => clearTimeout(id));
        this._pendingTimers = [];

        // Clean up the current galaxy's meshes
        this._disposeWarpedGalaxy(this.warpedGalaxy);

        if (this._galaxyStack.length > 0) {
            // Pop to parent galaxy
            const parent = this._galaxyStack.pop();

            // Restore parent galaxy's references so we can clean them up later
            this._galaxyMeshes = parent.galaxyMeshes || [];
            this._galaxyExtraMeshes = parent.galaxyExtraMeshes || [];
            this._galaxySpiralTube = parent.galaxySpiralTube;
            this._warpLine = parent.warpLine;
            this._warpLineMat = parent.warpLineMat;
            this._warpParticles = parent.warpParticles || [];
            this._warpParticleSharedMat = parent.warpParticleSharedMat;
            this._sourceGlow = parent.sourceGlow;
            this._galaxyLabel = parent.galaxyLabel;

            // Restore parent galaxy opacity
            this._restoreGalaxyMeshes(parent);

            this.warpedGalaxy = parent;

            // Fly camera back to parent galaxy
            if (animate) {
                this._flyCamera(parent.galaxyCenter, true);
            }
        } else {
            // Return to main spiral
            this.warpedGalaxy = null;

            // Restore main spiral opacity
            this._dimMainSpiral(1.0);

            // Fly camera back
            if (animate) {
                this._flyCamera(new BABYLON.Vector3(0, 10, 0), false);
            }

            // Hide return button
            this._showReturnButton(false);
        }
    }

    /**
     * Dispose all meshes belonging to a single warpedGalaxy entry.
     */
    _disposeWarpedGalaxy(galaxy) {
        if (!galaxy) return;

        const cachedMats = new Set(this._matCache.values());

        // Dispose galaxy meshes
        const allMeshes = [...(galaxy.galaxyMeshes || []), ...(galaxy.galaxyExtraMeshes || [])];
        for (const mesh of allMeshes) {
            if (mesh && !mesh.isDisposed()) {
                this.scene.stopAnimation(mesh);
                if (mesh.material) {
                    if (!cachedMats.has(mesh.material)) {
                        if (mesh.material.diffuseTexture) mesh.material.diffuseTexture.dispose();
                        mesh.material.dispose();
                    } else {
                        mesh.material = null;
                    }
                }
                mesh.dispose();
            }
        }

        // Dispose warp line
        if (galaxy.warpLine && !galaxy.warpLine.isDisposed()) {
            this.scene.stopAnimation(galaxy.warpLine);
            if (galaxy.warpLine.material) galaxy.warpLine.material.dispose();
            galaxy.warpLine.dispose();
        }

        // Dispose warp particles
        if (galaxy.warpParticles) {
            for (const p of galaxy.warpParticles) {
                if (p && !p.isDisposed()) {
                    this.scene.stopAnimation(p);
                    p.material = null;
                    p.dispose();
                }
            }
        }
        if (galaxy.warpParticleSharedMat) {
            galaxy.warpParticleSharedMat.dispose();
        }

        // Dispose source glow
        if (galaxy.sourceGlow && !galaxy.sourceGlow.isDisposed()) {
            this.scene.stopAnimation(galaxy.sourceGlow);
            if (galaxy.sourceGlow.material) galaxy.sourceGlow.material.dispose();
            galaxy.sourceGlow.dispose();
        }

        // Dispose galaxy label
        if (galaxy.galaxyLabel && !galaxy.galaxyLabel.isDisposed()) {
            this.scene.stopAnimation(galaxy.galaxyLabel);
            if (galaxy.galaxyLabel.material) {
                if (galaxy.galaxyLabel.material.diffuseTexture) {
                    galaxy.galaxyLabel.material.diffuseTexture.dispose();
                }
                galaxy.galaxyLabel.material.dispose();
            }
            galaxy.galaxyLabel.dispose();
        }
    }

    /**
     * Dim the meshes of a galaxy entry (when warping deeper).
     */
    _dimGalaxyMeshes(galaxy, alpha) {
        const allMeshes = [...(galaxy.galaxyMeshes || []), ...(galaxy.galaxyExtraMeshes || [])];
        for (const mesh of allMeshes) {
            if (mesh && !mesh.isDisposed() && mesh.material && !mesh.material.isFrozen) {
                mesh.material.alpha = (mesh.material.alpha || 0.85) * alpha;
            }
        }
    }

    /**
     * Restore the meshes of a galaxy entry (when returning from a deeper warp).
     */
    _restoreGalaxyMeshes(galaxy) {
        const allMeshes = [...(galaxy.galaxyMeshes || []), ...(galaxy.galaxyExtraMeshes || [])];
        for (const mesh of allMeshes) {
            if (mesh && !mesh.isDisposed() && mesh.material) {
                // Unfreeze so we can modify alpha
                if (mesh.material.isFrozen) mesh.material.unfreeze();
                mesh.material.alpha = 0.85;
            }
        }
    }

    // ─── Galaxy Builder ────────────────────────────────────────────

    /**
     * Build a full mini-city (galaxy) from a sub-trace at the given center.
     * Uses the SubSpiralRenderer's consolidation logic to deduplicate entities,
     * then lays them out on a spiral.
     */
    _buildGalaxy(subTrace, center, parentEntity) {
        const renderer = this.mainCityRenderer.subSpiralRenderer;
        // Use the consolidation logic to get deduplicated entities
        const allIndices = subTrace.map((_, i) => i);
        const entities = renderer._consolidateChildren(allIndices, subTrace);

        // Reset extra meshes list before building — _createGalaxyBuilding will push into it
        this._galaxyExtraMeshes = [];

        const meshes = [];
        const pathPoints = [];

        // Galaxy spiral config — slightly bigger than sub-spiral
        const radiusStart = 4.0;
        const radiusGrowth = 0.25;
        const angleStep = 0.7;
        const heightStep = 0.08;

        // ── Pre-compute child-step ranges for container entities ──
        // Walk through the sub-trace to figure out which steps belong
        // to which container (call, loop, condition). This lets
        // galaxy buildings have child steps for recursive warping.
        const entityChildMap = this._computeGalaxyChildMap(subTrace, entities);

        for (let i = 0; i < entities.length; i++) {
            const angle = i * angleStep;
            const radius = radiusStart + i * radiusGrowth;
            const y = center.y + 0.5 + i * heightStep;
            const pos = new BABYLON.Vector3(
                center.x + Math.cos(angle) * radius,
                y,
                center.z + Math.sin(angle) * radius
            );
            pathPoints.push(pos.clone());

            const entity = entities[i];
            const mesh = this._createGalaxyBuilding(entity, pos, i, parentEntity.key || 'galaxy');

            // Attach child step data for recursive galaxy warping
            const childIndices = entityChildMap.get(i);
            if (childIndices && childIndices.length > 0) {
                mesh._galaxyChildIndices = childIndices;
            }
            // Always attach the sub-trace so recursive warping can use it
            mesh._galaxySubTrace = subTrace;

            meshes.push(mesh);
        }

        // Spiral tube for the galaxy
        let spiralTube = null;
        if (pathPoints.length >= 2) {
            spiralTube = BABYLON.MeshBuilder.CreateTube('galaxySpiralTube', {
                path: pathPoints,
                radius: 0.15,
                sideOrientation: BABYLON.Mesh.DOUBLESIDE,
                tessellation: 8
            }, this.scene);
            const mat = new BABYLON.StandardMaterial('galaxySpiralMat', this.scene);
            mat.emissiveColor = new BABYLON.Color3(0.6, 0.5, 0.9);
            mat.diffuseColor = new BABYLON.Color3(0.7, 0.6, 1.0);
            mat.alpha = 0.55;
            mat.freeze();
            spiralTube.material = mat;
            spiralTube.isPickable = false;
            spiralTube.freezeWorldMatrix();
            meshes.push(spiralTube);
        }

        this._galaxyMeshes = [...meshes, ...this._galaxyExtraMeshes];
        this._galaxySpiralTube = spiralTube;

        // ── Render a causality web within the galaxy ──
        const causalityMeshes = this._renderGalaxyCausalityWeb(subTrace, entities, meshes.filter(m => m._isGalaxyBuilding));
        if (causalityMeshes.length > 0) {
            this._galaxyMeshes.push(...causalityMeshes);
            this._galaxyExtraMeshes.push(...causalityMeshes);
        }

        // Clear pending timers from any previous galaxy
        this._pendingTimers.forEach(id => clearTimeout(id));
        this._pendingTimers = [];

        // Create a single reusable pop-in animation template
        const popAnim = new BABYLON.Animation(
            'galaxyPopShared', 'scaling', 30,
            BABYLON.Animation.ANIMATIONTYPE_VECTOR3,
            BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT
        );
        popAnim.setKeys([
            { frame: 0, value: new BABYLON.Vector3(0, 0, 0) },
            { frame: 10, value: new BABYLON.Vector3(1.15, 1.15, 1.15) },
            { frame: 15, value: new BABYLON.Vector3(1, 1, 1) }
        ]);
        const ease = new BABYLON.CubicEase();
        ease.setEasingMode(BABYLON.EasingFunction.EASINGMODE_EASEOUT);
        popAnim.setEasingFunction(ease);

        // Animate with staggered pop and freeze after animation completes
        const buildingMeshes = meshes.filter(m => m._isGalaxyBuilding);
        buildingMeshes.forEach((mesh, i) => {
            mesh.scaling = new BABYLON.Vector3(0, 0, 0);
            const timerId = setTimeout(() => {
                if (!mesh.isDisposed()) {
                    this.scene.beginDirectAnimation(mesh, [popAnim], 0, 15, false, 1.0, () => {
                        // Ensure final scale is exactly 1 and refresh bounding info for picking
                        if (!mesh.isDisposed()) {
                            mesh.scaling = new BABYLON.Vector3(1, 1, 1);
                            mesh.refreshBoundingInfo();
                            mesh.freezeWorldMatrix();
                        }
                    });
                }
            }, i * 40);  // slightly faster stagger (40ms vs 50ms)
            this._pendingTimers.push(timerId);
        });

        // Freeze extra meshes (roofs, labels) immediately
        for (const extra of this._galaxyExtraMeshes) {
            if (extra && !extra.isDisposed()) {
                extra.freezeWorldMatrix();
            }
        }

        return { entities, meshes, pathPoints, center };
    }

    /**
     * Compute which sub-trace indices belong to each container entity.
     * Container types (call, loop, condition) own a range of child steps:
     *   - CALL: from the call step until the matching RETURN (same depth)
     *   - LOOP: from the loop step until condition_result becomes 0 or a
     *     different container starts at the same depth
     *   - CONDITION: from the condition step until the matching BRANCH
     *
     * Returns a Map<entityIndex, number[]> of sub-trace child indices.
     */
    _computeGalaxyChildMap(subTrace, entities) {
        const childMap = new Map();

        // Build a quick lookup: sub-trace index → which entity owns it
        // (entities that are containers we care about)
        for (let ei = 0; ei < entities.length; ei++) {
            const entity = entities[ei];
            const containerTypes = ['call', 'loop', 'condition'];
            if (!containerTypes.includes(entity.type)) continue;

            const firstStepIdx = entity.stepIndices ? entity.stepIndices[0] : -1;
            if (firstStepIdx < 0) continue;

            const firstStep = subTrace[firstStepIdx];
            if (!firstStep) continue;

            const children = [];
            const startDepth = Number(firstStep.depth) || 0;
            const entityName = firstStep.name || firstStep.subject || '';
            let callBalance = 1; // used only for call entities

            // Walk forward from the first step to collect children
            for (let j = firstStepIdx + 1; j < subTrace.length; j++) {
                const step = subTrace[j];
                if (!step) continue;

                const stepDepth = Number(step.depth) || 0;

                // For calls: collect everything until the matching RETURN.
                // Track nested call balance to handle same-depth recursion.
                if (entity.type === 'call') {
                    if (step.type === 'CALL' && stepDepth <= startDepth) {
                        callBalance++;
                    }
                    if (step.type === 'RETURN' && stepDepth <= startDepth) {
                        callBalance--;
                        if (callBalance <= 0) {
                            children.push(j); // include the RETURN itself
                            break;
                        }
                    }
                    if (stepDepth < startDepth) break;
                    children.push(j);
                }
                // For loops: steps on the same or deeper depth until
                // we see another loop/call at the same depth
                else if (entity.type === 'loop') {
                    if (stepDepth < startDepth) break;
                    if (stepDepth === startDepth &&
                        (step.type === 'CALL' || step.type === 'CONDITION') &&
                        j !== firstStepIdx) break;
                    // For a new LOOP event at same depth with a different condition, break
                    if (stepDepth === startDepth && step.type === 'LOOP' &&
                        j !== firstStepIdx &&
                        step.condition !== firstStep.condition) break;
                    children.push(j);
                }
                // For conditions: a few steps following the condition
                else if (entity.type === 'condition') {
                    if (step.type === 'BRANCH') {
                        children.push(j);
                        break;
                    }
                    if (stepDepth < startDepth) break;
                    children.push(j);
                }
            }

            if (children.length > 0) {
                childMap.set(ei, children);
            }
        }

        return childMap;
    }

    /**
     * Render a causality web within a galaxy.
     * Finds READ→ASSIGN relationships in the sub-trace and draws arc lines
     * between the corresponding galaxy building meshes.
     */
    _renderGalaxyCausalityWeb(subTrace, entities, buildingMeshes) {
        const createdMeshes = [];
        if (!subTrace || subTrace.length === 0 || buildingMeshes.length === 0) return createdMeshes;

        // Build a map: variable name+address → entity index (for variable entities)
        const varEntityMap = new Map();
        for (let i = 0; i < entities.length; i++) {
            const ent = entities[i];
            if (ent.type === 'variable') {
                const key = `${ent.subject || ent.label}|${ent.address || ''}`;
                varEntityMap.set(key, i);
                // Also map by name alone for broader matching
                if (!varEntityMap.has(ent.subject || ent.label)) {
                    varEntityMap.set(ent.subject || ent.label, i);
                }
            }
        }

        // Walk through the sub-trace looking for READ→ASSIGN patterns
        const links = [];
        const seen = new Set();
        const pendingReads = [];

        for (let i = 0; i < subTrace.length; i++) {
            const step = subTrace[i];
            if (!step) continue;

            if (step.type === 'READ') {
                pendingReads.push({
                    name: step.name || step.subject || '',
                    address: step.address || '',
                    line: Number(step.line) || 0,
                    idx: i
                });
            } else if (step.type === 'ASSIGN' || step.type === 'DECL') {
                const targetName = step.name || step.subject || '';
                const targetAddr = step.address || '';
                const targetLine = Number(step.line) || 0;

                // Find the target entity
                let targetEI = varEntityMap.get(`${targetName}|${targetAddr}`);
                if (targetEI === undefined) targetEI = varEntityMap.get(targetName);
                if (targetEI === undefined) continue;

                // Match pending reads
                const remaining = [];
                for (const pr of pendingReads) {
                    const lineDist = Math.abs(targetLine - pr.line);
                    const stepDist = i - pr.idx;
                    if (lineDist <= 2 || stepDist <= 5) {
                        let sourceEI = varEntityMap.get(`${pr.name}|${pr.address}`);
                        if (sourceEI === undefined) sourceEI = varEntityMap.get(pr.name);
                        if (sourceEI !== undefined && sourceEI !== targetEI) {
                            const linkId = `${sourceEI}->${targetEI}`;
                            if (!seen.has(linkId)) {
                                seen.add(linkId);
                                links.push({ fromEI: sourceEI, toEI: targetEI });
                            }
                        }
                    } else if (stepDist <= 20) {
                        remaining.push(pr);
                    }
                    // else too old, discard
                }
                pendingReads.length = 0;
                pendingReads.push(...remaining);
            }
        }

        // Also use heuristic: if ASSIGN uses data from variables on the same/adjacent line
        for (let i = 0; i < subTrace.length; i++) {
            const step = subTrace[i];
            if (!step || step.type !== 'ASSIGN') continue;
            const targetName = step.name || step.subject || '';
            const targetAddr = step.address || '';
            const targetLine = Number(step.line) || 0;
            let targetEI = varEntityMap.get(`${targetName}|${targetAddr}`);
            if (targetEI === undefined) targetEI = varEntityMap.get(targetName);
            if (targetEI === undefined) continue;

            for (let j = i - 1; j >= Math.max(0, i - 6); j--) {
                const prev = subTrace[j];
                if (!prev) continue;
                if (prev.type !== 'ASSIGN' && prev.type !== 'DECL') continue;
                const prevName = prev.name || prev.subject || '';
                const prevAddr = prev.address || '';
                const prevLine = Number(prev.line) || 0;
                if (Math.abs(targetLine - prevLine) > 1) continue;

                let sourceEI = varEntityMap.get(`${prevName}|${prevAddr}`);
                if (sourceEI === undefined) sourceEI = varEntityMap.get(prevName);
                if (sourceEI === undefined || sourceEI === targetEI) continue;

                const linkId = `${sourceEI}->${targetEI}`;
                if (!seen.has(linkId)) {
                    seen.add(linkId);
                    links.push({ fromEI: sourceEI, toEI: targetEI });
                }
            }
        }

        if (links.length === 0) return createdMeshes;

        // Render causality arcs
        const allLines = [];
        const allColors = [];

        for (const link of links) {
            const fromMesh = buildingMeshes[link.fromEI];
            const toMesh = buildingMeshes[link.toEI];
            if (!fromMesh || !toMesh) continue;

            const fromPos = fromMesh.position;
            const toPos = toMesh.position;

            const midPoint = BABYLON.Vector3.Lerp(fromPos, toPos, 0.5);
            const dist = BABYLON.Vector3.Distance(fromPos, toPos);
            midPoint.y += dist * 0.15 + 0.5;

            // 8-segment Bézier
            const pts = [];
            const segments = 8;
            for (let s = 0; s <= segments; s++) {
                const t = s / segments;
                const x = (1 - t) * (1 - t) * fromPos.x + 2 * (1 - t) * t * midPoint.x + t * t * toPos.x;
                const y = (1 - t) * (1 - t) * fromPos.y + 2 * (1 - t) * t * midPoint.y + t * t * toPos.y;
                const z = (1 - t) * (1 - t) * fromPos.z + 2 * (1 - t) * t * midPoint.z + t * t * toPos.z;
                pts.push(new BABYLON.Vector3(x, y, z));
            }
            const col = new BABYLON.Color4(0.7, 0.6, 0.9, 0.6);
            const cols = new Array(pts.length).fill(col);
            allLines.push(pts);
            allColors.push(cols);
        }

        if (allLines.length > 0) {
            const lineSystem = BABYLON.MeshBuilder.CreateLineSystem('galaxyCausalLines', {
                lines: allLines,
                colors: allColors
            }, this.scene);
            const lineMat = new BABYLON.StandardMaterial('galaxyCausalLineMat', this.scene);
            lineMat.emissiveColor = new BABYLON.Color3(0.7, 0.6, 0.9);
            lineMat.disableLighting = true;
            lineSystem.material = lineMat;
            lineSystem.isPickable = false;
            lineSystem.freezeWorldMatrix();
            createdMeshes.push(lineSystem);
        }

        return createdMeshes;
    }

    /**
     * Create a single building mesh for the galaxy.
     * Uses cached materials per entity type for performance.
     */
    _createGalaxyBuilding(entity, pos, index, parentKey) {
        const colorType = entity.colorType || entity.type || 'CALL';
        const color = this._colorForType(colorType);

        let mesh;

        switch (entity.type) {
            case 'variable': {
                // Box house
                const height = 2.0;
                mesh = BABYLON.MeshBuilder.CreateBox(
                    `galaxy_var_${parentKey}_${index}`,
                    { height, width: 1.5, depth: 1.5 },
                    this.scene
                );
                mesh.position = pos.clone();
                mesh.position.y += height / 2;

                // Roof — share material via cache
                const roof = BABYLON.MeshBuilder.CreateCylinder(
                    `galaxy_varRoof_${parentKey}_${index}`,
                    { height: 0.6, diameterTop: 0, diameterBottom: 2.0, tessellation: 4 },
                    this.scene
                );
                roof.bakeTransformIntoVertices(BABYLON.Matrix.RotationY(Math.PI / 4));
                roof.position = pos.clone();
                roof.position.y += height + 0.3;
                roof.material = this._getCachedMat('varRoof', {
                    r: Math.min(color.r * 1.3, 1),
                    g: Math.min(color.g * 1.3, 1),
                    b: Math.min(color.b * 1.3, 1),
                    a: 0.9
                });
                roof.isPickable = false;
                this._galaxyExtraMeshes.push(roof);
                break;
            }
            case 'loop': {
                // Hexagonal factory
                const height = 3.0;
                mesh = BABYLON.MeshBuilder.CreateCylinder(
                    `galaxy_loop_${parentKey}_${index}`,
                    { height, diameterTop: 2.0 * 0.75, diameterBottom: 2.0, tessellation: 6 },
                    this.scene
                );
                mesh.position = pos.clone();
                mesh.position.y += height / 2;
                break;
            }
            case 'call':
            case 'return': {
                // Tall tower — reduced tessellation
                const height = 3.5;
                mesh = BABYLON.MeshBuilder.CreateCylinder(
                    `galaxy_call_${parentKey}_${index}`,
                    { height, diameterTop: 1.0, diameterBottom: 2.5, tessellation: 4 },
                    this.scene
                );
                const bake = BABYLON.Matrix.RotationY(Math.PI / 4)
                    .multiply(BABYLON.Matrix.Translation(0, height / 2, 0));
                mesh.bakeTransformIntoVertices(bake);
                mesh.position = pos.clone();
                break;
            }
            default: {
                // Generic sphere — fewer segments
                mesh = BABYLON.MeshBuilder.CreateSphere(
                    `galaxy_gen_${parentKey}_${index}`,
                    { diameter: 1.8, segments: 6 },
                    this.scene
                );
                mesh.position = pos.clone();
                mesh.position.y += 0.9;
                break;
            }
        }

        // Use shared cached material per entity type
        mesh.material = this._getCachedMat(colorType, color);
        mesh.isPickable = true;
        mesh._isGalaxyBuilding = true;
        mesh._entityData = entity;

        // Create a floating label
        const labelText = entity.label || entity.subject || entity.type;
        const label = this._createLabel(
            `galaxy_label_${parentKey}_${index}`,
            labelText,
            mesh.position.clone(),
            color
        );
        this._galaxyExtraMeshes.push(label);

        return mesh;
    }

    // ─── Warp Line (the colorful connection between galaxies) ──────

    _createWarpLine(from, to, color) {
        this._disposeWarpLine();

        // Create a curved path (catenary-like arc) — fewer segments for perf
        const mid = BABYLON.Vector3.Lerp(from, to, 0.5);
        mid.y += 25; // arc upward

        const pathPoints = [];
        const segments = 30;
        for (let i = 0; i <= segments; i++) {
            const t = i / segments;
            // Quadratic Bézier
            const p = new BABYLON.Vector3(
                (1 - t) * (1 - t) * from.x + 2 * (1 - t) * t * mid.x + t * t * to.x,
                (1 - t) * (1 - t) * from.y + 2 * (1 - t) * t * mid.y + t * t * to.y,
                (1 - t) * (1 - t) * from.z + 2 * (1 - t) * t * mid.z + t * t * to.z,
            );
            pathPoints.push(p);
        }

        // Create the tube with varying radius — lower tessellation
        const radiusFunction = (i, distance) => {
            const t = i / segments;
            return 0.15 + 0.25 * Math.sin(t * Math.PI);
        };

        this._warpLine = BABYLON.MeshBuilder.CreateTube('warpLine', {
            path: pathPoints,
            radiusFunction,
            sideOrientation: BABYLON.Mesh.DOUBLESIDE,
            tessellation: 8
        }, this.scene);

        // Animated material
        const mat = new BABYLON.StandardMaterial('warpLineMat', this.scene);
        mat.emissiveColor = new BABYLON.Color3(
            color.r * 0.8, color.g * 0.8, color.b * 0.8
        );
        mat.diffuseColor = new BABYLON.Color3(color.r, color.g, color.b);
        mat.alpha = 0.7;
        mat.backFaceCulling = false;
        this._warpLine.material = mat;
        this._warpLine.isPickable = false;
        this._warpLine.freezeWorldMatrix();
        this._warpLineMat = mat;

        // Animate the warp line's emissive color to pulse
        const colorAnim = new BABYLON.Animation(
            'warpColorPulse', 'material.emissiveColor', 30,
            BABYLON.Animation.ANIMATIONTYPE_COLOR3,
            BABYLON.Animation.ANIMATIONLOOPMODE_CYCLE
        );
        const c = color;
        colorAnim.setKeys([
            { frame: 0, value: new BABYLON.Color3(c.r * 0.5, c.g * 0.5, c.b * 0.5) },
            { frame: 30, value: new BABYLON.Color3(
                Math.min(c.r * 1.2, 1), Math.min(c.g * 1.2, 1), Math.min(c.b * 1.2, 1)
            )},
            { frame: 60, value: new BABYLON.Color3(c.r * 0.5, c.g * 0.5, c.b * 0.5) },
        ]);
        this.scene.beginDirectAnimation(
            this._warpLine, [colorAnim], 0, 60, true
        );

        // Create particle spheres along the path for sparkle effect
        this._createWarpParticles(pathPoints, color);
    }

    /**
     * Small glowing spheres that travel along the warp line.
     * Performance: fewer particles (4 instead of 8), shared material,
     * fewer keyframes, no individual scale animations.
     */
    _createWarpParticles(pathPoints, color) {
        this._disposeWarpParticles();

        const numParticles = 4;

        // Single shared material for all warp particles
        const sharedMat = new BABYLON.StandardMaterial('warpParticleSharedMat', this.scene);
        sharedMat.emissiveColor = new BABYLON.Color3(
            Math.min(color.r * 1.1, 1),
            Math.min(color.g * 1.1, 1),
            Math.min(color.b * 1.1, 1)
        );
        sharedMat.alpha = 0.85;
        sharedMat.freeze();
        this._warpParticleSharedMat = sharedMat;

        for (let p = 0; p < numParticles; p++) {
            const sphere = BABYLON.MeshBuilder.CreateSphere(
                `warpParticle_${p}`,
                { diameter: 0.4, segments: 4 },
                this.scene
            );
            sphere.material = sharedMat;
            sphere.isPickable = false;

            // Animate along the path with fewer keyframes (sample every 2nd point)
            const posAnim = new BABYLON.Animation(
                `warpParticlePos_${p}`, 'position', 20,
                BABYLON.Animation.ANIMATIONTYPE_VECTOR3,
                BABYLON.Animation.ANIMATIONLOOPMODE_CYCLE
            );
            const keys = [];
            const totalFrames = 80;
            for (let i = 0; i <= totalFrames; i += 2) {
                const rawT = (i / totalFrames + p / numParticles) % 1.0;
                const pathIdx = Math.floor(rawT * (pathPoints.length - 1));
                keys.push({ frame: i, value: pathPoints[pathIdx].clone() });
            }
            posAnim.setKeys(keys);
            this.scene.beginDirectAnimation(sphere, [posAnim], 0, totalFrames, true);

            this._warpParticles.push(sphere);
        }
    }

    // ─── Source Glow Ring ──────────────────────────────────────────

    _createSourceGlow(pos, color) {
        this._disposeSourceGlow();

        const ring = BABYLON.MeshBuilder.CreateTorus('sourceGlow', {
            diameter: 5,
            thickness: 0.3,
            tessellation: 16  // reduced from 32
        }, this.scene);
        ring.position = pos.clone();
        ring.position.y -= 0.2;

        const mat = new BABYLON.StandardMaterial('sourceGlowMat', this.scene);
        mat.emissiveColor = new BABYLON.Color3(color.r, color.g, color.b);
        mat.diffuseColor = new BABYLON.Color3(0, 0, 0);
        mat.alpha = 0.7;
        ring.material = mat;
        ring.isPickable = false;

        // Rotate and pulse
        const rotAnim = new BABYLON.Animation(
            'sourceGlowRot', 'rotation.y', 30,
            BABYLON.Animation.ANIMATIONTYPE_FLOAT,
            BABYLON.Animation.ANIMATIONLOOPMODE_CYCLE
        );
        rotAnim.setKeys([
            { frame: 0, value: 0 },
            { frame: 120, value: Math.PI * 2 }
        ]);
        this.scene.beginDirectAnimation(ring, [rotAnim], 0, 120, true);

        const pulseAnim = new BABYLON.Animation(
            'sourceGlowPulse', 'material.alpha', 30,
            BABYLON.Animation.ANIMATIONTYPE_FLOAT,
            BABYLON.Animation.ANIMATIONLOOPMODE_CYCLE
        );
        pulseAnim.setKeys([
            { frame: 0, value: 0.5 },
            { frame: 30, value: 0.8 },
            { frame: 60, value: 0.5 }
        ]);
        this.scene.beginDirectAnimation(ring, [pulseAnim], 0, 60, true);

        this._sourceGlow = ring;
    }

    // ─── Galaxy Label ──────────────────────────────────────────────

    _createGalaxyLabel(center, entity) {
        if (this._galaxyLabel) {
            if (this._galaxyLabel.material) {
                if (this._galaxyLabel.material.diffuseTexture) {
                    this._galaxyLabel.material.diffuseTexture.dispose();
                }
                this._galaxyLabel.material.dispose();
            }
            this._galaxyLabel.dispose();
            this._galaxyLabel = null;
        }

        const name = entity.name || entity.condition || entity.key || 'Galaxy';
        const text = `✦ ${name} Galaxy ✦`;

        const plane = BABYLON.MeshBuilder.CreatePlane('galaxyLabel', {
            width: text.length * 0.5,
            height: 1.2
        }, this.scene);
        plane.position = center.clone();
        plane.position.y += 12;
        plane.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;

        const dtSize = 512;
        const dt = new BABYLON.DynamicTexture('galaxyLabelTex', { width: dtSize * 4, height: dtSize }, this.scene, false);
        dt.hasAlpha = true;
        const ctx = dt.getContext();
        ctx.clearRect(0, 0, dtSize * 4, dtSize);
        ctx.font = 'bold 64px Segoe UI, sans-serif';
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, dtSize * 2, dtSize / 2);
        dt.update();

        const mat = new BABYLON.StandardMaterial('galaxyLabelMat', this.scene);
        mat.diffuseTexture = dt;
        mat.emissiveColor = new BABYLON.Color3(1, 1, 1);
        mat.backFaceCulling = false;
        mat.useAlphaFromDiffuseTexture = true;
        mat.disableLighting = true;
        plane.material = mat;
        plane.isPickable = false;

        this._galaxyLabel = plane;
    }

    // ─── Camera Fly ────────────────────────────────────────────────

    _flyCamera(target, toGalaxy) {
        const camera = this.sceneManager.getCamera();

        // Stop any existing camera animation
        this.scene.stopAnimation(camera);

        // Compute a good viewing position
        const viewOffset = toGalaxy
            ? new BABYLON.Vector3(15, 20, 15)
            : new BABYLON.Vector3(20, 25, 20);

        const newPos = target.add(viewOffset);
        const newTarget = target.clone();

        // Animate camera position
        const posAnim = new BABYLON.Animation(
            'cameraFlyPos', 'position', 30,
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

        // Animate camera target
        const targetAnim = new BABYLON.Animation(
            'cameraFlyTarget', 'target', 30,
            BABYLON.Animation.ANIMATIONTYPE_VECTOR3,
            BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT
        );
        targetAnim.setKeys([
            { frame: 0, value: camera.target.clone() },
            { frame: 60, value: newTarget }
        ]);
        targetAnim.setEasingFunction(ease);

        this.scene.beginDirectAnimation(camera, [posAnim, targetAnim], 0, 60, false);
    }

    // ─── Dim/Restore Main Spiral ───────────────────────────────────

    _dimMainSpiral(targetAlpha) {
        const dim = (cache) => {
            for (const [, entry] of cache) {
                if (entry.mesh && entry.mesh.material) {
                    entry.mesh.material.alpha = entry.mesh.material.alpha * targetAlpha;
                }
                for (const part of ['cap', 'roof', 'chimney', 'truePath', 'falsePath']) {
                    if (entry[part] && entry[part].material) {
                        entry[part].material.alpha = entry[part].material.alpha * targetAlpha;
                    }
                }
            }
        };

        if (targetAlpha < 1.0) {
            // Dim
            dim(this.mainCityRenderer.functionMeshes);
            dim(this.mainCityRenderer.variableMeshes);
            dim(this.mainCityRenderer.loopMeshes);
            dim(this.mainCityRenderer.whileMeshes);
            dim(this.mainCityRenderer.branchMeshes);
            if (this.mainCityRenderer._spiralTube && this.mainCityRenderer._spiralTube.material) {
                this.mainCityRenderer._spiralTube.material.alpha *= targetAlpha;
            }
        } else {
            // Restore — re-render from snapshot to restore original alpha values
            if (this.mainCityRenderer._lastSnapshot) {
                const restore = (cache) => {
                    for (const [, entry] of cache) {
                        if (entry.mesh && entry.mesh.material) {
                            entry.mesh.material.alpha = 0.85;
                        }
                        for (const part of ['cap', 'roof', 'chimney']) {
                            if (entry[part] && entry[part].material) {
                                entry[part].material.alpha = 0.9;
                            }
                        }
                        for (const part of ['truePath', 'falsePath']) {
                            if (entry[part] && entry[part].material) {
                                entry[part].material.alpha = 0.9;
                            }
                        }
                    }
                };
                restore(this.mainCityRenderer.functionMeshes);
                restore(this.mainCityRenderer.variableMeshes);
                restore(this.mainCityRenderer.loopMeshes);
                restore(this.mainCityRenderer.whileMeshes);
                restore(this.mainCityRenderer.branchMeshes);
                if (this.mainCityRenderer._spiralTube && this.mainCityRenderer._spiralTube.material) {
                    this.mainCityRenderer._spiralTube.material.alpha = 0.55;
                }
            }
        }
    }

    // ─── UI: Return Button ─────────────────────────────────────────

    _showReturnButton(show) {
        const btn = document.getElementById('returnToMainGalaxy');
        if (btn) {
            btn.style.display = show ? 'block' : 'none';
        }
    }

    // ─── Helpers ───────────────────────────────────────────────────

    /**
     * Get or create a cached material for a given key.
     * Shared materials across galaxy buildings of the same type
     * dramatically reduce material count and GPU state switches.
     */
    _getCachedMat(key, color) {
        if (this._matCache.has(key)) return this._matCache.get(key);
        const mat = this._glowMat(`galaxyCached_${key}`, color);
        mat.freeze();
        this._matCache.set(key, mat);
        return mat;
    }

    _glowMat(name, color) {
        const mat = new BABYLON.StandardMaterial(name, this.scene);
        mat.diffuseColor = new BABYLON.Color3(color.r, color.g, color.b);
        mat.emissiveColor = new BABYLON.Color3(
            color.r * 0.45, color.g * 0.45, color.b * 0.45
        );
        mat.specularColor = new BABYLON.Color3(0.6, 0.6, 0.6);
        mat.specularPower = 32;
        mat.alpha = color.a !== undefined ? color.a : 0.85;
        return mat;
    }

    _colorForType(type) {
        switch (type) {
            case 'CALL':      return { r: 0.9, g: 0.3, b: 0.3, a: 0.85 };
            case 'RETURN':    return { r: 0.9, g: 0.6, b: 0.2, a: 0.85 };
            case 'DECL':      return { r: 0.3, g: 0.5, b: 0.9, a: 0.85 };
            case 'PARAM':     return { r: 0.4, g: 0.6, b: 1.0, a: 0.85 };
            case 'ASSIGN':    return { r: 0.3, g: 0.8, b: 0.9, a: 0.85 };
            case 'READ':      return { r: 0.2, g: 0.9, b: 0.7, a: 0.85 };
            case 'LOOP':      return { r: 0.7, g: 0.3, b: 0.9, a: 0.85 };
            case 'CONDITION': return { r: 0.9, g: 0.5, b: 0.2, a: 0.85 };
            case 'BRANCH':    return { r: 0.9, g: 0.8, b: 0.2, a: 0.85 };
            default:          return { r: 0.5, g: 0.5, b: 0.5, a: 0.85 };
        }
    }

    _createLabel(name, text, pos, color) {
        const plane = BABYLON.MeshBuilder.CreatePlane(name, {
            width: Math.max(text.length * 0.35, 2),
            height: 0.7
        }, this.scene);
        plane.position = pos.clone();
        plane.position.y += 3.5;
        plane.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;

        const dtW = 512;
        const dtH = 128;
        const dt = new BABYLON.DynamicTexture(name + '_tex', { width: dtW, height: dtH }, this.scene, false);
        dt.hasAlpha = true;
        const ctx = dt.getContext();
        ctx.clearRect(0, 0, dtW, dtH);
        ctx.font = 'bold 36px Segoe UI, sans-serif';
        const r = Math.round((color.r || 0.8) * 255);
        const g = Math.round((color.g || 0.8) * 255);
        const b = Math.round((color.b || 0.8) * 255);
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, dtW / 2, dtH / 2);
        dt.update();

        const mat = new BABYLON.StandardMaterial(name + '_mat', this.scene);
        mat.diffuseTexture = dt;
        mat.emissiveColor = new BABYLON.Color3(1, 1, 1);
        mat.backFaceCulling = false;
        mat.useAlphaFromDiffuseTexture = true;
        mat.disableLighting = true;
        plane.material = mat;
        plane.isPickable = false;

        return plane;
    }

    // ─── Disposal ──────────────────────────────────────────────────

    _disposeGalaxy() {
        // Cancel any pending staggered-animation timers
        this._pendingTimers.forEach(id => clearTimeout(id));
        this._pendingTimers = [];

        // Collect cached material references so we don't accidentally dispose them
        const cachedMats = new Set(this._matCache.values());

        for (const mesh of this._galaxyMeshes) {
            if (mesh && !mesh.isDisposed()) {
                this.scene.stopAnimation(mesh);
                if (mesh.material) {
                    // Only dispose non-cached materials
                    if (!cachedMats.has(mesh.material)) {
                        if (mesh.material.diffuseTexture) mesh.material.diffuseTexture.dispose();
                        mesh.material.dispose();
                    } else {
                        mesh.material = null; // detach without disposing
                    }
                }
                mesh.dispose();
            }
        }
        this._galaxyMeshes = [];
        this._galaxyExtraMeshes = [];
        this._galaxySpiralTube = null;

        // Safety net: find and dispose any orphaned galaxy meshes in the scene
        const orphans = this.scene.meshes.filter(m =>
            m.name && (m.name.startsWith('galaxy_') || m.name === 'galaxySpiralTube')
        );
        for (const m of orphans) {
            this.scene.stopAnimation(m);
            if (m.material) {
                if (!cachedMats.has(m.material)) {
                    if (m.material.diffuseTexture) m.material.diffuseTexture.dispose();
                    m.material.dispose();
                } else {
                    m.material = null;
                }
            }
            m.dispose();
        }
    }

    _disposeWarpLine() {
        if (this._warpLine) {
            this.scene.stopAnimation(this._warpLine);
            if (this._warpLine.material) this._warpLine.material.dispose();
            this._warpLine.dispose();
            this._warpLine = null;
            this._warpLineMat = null;
        }
        this._disposeWarpParticles();

        // Safety net: dispose any orphaned warp line mesh
        const orphanLines = this.scene.meshes.filter(m => m.name === 'warpLine');
        for (const m of orphanLines) {
            this.scene.stopAnimation(m);
            if (m.material) m.material.dispose();
            m.dispose();
        }
    }

    _disposeWarpParticles() {
        for (const p of this._warpParticles) {
            if (p && !p.isDisposed()) {
                this.scene.stopAnimation(p);
                p.material = null;   // don't dispose shared material here
                p.dispose();
            }
        }
        this._warpParticles = [];

        // Dispose the shared warp-particle material
        if (this._warpParticleSharedMat) {
            this._warpParticleSharedMat.dispose();
            this._warpParticleSharedMat = null;
        }

        // Safety net: dispose any orphaned warp particle meshes
        const orphanParticles = this.scene.meshes.filter(m =>
            m.name && m.name.startsWith('warpParticle_')
        );
        for (const m of orphanParticles) {
            this.scene.stopAnimation(m);
            if (m.material) m.material.dispose();
            m.dispose();
        }
    }

    _disposeSourceGlow() {
        if (this._sourceGlow) {
            this.scene.stopAnimation(this._sourceGlow);
            if (this._sourceGlow.material) this._sourceGlow.material.dispose();
            this._sourceGlow.dispose();
            this._sourceGlow = null;
        }

        // Safety net: dispose any orphaned source glow mesh
        const orphanGlows = this.scene.meshes.filter(m => m.name === 'sourceGlow');
        for (const m of orphanGlows) {
            this.scene.stopAnimation(m);
            if (m.material) m.material.dispose();
            m.dispose();
        }
    }

    /** Full cleanup (called when the city is cleared). */
    clear() {
        // Cancel pending timers first
        this._pendingTimers.forEach(id => clearTimeout(id));
        this._pendingTimers = [];

        // Dispose all galaxies on the stack first
        for (const galaxy of this._galaxyStack) {
            this._disposeWarpedGalaxy(galaxy);
        }
        this._galaxyStack = [];

        // Dispose current galaxy
        if (this.warpedGalaxy) {
            this._disposeWarpedGalaxy(this.warpedGalaxy);
        }

        // Also run legacy disposal for any orphaned meshes
        this._disposeGalaxy();
        this._disposeWarpLine();
        this._disposeSourceGlow();

        if (this._galaxyLabel) {
            this.scene.stopAnimation(this._galaxyLabel);
            if (this._galaxyLabel.material) {
                if (this._galaxyLabel.material.diffuseTexture) {
                    this._galaxyLabel.material.diffuseTexture.dispose();
                }
                this._galaxyLabel.material.dispose();
            }
            this._galaxyLabel.dispose();
            this._galaxyLabel = null;
        }

        // Safety net: dispose any orphaned galaxy meshes/labels in the scene
        const orphans = this.scene.meshes.filter(m =>
            m.name && (m.name.startsWith('galaxy_') || m.name === 'galaxySpiralTube' ||
                       m.name === 'galaxyLabel' || m.name === 'warpLine' ||
                       m.name === 'sourceGlow' || m.name.startsWith('warpParticle_'))
        );
        const cachedMats = new Set(this._matCache.values());
        for (const m of orphans) {
            this.scene.stopAnimation(m);
            if (m.material) {
                if (!cachedMats.has(m.material)) {
                    if (m.material.diffuseTexture) m.material.diffuseTexture.dispose();
                    m.material.dispose();
                } else {
                    m.material = null;
                }
            }
            m.dispose();
        }

        // Dispose cached materials
        this._matCache.forEach(mat => mat.dispose());
        this._matCache.clear();

        // Restore main spiral opacity if it was dimmed
        this._dimMainSpiral(1.0);

        this.warpedGalaxy = null;
        this._showReturnButton(false);
    }
}
