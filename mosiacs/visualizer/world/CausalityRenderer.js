/**
 * CausalityRenderer — Phase 3 Part 3
 *
 * Draws a "causality web" showing data-flow between variables.
 * When READ relations are available, precise read→assign links are drawn.
 * Otherwise, falls back to a heuristic based on line proximity.
 *
 * Performance notes:
 *   • Uses simple LineSystem instead of tubes (one draw call for all strands)
 *   • Shares a single material across all lines
 *   • Arrowheads use thin-instances on one shared mesh
 *   • No per-strand DynamicTexture labels (eliminated)
 *   • No per-strand shimmer animations (eliminated)
 *
 * Togglable on/off via the UI.
 */
class CausalityRenderer {
    constructor(scene, cityRenderer) {
        this.scene = scene;
        this.cityRenderer = cityRenderer;

        /** The single LineSystem mesh for all strands */
        this._lineSystem = null;

        /** Shared material for all strands */
        this._lineMat = null;

        /** Arrowhead instances root mesh */
        this._arrowRoot = null;
        this._arrowMat = null;

        /** Junction dots root mesh */
        this._junctionRoot = null;
        this._junctionMat = null;

        /** Whether the web is currently visible */
        this._visible = false;
    }

    // ─── Public API ────────────────────────────────────────────────

    isVisible() {
        return this._visible;
    }

    toggle() {
        if (this._visible) {
            this.hide();
        } else {
            this.show();
        }
        return this._visible;
    }

    show() {
        this.clear();
        const snapshot = this.cityRenderer._lastSnapshot;
        const trace = this.cityRenderer._lastTrace;
        if (!snapshot || !trace || trace.length === 0) return;

        const links = this._computeCausalLinks(snapshot, trace);
        this._renderWeb(links);
        this._visible = true;
    }

    hide() {
        this.clear();
        this._visible = false;
    }

    clear() {
        if (this._lineSystem) {
            this._lineSystem.dispose();
            this._lineSystem = null;
        }
        if (this._lineMat) {
            this._lineMat.dispose();
            this._lineMat = null;
        }
        if (this._arrowRoot) {
            this._arrowRoot.dispose();
            this._arrowRoot = null;
        }
        if (this._arrowMat) {
            this._arrowMat.dispose();
            this._arrowMat = null;
        }
        if (this._junctionRoot) {
            this._junctionRoot.dispose();
            this._junctionRoot = null;
        }
        if (this._junctionMat) {
            this._junctionMat.dispose();
            this._junctionMat = null;
        }
    }

    // ─── Causality Analysis ────────────────────────────────────────

    /**
     * Build causal links from READ relations in the snapshot.
     *
     * READ events explicitly tell us which variable was read to produce
     * which assignment.  Each readRelation is { fromKey, toKey, readValue, step }.
     * We use these directly — no heuristic needed.
     *
     * Falls back to the old heuristic approach if no readRelations exist
     * (for backward compatibility with older trace files).
     *
     * Returns an array of { fromKey, toKey, strength, readValue }
     */
    _computeCausalLinks(snapshot, trace) {
        const readRelations = snapshot.readRelations || [];

        if (readRelations.length > 0) {
            return this._computeLinksFromReads(readRelations);
        }

        // Fallback: old heuristic approach for traces without READ events
        return this._computeLinksHeuristic(snapshot, trace);
    }

    /**
     * Build links directly from READ relations (precise data-flow).
     */
    _computeLinksFromReads(readRelations) {
        const links = [];
        const seen = new Set();

        for (const rel of readRelations) {
            const linkId = `${rel.fromKey}->${rel.toKey}`;
            if (seen.has(linkId)) continue;
            seen.add(linkId);

            links.push({
                fromKey: rel.fromKey,
                toKey: rel.toKey,
                strength: 0.8,
                readValue: rel.readValue || ''
            });
        }

        return links;
    }

