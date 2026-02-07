/**
 * CausalityRenderer — Phase 3 Part 3
 *
 * Draws a "causality web" connecting variable values to the values that
 * produced them.  When variable B is assigned on the same line where
 * variable A was last read/assigned, a glowing silk thread is drawn
 * between their buildings.
 *
 * The web is coloured by blending the colours of the two connected
 * buildings — giving it a stained-glass spider-web aesthetic that
 * floats between the mosaic towers.
 *
 * Togglable on/off via the UI.
 */
class CausalityRenderer {
    constructor(scene, cityRenderer) {
        this.scene = scene;
        this.cityRenderer = cityRenderer;

        /** All web strands: { line, mat, from, to } */
        this._strands = [];

        /** Animated junction dots at intersection points */
        this._junctions = [];

        /** Whether the web is currently visible */
        this._visible = false;

        /** Shared junction material (cached) */
        this._junctionMat = null;
    }

    // ─── Public API ────────────────────────────────────────────────

    /**
     * Is the web currently showing?
     */
    isVisible() {
        return this._visible;
    }

    /**
     * Toggle the causality web on/off.
     * @returns {boolean} new visibility state
     */
    toggle() {
        if (this._visible) {
            this.hide();
        } else {
            this.show();
        }
        return this._visible;
    }

    /**
     * Build and show the causality web from the current snapshot.
     */
    show() {
        this.clear();
        const snapshot = this.cityRenderer._lastSnapshot;
        const trace = this.cityRenderer._lastTrace;
        if (!snapshot || !trace || trace.length === 0) return;

        const links = this._computeCausalLinks(snapshot, trace);
        this._renderWeb(links);
        this._visible = true;
    }

    /**
     * Hide and dispose the causality web.
     */
    hide() {
        this.clear();
        this._visible = false;
    }

    /**
     * Dispose all web geometry.
     */
    clear() {
        for (const strand of this._strands) {
            if (strand.mat) strand.mat.dispose();
            if (strand.line) strand.line.dispose();
        }
        this._strands = [];

        for (const j of this._junctions) {
            if (j && !j.isDisposed()) {
                j.material = null;
                j.dispose();
            }
        }
        this._junctions = [];

        if (this._junctionMat) {
            this._junctionMat.dispose();
            this._junctionMat = null;
        }
    }

    // ─── Causality Analysis ────────────────────────────────────────

    /**
     * Walk through the trace and find causal links:
     *
     * For each ASSIGN event, look backward in the trace (within a small
     * window) for other variables that were recently assigned or declared
     * on the same line or an adjacent line.  Those are likely the values
     * that contributed to the new assignment (e.g.  sum = sum + i).
     *
     * Returns an array of { fromKey, toKey, fromColor, toColor, strength }
     */
    _computeCausalLinks(snapshot, trace) {
        const links = [];
        const seen = new Set();  // deduplicate

        // Build a map:  varName → latest variable-house key
        const varKeyMap = new Map();
        for (const v of snapshot.variables) {
            varKeyMap.set(`${v.name}|${v.address}`, v.key);
        }

        // Walk through the trace looking for ASSIGN events
        for (let i = 0; i < trace.length; i++) {
            const step = trace[i];
            if (step.type !== 'ASSIGN') continue;

            const targetKey = varKeyMap.get(`${step.name}|${step.address}`);
            if (!targetKey) continue;

            const targetLine = step.line || 0;

            // Look backward up to 8 steps for related variables
            // that were assigned/declared on the same line or ±1 line
            for (let j = i - 1; j >= Math.max(0, i - 8); j--) {
                const prev = trace[j];
                if (prev.type !== 'ASSIGN' && prev.type !== 'DECL') continue;

                const prevKey = varKeyMap.get(`${prev.name}|${prev.address}`);
                if (!prevKey || prevKey === targetKey) continue;

                const prevLine = prev.line || 0;

                // Same line or adjacent line = likely causal
                if (Math.abs(targetLine - prevLine) <= 1) {
                    const linkId = `${prevKey}->${targetKey}`;
                    if (seen.has(linkId)) continue;
                    seen.add(linkId);

                    links.push({
                        fromKey: prevKey,
                        toKey: targetKey,
                        strength: targetLine === prevLine ? 1.0 : 0.6
                    });
                }
            }

            // Also look for the SAME variable's prior value (self-assignment
            // patterns like sum = sum + i).  If this variable was assigned
            // before, link from the prior step.
            for (let j = i - 1; j >= Math.max(0, i - 12); j--) {
                const prev = trace[j];
                if (prev.type !== 'ASSIGN' && prev.type !== 'DECL') continue;
                if (prev.name !== step.name || prev.address !== step.address) continue;

                // Found prior assignment to same var — now find what else
                // was assigned near that step (the "input" variables)
                for (let k = j - 1; k >= Math.max(0, j - 6); k--) {
                    const input = trace[k];
                    if (input.type !== 'ASSIGN' && input.type !== 'DECL') continue;
                    const inputKey = varKeyMap.get(`${input.name}|${input.address}`);
                    if (!inputKey || inputKey === targetKey) continue;

                    const linkId = `${inputKey}->${targetKey}`;
                    if (seen.has(linkId)) continue;
                    seen.add(linkId);

                    links.push({
                        fromKey: inputKey,
                        toKey: targetKey,
                        strength: 0.4
                    });
                }
                break; // only look at the most recent prior assignment
            }
        }

        return links;
    }

    // ─── Web Rendering ─────────────────────────────────────────────

