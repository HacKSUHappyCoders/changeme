/**
 * SubSpiralRenderer — Renders sub-spirals that descend downward from
 * container buildings (functions, for-loops, while-loops, branches).
 *
 * Sub-spirals are spawned on-demand (when a building is clicked) rather
 * than all at once, so only one is visible at a time.
 *
 * The layout is deliberately TALL and NARROW — a tight helix that drops
 * straight down beneath the parent building, clearly distinct from the
 * wide main spiral.
 *
 * Performance: caches materials per step-type so at most ~8 materials
 * exist regardless of how many dots are rendered.
 */
class SubSpiralRenderer {
    constructor(scene, labelHelper) {
        this.scene = scene;
        this.labelHelper = labelHelper;

        // All rendered sub-spirals: parentKey → { tube, dots[], dotCount }
        this.subSpirals = new Map();

        // ── Sub-spiral layout: tall & narrow ──
        // Small radius so it stays close to the building column
        this.radiusStart  = 0.8;
        this.radiusGrowth = 0.02;       // barely grows outward
        // Tight winding
        this.angleStep    = 0.65;
        // Large vertical drop per step → long / tall spiral
        this.heightStep   = 0.55;
        this.tubeRadius   = 0.06;
        this.dotRadius    = 0.10;

        // Shared material cache (stepType → StandardMaterial)
        this._matCache = new Map();
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
     * Compute sub-spiral position for a given slot, descending from origin.
     * Slot 0 starts just below the building; subsequent slots drop steeply.
     */
    _subSpiralPosition(slot, origin) {
        const angle  = slot * this.angleStep;
        const radius = this.radiusStart + slot * this.radiusGrowth;
        // Descend straight down beneath the building
        const y = origin.y - 0.5 - slot * this.heightStep;
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

    _buildSubSpiral(parentKey, childIndices, origin, pathColor, trace) {
        const dots = [];
        const pathPoints = [];
        const maxSlots = childIndices.length;

        for (let i = 0; i < maxSlots; i++) {
            const pos = this._subSpiralPosition(i, origin);
            pathPoints.push(pos.clone());

            const stepIndex = childIndices[i];
            const step = trace[stepIndex];
            const stepType = step ? step.type : 'UNKNOWN';

            const dot = BABYLON.MeshBuilder.CreateSphere(
                `subDot_${parentKey}_${i}`,
                { diameter: this.dotRadius * 2, segments: 4 },
                this.scene
            );
            dot.position = pos;
            dot.isPickable = false;
            dot.material = this._getCachedMaterial(stepType);
            dot.freezeWorldMatrix();

            dots.push(dot);
        }

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
            tube.freezeWorldMatrix();
        }

        return { tube, dots, pathColor, dotCount: maxSlots };
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
