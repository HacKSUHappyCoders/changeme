/**
 * BranchTreeRenderer — Phase 4
 *
 * Renders if/elif/else chains as tree structures when expanded.
 *
 * Unlike the spiral galaxy approach, this creates:
 *   1. A root node representing the condition evaluation
 *   2. Branch arms fanning out below the root (if / else-if / else)
 *   3. Child nodes on each branch arm representing the code inside that branch
 *   4. Hover labels for each node
 *   5. Visual indication of which branch was taken (bright) vs not taken (dim)
 *
 * The tree grows downward from the root: the condition is the trunk,
 * branches are arms, and child steps are leaves.
 *
 * Tree color follows the existing hash-based color scheme for branches.
 */
class BranchTreeRenderer {
    constructor(scene, labelHelper) {
        this.scene = scene;
        this.labelHelper = labelHelper;

        // All rendered trees: parentKey → treeData
        this.trees = new Map();

        // Tree configuration
        this.rootNodeRadius     = 0.45;       // root (condition) node size
        this.branchNodeRadius   = 0.35;       // branch label node size
        this.leafNodeRadius     = 0.28;       // child-step node size (smaller)
        this.trunkLength        = 2.5;        // vertical drop from root to branch fan
        this.branchSpread       = 4.0;        // horizontal spread between branches
        this.leafSpacing        = 1.0;        // vertical spacing between leaf nodes
        this.connectionRadius   = 0.05;       // tube thickness (thinner)
        this.takenAlpha         = 0.95;       // alpha for the taken branch
        this.dimAlpha           = 0.30;       // alpha for not-taken branches

        // Material cache — keyed by rounded colour
        this._matCache = new Map();

        // Callback for when tree is toggled (mirrors bubble API)
        this.onTreeToggle = null;
    }

    // ─── Main API ──────────────────────────────────────────────────

    /**
     * Render a tree for an if-statement chain.
     *
     * @param {string}          parentKey    – entity key (e.g. "cond_…_#1")
     * @param {number[]}        childIndices – indices into the trace array
     * @param {BABYLON.Vector3} parentPos    – world position of the branch building
     * @param {Array}           trace        – full trace array
     * @param {object}          branchEntity – the branch intersection entity from WorldState
     */
    renderTree(parentKey, childIndices, parentPos, trace, branchEntity) {
        // Remove existing tree if present
        this.removeTree(parentKey);

        // ── Build the branch structure from the sub-trace ──
        const branchInfo = this._extractBranchStructure(childIndices, trace, branchEntity);
        if (!branchInfo) return null;

        const treeCenter = parentPos.clone();

        // ── Root node (the condition) ──
        const rootColor = this._getRootColor(parentKey, branchEntity);
        const rootNode  = this._createRootNode(parentKey, treeCenter, rootColor, branchEntity);

        // ── Branch arms ──
        const arms           = [];
        const armConnections = [];
        const numBranches    = branchInfo.branches.length;

        for (let b = 0; b < numBranches; b++) {
            const branch    = branchInfo.branches[b];
            const isTaken   = branch.isTaken;
            const branchAlpha = isTaken ? this.takenAlpha : this.dimAlpha;

            // Fan-out position for this branch
            const armPos = this._branchArmPosition(treeCenter, b, numBranches);

            // Arm connector: root → arm node
            const armConn = this._createTube(
                `${parentKey}_arm_${b}`,
                treeCenter,
                armPos,
                rootColor,
                branchAlpha
            );
            armConnections.push(armConn);

            // Branch label node (diamond shape)
            const armColor = this._getBranchColor(parentKey, branch.label, isTaken);
            const armNode  = this._createBranchArmNode(
                `${parentKey}_brNode_${b}`, armPos, armColor, branch, branchAlpha
            );

            // Leaf nodes: child steps inside this branch
            const leaves     = [];
            const leafConns  = [];
            const entities   = this._consolidateLeafSteps(branch.childIndices, trace);

            let prevPos = armPos;
            for (let l = 0; l < entities.length; l++) {
                const leafPos = this._leafPosition(armPos, l, entities.length);
                const leafColor = this._getLeafColor(entities[l]);
                const leafNode  = this._createLeafNode(
                    `${parentKey}_leaf_${b}_${l}`, leafPos, leafColor, entities[l], branchAlpha
                );

                // Connector: previous → leaf
                const leafConn = this._createTube(
                    `${parentKey}_leafConn_${b}_${l}`,
                    prevPos, leafPos,
                    leafColor, branchAlpha * 0.8
                );
                leafConns.push(leafConn);
                leaves.push(leafNode);
                prevPos = leafPos;
            }

            arms.push({
                label: branch.label,
                isTaken,
                armNode,
                armConnection: armConn,
                leaves,
                leafConnections: leafConns,
                entities
            });
        }

        // Bounding radius for camera / push-out
        const boundingRadius = Math.max(
            this.trunkLength + entities_maxLeafCount(arms) * this.leafSpacing,
            this.branchSpread * numBranches * 0.5
        ) + 2;

        const treeData = {
            rootNode,
            arms,
            armConnections,
            boundingRadius,
            parentPos: parentPos.clone(),
            treeCenter,
            branchEntity
        };

        this.trees.set(parentKey, treeData);

        // Notify parent
        if (this.onTreeToggle) {
            this.onTreeToggle('open', parentKey, boundingRadius, treeCenter);
        }

        return treeData;
    }

