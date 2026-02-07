/**
 * GalaxyBuilder — Responsible for building galaxy spirals from sub-traces
 *
 * Handles:
 * - Converting sub-traces into galaxy buildings
 * - Creating spiral layouts for galaxies
 * - Computing child relationships for recursive warping
 * - Rendering causality webs within galaxies
 */
class GalaxyBuilder {
    constructor(scene, mainCityRenderer, labelHelper) {
        this.scene = scene;
        this.mainCityRenderer = mainCityRenderer;
        this.labelHelper = labelHelper;

        // Material cache for performance
        this._matCache = new Map();

        // Meshes created during build
        this._galaxyMeshes = [];
        this._galaxyExtraMeshes = [];
        this._galaxySpiralTube = null;

        // Pending animation timers
        this._pendingTimers = [];

        // ── Performance: cap galaxy building count ──
        this.maxGalaxyNodes = 80;

        // ── Flow bubble configuration ──
        this.bubbleCount = 8;             // bubbles per spiral
        this.bubbleBaseSize = 0.25;       // base diameter (larger for galaxy visibility)
        this.bubbleSizeVariance = 0.12;   // random size variation
        this.bubbleDuration = 3000;       // ms to travel full path
        this.bubbleDurationVariance = 1000; // random speed variation
        this._bubbles = [];               // active bubble meshes
    }

    /**
     * Build a full mini-city (galaxy) from a sub-trace at the given center.
     * Uses the SubSpiralRenderer's consolidation logic to deduplicate entities,
     * then lays them out on a spiral.
     */
    buildGalaxy(subTrace, center, parentEntity) {
        const renderer = this.mainCityRenderer.subSpiralRenderer;
        const allIndices = subTrace.map((_, i) => i);
        const rawEntities = renderer._consolidateChildren(allIndices, subTrace);

        // ── Performance: cap large galaxy spirals ──
        let entities = rawEntities;
        if (rawEntities.length > this.maxGalaxyNodes) {
            entities = rawEntities.slice(0, this.maxGalaxyNodes - 1);
            const remaining = rawEntities.length - entities.length;
            entities.push({
                type: 'summary',
                colorType: 'SUMMARY',
                label: `… ${remaining} more nodes`,
                stepIndices: [],
                firstStep: rawEntities[this.maxGalaxyNodes - 1].firstStep || {}
            });
        }

        // Reset extra meshes list before building
        this._galaxyExtraMeshes = [];

        const meshes = [];
        const pathPoints = [];

        // Galaxy spiral config
        const radiusStart = 4.0;
        const radiusGrowth = 0.25;
        const angleStep = 0.7;
        const heightStep = 0.08;

        // Pre-compute child-step ranges for container entities
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
            mat.emissiveColor = new BABYLON.Color3(0.25, 0.2, 0.35);
            mat.diffuseColor = new BABYLON.Color3(0.35, 0.3, 0.5);
            mat.alpha = 0.45;
            mat.freeze();
            spiralTube.material = mat;
            spiralTube.isPickable = false;
            spiralTube.freezeWorldMatrix();
            meshes.push(spiralTube);
        }

        this._galaxyMeshes = [...meshes, ...this._galaxyExtraMeshes];
        this._galaxySpiralTube = spiralTube;

        // Render causality web
        const causalityMeshes = this._renderGalaxyCausalityWeb(subTrace, entities, meshes.filter(m => m._isGalaxyBuilding));
        if (causalityMeshes.length > 0) {
            this._galaxyMeshes.push(...causalityMeshes);
            this._galaxyExtraMeshes.push(...causalityMeshes);
        }

        // Animate buildings with staggered pop-in
        this._animateGalaxyBuildings(meshes.filter(m => m._isGalaxyBuilding));

        // ── Create animated flow bubbles traveling down the spiral ──
        this._bubbles = this._createFlowBubbles(pathPoints);
        this._galaxyMeshes.push(...this._bubbles);

        // Freeze extra meshes
        for (const extra of this._galaxyExtraMeshes) {
            if (extra && !extra.isDisposed()) {
                extra.freezeWorldMatrix();
            }
        }

