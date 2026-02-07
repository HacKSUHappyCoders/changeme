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
        this.bubbleOpacity = 0.25;          // semi-transparent
        this.bubbleRadiusBase = 3.0;        // base bubble size
        this.bubbleRadiusPerNode = 0.15;    // grows with content
        this.bubbleSegments = 32;           // smooth sphere

        // Node chain configuration
        this.nodeRadius = 0.35;             // individual node size
        this.nodeSpacing = 0.8;             // distance between nodes
        this.chainCurvature = 0.4;          // how much the chain curves

        // Connection line configuration
        this.connectionRadius = 0.08;       // tube thickness between nodes
        this.connectionOpacity = 0.6;       // slightly transparent

        // Material cache for performance
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

        // Consolidate child steps into main entity types (functions, variables, loops, branches)
        // This filters out raw trace steps and groups them into buildings
        const entities = this._consolidateChildren(childIndices, trace);

        if (entities.length === 0) return;

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

        // Store the bubble data
        const bubbleData = {
            bubble,
            nodes,
            connections,
            entryConnector,
            boundingRadius: bubbleRadius,
            parentPos: parentPos.clone(),
            childIndices,
            entities
        };

        this.bubbles.set(parentKey, bubbleData);

        // Notify parent of bubble creation
        if (this.onBubbleToggle) {
            this.onBubbleToggle('open', parentKey, bubbleRadius, parentPos);
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
        bubble.position.y += radius * 0.5; // lift slightly above ground

        // Semi-transparent material
        const mat = new BABYLON.StandardMaterial(`bubbleMat_${key}`, this.scene);
        mat.diffuseColor = new BABYLON.Color3(color.r, color.g, color.b);
        mat.emissiveColor = new BABYLON.Color3(color.r * 0.3, color.g * 0.3, color.b * 0.3);
        mat.alpha = this.bubbleOpacity;
        mat.transparencyMode = BABYLON.Material.MATERIAL_ALPHABLEND;
        mat.backFaceCulling = false; // show from inside too

        bubble.material = mat;
        bubble.isPickable = false; // clicks go through to nodes

        // Gentle pulsing animation
        this._animateBubblePulse(bubble, radius);

        return bubble;
    }

    _animateBubblePulse(bubble, radius) {
        const scaleAnim = new BABYLON.Animation(
            'bubblePulse',
            'scaling',
            30,
            BABYLON.Animation.ANIMATIONTYPE_VECTOR3,
            BABYLON.Animation.ANIMATIONLOOPMODE_CYCLE
        );

        const keys = [
            { frame: 0, value: new BABYLON.Vector3(1, 1, 1) },
            { frame: 60, value: new BABYLON.Vector3(1.02, 1.02, 1.02) },
            { frame: 120, value: new BABYLON.Vector3(1, 1, 1) }
        ];

        scaleAnim.setKeys(keys);
        bubble.animations.push(scaleAnim);
        this.scene.beginAnimation(bubble, 0, 120, true);
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
     * - Branches (CONDITION/BRANCH consolidated)
     * 
     * Skips: READ events, raw computation steps
     */
    _consolidateChildren(childIndices, trace) {
        const entities = [];
        const varMap = new Map();      // "name|address" → entity
        const loopMap = new Map();     // "subtype|condition" → entity
        const callMap = new Map();     // "functionName" → entity
        const branchMap = new Map();   // "condition" → entity

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
            // ── Branches: CONDITION/BRANCH ──
            else if (step.type === 'CONDITION') {
                const ent = {
                    type: 'condition',
                    colorType: 'CONDITION',
                    label: stepName || step.condition || 'condition',
                    condition: step.condition,
                    result: step.result,
                    stepIndices: [idx],
                    firstStep: step
                };
                entities.push(ent);
            }
            else if (step.type === 'BRANCH') {
                const ent = {
                    type: 'branch',
                    colorType: 'BRANCH',
                    label: stepName || step.branch || 'branch',
                    branch: step.branch,
                    stepIndices: [idx],
                    firstStep: step
                };
                entities.push(ent);
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

        const angle = t * Math.PI * 1.5; // 270 degrees of curve
        const height = Math.sin(t * Math.PI) * (bubbleRadius * 0.6); // arc up and down

        // Spiral curve parameters
        const radius = (bubbleRadius * 0.5) * (0.5 + 0.3 * Math.sin(t * Math.PI * 2));
        const azimuth = t * Math.PI * 2 * 1.5; // spiral around

        const x = centerPos.x + radius * Math.cos(azimuth);
        const y = centerPos.y + bubbleRadius * 0.5 + height;
        const z = centerPos.z + radius * Math.sin(azimuth);

        return new BABYLON.Vector3(x, y, z);
    }

    _createEntityNode(name, position, color, entity) {
        // Match galaxy building shapes exactly
        let mesh;

        switch (entity.type) {
            case 'variable': {
                // Variables are boxes with a pyramidal roof (houses)
                const height = this.nodeRadius * 2.5;
                mesh = BABYLON.MeshBuilder.CreateBox(
                    name,
                    { height, width: this.nodeRadius * 2, depth: this.nodeRadius * 2 },
                    this.scene
                );
                mesh.position = position.clone();
                mesh.position.y += height / 2;

                // Create roof (optional - can skip for simpler look in bubble)
                const roof = BABYLON.MeshBuilder.CreateCylinder(
                    `${name}_roof`,
                    { 
                        height: this.nodeRadius * 0.8, 
                        diameterTop: 0, 
                        diameterBottom: this.nodeRadius * 2.5, 
                        tessellation: 4 
                    },
                    this.scene
                );
                roof.bakeTransformIntoVertices(BABYLON.Matrix.RotationY(Math.PI / 4));
                roof.position = position.clone();
                roof.position.y += height + this.nodeRadius * 0.4;
                roof.material = mesh.material; // Will be set below
                roof.isPickable = false;
                mesh._roofMesh = roof; // Store for disposal
                break;
            }

            case 'loop': {
                // Loops are tapered cylinders (factories)
                const height = this.nodeRadius * 3;
                mesh = BABYLON.MeshBuilder.CreateCylinder(
                    name,
                    { 
                        height, 
                        diameterTop: this.nodeRadius * 2 * 0.75, 
                        diameterBottom: this.nodeRadius * 2, 
                        tessellation: 6 
                    },
                    this.scene
                );
                mesh.position = position.clone();
                mesh.position.y += height / 2;
                break;
            }

            case 'call':
            case 'return': {
                // Functions are tapered cylinders rotated 45° (districts)
                const height = this.nodeRadius * 3;
                mesh = BABYLON.MeshBuilder.CreateCylinder(
                    name,
                    { 
                        height, 
                        diameterTop: this.nodeRadius * 1, 
                        diameterBottom: this.nodeRadius * 2.5, 
                        tessellation: 4 
                    },
                    this.scene
                );
                const bake = BABYLON.Matrix.RotationY(Math.PI / 4)
                    .multiply(BABYLON.Matrix.Translation(0, height / 2, 0));
                mesh.bakeTransformIntoVertices(bake);
                mesh.position = position.clone();
                break;
            }

            case 'condition':
            case 'branch':
            default: {
                // Conditions/branches are spheres (like galaxy default)
                mesh = BABYLON.MeshBuilder.CreateSphere(
                    name,
                    { diameter: this.nodeRadius * 2.2, segments: 8 },
                    this.scene
                );
                mesh.position = position.clone();
                mesh.position.y += this.nodeRadius * 1.1;
                break;
            }
        }

        // Material with glow (matching galaxy style)
        const mat = new BABYLON.StandardMaterial(`${name}_mat`, this.scene);
        mat.diffuseColor = new BABYLON.Color3(color.r, color.g, color.b);
        mat.emissiveColor = new BABYLON.Color3(color.r * 0.4, color.g * 0.4, color.b * 0.4);
        mat.specularColor = new BABYLON.Color3(0.3, 0.3, 0.3);
        mat.alpha = color.a || 0.9;
        mesh.material = mat;

        // Apply same material to roof if it exists
        if (mesh._roofMesh) {
            const roofColor = {
                r: Math.min(color.r * 1.3, 1),
                g: Math.min(color.g * 1.3, 1),
                b: Math.min(color.b * 1.3, 1)
            };
            const roofMat = new BABYLON.StandardMaterial(`${name}_roof_mat`, this.scene);
            roofMat.diffuseColor = new BABYLON.Color3(roofColor.r, roofColor.g, roofColor.b);
            roofMat.emissiveColor = new BABYLON.Color3(roofColor.r * 0.4, roofColor.g * 0.4, roofColor.b * 0.4);
            roofMat.alpha = 0.9;
            mesh._roofMesh.material = roofMat;
        }

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
        mesh._entityData = entity;  // Attach entity for recursive warping
        mesh.isPickable = true;

        return mesh;
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
            case 'CONDITION':
            case 'BRANCH':
            case 'condition':
            case 'branch':
                return ColorHash.color('branch', name);
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

            case 'CONDITION':
            case 'BRANCH':
                // Branches are diamonds (rotated boxes)
                mesh = BABYLON.MeshBuilder.CreateBox(
                    name,
                    { size: this.nodeRadius * 2 },
                    this.scene
                );
                mesh.rotation.y = Math.PI / 4;
                mesh.rotation.x = Math.PI / 4;
                break;

            default:
                // Everything else is a sphere
                mesh = BABYLON.MeshBuilder.CreateSphere(
                    name,
                    { diameter: this.nodeRadius * 2, segments: 16 },
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
     * Create entry connector from parent loop building to the bubble's first node.
     * This visually connects the main spiral to the bubble content.
     */
    _createEntryConnector(parentPos, firstNode, parentKey, bubbleColor) {
        if (!firstNode) return null;

        // Calculate entry point on the bubble (where it touches the parent building)
        const entryPoint = parentPos.clone();
        entryPoint.y += 1.5; // Slightly above the loop building

        // Create a curved connection line
        const path = this._createCurvedPath(entryPoint, firstNode.position);

        const connector = BABYLON.MeshBuilder.CreateTube(
            `${parentKey}_entry_connector`,
            {
                path,
                radius: this.connectionRadius * 1.2, // Slightly thicker for emphasis
                tessellation: 8,
                cap: BABYLON.Mesh.CAP_ALL
            },
            this.scene
        );

        // Use bubble color for the entry connector
        const mat = new BABYLON.StandardMaterial(`${parentKey}_entry_mat`, this.scene);
        mat.diffuseColor = new BABYLON.Color3(bubbleColor.r, bubbleColor.g, bubbleColor.b);
        mat.emissiveColor = new BABYLON.Color3(
            bubbleColor.r * 0.6,
            bubbleColor.g * 0.6,
            bubbleColor.b * 0.6
        );
        mat.alpha = 0.8;
        mat.transparencyMode = BABYLON.Material.MATERIAL_ALPHABLEND;

        connector.material = mat;
        connector.isPickable = false;

        // Gentle pulse animation
        this._animateEntryConnector(connector);

        return connector;
    }

    _animateEntryConnector(connector) {
        const mat = connector.material;
        const baseEmissive = mat.emissiveColor.clone();

        const pulseAnim = new BABYLON.Animation(
            'entryPulse',
            'material.emissiveColor',
            30,
            BABYLON.Animation.ANIMATIONTYPE_COLOR3,
            BABYLON.Animation.ANIMATIONLOOPMODE_CYCLE
        );

        const keys = [
            { frame: 0, value: baseEmissive.clone() },
            { frame: 45, value: baseEmissive.clone().scale(1.3) },
            { frame: 90, value: baseEmissive.clone() }
        ];

        pulseAnim.setKeys(keys);
        connector.animations.push(pulseAnim);
        this.scene.beginAnimation(connector, 0, 90, true);
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

        // Build a map of variable entities
        const varMap = new Map(); // varName → [nodeIndices]

        nodes.forEach((nodeData, i) => {
            const entity = nodeData.entity;
            if (!entity) return;

            // Only connect variables
            if (entity.type === 'variable') {
                const varName = entity.subject || entity.label;
                if (!varMap.has(varName)) {
                    varMap.set(varName, []);
                }
                varMap.get(varName).push(i);
            }
        });

        // Create causality connections between related variables
        // Connect assignments in sequence for same variable
        for (const [varName, indices] of varMap.entries()) {
            for (let i = 0; i < indices.length - 1; i++) {
                const fromIdx = indices[i];
                const toIdx = indices[i + 1];
                const fromNode = nodes[fromIdx];
                const toNode = nodes[toIdx];

                // Create a more subtle causality line
                const causalityLine = this._createCausalityLine(
                    `${parentKey}_causality_${fromIdx}_${toIdx}`,
                    fromNode.position,
                    toNode.position,
                    fromNode.mesh.material.diffuseColor,
                    toNode.mesh.material.diffuseColor
                );

                causalityLine.isVisible = false; // Hidden by default

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

    _createCausalityLine(name, fromPos, toPos, colorFrom, colorTo) {
        // Create a curved line for causality (more visually interesting)
        const path = this._createCurvedPath(fromPos, toPos);
        
        const tube = BABYLON.MeshBuilder.CreateTube(
            name,
            {
                path,
                radius: this.connectionRadius * 0.6, // Thinner than regular connections
                tessellation: 8,
                cap: BABYLON.Mesh.CAP_ALL
            },
            this.scene
        );

        // Blend colors from source to target
        const blendedColor = new BABYLON.Color3(
            (colorFrom.r + colorTo.r) * 0.5,
            (colorFrom.g + colorTo.g) * 0.5,
            (colorFrom.b + colorTo.b) * 0.5
        );

        const mat = new BABYLON.StandardMaterial(`${name}_mat`, this.scene);
        mat.diffuseColor = blendedColor.clone();
        mat.emissiveColor = blendedColor.clone().scale(0.8);
        mat.alpha = 0.5;
        mat.transparencyMode = BABYLON.Material.MATERIAL_ALPHABLEND;

        tube.material = mat;
        tube.isPickable = false;

        // Gentle glow animation
        this._animateCausalityGlow(tube);

        return tube;
    }

    _createCurvedPath(fromPos, toPos) {
        // Create a gentle curve between points
        const midPoint = BABYLON.Vector3.Lerp(fromPos, toPos, 0.5);
        
        // Add perpendicular offset for curve
        const direction = toPos.subtract(fromPos);
        const perpendicular = new BABYLON.Vector3(-direction.z, 0, direction.x).normalize();
        midPoint.addInPlace(perpendicular.scale(direction.length() * 0.2));

        // Create bezier-like curve with multiple segments
        const segments = 10;
        const path = [];
        for (let i = 0; i <= segments; i++) {
            const t = i / segments;
            const t2 = t * t;
            const t3 = t2 * t;
            const mt = 1 - t;
            const mt2 = mt * mt;
            const mt3 = mt2 * mt;

            // Quadratic bezier
            const point = new BABYLON.Vector3(
                mt2 * fromPos.x + 2 * mt * t * midPoint.x + t2 * toPos.x,
                mt2 * fromPos.y + 2 * mt * t * midPoint.y + t2 * toPos.y,
                mt2 * fromPos.z + 2 * mt * t * midPoint.z + t2 * toPos.z
            );
            path.push(point);
        }

        return path;
    }

    _animateCausalityGlow(mesh) {
        const mat = mesh.material;
        const baseEmissive = mat.emissiveColor.clone();

        const glowAnim = new BABYLON.Animation(
            'causalityGlow',
            'material.emissiveColor',
            30,
            BABYLON.Animation.ANIMATIONTYPE_COLOR3,
            BABYLON.Animation.ANIMATIONLOOPMODE_CYCLE
        );

        const keys = [
            { frame: 0, value: baseEmissive.clone() },
            { frame: 60, value: baseEmissive.clone().scale(1.5) },
            { frame: 120, value: baseEmissive.clone() }
        ];

        glowAnim.setKeys(keys);
        mesh.animations.push(glowAnim);
        this.scene.beginAnimation(mesh, 0, 120, true);
    }

    _createConnection(name, fromPos, toPos, color) {
        const path = [fromPos, toPos];
        const tube = BABYLON.MeshBuilder.CreateTube(
            name,
            {
                path,
                radius: this.connectionRadius,
                tessellation: 8,
                cap: BABYLON.Mesh.CAP_ALL
            },
            this.scene
        );

        const mat = new BABYLON.StandardMaterial(`${name}_mat`, this.scene);
        mat.diffuseColor = color.clone();
        mat.emissiveColor = color.clone().scale(0.3);
        mat.alpha = this.connectionOpacity;
        mat.transparencyMode = BABYLON.Material.MATERIAL_ALPHABLEND;

        tube.material = mat;
        tube.isPickable = false;

        return tube;
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
            case 'CONDITION':
            case 'BRANCH':
                return ColorHash.color('branch', name);
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
            case 'CONDITION':
                return `IF ${step.condition || '?'}`;
            case 'BRANCH':
                return `${step.branch || '?'}`;
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
            bubbleData.bubble.dispose();
        }

        // Dispose entry connector
        if (bubbleData.entryConnector) {
            if (bubbleData.entryConnector.material) {
                bubbleData.entryConnector.material.dispose();
            }
            bubbleData.entryConnector.dispose();
        }

        // Dispose all nodes
        if (bubbleData.nodes) {
            bubbleData.nodes.forEach(nodeData => {
                if (nodeData.mesh) {
                    // Dispose roof mesh if it exists
                    if (nodeData.mesh._roofMesh) {
                        if (nodeData.mesh._roofMesh.material) {
                            nodeData.mesh._roofMesh.material.dispose();
                        }
                        nodeData.mesh._roofMesh.dispose();
                    }
                    // Dispose main mesh
                    if (nodeData.mesh.material) {
                        nodeData.mesh.material.dispose();
                    }
                    nodeData.mesh.dispose();
                }
                if (nodeData.label) nodeData.label.dispose();
            });
        }

        // Dispose all connections
        if (bubbleData.connections) {
            bubbleData.connections.forEach(conn => {
                if (conn.mesh) conn.mesh.dispose();
                if (conn.causality) conn.causality.dispose();
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