    /**
     * Remove a tree by key.
     */
    removeTree(parentKey) {
        const existing = this.trees.get(parentKey);
        if (existing) {
            this._disposeTree(existing);
            this.trees.delete(parentKey);
            if (this.onTreeToggle) {
                this.onTreeToggle('close', parentKey);
            }
            return true;
        }
        return false;
    }

    /** Remove ALL trees. */
    clearAll() {
        for (const data of this.trees.values()) {
            this._disposeTree(data);
        }
        this.trees.clear();
        // Dispose cached materials on full clear
        this._matCache.forEach(mat => {
            try { if (mat) mat.dispose(); } catch (e) { /* already disposed */ }
        });
        this._matCache.clear();
    }

    // ─── Branch Structure Extraction ───────────────────────────────

    /**
     * Given the child step indices and the branchEntity, determine how many
     * branches exist (if / elif / else) and which child steps belong to each.
     *
     * Strategy:
     *   The branchEntity from WorldState represents ONE if-statement.
     *   Its childStepIndices contain the events that happened inside that
     *   if-statement's scope.  We split into two arms:
     *     - The TAKEN arm (the branch that was actually executed) with its child steps
     *     - The NOT-TAKEN arm (empty — no code ran there)
     *
     *   For elif chains we detect multiple CONDITION events in the sub-trace
     *   and create one arm per condition.
     */
    _extractBranchStructure(childIndices, trace, branchEntity) {
        if (!childIndices || childIndices.length === 0) {
            return this._fallbackStructure(branchEntity);
        }

        // Gather all CONDITION and BRANCH events vs regular child steps
        const conditions = [];
        let currentCondition = null;
        const childSteps = [];

        for (const idx of childIndices) {
            const step = trace[idx];
            if (!step) continue;

            if (step.type === 'CONDITION') {
                // New condition in an elif chain
                if (currentCondition) {
                    conditions.push(currentCondition);
                }
                currentCondition = {
                    conditionName: step.name || step.subject || step.condition || '?',
                    conditionResult: !!(step.conditionResult ?? step.condition_result),
                    branchSubtype: null,
                    isTaken: false,
                    childIndices: []
                };
            } else if (step.type === 'BRANCH') {
                // Marks which branch was taken
                if (currentCondition) {
                    currentCondition.branchSubtype = step.subtype || step.name || 'if';
                    currentCondition.isTaken = true;
                } else {
                    // Bare BRANCH (e.g. else without preceding condition in this sub-trace)
                    currentCondition = {
                        conditionName: step.condition || branchEntity?.condition || '?',
                        conditionResult: true,
                        branchSubtype: step.subtype || 'else',
                        isTaken: true,
                        childIndices: []
                    };
                }
            } else {
                // Regular child step — belongs to the current condition's taken arm
                if (currentCondition) {
                    currentCondition.childIndices.push(idx);
                } else {
                    childSteps.push(idx);
                }
            }
        }

        // Push last condition
        if (currentCondition) {
            conditions.push(currentCondition);
        }

        // If we found no structured conditions, use fallback
        if (conditions.length === 0) {
            // All steps are just child steps — put them in one taken arm
            const cond = branchEntity ? branchEntity.condition : '?';
            const result = branchEntity ? branchEntity.result : true;
            const chosen = branchEntity ? branchEntity.chosenBranch : 'if';
            return {
                condition: cond,
                result,
                branches: [{
                    label: `${chosen || 'if'} (${cond})`,
                    condition: cond,
                    conditionResult: result,
                    isTaken: true,
                    childIndices: childSteps
                }, {
                    label: result ? 'else' : `if (${cond})`,
                    condition: cond,
                    conditionResult: !result,
                    isTaken: false,
                    childIndices: []
                }]
            };
        }

        // Build branches from the conditions we found
        const branches = [];
        for (const cond of conditions) {
            const subtype = cond.branchSubtype || 'if';
            let label;
            if (subtype === 'else') {
                label = 'else';
            } else if (subtype === 'elif' || subtype === 'else if') {
                label = `else if (${cond.conditionName})`;
            } else {
                label = `if (${cond.conditionName})`;
            }
            branches.push({
                label,
                condition: cond.conditionName,
                conditionResult: cond.conditionResult,
                isTaken: cond.isTaken,
                childIndices: cond.childIndices
            });
        }

        // If only one branch was taken and there's no explicit else,
        // add the complementary not-taken arm
        if (branches.length === 1) {
            const taken = branches[0];
            const notTakenLabel = taken.label.startsWith('else')
                ? `if (${taken.condition})`
                : 'else';
            branches.push({
                label: notTakenLabel,
                condition: taken.condition,
                conditionResult: !taken.conditionResult,
                isTaken: false,
                childIndices: []
            });
        }

        const mainCond = branchEntity ? branchEntity.condition : (conditions[0]?.conditionName || '?');
        const mainResult = branchEntity ? branchEntity.result : (conditions[0]?.conditionResult ?? true);

        return {
            condition: mainCond,
            result: mainResult,
            branches
        };
    }