        return {
            entities,
            meshes: this._galaxyMeshes,
            extraMeshes: this._galaxyExtraMeshes,
            spiralTube: this._galaxySpiralTube,
            bubbles: this._bubbles,
            pathPoints,
            center
        };
    }

    /**
     * Animate galaxy buildings with staggered pop-in effect
     */
    _animateGalaxyBuildings(buildingMeshes) {
        // Clear pending timers from any previous galaxy
        this._pendingTimers.forEach(id => clearTimeout(id));
        this._pendingTimers = [];

        // Create reusable pop-in animation
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

        buildingMeshes.forEach((mesh, i) => {
            mesh.scaling = new BABYLON.Vector3(0, 0, 0);
            // Reduce stagger delay for large galaxies to avoid long load feel
            const delay = buildingMeshes.length > 40 ? i * 15 : i * 40;
            const timerId = setTimeout(() => {
                if (!mesh.isDisposed()) {
                    this.scene.beginDirectAnimation(mesh, [popAnim], 0, 15, false, 1.0, () => {
                        if (!mesh.isDisposed()) {
                            mesh.scaling = new BABYLON.Vector3(1, 1, 1);
                            mesh.refreshBoundingInfo();
                            mesh.freezeWorldMatrix();
                        }
                    });
                }
            }, delay);
            this._pendingTimers.push(timerId);
        });
    }

    /**
     * Create animated bubbles that flow DOWN the spiral path to show
     * directional execution flow.
     */
    _createFlowBubbles(pathPoints) {
        if (pathPoints.length < 2) return [];

        const bubbles = [];
        const count = Math.min(this.bubbleCount, Math.floor(pathPoints.length / 2));

        // Reverse path so bubbles flow TOP → BOTTOM (down the spiral)
        const reversedPath = [...pathPoints].reverse();

        // Galaxy spiral color (purple-ish to match the tube)
        const pathColor = { r: 0.5, g: 0.35, b: 0.7 };

        for (let i = 0; i < count; i++) {
            const size = this.bubbleBaseSize + Math.random() * this.bubbleSizeVariance;
            const bubble = BABYLON.MeshBuilder.CreateSphere(
                `galaxyFlowBubble_${i}`,
                { diameter: size, segments: 12 },
                this.scene
            );

            // Glassy, glowing bubble material
            const mat = new BABYLON.StandardMaterial(`galaxyBubbleMat_${i}`, this.scene);
            mat.diffuseColor = new BABYLON.Color3(
                Math.min(1, pathColor.r + 0.3),
                Math.min(1, pathColor.g + 0.3),
                Math.min(1, pathColor.b + 0.3)
            );
            mat.emissiveColor = new BABYLON.Color3(
                pathColor.r * 0.9,
                pathColor.g * 0.9,
                pathColor.b * 0.9
            );
            mat.specularColor = new BABYLON.Color3(1, 1, 1);
            mat.specularPower = 64;
            mat.alpha = 0.7;
            bubble.material = mat;
            bubble.isPickable = false;

            // Start at beginning of path
            bubble.position = reversedPath[0].clone();

            // Create the flowing animation
            this._animateBubbleAlongPath(bubble, reversedPath, i, count);

            bubbles.push(bubble);
        }

        return bubbles;
    }

    /**
     * Animate a single bubble flowing along the spiral path.
     */
    _animateBubbleAlongPath(bubble, pathPoints, index, totalBubbles) {
        const duration = this.bubbleDuration + Math.random() * this.bubbleDurationVariance;
        const staggerDelay = (index / totalBubbles) * duration;

        let startTime = null;

        const animate = (time) => {
            if (bubble.isDisposed()) return;

            if (!startTime) startTime = time - staggerDelay;

            const elapsed = time - startTime;
            const loopTime = elapsed % duration;
            const t = loopTime / duration;  // 0 → 1 along path

            // Interpolate position along the path
            const pathProgress = t * (pathPoints.length - 1);
            const segmentIndex = Math.floor(pathProgress);
            const segmentFrac = pathProgress - segmentIndex;

            if (segmentIndex < pathPoints.length - 1) {
                const p0 = pathPoints[segmentIndex];
                const p1 = pathPoints[segmentIndex + 1];
                bubble.position = BABYLON.Vector3.Lerp(p0, p1, segmentFrac);
            } else {
                bubble.position = pathPoints[pathPoints.length - 1].clone();
            }

            // Gentle pulsing scale for organic "floating" feel
            const pulse = 1 + Math.sin(time * 0.005 + index * 1.5) * 0.25;
            bubble.scaling.setAll(pulse);

            // Slight alpha variation for shimmer effect
            if (bubble.material) {
                bubble.material.alpha = 0.55 + Math.sin(time * 0.003 + index * 0.7) * 0.2;
            }

            requestAnimationFrame(animate);
        };

        requestAnimationFrame(animate);
    }

    /**
     * Compute which sub-trace indices belong to each container entity.
     * Uses CALL/RETURN balance tracking instead of depth comparison.
     */
    _computeGalaxyChildMap(subTrace, entities) {
        const childMap = new Map();

        for (let ei = 0; ei < entities.length; ei++) {
            const entity = entities[ei];
            const containerTypes = ['call', 'loop', 'condition'];
            if (!containerTypes.includes(entity.type)) continue;

            const firstStepIdx = entity.stepIndices ? entity.stepIndices[0] : -1;
            if (firstStepIdx < 0 || firstStepIdx >= subTrace.length) continue;

            const firstStep = subTrace[firstStepIdx];
            if (!firstStep) continue;

            const children = [];

            if (entity.type === 'call') {
                let callBalance = 1;
                for (let j = firstStepIdx + 1; j < subTrace.length; j++) {
                    const step = subTrace[j];
                    if (!step) continue;

                    if (step.type === 'CALL') callBalance++;
                    if (step.type === 'RETURN') {
                        callBalance--;
                        if (callBalance <= 0) {
                            children.push(j);
                            break;
                        }
                    }
                    children.push(j);
                }
            } else if (entity.type === 'loop') {
                const loopCondition = firstStep.condition || '';
                const startDepth = Number(firstStep.depth) || 0;

                for (let j = firstStepIdx + 1; j < subTrace.length; j++) {
                    const step = subTrace[j];
                    if (!step) continue;
                    const stepDepth = Number(step.depth) || 0;

                    if (step.type === 'LOOP' && step.condition === loopCondition) {
                        const cr = step.conditionResult !== undefined
                            ? step.conditionResult
                            : step.condition_result;
                        if (Number(cr) === 0) {
                            children.push(j);
                            break;
                        }
                        children.push(j);
                        continue;
                    }

                    if (stepDepth > 0 && startDepth > 0 && stepDepth < startDepth) break;
                    if (stepDepth > 0 && startDepth > 0 && stepDepth === startDepth &&
                        (step.type === 'CALL' || step.type === 'CONDITION')) break;

                    children.push(j);
                }
            } else if (entity.type === 'condition') {
                const startDepth = Number(firstStep.depth) || 0;

                for (let j = firstStepIdx + 1; j < subTrace.length; j++) {
                    const step = subTrace[j];
                    if (!step) continue;

                    if (step.type === 'BRANCH') {
                        children.push(j);
                        break;
                    }
                    const stepDepth = Number(step.depth) || 0;
                    if (stepDepth > 0 && startDepth > 0 && stepDepth < startDepth) break;
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
     * Create a single building mesh for the galaxy.
     */
    _createGalaxyBuilding(entity, pos, index, parentKey) {
        const colorType = entity.colorType || entity.type || 'CALL';
        const color = this._colorForType(colorType);

        let mesh;

        switch (entity.type) {
            case 'variable': {
                const height = 2.0;
                mesh = BABYLON.MeshBuilder.CreateBox(
                    `galaxy_var_${parentKey}_${index}`,
                    { height, width: 1.5, depth: 1.5 },
                    this.scene
                );
                mesh.position = pos.clone();
                mesh.position.y += height / 2;

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

        mesh.material = this._getCachedMat(colorType, color);
        mesh.isPickable = true;
        mesh._isGalaxyBuilding = true;
        mesh._entityData = entity;

        // Create floating label
        const labelText = entity.label || entity.subject || entity.type;
        const label = this.labelHelper.create(
            `galaxy_label_${parentKey}_${index}`,
            labelText,
            mesh.position.clone(),
            3.5,
            color,
            0.5
        );
        label.isVisible = false;
        label.isPickable = false;
        mesh._label = label;
        this._galaxyExtraMeshes.push(label);

        return mesh;
    }

    /**
     * Render causality web within a galaxy.
     */
    _renderGalaxyCausalityWeb(subTrace, entities, buildingMeshes) {
        const createdMeshes = [];
        if (!subTrace || subTrace.length === 0 || buildingMeshes.length === 0) return createdMeshes;

        // Build variable entity map
        const varEntityMap = new Map();
        for (let i = 0; i < entities.length; i++) {
            const ent = entities[i];
            if (ent.type === 'variable') {
                const key = `${ent.subject || ent.label}|${ent.address || ''}`;
                varEntityMap.set(key, i);
                if (!varEntityMap.has(ent.subject || ent.label)) {
                    varEntityMap.set(ent.subject || ent.label, i);
                }
            }
        }

        // Find READ→ASSIGN patterns
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

                let targetEI = varEntityMap.get(`${targetName}|${targetAddr}`);
                if (targetEI === undefined) targetEI = varEntityMap.get(targetName);
                if (targetEI === undefined) continue;

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
                }
                pendingReads.length = 0;
                pendingReads.push(...remaining);
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

            const pts = [];
            const segments = 8;
            for (let s = 0; s <= segments; s++) {
                const t = s / segments;
                const x = (1 - t) * (1 - t) * fromPos.x + 2 * (1 - t) * t * midPoint.x + t * t * toPos.x;
                const y = (1 - t) * (1 - t) * fromPos.y + 2 * (1 - t) * t * midPoint.y + t * t * toPos.y;
                const z = (1 - t) * (1 - t) * fromPos.z + 2 * (1 - t) * t * midPoint.z + t * t * toPos.z;
                pts.push(new BABYLON.Vector3(x, y, z));
            }
            const col = new BABYLON.Color4(0.3, 0.25, 0.4, 0.35);
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
            lineMat.emissiveColor = new BABYLON.Color3(0.2, 0.15, 0.25);
            lineMat.disableLighting = true;
            lineSystem.material = lineMat;
            lineSystem.isPickable = false;
            lineSystem.freezeWorldMatrix();
            createdMeshes.push(lineSystem);
        }

        return createdMeshes;
    }

    /**
     * Get or create cached material for performance
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
            case 'CALL': return { r: 0.9, g: 0.3, b: 0.3, a: 0.85 };
            case 'RETURN': return { r: 0.9, g: 0.6, b: 0.2, a: 0.85 };
            case 'DECL': return { r: 0.3, g: 0.5, b: 0.9, a: 0.85 };
            case 'PARAM': return { r: 0.4, g: 0.6, b: 1.0, a: 0.85 };
            case 'ASSIGN': return { r: 0.3, g: 0.8, b: 0.9, a: 0.85 };
            case 'READ': return { r: 0.2, g: 0.9, b: 0.7, a: 0.85 };
            case 'LOOP': return { r: 0.7, g: 0.3, b: 0.9, a: 0.85 };
            case 'CONDITION': return { r: 0.9, g: 0.5, b: 0.2, a: 0.85 };
            case 'BRANCH': return { r: 0.9, g: 0.8, b: 0.2, a: 0.85 };
            default: return { r: 0.5, g: 0.5, b: 0.5, a: 0.85 };
        }
    }

    /**
     * Cancel pending animation timers
     */
    cancelAnimations() {
        this._pendingTimers.forEach(id => clearTimeout(id));
        this._pendingTimers = [];
    }

    /**
     * Dispose cached materials
     */
    disposeMaterials() {
        this._matCache.forEach(mat => mat.dispose());
        this._matCache.clear();
    }

    /**
     * Dispose flow bubbles
     */
    disposeBubbles() {
        for (const bubble of this._bubbles) {
            if (bubble && !bubble.isDisposed()) {
                if (bubble.material) bubble.material.dispose();
                bubble.dispose();
            }
        }
        this._bubbles = [];
    }
}