    /**
     * Render the causality web as glowing silk strands between buildings.
     */
    _renderWeb(links) {
        if (links.length === 0) return;

        // Collect building positions & colours
        const posMap = new Map();
        const colorMap = new Map();

        const extractFromCache = (cache) => {
            for (const [key, entry] of cache) {
                if (entry.mesh && !entry.mesh.isDisposed()) {
                    posMap.set(key, entry.mesh.position.clone());
                    colorMap.set(key, entry.color || { r: 0.5, g: 0.5, b: 0.5 });
                }
            }
        };
        extractFromCache(this.cityRenderer.variableMeshes);
        extractFromCache(this.cityRenderer.functionMeshes);
        extractFromCache(this.cityRenderer.loopMeshes);
        extractFromCache(this.cityRenderer.whileMeshes);
        extractFromCache(this.cityRenderer.branchMeshes);

        // Junction dot material
        this._junctionMat = new BABYLON.StandardMaterial('causalJunctionMat', this.scene);
        this._junctionMat.emissiveColor = new BABYLON.Color3(1, 1, 1);
        this._junctionMat.diffuseColor = new BABYLON.Color3(0.9, 0.85, 1.0);
        this._junctionMat.alpha = 0.7;

        // Track all unique positions that participate in a link for junction dots
        const junctionPositions = new Set();

        for (let i = 0; i < links.length; i++) {
            const link = links[i];
            const fromPos = posMap.get(link.fromKey);
            const toPos = posMap.get(link.toKey);
            if (!fromPos || !toPos) continue;

            const fromColor = colorMap.get(link.fromKey) || { r: 0.5, g: 0.5, b: 0.5 };
            const toColor = colorMap.get(link.toKey) || { r: 0.5, g: 0.5, b: 0.5 };

            // Blend the two colours for the strand
            const blendR = (fromColor.r + toColor.r) / 2;
            const blendG = (fromColor.g + toColor.g) / 2;
            const blendB = (fromColor.b + toColor.b) / 2;

            // Create a curved path (catenary / drooping silk strand)
            const midPoint = BABYLON.Vector3.Lerp(fromPos, toPos, 0.5);
            // Droop the strand slightly below the midpoint for a web effect
            const dist = BABYLON.Vector3.Distance(fromPos, toPos);
            midPoint.y -= dist * 0.15 + 0.5;

            const pathPoints = this._quadraticBezier(fromPos, midPoint, toPos, 16);

            // Create the strand as a thin tube
            const tube = BABYLON.MeshBuilder.CreateTube(`causalStrand_${i}`, {
                path: pathPoints,
                radius: 0.04 + link.strength * 0.03,
                sideOrientation: BABYLON.Mesh.DOUBLESIDE,
                tessellation: 6
            }, this.scene);

            const mat = new BABYLON.StandardMaterial(`causalStrandMat_${i}`, this.scene);
            mat.emissiveColor = new BABYLON.Color3(
                blendR * 0.7, blendG * 0.7, blendB * 0.7
            );
            mat.diffuseColor = new BABYLON.Color3(blendR, blendG, blendB);
            mat.alpha = 0.35 + link.strength * 0.25;
            mat.backFaceCulling = false;
            tube.material = mat;
            tube.isPickable = false;
            tube.freezeWorldMatrix();

            this._strands.push({ line: tube, mat, fromKey: link.fromKey, toKey: link.toKey });

            // Track junction points
            junctionPositions.add(link.fromKey);
            junctionPositions.add(link.toKey);
        }

        // Animate a gentle shimmer across all strands
        this._animateWebShimmer();

        // Create junction dots at each participating building
        for (const key of junctionPositions) {
            const pos = posMap.get(key);
            if (!pos) continue;

            const dot = BABYLON.MeshBuilder.CreateSphere(`causalJunction_${key}`, {
                diameter: 0.22, segments: 4
            }, this.scene);
            dot.position = pos.clone();
            dot.position.y += 0.3;
            dot.material = this._junctionMat;
            dot.isPickable = false;
            dot.freezeWorldMatrix();
            this._junctions.push(dot);
        }
    }

    /**
     * Animate a gentle pulsing shimmer on all web strands.
     */
    _animateWebShimmer() {
        for (let i = 0; i < this._strands.length; i++) {
            const strand = this._strands[i];
            if (!strand.line || strand.line.isDisposed()) continue;

            const baseAlpha = strand.mat.alpha;
            const anim = new BABYLON.Animation(
                `causalShimmer_${i}`, 'material.alpha', 30,
                BABYLON.Animation.ANIMATIONTYPE_FLOAT,
                BABYLON.Animation.ANIMATIONLOOPMODE_CYCLE
            );

            // Each strand shimmers at a slightly different phase
            const phase = (i * 7) % 30;
            anim.setKeys([
                { frame: 0, value: baseAlpha * 0.6 },
                { frame: 15 + phase, value: baseAlpha * 1.1 },
                { frame: 45, value: baseAlpha * 0.8 },
                { frame: 60, value: baseAlpha * 0.6 }
            ]);

            this.scene.beginDirectAnimation(strand.line, [anim], 0, 60, true);
        }
    }

    /**
     * Generate a quadratic Bézier curve.
     */
    _quadraticBezier(p0, p1, p2, segments) {
        const points = [];
        for (let i = 0; i <= segments; i++) {
            const t = i / segments;
            const x = (1 - t) * (1 - t) * p0.x + 2 * (1 - t) * t * p1.x + t * t * p2.x;
            const y = (1 - t) * (1 - t) * p0.y + 2 * (1 - t) * t * p1.y + t * t * p2.y;
            const z = (1 - t) * (1 - t) * p0.z + 2 * (1 - t) * t * p1.z + t * t * p2.z;
            points.push(new BABYLON.Vector3(x, y, z));
        }
        return points;
    }
}
