/**
 * BuildingFactory - Creates buildings for code operations
 */
class BuildingFactory {
    constructor(scene, shapeBuilder, materialManager, animationController) {
        this.scene = scene;
        this.shapeBuilder = shapeBuilder;
        this.materialManager = materialManager;
        this.animationController = animationController;
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
        const profile = this.shapeBuilder.getShapeProfile(type);

        // Create the trapezoid mesh
        const building = this.shapeBuilder.createTrapezoidMesh(`building_${step}`, profile);

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
        const material = this.materialManager.createStainedGlassMaterial(`mat_${step}`, color);
        building.material = material;

        // Add a glowing crown/cap on top
        const cap = this._createCap(step, building, color, type, parentY);

        // Animate building and cap
        this.animationController.animateScaleIn(building, step);
        this.animationController.animateScaleIn(cap, `cap_${step}`);
        this.animationController.addFloatingAnimation(building, step);

        return {
            mesh: building,
            cap: cap,
            data: step,
            type: type,
            height: building._trapHeight
        };
    }

    /**
     * Create a glowing cap on top of a building
     */
    _createCap(step, building, color, type, parentY) {
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
        const capMat = this.materialManager.createCapMaterial(`capmat_${step}`, color);
        cap.material = capMat;

        return cap;
    }
}
