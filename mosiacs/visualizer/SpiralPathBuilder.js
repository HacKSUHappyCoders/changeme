/**
 * SpiralPathBuilder - Creates the descending spiral path
 */
class SpiralPathBuilder {
    constructor(scene, materialManager) {
        this.scene = scene;
        this.materialManager = materialManager;
        this.spiralPath = null;
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

        const pathMaterial = this.materialManager.createPathMaterial("pathMat");
        pathTube.material = pathMaterial;

        this.spiralPath = points;
        return points;
    }

    /**
     * Get the spiral path points
     */
    getPath() {
        return this.spiralPath;
    }

    /**
     * Clear the spiral path
     */
    clear() {
        this.scene.getMeshByName("spiralPath")?.dispose();
        this.spiralPath = null;
    }
}
