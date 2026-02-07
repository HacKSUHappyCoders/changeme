/**
 * LoopBubbleRenderer — Phase 4
 *
 * Renders for-loops as semi-transparent bubbles containing a connected chain
 * of nodes/buildings representing the code inside the loop.
 *
 * Unlike the spiral galaxy approach, this creates:
 *   1. A semi-transparent spherical bubble (the loop container)
 *   2. A chain of connected nodes inside the bubble
 *   3. Hover labels for each node
 *   4. Causality connections between nodes when enabled
 *
 * Bubble color follows the existing hash-based color scheme for for-loops.
 * Node chain layout positions nodes in a flowing curve inside the bubble.
 */
class LoopBubbleRenderer {
    constructor(scene, labelHelper) {
        this.scene = scene;
        this.labelHelper = labelHelper;

        // All rendered bubbles: parentKey → { bubble, nodes[], connections[], boundingRadius }
        this.bubbles = new Map();

        // Bubble configuration
        this.bubbleOpacity = 0.22;          // semi-transparent
        this.bubbleRadiusBase = 3.0;        // base bubble size
        this.bubbleRadiusPerNode = 0.12;    // grows with content
        this.bubbleSegments = 12;           // low-poly sphere (was 32)

        // Node chain configuration
        this.nodeRadius = 0.30;             // individual node size (smaller)
        this.nodeSpacing = 0.8;             // distance between nodes
        this.chainCurvature = 0.4;          // how much the chain curves

        // Connection line configuration — use lines instead of tubes
        this.connectionRadius = 0.05;       // thinner tubes for connections
        this.connectionOpacity = 0.5;       // slightly transparent

        // ── Performance: cap nodes per bubble ──
        // Recursive loops can produce 100+ entities inside a bubble.
        // Rendering all of them as individual pickable meshes is expensive.
        this.maxBubbleNodes = 50;

        // Material cache for performance (shared across all bubbles)
        this._matCache = new Map();

        // Callback for when bubble is toggled
        this.onBubbleToggle = null;
    }

    // ─── Main API ──────────────────────────────────────────────────

    /**
     * Render a bubble for a for-loop with its child nodes.
     *
     * @param {string}          parentKey    - entity key (e.g. "for_loop_#1")
     * @param {number[]}        childIndices - indices into the trace array
     * @param {BABYLON.Vector3} parentPos    - world position of the loop building
     * @param {Array}           trace        - full trace array
     */
    renderBubble(parentKey, childIndices, parentPos, trace) {
        if (!childIndices || childIndices.length === 0) return;

        // Remove existing bubble if present
        this.removeBubble(parentKey);

        // Consolidate child steps into main entity types (functions, variables, loops)
        // This filters out raw trace steps and groups them into buildings
        const rawEntities = this._consolidateChildren(childIndices, trace);

        if (rawEntities.length === 0) return;

        // ── Performance: cap large bubbles ──
        let entities = rawEntities;
        if (rawEntities.length > this.maxBubbleNodes) {
            entities = rawEntities.slice(0, this.maxBubbleNodes - 1);
            const remaining = rawEntities.length - entities.length;
            entities.push({
                type: 'summary',
                colorType: 'SUMMARY',
                label: `… ${remaining} more`,
                stepIndices: [],
                firstStep: rawEntities[this.maxBubbleNodes - 1].firstStep
            });
        }

        // Calculate bubble size based on consolidated entities
        const bubbleRadius = this.bubbleRadiusBase + (entities.length * this.bubbleRadiusPerNode);

        // Get bubble color from parent loop (for-loop colors)
        const bubbleColor = this._getBubbleColor(parentKey);

        // Create the bubble container
        const bubble = this._createBubble(parentKey, parentPos, bubbleRadius, bubbleColor);

        // Create node chain inside the bubble using consolidated entities
        const nodes = this._createNodeChainFromEntities(
            parentKey,
            entities,
            parentPos,
            bubbleRadius,
            trace
        );

        // Create connections between nodes
        const connections = this._createConnections(nodes, parentKey);

        // Create entry connector from parent building to first node in bubble
        const entryConnector = this._createEntryConnector(parentPos, nodes[0], parentKey, bubbleColor);

        // The bubble center is at parentPos (since bubble.position = parentPos)
        // This is where the camera should focus
        const bubbleCenter = parentPos.clone();

        // Store the bubble data
        const bubbleData = {
            bubble,
            nodes,
            connections,
            entryConnector,
            boundingRadius: bubbleRadius,
            parentPos: parentPos.clone(),
            bubbleCenter: bubbleCenter,
            childIndices,
            entities
        };

        this.bubbles.set(parentKey, bubbleData);

        // Notify parent of bubble creation (use bubble center for camera focus)
        if (this.onBubbleToggle) {
            this.onBubbleToggle('open', parentKey, bubbleRadius, bubbleCenter);
        }

        return bubbleData;
    }

