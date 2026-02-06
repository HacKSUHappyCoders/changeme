/**
 * Babylon.js Visualizer for Code Mosaic
 * Creates a stained-glass descending spiral visualization of code execution.
 * 
 * Design philosophy:
 * - The spiral DESCENDS from top to bottom (execution flows downward like gravity)
 * - Each operation type has a unique trapezoid-style shape and size hierarchy
 * - CALL operations are the largest/tallest (they are function entry points)
 * - Child operations (DECL, ASSIGN, LOOP, etc.) build off their parent CALL
 * - Shapes are varied trapezoids/prisms to create a dynamic, organic skyline
 */
class CodeVisualizer {
    constructor(canvas) {
        this.canvas = canvas;
        this.engine = null;
        this.scene = null;
        this.camera = null;
        this.parser = new CodeParser();
        this.buildings = [];
        this.spiralPath = null;
        this.animationSpeed = 1;
        this.isAnimating = true;
    }

    /**
     * Initialize the Babylon.js scene
     */
    init() {
        this.engine = new BABYLON.Engine(this.canvas, true);
        this.scene = new BABYLON.Scene(this.engine);
        this.scene.clearColor = new BABYLON.Color4(0.1, 0.1, 0.18, 1);

        // Create camera — positioned to look DOWN at the descending spiral
        this.camera = new BABYLON.ArcRotateCamera(
            "camera",
            Math.PI / 4,
            Math.acos(20 / Math.sqrt(1650)), // match resetCamera perspective
            Math.sqrt(1650), // distance from (25,30,25) to (0,10,0)
            new BABYLON.Vector3(0, 10, 0),
            this.scene
        );
        this.camera.attachControl(this.canvas, true);
        this.camera.lowerRadiusLimit = 10;
        this.camera.upperRadiusLimit = 150;
        this.camera.wheelPrecision = 50;

        // Create lights
        const hemisphericLight = new BABYLON.HemisphericLight(
            "hemiLight",
            new BABYLON.Vector3(0, 1, 0),
            this.scene
        );
        hemisphericLight.intensity = 0.6;

        const pointLight1 = new BABYLON.PointLight(
            "pointLight1",
            new BABYLON.Vector3(10, 30, 10),
            this.scene
        );
        pointLight1.intensity = 0.8;
        pointLight1.diffuse = new BABYLON.Color3(1, 0.9, 0.7);

        const pointLight2 = new BABYLON.PointLight(
            "pointLight2",
            new BABYLON.Vector3(-10, 25, -10),
            this.scene
        );
        pointLight2.intensity = 0.6;
        pointLight2.diffuse = new BABYLON.Color3(0.5, 0.7, 1);

        // Add glow layer for stained glass effect
        const glowLayer = new BABYLON.GlowLayer("glow", this.scene);
        glowLayer.intensity = 0.5;

        // Start render loop
        this.engine.runRenderLoop(() => {
            this.scene.render();
        });

        // Handle window resize
        window.addEventListener('resize', () => {
            this.engine.resize();
        });

        return this;
    }

    /**
     * Create a stained glass material
     */
    createStainedGlassMaterial(name, color) {
        const material = new BABYLON.StandardMaterial(name, this.scene);
        material.diffuseColor = new BABYLON.Color3(color.r, color.g, color.b);
        material.emissiveColor = new BABYLON.Color3(color.r * 0.3, color.g * 0.3, color.b * 0.3);
        material.specularColor = new BABYLON.Color3(1, 1, 1);
        material.specularPower = 64;
        material.alpha = color.a;
        return material;
    }

    /**
     * Create the DESCENDING spiral path.
     * Step 0 is at the TOP, and the path spirals downward.
     */
    createSpiralPath(steps) {
        const points = [];
        const radius = 2;
        const radiusGrowth = 0.3;
        const heightPerStep = 0.5;
        const turnsPerStep = 0.3;

        // Calculate the total height so we can start at the top
        const totalHeight = (steps - 1) * heightPerStep;

        for (let i = 0; i < steps; i++) {
            const angle = i * turnsPerStep;
            const currentRadius = radius + (i * radiusGrowth);
            const x = Math.cos(angle) * currentRadius;
            const z = Math.sin(angle) * currentRadius;
            // DESCENDING: start at totalHeight and go DOWN
            const y = totalHeight - (i * heightPerStep);
            points.push(new BABYLON.Vector3(x, y, z));
        }

        // Create tube for the path
        const pathTube = BABYLON.MeshBuilder.CreateTube(
            "spiralPath",
            {
                path: points,
                radius: 0.2,
                sideOrientation: BABYLON.Mesh.DOUBLESIDE,
                updatable: false
            },
            this.scene
        );

        const pathMaterial = new BABYLON.StandardMaterial("pathMat", this.scene);
        pathMaterial.diffuseColor = new BABYLON.Color3(0.8, 0.7, 0.4);
        pathMaterial.emissiveColor = new BABYLON.Color3(0.4, 0.35, 0.2);
        pathMaterial.alpha = 0.6;
        pathTube.material = pathMaterial;

        this.spiralPath = points;
        return points;
    }