    /**
     * Fallback: produce a minimal two-branch structure from the entity data.
     */
    _fallbackStructure(branchEntity) {
        const cond = branchEntity ? branchEntity.condition : '?';
        const result = branchEntity ? branchEntity.result : true;
        const chosen = branchEntity ? branchEntity.chosenBranch : 'if';

        const branches = [
            {
                label: `if (${cond})`,
                condition: cond,
                conditionResult: result,
                isTaken: chosen !== 'else',
                childIndices: []
            },
            {
                label: 'else',
                condition: cond,
                conditionResult: !result,
                isTaken: chosen === 'else',
                childIndices: []
            }
        ];

        return { condition: cond, result, branches };
    }

    // ─── Leaf Consolidation ────────────────────────────────────────

    /**
     * Consolidate raw child steps into entity types (same logic as
     * LoopBubbleRenderer/SubSpiralRenderer).
     */
    _consolidateLeafSteps(childIndices, trace) {
        const entities = [];
        const varMap  = new Map();
        const loopMap = new Map();

        for (const idx of childIndices) {
            const step = trace[idx];
            if (!step) continue;
            if (step.type === 'READ') continue;

            const stepName = step.name || step.subject || '';

            if (step.type === 'DECL' || step.type === 'ASSIGN' || step.type === 'PARAM') {
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
                const loopKey = `${step.subtype || 'loop'}|${step.condition || ''}`;
                if (loopMap.has(loopKey)) {
                    const ent = loopMap.get(loopKey);
                    ent.stepIndices.push(idx);
                    ent.iterations++;
                } else {
                    const ent = {
                        type: 'loop',
                        colorType: 'LOOP',
                        label: `${(step.subtype || 'loop').toUpperCase()} (${step.condition || '?'})`,
                        subtype: step.subtype,
                        condition: step.condition,
                        iterations: 1,
                        stepIndices: [idx],
                        firstStep: step
                    };
                    loopMap.set(loopKey, ent);
                    entities.push(ent);
                }
            } else if (step.type === 'CALL') {
                entities.push({
                    type: 'call', colorType: 'CALL',
                    label: stepName || 'function',
                    name: stepName,
                    stepIndices: [idx],
                    firstStep: step
                });
            } else if (step.type === 'RETURN') {
                entities.push({
                    type: 'return', colorType: 'RETURN',
                    label: stepName || 'return',
                    value: step.value,
                    stepIndices: [idx],
                    firstStep: step
                });
            } else if (step.type !== 'CONDITION' && step.type !== 'BRANCH') {
                entities.push({
                    type: step.type.toLowerCase(),
                    colorType: step.type,
                    label: stepName || step.type,
                    stepIndices: [idx],
                    firstStep: step
                });
            }
        }
        return entities;
    }

