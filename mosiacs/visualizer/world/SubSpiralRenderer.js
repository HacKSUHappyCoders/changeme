/**
 * SubSpiralRenderer — Phase 3
 *
 * Renders sub-spirals that wrap UPWARD around container buildings
 * (functions, for-loops, while-loops, branches).
 *
 * Sub-spirals circle around the parent building and ascend, creating a
 * visually striking helix that rises from the building.  The dots are
 * large enough to be individually clickable.
 *
 * When a sub-spiral is opened the main spiral is pushed outward to
 * make room; when closed the main spiral returns to its original layout.
 *
 * Performance: caches materials per step-type so at most ~8 materials
 * exist regardless of how many dots are rendered.
 */
class SubSpiralRenderer {
    constructor(scene, labelHelper) {
        this.scene = scene;
        this.labelHelper = labelHelper;

        // All rendered sub-spirals: parentKey → { tube, dots[], dotCount, parentPos, boundingRadius }
        this.subSpirals = new Map();

        // ── Sub-spiral layout: compact helix wrapping UP around building ──
        this.radiusStart  = 2.0;         // start further from center to wrap around building
        this.radiusGrowth = 0.03;        // slight outward growth
        this.angleStep    = 0.65;        // tighter winding so it wraps neatly
        this.heightStep   = 0.04;        // gentle ascent — mostly horizontal wrapping
        this.tubeRadius   = 0.08;
        this.dotRadius    = 0.40;        // big dots — easy to click and inspect

        // Shared material cache (stepType → StandardMaterial)
        this._matCache = new Map();

        // Callback for when sub-spiral is opened/closed (set by CityRenderer)
        this.onSubSpiralToggle = null;
    }

    // ─── On-demand API (called by ExplodeManager) ──────────────────

    /**
     * Render a single sub-spiral for the given container entity key.
     * If one already exists for that key it is disposed first.
     *
     * @param {string}          parentKey   – entity key (e.g. "fn_main_#1")
     * @param {number[]}        childIndices – indices into the trace array
     * @param {BABYLON.Vector3} parentPos   – world position of the building
     * @param {Array}           trace       – full trace array
     */
    renderSingle(parentKey, childIndices, parentPos, trace) {
        if (!childIndices || childIndices.length === 0) return;

        // Remove existing spiral for this key
        this.removeSingle(parentKey);

        const pathColor = ColorHash.spiralColor(parentKey);
        const result = this._buildSubSpiral(
            parentKey, childIndices, parentPos, pathColor, trace
        );
        this.subSpirals.set(parentKey, result);

        // Notify CityRenderer to push main spiral outward
        if (this.onSubSpiralToggle) {
            this.onSubSpiralToggle('open', parentKey, result.boundingRadius, parentPos);
        }
    }

    /**
     * Remove a single sub-spiral by key.
     * @returns {boolean} true if something was removed
     */
    removeSingle(parentKey) {
        const existing = this.subSpirals.get(parentKey);
        if (existing) {
            this._disposeSubSpiral(existing);
            this.subSpirals.delete(parentKey);

            // Notify CityRenderer to restore main spiral
            if (this.onSubSpiralToggle) {
                this.onSubSpiralToggle('close', parentKey);
            }
            return true;
        }
        return false;
    }

    /** Remove ALL sub-spirals (used when the whole city is cleared). */
    clear() {
        this.subSpirals.forEach(s => this._disposeSubSpiral(s));
        this.subSpirals.clear();
        this._matCache.forEach(m => m.dispose());
        this._matCache.clear();
    }

    // ─── internal ──────────────────────────────────────────────────

    /**
     * Compute sub-spiral position for a given slot, ascending from origin.
     * The helix wraps AROUND the building and climbs upward.
     * Slot 0 starts at the building's base; subsequent slots rise.
     */
    _subSpiralPosition(slot, origin) {
        const angle  = slot * this.angleStep;
        const radius = this.radiusStart + slot * this.radiusGrowth;
        // Ascend upward from the building
        const y = origin.y + 0.3 + slot * this.heightStep;
        return new BABYLON.Vector3(
            origin.x + Math.cos(angle) * radius,
            y,
            origin.z + Math.sin(angle) * radius
        );
    }