    /**
     * Get the shape profile (size/height) for each operation type.
     * 
     * Hierarchy (biggest → smallest):
     *   CALL     — tallest & widest (function entry, the "cathedral tower")
     *   RETURN   — tall but narrower (function exit, the "capstone")
     *   LOOP     — medium-large (loop structure, repeating motif)
     *   IF/ELSE  — medium (branching decisions)
     *   DECL     — medium-small (variable birth)
     *   ASSIGN   — smallest (incremental change, builds off parent)
     */
    getShapeProfile(type) {
        const profiles = {
            'CALL': {
                heightMin: 4.0, heightMax: 5.5,
                topWidthMin: 0.4, topWidthMax: 0.6,    // Much narrower top
                bottomWidthMin: 2.2, bottomWidthMax: 3.0, // Much wider base
                depthMin: 1.8, depthMax: 2.4,
                shape: 'trapezoidTower' // wide base, narrow top — grand tower
            },
            'RETURN': {
                heightMin: 3.0, heightMax: 4.0,
                topWidthMin: 1.2, topWidthMax: 1.6,    // Wide top
                bottomWidthMin: 0.6, bottomWidthMax: 0.8, // Narrow base
                depthMin: 1.2, depthMax: 1.6,
                shape: 'invertedTrapezoid' // narrow base, wide top — capstone
            },
            'LOOP': {
                heightMin: 2.5, heightMax: 3.5,
                topWidthMin: 0.4, topWidthMax: 0.6,
                bottomWidthMin: 1.6, bottomWidthMax: 2.2,
                depthMin: 1.4, depthMax: 1.8,
                shape: 'trapezoidWide' // wide and squat — repeating block
            },
            'IF': {
                heightMin: 2.0, heightMax: 3.0,
                topWidthMin: 0.3, topWidthMax: 0.5,
                bottomWidthMin: 1.2, bottomWidthMax: 1.6,
                depthMin: 1.0, depthMax: 1.4,
                shape: 'trapezoidAngled' // asymmetric trapezoid — decision
            },
            'ELSE': {
                heightMin: 1.8, heightMax: 2.8,
                topWidthMin: 0.3, topWidthMax: 0.5,
                bottomWidthMin: 1.2, bottomWidthMax: 1.6,
                depthMin: 1.0, depthMax: 1.4,
                shape: 'trapezoidAngled'
            },
            'DECL': {
                heightMin: 1.5, heightMax: 2.5,
                topWidthMin: 0.3, topWidthMax: 0.5,
                bottomWidthMin: 1.0, bottomWidthMax: 1.4,
                depthMin: 0.8, depthMax: 1.2,
                shape: 'trapezoidSlim' // slim trapezoid — declaration marker
            },
            'ASSIGN': {
                heightMin: 1.0, heightMax: 1.8,
                topWidthMin: 0.2, topWidthMax: 0.4,
                bottomWidthMin: 0.8, bottomWidthMax: 1.2,
                depthMin: 0.6, depthMax: 1.0,
                shape: 'trapezoidSmall' // smallest — incremental change
            },
            'DEFAULT': {
                heightMin: 1.2, heightMax: 2.0,
                topWidthMin: 0.3, topWidthMax: 0.5,
                bottomWidthMin: 0.9, bottomWidthMax: 1.3,
                depthMin: 0.7, depthMax: 1.1,
                shape: 'trapezoidSlim'
            }
        };
        return profiles[type] || profiles['DEFAULT'];
    }

    /**
     * Helper: random float in range
     */
    _rand(min, max) {
        return min + Math.random() * (max - min);
    }

