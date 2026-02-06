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
    }

    /**
     * Initialize the visualizer
     */
    init() {
        // Initialize scene manager
        this.sceneManager = new SceneManager(this.canvas);
        this.sceneManager.init();

        const scene = this.sceneManager.getScene();

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
        
        // Create descending spiral path
        const pathPoints = this.spiralPathBuilder.createSpiralPath(trace.length);

        // Track the current parent CALL's building height so children
        // can "build off" of it visually.
        let currentCallHeight = 0;

        // Create buildings along the path
        trace.forEach((step, index) => {
            const position = pathPoints[index];
            const color = this.parser.getColorForType(step.type);
            
            setTimeout(() => {
                const buildingData = this.buildingFactory.createBuilding(
                    index, position, color, step.type, step, currentCallHeight
                );
                this.buildings.push(buildingData);
                
                // When we encounter a CALL, update the parent height
                if (step.type === 'CALL') {
                    currentCallHeight = buildingData.height;
                }
            }, index * 100); // Stagger the creation
        });

        // Update camera target to the middle of the spiral
        const midHeight = ((trace.length - 1) * 0.5) / 2;
        this.sceneManager.setCameraTarget(new BABYLON.Vector3(0, midHeight, 0));

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
        this.sceneManager.resetCamera();
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