    // ─── Layout ────────────────────────────────────────────────────

    /**
     * Compute position for a branch arm node, fanning horizontally from root.
     */
    _branchArmPosition(rootPos, branchIndex, totalBranches) {
        const totalWidth = (totalBranches - 1) * this.branchSpread;
        const startX = -totalWidth / 2;
        const x = startX + branchIndex * this.branchSpread;

        return new BABYLON.Vector3(
            rootPos.x + x,
            rootPos.y - this.trunkLength,
            rootPos.z
        );
    }

    /**
     * Compute position for a leaf node below its branch arm.
     */
    _leafPosition(armPos, leafIndex, totalLeaves) {
        return new BABYLON.Vector3(
            armPos.x,
            armPos.y - (leafIndex + 1) * this.leafSpacing,
            armPos.z + (leafIndex % 2 === 0 ? 0.3 : -0.3) // slight zigzag for visual interest
        );
    }

    // ─── Node Creation ─────────────────────────────────────────────

    /**
     * Root node: octahedron (diamond) representing the condition evaluation.
     * Optimized: shared material, no looping rotation animation.
     */
    _createRootNode(parentKey, position, color, branchEntity) {
        const mesh = BABYLON.MeshBuilder.CreatePolyhedron(
            `${parentKey}_root`,
            { type: 1, size: this.rootNodeRadius },
            this.scene
        );
        mesh.position = position.clone();

        const mat = this._getCachedGlowMat('root', color, this.takenAlpha);
        mesh.material = mat;

        // Label
        const condText = branchEntity
            ? `IF (${branchEntity.condition}) → ${branchEntity.result ? 'TRUE' : 'FALSE'}`
            : 'CONDITION';
        const label = this.labelHelper.create(
            `${parentKey}_rootLabel`, condText,
            position.clone(), 1.0, color
        );
        label.isVisible = true;

        // Fast scale-in (no looping spin)
        this._animateScaleIn(mesh);

        mesh._isTreeNode = true;
        mesh._isBubbleNode = true;
        mesh._entityData = branchEntity || {};
        mesh._bubbleNodeData = {
            step: branchEntity ? branchEntity.step : 0,
            stepData: { type: 'CONDITION', name: branchEntity ? branchEntity.condition : '' },
            type: 'condition',
            color,
            index: -1
        };
        mesh._label = label;
        mesh.isPickable = true;

        return { mesh, label, position: position.clone() };
    }

    /**
     * Branch arm node: elongated diamond showing the branch label.
     * Optimized: cached material, no individual material per node.
     */
    _createBranchArmNode(name, position, color, branch, alpha) {
        const mesh = BABYLON.MeshBuilder.CreatePolyhedron(
            name,
            { type: 1, size: this.branchNodeRadius },
            this.scene
        );
        mesh.position = position.clone();
        mesh.scaling.y = 1.4;

        const mat = this._getCachedGlowMat(`arm_${branch.isTaken ? 'taken' : 'dim'}`, color, alpha);
        mesh.material = mat;

        // Label
        const labelText = branch.isTaken
            ? `✓ ${branch.label}`
            : `✗ ${branch.label}`;
        const label = this.labelHelper.create(
            `${name}_label`, labelText,
            position.clone(), 0.8, color
        );
        label.isVisible = true;

        this._animateScaleIn(mesh);

        mesh._isTreeNode = true;
        mesh._isBubbleNode = true;
        mesh._label = label;
        mesh.isPickable = true;
        mesh._bubbleNodeData = {
            step: 0,
            stepData: { type: 'BRANCH', name: branch.label },
            type: 'branch',
            color,
            index: 0
        };

        return { mesh, label, position: position.clone(), branch };
    }