    /**
     * Build a trapezoid mesh from a shape profile.
     * Uses per-face vertices (24 total) so each face gets correct flat normals.
     * The shape tapers from a wider bottom to a narrower top (or inverted).
     * Both X-width AND Z-depth taper, creating a true truncated pyramid / trapezoid prism.
     */
    createTrapezoidMesh(name, profile) {
        const h = this._rand(profile.heightMin, profile.heightMax);
        const tw = this._rand(profile.topWidthMin, profile.topWidthMax);
        const bw = this._rand(profile.bottomWidthMin, profile.bottomWidthMax);
        const d = this._rand(profile.depthMin, profile.depthMax);

        // For inverted trapezoid, swap top and bottom
        let topW, botW, topD, botD;
        if (profile.shape === 'invertedTrapezoid') {
            topW = bw;  
            botW = tw;  
            topD = d;
            botD = d * (botW / topW); // scale depth proportionally
        } else {
            topW = tw;  
            botW = bw;  
            // Make depth taper similarly to width for true trapezoid shape
            topD = d * 0.6; // top depth is proportionally smaller
            botD = d;
        }

        const tw2 = topW / 2, bw2 = botW / 2;
        const td2 = topD / 2, bd2 = botD / 2;

        // 8 corner positions of the frustum
        // Bottom (y=0)
        const b0 = [-bw2, 0,  bd2]; // bottom-left-front
        const b1 = [ bw2, 0,  bd2]; // bottom-right-front
        const b2 = [ bw2, 0, -bd2]; // bottom-right-back
        const b3 = [-bw2, 0, -bd2]; // bottom-left-back
        // Top (y=h)
        const t0 = [-tw2, h,  td2]; // top-left-front
        const t1 = [ tw2, h,  td2]; // top-right-front
        const t2 = [ tw2, h, -td2]; // top-right-back
        const t3 = [-tw2, h, -td2]; // top-left-back

        // Per-face vertices (4 verts × 6 faces = 24 vertices)
        // Each face duplicates its corner positions so normals are independent
        const positions = [
            // Front face (z positive)
            ...b0, ...b1, ...t1, ...t0,
            // Back face (z negative)
            ...b2, ...b3, ...t3, ...t2,
            // Right face (x positive)
            ...b1, ...b2, ...t2, ...t1,
            // Left face (x negative)
            ...b3, ...b0, ...t0, ...t3,
            // Top face (y = h)
            ...t0, ...t1, ...t2, ...t3,
            // Bottom face (y = 0)
            ...b3, ...b2, ...b1, ...b0,
        ];

        // Two triangles per face: 0,1,2 and 0,2,3
        const indices = [];
        for (let face = 0; face < 6; face++) {
            const off = face * 4;
            indices.push(off, off + 1, off + 2, off, off + 2, off + 3);
        }

        // Compute proper per-face normals
        const normals = [];
        BABYLON.VertexData.ComputeNormals(positions, indices, normals);

        // UVs per face
        const uvs = [];
        for (let face = 0; face < 6; face++) {
            uvs.push(0, 0,  1, 0,  1, 1,  0, 1);
        }

        const vertexData = new BABYLON.VertexData();
        vertexData.positions = positions;
        vertexData.indices = indices;
        vertexData.normals = normals;
        vertexData.uvs = uvs;

        const mesh = new BABYLON.Mesh(name, this.scene);
        vertexData.applyToMesh(mesh);

        mesh._trapHeight = h;
        mesh._trapTopWidth = topW;
        mesh._trapBottomWidth = botW;

        return mesh;
    }

