/**
 * CodeVisualizer - Main visualizer class
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
        this.parser = new CodeParser();
        this.buildings = [];
        
        // Initialize managers
        this.sceneManager = null;
        this.materialManager = null;
        this.spiralPathBuilder = null;
        this.shapeBuilder = null;
        this.animationController = null;
        this.buildingFactory = null;
        this.explodeManager = null;
    }

    /**
     * Initialize the visualizer
     */
    init() {
        // Initialize scene manager
        this.sceneManager = new SceneManager(this.canvas);
        this.sceneManager.init();

        const scene = this.sceneManager.getScene();
        const camera = this.sceneManager.getCamera();

        // Initialize other managers
        this.materialManager = new MaterialManager(scene);
        this.spiralPathBuilder = new SpiralPathBuilder(scene, this.materialManager);
        this.shapeBuilder = new ShapeBuilder(scene);
        this.animationController = new AnimationController(scene);
        this.buildingFactory = new BuildingFactory(
            scene,
            this.shapeBuilder,
            this.materialManager,
            this.animationController
        );
        this.explodeManager = new ExplodeManager(scene, camera, this.materialManager);

        return this;
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
        
        // Clear spiral path
        this.spiralPathBuilder.clear();

        // Parse the code
        const trace = this.parser.parse(codeTrace);

        // ── Group child steps under their parent "container" step ────
        // Container types: CALL, LOOP, CONDITION, BRANCH  (and legacy IF/ELSE)
        // Everything between a container and the next container (or RETURN
        // / next container at same depth) belongs to that container.
        const containerTypes = new Set(['CALL', 'LOOP', 'CONDITION', 'BRANCH', 'IF', 'ELSE']);
        const childMap = this._buildChildMap(trace, containerTypes);

        // Create descending spiral path
        const pathPoints = this.spiralPathBuilder.createSpiralPath(trace.length);

        // Track the current parent CALL's building height
        let currentCallHeight = 0;

        // Create buildings along the path
        trace.forEach((step, index) => {
            const position = pathPoints[index];
            const color = this.parser.getColorForType(step.type);
            const children = childMap[index] || [];
            
            setTimeout(() => {
                const buildingData = this.buildingFactory.createBuilding(
                    index, position, color, step.type, step, currentCallHeight, children
                );
                this.buildings.push(buildingData);
                
                if (step.type === 'CALL') {
                    currentCallHeight = buildingData.height;
                }
            }, index * 100);
        });

        // Update camera target
        const midHeight = ((trace.length - 1) * 0.5) / 2;
        this.sceneManager.setCameraTarget(new BABYLON.Vector3(0, midHeight, 0));

        this.updateStats(trace.length);
    }

    /**
     * Build a map:  parentIndex → [ childStep, childStep, … ]
     *
     * A "container" (CALL, LOOP, IF, ELSE) owns every subsequent step
     * until the next container at the same-or-lesser depth, or a RETURN
     * that closes the current function.
     */
    _buildChildMap(trace, containerTypes) {
        const childMap = {};        // index → []
        let currentContainer = -1;  // index of current open container

        trace.forEach((step, i) => {
            if (containerTypes.has(step.type)) {
                // This step IS a container — initialise its child list.
                childMap[i] = childMap[i] || [];
                currentContainer = i;
            } else if (step.type === 'RETURN') {
                // RETURN is its own building; give it an empty child list
                childMap[i] = childMap[i] || [];
                // Also add the RETURN as a child of the current container
                if (currentContainer >= 0) {
                    childMap[currentContainer] = childMap[currentContainer] || [];
                    childMap[currentContainer].push(step);
                }
                currentContainer = -1; // close container
            } else {
                // DECL / ASSIGN / other → belongs to current container
                if (currentContainer >= 0) {
                    childMap[currentContainer] = childMap[currentContainer] || [];
                    childMap[currentContainer].push(step);
                } else {
                    // No open container – the step is its own building
                    childMap[i] = childMap[i] || [];
                }
            }
        });

        return childMap;
    }

    /**
     * Update statistics display, including metadata when available.
     */
    updateStats(count) {
        const statsElement = document.getElementById('stats');
        if (!statsElement) return;

        let html = `<strong>Visualizing:</strong><br>${count} execution steps`;

        const meta = this.parser.metadata;
        if (meta) {
            if (meta.file_name)  html += `<br>File: ${meta.file_name}`;
            if (meta.language)   html += ` (${meta.language})`;
            if (meta.total_lines) html += `<br>${meta.total_lines} lines`;
            if (meta.num_functions) html += `, ${meta.num_functions} function(s)`;
            if (meta.num_variables) html += `, ${meta.num_variables} vars`;
        }

        statsElement.innerHTML = html;
    }

    /**
     * Reset camera to default position — looking at the top of the spiral
     */
    resetCamera() {
        this.sceneManager.resetCamera();
    }

    /**
     * Collapse any currently exploded building and restore camera
     */
    collapseExplodedBuilding() {
        return this.explodeManager.collapseIfExploded();
    }

    /**
     * Toggle debug column mode for shattered pieces
     * When enabled: shards fly to side column in front of camera for easy debugging
     * When disabled: shards explode in rings around the building (original behavior)
     */
    toggleDebugColumnMode() {
        return this.explodeManager.toggleDebugMode();
    }

    /**
     * Toggle animation
     */
    toggleAnimation() {
        const isAnimating = this.animationController.toggleAnimation();
        this.sceneManager.toggleAnimations(isAnimating);
        return isAnimating;
    }
}