    /**
     * Get or create a cached material for a given step type.
     */
    _getCachedMaterial(stepType) {
        if (this._matCache.has(stepType)) return this._matCache.get(stepType);

        const c = this._dotColor({ type: stepType });
        const mat = new BABYLON.StandardMaterial(`subDotMat_${stepType}`, this.scene);
        mat.diffuseColor  = new BABYLON.Color3(c.r, c.g, c.b);
        mat.emissiveColor = new BABYLON.Color3(c.r * 0.5, c.g * 0.5, c.b * 0.5);
        mat.alpha = 0.9;
        mat.freeze();
        this._matCache.set(stepType, mat);
        return mat;
    }

    /**
     * Consolidate raw child trace indices into deduplicated entities,
     * mirroring how the main spiral works:
     *  - Variables: one entity per unique (subject+address), with value history
     *  - Loops: one entity per unique condition, with iteration count
     *  - READ events are skipped (they are data-flow relations, not entities)
     *  - PARAM events are treated like variable declarations
     *  - Everything else: one entity per occurrence
     *
     * Returns an array of consolidated entity objects, each with:
     *   { type, label, stepIndices[], steps[], color (stepType for material) }
     */
    _consolidateChildren(childIndices, trace) {
        const entities = [];          // final deduplicated list
        const varMap   = new Map();   // "name|address" → entity
        const loopMap  = new Map();   // "subtype|condition" → entity

        for (const idx of childIndices) {
            const step = trace[idx];
            if (!step) continue;

            // Skip READ events — they are data-flow relations rendered
            // by CausalityRenderer, not standalone entities.
            if (step.type === 'READ') continue;

            // The parsed trace uses "name" (mapped from raw "subject")
            const stepName = step.name || step.subject || '';

            if (step.type === 'DECL' || step.type === 'ASSIGN' || step.type === 'PARAM') {
                // ── Variable: merge DECL + ASSIGN + PARAM by name+address ──
                const varKey = `${stepName}|${step.address || ''}`;
                if (varMap.has(varKey)) {
                    const ent = varMap.get(varKey);
                    ent.stepIndices.push(idx);
                    ent.values.push({ step: idx, value: step.value });
                    ent.currentValue = step.value;
                } else {
                    const ent = {
                        type: 'variable',
                        colorType: step.type === 'PARAM' ? 'PARAM' : 'DECL',
                        label: stepName,
                        subject: stepName,
                        address: step.address,
                        currentValue: step.value,
                        values: [{ step: idx, value: step.value }],
                        stepIndices: [idx],
                        firstStep: step
                    };
                    varMap.set(varKey, ent);
                    entities.push(ent);
                }
            } else if (step.type === 'LOOP') {
                // ── Loop: merge iterations of same condition ──
                const loopKey = `${step.subtype || 'loop'}|${step.condition || ''}`;
                if (loopMap.has(loopKey)) {
                    const ent = loopMap.get(loopKey);
                    ent.stepIndices.push(idx);
                    ent.iterations++;
                    ent.running = !!(step.conditionResult || step.condition_result);
                } else {
                    const ent = {
                        type: 'loop',
                        colorType: 'LOOP',
                        label: `${(step.subtype || 'loop').toUpperCase()} (${step.condition || '?'})`,
                        subtype: step.subtype,
                        condition: step.condition,
                        iterations: 1,
                        running: !!(step.conditionResult || step.condition_result),
                        stepIndices: [idx],
                        firstStep: step
                    };
                    loopMap.set(loopKey, ent);
                    entities.push(ent);
                }
            } else {
                // ── CALL, RETURN, CONDITION, BRANCH: one entity each ──
                entities.push({
                    type: step.type.toLowerCase(),
                    colorType: step.type,
                    label: stepName || step.subtype || step.type,
                    stepIndices: [idx],
                    firstStep: step
                });
            }
        }

        return entities;
    }