    /**
     * Create a building/structure for a code operation.
     * 
     * Each type gets a unique trapezoid shape and size based on its
     * importance in the execution hierarchy.
     * 
     * @param {number} step - step index
     * @param {object} position - BABYLON.Vector3 on the spiral path
     * @param {object} color - {r, g, b, a}
     * @param {string} type - operation type (CALL, ASSIGN, etc.)
     * @param {object} stepData - the parsed trace step (has depth, name, etc.)
     * @param {number} parentY - the Y offset contributed by the parent CALL building height
     */
    createBuilding(step, position, color, type, stepData, parentY) {
        const profile = this.getShapeProfile(type);

        // Create the trapezoid mesh
        const building = this.createTrapezoidMesh(`building_${step}`, profile);

        // Position: place on the spiral path.
        // For non-CALL operations, offset upward by their parent's height
        // so they visually "build off" the parent CALL.
        building.position = position.clone();
        if (type !== 'CALL' && parentY > 0) {
            building.position.y += parentY * 0.3; // partial stack on parent
        }

        // Slight random rotation for organic feel
        building.rotation.y = Math.random() * 0.3 - 0.15;

        // Create stained glass material
        const material = this.createStainedGlassMaterial(`mat_${step}`, color);
        building.material = material;

        // Add a glowing crown/cap on top
        const capHeight = 0.15;
        const capWidth = building._trapTopWidth * 1.3;
        const cap = BABYLON.MeshBuilder.CreateBox(
            `cap_${step}`,
            { height: capHeight, width: capWidth, depth: capWidth },
            this.scene
        );
        cap.position = building.position.clone();
        cap.position.y += building._trapHeight + capHeight / 2;
        if (type !== 'CALL' && parentY > 0) {
            cap.position.y += parentY * 0.3;
        }
        const capMat = this.createStainedGlassMaterial(`capmat_${step}`, {
            r: Math.min(color.r * 1.5, 1),
            g: Math.min(color.g * 1.5, 1),
            b: Math.min(color.b * 1.5, 1),
            a: 0.9
        });
        cap.material = capMat;

        // Animate building appearance (scale in)
        building.scaling = new BABYLON.Vector3(0.01, 0.01, 0.01);
        BABYLON.Animation.CreateAndStartAnimation(
            `anim_${step}`,
            building,
            "scaling",
            60,
            30,
            new BABYLON.Vector3(0.01, 0.01, 0.01),
            new BABYLON.Vector3(1, 1, 1),
            BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT
        );

        cap.scaling = new BABYLON.Vector3(0.01, 0.01, 0.01);
        BABYLON.Animation.CreateAndStartAnimation(
            `animCap_${step}`,
            cap,
            "scaling",
            60,
            30,
            new BABYLON.Vector3(0.01, 0.01, 0.01),
            new BABYLON.Vector3(1, 1, 1),
            BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT
        );

        // Subtle floating animation
        const floatAnim = new BABYLON.Animation(
            `float_${step}`,
            "position.y",
            30,
            BABYLON.Animation.ANIMATIONTYPE_FLOAT,
            BABYLON.Animation.ANIMATIONLOOPMODE_CYCLE
        );
        const baseY = building.position.y;
        const keys = [
            { frame: 0, value: baseY },
            { frame: 60, value: baseY + 0.15 },
            { frame: 120, value: baseY }
        ];
        floatAnim.setKeys(keys);
        building.animations.push(floatAnim);
        this.scene.beginAnimation(building, 0, 120, true);

        this.buildings.push({ mesh: building, cap: cap, data: step, type: type, height: building._trapHeight });
        return building._trapHeight;
    }

    /**
     * Visualize parsed code trace
     */
    visualize(codeTrace) {
        // Clear existing buildings
        this.buildings.forEach(b => {
            b.mesh.dispose();
            b.cap.dispose();
        });
        this.buildings = [];
        
        if (this.spiralPath) {
            this.scene.getMeshByName("spiralPath")?.dispose();
        }

        // Parse the code
        const trace = this.parser.parse(codeTrace);
        
        // Create descending spiral path
        const pathPoints = this.createSpiralPath(trace.length);

        // Track the current parent CALL's building height so children
        // can "build off" of it visually.
        let currentCallHeight = 0;

        // Create buildings along the path
        trace.forEach((step, index) => {
            const position = pathPoints[index];
            const color = this.parser.getColorForType(step.type);
            
            setTimeout(() => {
                const builtHeight = this.createBuilding(
                    index, position, color, step.type, step, currentCallHeight
                );
                // When we encounter a CALL, update the parent height
                if (step.type === 'CALL') {
                    currentCallHeight = builtHeight;
                }
            }, index * 100); // Stagger the creation
        });

        // Update camera target to the middle of the spiral
        const midHeight = ((trace.length - 1) * 0.5) / 2;
        this.camera.setTarget(new BABYLON.Vector3(0, midHeight, 0));

        // Update stats
        this.updateStats(trace.length);
    }

    /**
     * Update statistics display
     */
    updateStats(count) {
        const statsElement = document.getElementById('stats');
        if (statsElement) {
            statsElement.innerHTML = `<strong>Visualizing:</strong><br>${count} execution steps`;
        }
    }

    /**
     * Reset camera to default position — looking at the top of the spiral
     */
    resetCamera() {
        this.camera.setPosition(new BABYLON.Vector3(25, 30, 25));
        this.camera.setTarget(new BABYLON.Vector3(0, 10, 0));
    }

    /**
     * Toggle animation
     */
    toggleAnimation() {
        this.isAnimating = !this.isAnimating;
        if (this.isAnimating) {
            this.scene.animationsEnabled = true;
        } else {
            this.scene.animationsEnabled = false;
        }
        return this.isAnimating;
    }
}