    /**
     * Remove a bubble by key.
     */
    removeBubble(parentKey) {
        const existing = this.bubbles.get(parentKey);
        if (existing) {
            this._disposeBubble(existing);
            this.bubbles.delete(parentKey);

            // Notify parent of bubble removal
            if (this.onBubbleToggle) {
                this.onBubbleToggle('close', parentKey);
            }
            return true;
        }
        return false;
    }

    /**
     * Clear all bubbles.
     */
    clearAll() {
        for (const bubbleData of this.bubbles.values()) {
            this._disposeBubble(bubbleData);
        }
        this.bubbles.clear();
        // Dispose cached materials on full clear
        this._matCache.forEach(mat => {
            try { if (mat) mat.dispose(); } catch (e) { /* already disposed */ }
        });
        this._matCache.clear();
    }

    /**
     * Toggle causality connections within all bubbles.
     */
    setCausalityVisible(visible) {
        for (const bubbleData of this.bubbles.values()) {
            if (bubbleData.connections) {
                bubbleData.connections.forEach(conn => {
                    // Only toggle causality-specific connections
                    if (conn.isCausality && conn.causality) {
                        conn.causality.isVisible = visible;
                    }
                });
            }
        }
    }

    // ─── Bubble Creation ───────────────────────────────────────────

    _createBubble(key, position, radius, color) {
        const bubble = BABYLON.MeshBuilder.CreateSphere(
            `bubble_${key}`,
            {
                diameter: radius * 2,
                segments: this.bubbleSegments
            },
            this.scene
        );

        bubble.position = position.clone();

        // Semi-transparent material — use cached material when possible
        const mat = this._getOrCreateBubbleMat(key, color);
        bubble.material = mat;
        bubble.isPickable = false; // clicks go through to nodes

        // Freeze world matrix immediately (bubble doesn't move)
        bubble.computeWorldMatrix(true);
        bubble.freezeWorldMatrix();

        return bubble;
    }

    /**
     * Get or create a bubble material. No pulse animation — static is faster.
     */
    _getOrCreateBubbleMat(key, color) {
        const mat = new BABYLON.StandardMaterial(`bubbleMat_${key}`, this.scene);
        mat.diffuseColor = new BABYLON.Color3(color.r, color.g, color.b);
        mat.emissiveColor = new BABYLON.Color3(color.r * 0.3, color.g * 0.3, color.b * 0.3);
        mat.specularColor = BABYLON.Color3.Black();
        mat.alpha = this.bubbleOpacity;
        mat.transparencyMode = BABYLON.Material.MATERIAL_ALPHABLEND;
        mat.backFaceCulling = false;
        mat.freeze();
        return mat;
    }

    // ─── Node Chain Creation ───────────────────────────────────────

    /**
     * Consolidate raw child trace steps into main entity types (buildings).
     * This mirrors the approach used in SubSpiralRenderer and the main spiral.
     * 
     * Filters to show only:
     * - Functions (CALL/RETURN consolidated)
     * - Variables (DECL/ASSIGN/PARAM consolidated by name+address)
     * - Loops (LOOP events consolidated by condition)
     * 
     * Skips: READ events, raw computation steps, branches
     */
    _consolidateChildren(childIndices, trace) {
        const entities = [];
        const varMap = new Map();      // "name|address" → entity
        const loopMap = new Map();     // "subtype|condition" → entity
        const callMap = new Map();     // "functionName" → entity

        for (const idx of childIndices) {
            const step = trace[idx];
            if (!step) continue;

            // Skip READ events (data-flow, not entities)
            if (step.type === 'READ') continue;

            const stepName = step.name || step.subject || step.var || '';

            // ── Variables: DECL, ASSIGN, PARAM ──
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
                        label: stepName,      // Variable name as label
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
            }
            // ── Functions: CALL/RETURN ──
            else if (step.type === 'CALL') {
                const ent = {
                    type: 'call',
                    colorType: 'CALL',
                    label: stepName || 'function',
                    name: stepName,
                    stepIndices: [idx],
                    firstStep: step
                };
                entities.push(ent);
            }
            else if (step.type === 'RETURN') {
                const ent = {
                    type: 'return',
                    colorType: 'RETURN',
                    label: stepName || 'return',
                    value: step.value,
                    stepIndices: [idx],
                    firstStep: step
                };
                entities.push(ent);
            }
            // ── Loops: LOOP events ──
            else if (step.type === 'LOOP') {
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
            }
        }