    _buildSubSpiral(parentKey, childIndices, origin, pathColor, trace) {
        // ── Consolidate raw events into deduplicated entities ──
        const entities = this._consolidateChildren(childIndices, trace);

        const dots = [];
        const pathPoints = [];
        const maxSlots = entities.length;
        let maxRadius = 0;

        for (let i = 0; i < maxSlots; i++) {
            const pos = this._subSpiralPosition(i, origin);
            pathPoints.push(pos.clone());

            // Track the maximum distance from origin for bounding radius
            const dx = pos.x - origin.x;
            const dz = pos.z - origin.z;
            const dist = Math.sqrt(dx * dx + dz * dz);
            if (dist > maxRadius) maxRadius = dist;

            const entity = entities[i];

            const dot = BABYLON.MeshBuilder.CreateSphere(
                `subDot_${parentKey}_${i}`,
                { diameter: this.dotRadius * 2, segments: 6 },
                this.scene
            );
            dot.position = pos;
            dot.isPickable = true;
            dot.material = this._getCachedMaterial(entity.colorType);

            // Attach consolidated entity data for the inspector
            dot._subSpiralDot = true;
            dot._parentKey = parentKey;
            dot._stepIndex = entity.stepIndices[0];
            dot._stepData = entity.firstStep;
            dot._entityData = entity;          // full consolidated entity

            dots.push(dot);
        }

        // Animate dots appearing one by one with a slight delay
        dots.forEach((dot, i) => {
            dot.scaling = new BABYLON.Vector3(0, 0, 0);
            const anim = new BABYLON.Animation(
                `subDotScale_${parentKey}_${i}`,
                'scaling', 30,
                BABYLON.Animation.ANIMATIONTYPE_VECTOR3,
                BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT
            );
            anim.setKeys([
                { frame: 0, value: new BABYLON.Vector3(0, 0, 0) },
                { frame: 8, value: new BABYLON.Vector3(1.1, 1.1, 1.1) },
                { frame: 12, value: new BABYLON.Vector3(1, 1, 1) }
            ]);
            const ease = new BABYLON.CubicEase();
            ease.setEasingMode(BABYLON.EasingFunction.EASINGMODE_EASEOUT);
            anim.setEasingFunction(ease);

            setTimeout(() => {
                this.scene.beginDirectAnimation(dot, [anim], 0, 12, false);
            }, i * 30);
        });

        // Draw the spiral tube
        let tube = null;
        if (pathPoints.length >= 2) {
            tube = BABYLON.MeshBuilder.CreateTube(`subTube_${parentKey}`, {
                path: pathPoints,
                radius: this.tubeRadius,
                sideOrientation: BABYLON.Mesh.DOUBLESIDE
            }, this.scene);
            const tubeMat = new BABYLON.StandardMaterial(`subTubeMat_${parentKey}`, this.scene);
            tubeMat.diffuseColor  = new BABYLON.Color3(pathColor.r, pathColor.g, pathColor.b);
            tubeMat.emissiveColor = new BABYLON.Color3(
                pathColor.r * 0.4, pathColor.g * 0.4, pathColor.b * 0.4
            );
            tubeMat.alpha = 0.6;
            tubeMat.freeze();
            tube.material = tubeMat;
            tube.isPickable = false;
        }

        // The bounding radius determines how far the main spiral should push out
        const boundingRadius = maxRadius + this.dotRadius + 0.5;

        return { tube, dots, pathColor, dotCount: maxSlots, parentPos: origin.clone(), boundingRadius };
    }

    /**
     * Pick a dot colour based on the trace step type.
     */
    _dotColor(step) {
        if (!step) return { r: 0.5, g: 0.5, b: 0.5 };
        switch (step.type) {
            case 'CALL':      return { r: 0.9, g: 0.3, b: 0.3 };
            case 'RETURN':    return { r: 0.9, g: 0.6, b: 0.2 };
            case 'DECL':      return { r: 0.3, g: 0.5, b: 0.9 };
            case 'ASSIGN':    return { r: 0.3, g: 0.8, b: 0.9 };
            case 'PARAM':     return { r: 0.4, g: 0.6, b: 1.0 };  // like DECL but slightly brighter
            case 'READ':      return { r: 0.2, g: 0.9, b: 0.7 };  // teal — data-flow
            case 'LOOP':      return { r: 0.7, g: 0.3, b: 0.9 };
            case 'CONDITION': return { r: 0.9, g: 0.5, b: 0.2 };
            case 'BRANCH':    return { r: 0.9, g: 0.8, b: 0.2 };
            default:          return { r: 0.5, g: 0.5, b: 0.5 };
        }
    }

    _disposeSubSpiral(entry) {
        if (entry.tube) {
            if (entry.tube.material) entry.tube.material.dispose();
            entry.tube.dispose();
        }
        for (const dot of entry.dots) {
            dot.material = null;   // don't dispose shared cached materials
            dot.dispose();
        }
    }
}
