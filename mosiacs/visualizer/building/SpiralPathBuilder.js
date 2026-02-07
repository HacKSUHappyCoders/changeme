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
        const radius = SPIRAL_CONFIG.radiusStart;
        const radiusGrowth = SPIRAL_CONFIG.radiusGrowth;

        for (let i = 0; i < steps; i++) {
            const angle = getSpiralAngle(i);
            const currentRadius = radius + (i * radiusGrowth);
            const x = Math.cos(angle) * currentRadius;
            const z = Math.sin(angle) * currentRadius;
            const y = getSpiralY(i, steps);
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