        return entities;
    }

    /**
     * Create node chain from consolidated entities (not raw steps).
     */
    _createNodeChainFromEntities(parentKey, entities, centerPos, bubbleRadius, trace) {
        const nodes = [];
        const nodeCount = entities.length;

        // Position nodes in a flowing curve inside the bubble
        for (let i = 0; i < nodeCount; i++) {
            const entity = entities[i];
            if (!entity || !entity.firstStep) continue;

            // Calculate position along a curved path inside bubble
            const t = i / Math.max(nodeCount - 1, 1); // normalized position [0,1]
            const nodePos = this._calculateNodePosition(
                centerPos,
                bubbleRadius,
                t,
                i,
                nodeCount
            );

            // Determine node color from entity type
            const nodeColor = this._getEntityColor(entity);

            // Create the node mesh based on entity type
            const node = this._createEntityNode(
                `${parentKey}_node_${i}`,
                nodePos,
                nodeColor,
                entity
            );

            // Attach entity data to the node
            node._bubbleNodeData = {
                step: entity.stepIndices[0],
                stepData: entity.firstStep,
                type: entity.type,
                entity: entity,
                color: nodeColor,
                index: i
            };

            // Create hover label
            const labelText = this._getEntityLabel(entity);
            const label = this._createNodeLabel(
                `${parentKey}_label_${i}`,
                labelText,
                nodePos,
                nodeColor
            );
            label.isVisible = false;
            node._label = label;

            nodes.push({ 
                mesh: node, 
                label, 
                position: nodePos, 
                entity,
                traceIndex: entity.stepIndices[0]
            });
        }

        return nodes;
    }

    _createNodeChain(parentKey, childIndices, centerPos, bubbleRadius, trace) {
        const nodes = [];
        const nodeCount = childIndices.length;

        // Position nodes in a flowing curve inside the bubble
        for (let i = 0; i < nodeCount; i++) {
            const traceIndex = childIndices[i];
            const step = trace[traceIndex];

            if (!step) continue;

            // Calculate position along a curved path inside bubble
            const t = i / Math.max(nodeCount - 1, 1); // normalized position [0,1]
            const nodePos = this._calculateNodePosition(
                centerPos,
                bubbleRadius,
                t,
                i,
                nodeCount
            );

            // Determine node type and color
            const nodeType = this._getNodeType(step);
            const nodeColor = this._getNodeColor(step, nodeType);

            // Create the node mesh
            const node = this._createNode(
                `${parentKey}_node_${i}`,
                nodePos,
                nodeColor,
                nodeType
            );

            // Attach data to the node
            node._bubbleNodeData = {
                step: traceIndex,
                stepData: step,
                type: nodeType,
                color: nodeColor,
                index: i
            };

            // Create hover label
            const labelText = this._getNodeLabel(step, nodeType);
            const label = this._createNodeLabel(
                `${parentKey}_label_${i}`,
                labelText,
                nodePos,
                nodeColor
            );
            label.isVisible = false;
            node._label = label;

            nodes.push({ mesh: node, label, position: nodePos, step, traceIndex });
        }

        return nodes;
    }

    _calculateNodePosition(centerPos, bubbleRadius, t, index, total) {
        // Create a curved path inside the bubble
        // Use a parametric curve that stays inside the sphere
        // Bubble is now centered at centerPos, so nodes should be relative to that center

        const angle = t * Math.PI * 1.5; // 270 degrees of curve
        const height = Math.sin(t * Math.PI) * (bubbleRadius * 0.6); // arc up and down

        // Spiral curve parameters
        const radius = (bubbleRadius * 0.5) * (0.5 + 0.3 * Math.sin(t * Math.PI * 2));
        const azimuth = t * Math.PI * 2 * 1.5; // spiral around

        const x = centerPos.x + radius * Math.cos(azimuth);
        const y = centerPos.y + height; // Centered at centerPos, height provides variation
        const z = centerPos.z + radius * Math.sin(azimuth);

        return new BABYLON.Vector3(x, y, z);
    }

    _createEntityNode(name, position, color, entity) {
        // Simplified geometry — lower poly, no roof sub-meshes
        let mesh;

        switch (entity.type) {
            case 'variable': {
                const h = this.nodeRadius * 2.2;
                mesh = BABYLON.MeshBuilder.CreateBox(name, {
                    height: h, width: this.nodeRadius * 1.8, depth: this.nodeRadius * 1.8
                }, this.scene);
                mesh.position = position.clone();
                mesh.position.y += h / 2;
                break;
            }

            case 'loop': {
                const h = this.nodeRadius * 2.5;
                mesh = BABYLON.MeshBuilder.CreateCylinder(name, {
                    height: h, diameterTop: this.nodeRadius * 1.2,
                    diameterBottom: this.nodeRadius * 1.8, tessellation: 6
                }, this.scene);
                mesh.position = position.clone();
                mesh.position.y += h / 2;
                break;
            }

            case 'call':
            case 'return': {
                const h = this.nodeRadius * 2.5;
                mesh = BABYLON.MeshBuilder.CreateCylinder(name, {
                    height: h, diameterTop: this.nodeRadius * 0.8,
                    diameterBottom: this.nodeRadius * 2, tessellation: 4
                }, this.scene);
                const bake = BABYLON.Matrix.RotationY(Math.PI / 4)
                    .multiply(BABYLON.Matrix.Translation(0, h / 2, 0));
                mesh.bakeTransformIntoVertices(bake);
                mesh.position = position.clone();
                break;
            }

            default: {
                mesh = BABYLON.MeshBuilder.CreateSphere(name, {
                    diameter: this.nodeRadius * 2, segments: 6
                }, this.scene);
                mesh.position = position.clone();
                mesh.position.y += this.nodeRadius;
                break;
            }
        }

        // Use cached material for performance
        mesh.material = this._getCachedNodeMat(entity.type, color);

        // Simple fast scale-in (no looping animation)
        mesh.scaling = new BABYLON.Vector3(0.01, 0.01, 0.01);
        BABYLON.Animation.CreateAndStartAnimation(
            'scaleIn', mesh, 'scaling', 60, 8,
            mesh.scaling,
            new BABYLON.Vector3(1, 1, 1),
            BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT
        );

        mesh._isBubbleNode = true;
        mesh._entityData = entity;
        mesh.isPickable = true;

        return mesh;
    }

    /**
     * Cached material per (type, colorKey) pair — avoids creating one material per node.
     */
    _getCachedNodeMat(entityType, color) {
        // Round colour to reduce unique materials
        const cr = (color.r * 10 | 0);
        const cg = (color.g * 10 | 0);
        const cb = (color.b * 10 | 0);
        const cacheKey = `${entityType}_${cr}_${cg}_${cb}`;

        if (this._matCache.has(cacheKey)) return this._matCache.get(cacheKey);

        const mat = new BABYLON.StandardMaterial(`bubbleNodeMat_${cacheKey}`, this.scene);
        mat.diffuseColor = new BABYLON.Color3(color.r, color.g, color.b);
        mat.emissiveColor = new BABYLON.Color3(color.r * 0.35, color.g * 0.35, color.b * 0.35);
        mat.specularColor = new BABYLON.Color3(0.15, 0.15, 0.15);
        mat.alpha = color.a || 0.9;
        mat.freeze();
        this._matCache.set(cacheKey, mat);
        return mat;
    }

    _getEntityColor(entity) {
        // Use colorType from entity, matching galaxy building colors
        const colorType = entity.colorType || entity.type || 'CALL';
        const name = entity.label || entity.subject || entity.name || entity.type;
        
        // Map entity types to ColorHash types
        switch (colorType) {
            case 'DECL':
            case 'ASSIGN':
            case 'PARAM':
            case 'variable':
                return ColorHash.color('variable', name);
            case 'CALL':
            case 'RETURN':
            case 'call':
            case 'return':
                return ColorHash.color('function', name);
            case 'LOOP':
            case 'loop':
                return ColorHash.color(entity.subtype || 'for', name);
            default:
                return { r: 0.7, g: 0.7, b: 0.9, a: 1.0 };
        }
    }

    _getEntityLabel(entity) {
        // Use entity.label consistently, just like galaxy buildings and sub-spirals
        return entity.label || entity.subject || entity.type || '?';
    }

    _createNode(name, position, color, nodeType) {
        // Different shapes for different node types
        let mesh;

        switch (nodeType) {
            case 'DECL':
            case 'ASSIGN':
                // Variables are boxes
                mesh = BABYLON.MeshBuilder.CreateBox(
                    name,
                    { size: this.nodeRadius * 2 },
                    this.scene
                );
                break;

            default:
                // Everything else is a sphere
                mesh = BABYLON.MeshBuilder.CreateSphere(
                    name,
                    { diameter: this.nodeRadius * 2, segments: 6 },
                    this.scene
                );
        }

        mesh.position = position.clone();

        // Material with glow
        const mat = new BABYLON.StandardMaterial(`${name}_mat`, this.scene);
        mat.diffuseColor = new BABYLON.Color3(color.r, color.g, color.b);
        mat.emissiveColor = new BABYLON.Color3(color.r * 0.5, color.g * 0.5, color.b * 0.5);
        mat.specularColor = new BABYLON.Color3(0.2, 0.2, 0.2);
        mesh.material = mat;

        // Scale-in animation
        mesh.scaling = new BABYLON.Vector3(0.01, 0.01, 0.01);
        BABYLON.Animation.CreateAndStartAnimation(
            'scaleIn',
            mesh,
            'scaling',
            30,
            15,
            mesh.scaling,
            new BABYLON.Vector3(1, 1, 1),
            BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT
        );

        mesh._isBubbleNode = true;
        mesh.isPickable = true;

        return mesh;
    }

    _createNodeLabel(name, text, position, color) {
        return this.labelHelper.create(
            name,
            text,
            position.clone().add(new BABYLON.Vector3(0, 0.6, 0)),
            color
        );
    }

    // ─── Connection Creation ───────────────────────────────────────

    /**
     * Create entry connector — simple line instead of tube.
     */
    _createEntryConnector(parentPos, firstNode, parentKey, bubbleColor) {
        if (!firstNode) return null;

        const entryPoint = parentPos.clone();
        entryPoint.y += 1.5;

        const connector = BABYLON.MeshBuilder.CreateLines(
            `${parentKey}_entry_connector`,
            { points: [entryPoint, firstNode.position], updatable: false },
            this.scene
        );
        connector.color = new BABYLON.Color3(bubbleColor.r, bubbleColor.g, bubbleColor.b);
        connector.alpha = 0.7;
        connector.isPickable = false;

        return connector;
    }

    _createConnections(nodes, parentKey) {
        const connections = [];

        // Connect adjacent nodes in the chain
        for (let i = 0; i < nodes.length - 1; i++) {
            const fromNode = nodes[i];
            const toNode = nodes[i + 1];

            const connection = this._createConnection(
                `${parentKey}_conn_${i}`,
                fromNode.position,
                toNode.position,
                fromNode.mesh.material.diffuseColor
            );

            connections.push({
                mesh: connection,
                from: i,
                to: i + 1,
                causality: null // Will be populated when causality is enabled
            });
        }

        // Optionally create causality connections (data flow)
        // This connects variables based on data dependencies
        const causalityConnections = this._createCausalityConnections(nodes, parentKey);
        connections.push(...causalityConnections);

        return connections;
    }

    _createCausalityConnections(nodes, parentKey) {
        const causalityConnections = [];
        const varMap = new Map();

        nodes.forEach((nodeData, i) => {
            const entity = nodeData.entity;
            if (!entity) return;
            if (entity.type === 'variable') {
                const varName = entity.subject || entity.label;
                if (!varMap.has(varName)) varMap.set(varName, []);
                varMap.get(varName).push(i);
            }
        });

        for (const [varName, indices] of varMap.entries()) {
            for (let i = 0; i < indices.length - 1; i++) {
                const fromIdx = indices[i];
                const toIdx = indices[i + 1];
                const fromNode = nodes[fromIdx];
                const toNode = nodes[toIdx];

                // Use simple lines for causality (no tubes, no animation)
                const causalityLine = BABYLON.MeshBuilder.CreateLines(
                    `${parentKey}_causality_${fromIdx}_${toIdx}`,
                    { points: [fromNode.position, toNode.position], updatable: false },
                    this.scene
                );
                const col = fromNode.mesh.material.diffuseColor;
                causalityLine.color = new BABYLON.Color3(col.r, col.g, col.b);
                causalityLine.alpha = 0.4;
                causalityLine.isPickable = false;
                causalityLine.isVisible = false;

                causalityConnections.push({
                    mesh: causalityLine,
                    from: fromIdx,
                    to: toIdx,
                    causality: causalityLine,
                    isCausality: true
                });
            }
        }

        return causalityConnections;
    }

    _createConnection(name, fromPos, toPos, color) {
        // Use simple lines instead of tubes for much better performance
        const line = BABYLON.MeshBuilder.CreateLines(
            name,
            { points: [fromPos, toPos], updatable: false },
            this.scene
        );
        line.color = new BABYLON.Color3(color.r, color.g, color.b);
        line.alpha = this.connectionOpacity;
        line.isPickable = false;

        return line;
    }

    // ─── Helper Methods ────────────────────────────────────────────

    _getBubbleColor(parentKey) {
        // For-loops use warm colors (red-orange-yellow family)
        // Extract identifying info from key to generate consistent color
        const color = ColorHash.color('for', parentKey);
        return color;
    }

    _getNodeType(step) {
        if (step.type) return step.type;
        if (step.event) return step.event;
        return 'UNKNOWN';
    }

    _getNodeColor(step, nodeType) {
        // Use existing color hash system
        const name = step.name || step.var || step.condition || nodeType;
        
        switch (nodeType) {
            case 'DECL':
            case 'ASSIGN':
                return ColorHash.color('variable', name);
            case 'CALL':
            case 'RETURN':
                return ColorHash.color('function', name);
            case 'LOOP':
                return ColorHash.color('for', name);
            default:
                // Default to a neutral color
                return { r: 0.7, g: 0.7, b: 0.9, a: 1.0 };
        }
    }

    _getNodeLabel(step, nodeType) {
        switch (nodeType) {
            case 'DECL':
                return `DECL ${step.var || '?'}`;
            case 'ASSIGN':
                return `${step.var || '?'} = ${step.value || '?'}`;
            case 'CALL':
                return `CALL ${step.name || '?'}`;
            case 'RETURN':
                return `RETURN ${step.value || ''}`;
            case 'LOOP':
                return `LOOP ${step.condition || '?'}`;
            default:
                return nodeType;
        }
    }

    // ─── Cleanup ───────────────────────────────────────────────────

    _disposeBubble(bubbleData) {
        // Dispose bubble mesh
        if (bubbleData.bubble) {
            if (bubbleData.bubble.material) bubbleData.bubble.material.dispose();
            bubbleData.bubble.dispose();
        }

        // Dispose entry connector
        if (bubbleData.entryConnector) {
            bubbleData.entryConnector.dispose();
        }

        // Dispose all nodes
        if (bubbleData.nodes) {
            bubbleData.nodes.forEach(nodeData => {
                if (nodeData.mesh) {
                    this.scene.stopAnimation(nodeData.mesh);
                    // Don't dispose cached materials
                    nodeData.mesh.material = null;
                    nodeData.mesh.dispose();
                }
                if (nodeData.label) nodeData.label.dispose();
            });
        }

        // Dispose all connections (lines — no material to dispose)
        if (bubbleData.connections) {
            bubbleData.connections.forEach(conn => {
                try { if (conn.mesh) conn.mesh.dispose(); } catch (e) {}
                try { if (conn.causality) conn.causality.dispose(); } catch (e) {}
            });
        }
    }

    // ─── Get Bubble Data ───────────────────────────────────────────

    getBubbleByKey(parentKey) {
        return this.bubbles.get(parentKey);
    }

    getAllBubbles() {
        return Array.from(this.bubbles.values());
    }

    hasBubble(parentKey) {
        return this.bubbles.has(parentKey);
    }
}