    /**
     * Leaf node: simpler shapes, cached materials.
     */
    _createLeafNode(name, position, color, entity, alpha) {
        let mesh;

        switch (entity.type) {
            case 'variable': {
                const h = this.leafNodeRadius * 2.2;
                mesh = BABYLON.MeshBuilder.CreateBox(name, {
                    height: h, width: this.leafNodeRadius * 1.8, depth: this.leafNodeRadius * 1.8
                }, this.scene);
                mesh.position = position.clone();
                mesh.position.y += h / 2;
                break;
            }
            case 'loop': {
                const h = this.leafNodeRadius * 2.5;
                mesh = BABYLON.MeshBuilder.CreateCylinder(name, {
                    height: h, diameterTop: this.leafNodeRadius * 1.2,
                    diameterBottom: this.leafNodeRadius * 1.8, tessellation: 6
                }, this.scene);
                mesh.position = position.clone();
                mesh.position.y += h / 2;
                break;
            }
            case 'call':
            case 'return': {
                const h = this.leafNodeRadius * 2.5;
                mesh = BABYLON.MeshBuilder.CreateCylinder(name, {
                    height: h, diameterTop: this.leafNodeRadius * 0.8,
                    diameterBottom: this.leafNodeRadius * 2, tessellation: 4
                }, this.scene);
                const bake = BABYLON.Matrix.RotationY(Math.PI / 4)
                    .multiply(BABYLON.Matrix.Translation(0, h / 2, 0));
                mesh.bakeTransformIntoVertices(bake);
                mesh.position = position.clone();
                break;
            }
            default: {
                mesh = BABYLON.MeshBuilder.CreateSphere(name, {
                    diameter: this.leafNodeRadius * 2, segments: 6
                }, this.scene);
                mesh.position = position.clone();
                mesh.position.y += this.leafNodeRadius;
                break;
            }
        }

        const mat = this._getCachedGlowMat(entity.type, color, alpha);
        mesh.material = mat;

        // Label
        const labelText = entity.label || entity.type;
        const label = this.labelHelper.create(
            `${name}_label`, labelText,
            position.clone(), 0.6, color
        );
        label.isVisible = false;

        this._animateScaleIn(mesh);

        mesh._isTreeNode = true;
        mesh._isBubbleNode = true;
        mesh._label = label;
        mesh._entityData = entity;
        mesh.isPickable = true;
        mesh._bubbleNodeData = {
            step: entity.stepIndices ? entity.stepIndices[0] : 0,
            stepData: entity.firstStep || { type: entity.type, name: entity.label },
            type: entity.type,
            color,
            entity
        };

        return { mesh, label, position: position.clone(), entity };
    }

    // ─── Connections (tubes) ───────────────────────────────────────

    /**
     * Connection between nodes — simple line instead of bezier tube.
     */
    _createTube(name, fromPos, toPos, color, alpha) {
        const line = BABYLON.MeshBuilder.CreateLines(
            name,
            { points: [fromPos, toPos], updatable: false },
            this.scene
        );
        line.color = new BABYLON.Color3(color.r, color.g, color.b);
        line.alpha = alpha * 0.7;
        line.isPickable = false;
        return line;
    }

    // ─── Colors ────────────────────────────────────────────────────

    _getRootColor(parentKey, branchEntity) {
        const cond = branchEntity ? branchEntity.condition : parentKey;
        return ColorHash.color('branch', cond);
    }

    _getBranchColor(parentKey, branchLabel, isTaken) {
        const base = ColorHash.color('branch', `${parentKey}_${branchLabel}`);
        if (isTaken) {
            // Brighten the taken branch
            return {
                r: Math.min(base.r * 1.3, 1),
                g: Math.min(base.g * 1.3, 1),
                b: Math.min(base.b * 1.3, 1),
                a: base.a || 1
            };
        }
        return base;
    }

    _getLeafColor(entity) {
        const name = entity.label || entity.subject || entity.type;
        const colorType = entity.colorType || entity.type || 'CALL';

        switch (colorType.toUpperCase()) {
            case 'DECL':
            case 'ASSIGN':
            case 'PARAM':
            case 'VARIABLE':
                return ColorHash.color('variable', name);
            case 'CALL':
            case 'RETURN':
                return ColorHash.color('function', name);
            case 'LOOP':
                return ColorHash.color(entity.subtype || 'for', name);
            default:
                return { r: 0.7, g: 0.7, b: 0.9, a: 1.0 };
        }
    }