    /**
     * Fallback heuristic: walk through the trace and find causal links
     * based on line proximity (for traces that don't have READ events).
     */
    _computeLinksHeuristic(snapshot, trace) {
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
     * Render all causality links efficiently:
     *   1. One LineSystem for all strands (single draw call)
     *   2. Thin-instanced arrowheads (single draw call)
     *   3. Thin-instanced junction dots (single draw call)
     *   4. No per-strand materials, animations, or labels
     */
    _renderWeb(links) {
        if (links.length === 0) return;

        // ── Collect building positions & colours ──
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

        // ── Build line paths and colours for LineSystem ──
        const allLines = [];    // array of point-arrays
        const allColors = [];   // parallel array of color-arrays
        const arrowData = [];   // { position, direction } for arrowheads
        const junctionSet = new Set();

        for (let i = 0; i < links.length; i++) {
            const link = links[i];
            const fromPos = posMap.get(link.fromKey);
            const toPos = posMap.get(link.toKey);
            if (!fromPos || !toPos) continue;

            const fromColor = colorMap.get(link.fromKey) || { r: 0.5, g: 0.5, b: 0.5 };
            const toColor = colorMap.get(link.toKey) || { r: 0.5, g: 0.5, b: 0.5 };

            // Blend colours with reduced brightness
            const blendR = (fromColor.r + toColor.r) / 2 * 0.4;
            const blendG = (fromColor.g + toColor.g) / 2 * 0.4;
            const blendB = (fromColor.b + toColor.b) / 2 * 0.4;
            const col = new BABYLON.Color4(blendR, blendG, blendB, 0.4);

            // Arc midpoint slightly upward
            const midPoint = BABYLON.Vector3.Lerp(fromPos, toPos, 0.5);
            const dist = BABYLON.Vector3.Distance(fromPos, toPos);
            midPoint.y += dist * 0.10 + 0.3;

            // 8-segment Bézier (reduced from 16)
            const pts = this._quadraticBezier(fromPos, midPoint, toPos, 8);
            const cols = new Array(pts.length).fill(col);

            allLines.push(pts);
            allColors.push(cols);

            // Arrow data — place near the target end
            const arrowPos = BABYLON.Vector3.Lerp(midPoint, toPos, 0.85);
            const dir = toPos.subtract(midPoint).normalize();
            arrowData.push({ pos: arrowPos, dir });

            junctionSet.add(link.fromKey);
            junctionSet.add(link.toKey);
        }

        if (allLines.length === 0) return;

        // ── 1) Single LineSystem for all strands ──
        this._lineSystem = BABYLON.MeshBuilder.CreateLineSystem('causalLines', {
            lines: allLines,
            colors: allColors
        }, this.scene);
        this._lineMat = new BABYLON.StandardMaterial('causalLineMat', this.scene);
        this._lineMat.emissiveColor = new BABYLON.Color3(0.2, 0.15, 0.25);
        this._lineMat.disableLighting = true;
        this._lineSystem.material = this._lineMat;
        this._lineSystem.isPickable = false;
        this._lineSystem.freezeWorldMatrix();

        // ── 2) Thin-instanced arrowheads ──
        if (arrowData.length > 0) {
            this._arrowMat = new BABYLON.StandardMaterial('causalArrowMat', this.scene);
            this._arrowMat.emissiveColor = new BABYLON.Color3(0.3, 0.25, 0.4);
            this._arrowMat.diffuseColor = new BABYLON.Color3(0.3, 0.25, 0.4);
            this._arrowMat.alpha = 0.4;

            this._arrowRoot = BABYLON.MeshBuilder.CreateCylinder('causalArrowRoot', {
                height: 0.3, diameterTop: 0, diameterBottom: 0.18, tessellation: 4
            }, this.scene);
            this._arrowRoot.material = this._arrowMat;
            this._arrowRoot.isPickable = false;
            this._arrowRoot.isVisible = false; // root hidden; instances are visible

            const up = new BABYLON.Vector3(0, 1, 0);
            for (let i = 0; i < arrowData.length; i++) {
                const { pos, dir } = arrowData[i];
                const mat = BABYLON.Matrix.Identity();

                // Build rotation
                const axis = BABYLON.Vector3.Cross(up, dir);
                const axisLen = axis.length();
                if (axisLen > 0.001) {
                    axis.scaleInPlace(1 / axisLen);
                    const angle = Math.acos(Math.max(-1, Math.min(1, BABYLON.Vector3.Dot(up, dir))));
                    const rot = BABYLON.Matrix.RotationAxis(axis, angle);
                    mat.copyFrom(rot);
                }
                mat.setTranslation(pos);

                this._arrowRoot.thinInstanceAdd(mat);
            }
            this._arrowRoot.thinInstanceRefreshBoundingInfo();
            this._arrowRoot.freezeWorldMatrix();
        }

        // ── 3) Thin-instanced junction dots ──
        const junctionPositions = [];
        for (const key of junctionSet) {
            const pos = posMap.get(key);
            if (pos) junctionPositions.push(pos);
        }

        if (junctionPositions.length > 0) {
            this._junctionMat = new BABYLON.StandardMaterial('causalJunctionMat', this.scene);
            this._junctionMat.emissiveColor = new BABYLON.Color3(1, 1, 1);
            this._junctionMat.diffuseColor = new BABYLON.Color3(0.9, 0.85, 1.0);
            this._junctionMat.alpha = 0.7;

            this._junctionRoot = BABYLON.MeshBuilder.CreateSphere('causalJunctionRoot', {
                diameter: 0.22, segments: 3
            }, this.scene);
            this._junctionRoot.material = this._junctionMat;
            this._junctionRoot.isPickable = false;
            this._junctionRoot.isVisible = false;

            for (const pos of junctionPositions) {
                const mat = BABYLON.Matrix.Translation(pos.x, pos.y + 0.3, pos.z);
                this._junctionRoot.thinInstanceAdd(mat);
            }
            this._junctionRoot.thinInstanceRefreshBoundingInfo();
            this._junctionRoot.freezeWorldMatrix();
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