    // ─── Material Helpers ──────────────────────────────────────────

    /**
     * Cached glow material — avoids creating one material per node.
     * Key is based on type + rounded colour + alpha bucket.
     */
    _getCachedGlowMat(type, color, alpha) {
        const cr = (color.r * 10 | 0);
        const cg = (color.g * 10 | 0);
        const cb = (color.b * 10 | 0);
        const ab = (alpha * 10 | 0);
        const cacheKey = `${type}_${cr}_${cg}_${cb}_${ab}`;

        if (this._matCache.has(cacheKey)) return this._matCache.get(cacheKey);

        const mat = new BABYLON.StandardMaterial(`treeMat_${cacheKey}`, this.scene);
        mat.diffuseColor  = new BABYLON.Color3(color.r, color.g, color.b);
        mat.emissiveColor = new BABYLON.Color3(color.r * 0.35, color.g * 0.35, color.b * 0.35);
        mat.specularColor = new BABYLON.Color3(0.15, 0.15, 0.15);
        mat.alpha = alpha !== undefined ? alpha : 0.9;
        mat.freeze();
        this._matCache.set(cacheKey, mat);
        return mat;
    }

    _animateScaleIn(mesh) {
        mesh.scaling = new BABYLON.Vector3(0.01, 0.01, 0.01);
        BABYLON.Animation.CreateAndStartAnimation(
            'treeScaleIn', mesh, 'scaling', 30, 15,
            mesh.scaling,
            new BABYLON.Vector3(1, 1, 1),
            BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT
        );
    }

    // ─── Disposal ──────────────────────────────────────────────────

    _disposeTree(treeData) {
        // Root
        if (treeData.rootNode) {
            this._disposeNodeEntry(treeData.rootNode);
        }

        // Arms
        if (treeData.arms) {
            for (const arm of treeData.arms) {
                this._disposeNodeEntry(arm.armNode);
                if (arm.armConnection) {
                    this._disposeMesh(arm.armConnection);
                }
                if (arm.leaves) {
                    for (const leaf of arm.leaves) {
                        this._disposeNodeEntry(leaf);
                    }
                }
                if (arm.leafConnections) {
                    for (const conn of arm.leafConnections) {
                        this._disposeMesh(conn);
                    }
                }
            }
        }

        // Arm connections (redundant safety)
        if (treeData.armConnections) {
            for (const conn of treeData.armConnections) {
                this._disposeMesh(conn);
            }
        }
    }

    _disposeNodeEntry(nodeEntry) {
        if (!nodeEntry) return;
        if (nodeEntry.mesh) {
            this.scene.stopAnimation(nodeEntry.mesh);
            // Don't dispose cached materials — just detach
            nodeEntry.mesh.material = null;
            nodeEntry.mesh.dispose();
        }
        if (nodeEntry.label) {
            nodeEntry.label.dispose();
        }
    }

    _disposeMesh(mesh) {
        if (!mesh) return;
        this.scene.stopAnimation(mesh);
        // Lines don't have materials; don't try to dispose
        mesh.dispose();
    }

    // ─── Accessors ─────────────────────────────────────────────────

    getTreeByKey(key) {
        return this.trees.get(key);
    }

    hasTree(key) {
        return this.trees.has(key);
    }

    /**
     * Get all meshes in a tree (for navigation / galaxy warp purposes).
     */
    getTreeMeshes(key) {
        const data = this.trees.get(key);
        if (!data) return [];
        const meshes = [];
        if (data.rootNode && data.rootNode.mesh) meshes.push(data.rootNode.mesh);
        if (data.arms) {
            for (const arm of data.arms) {
                if (arm.armNode && arm.armNode.mesh) meshes.push(arm.armNode.mesh);
                if (arm.leaves) {
                    for (const leaf of arm.leaves) {
                        if (leaf.mesh) meshes.push(leaf.mesh);
                    }
                }
            }
        }
        return meshes;
    }
}

/**
 * Helper: compute the maximum leaf count across all arms (for bounding radius).
 */
function entities_maxLeafCount(arms) {
    let max = 0;
    for (const arm of arms) {
        const c = arm.leaves ? arm.leaves.length : 0;
        if (c > max) max = c;
    }
    return max;
}
