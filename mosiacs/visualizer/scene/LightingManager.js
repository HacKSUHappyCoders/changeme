/**
 * LightingManager — Handles scene lighting setup
 */
class LightingManager {
    constructor(scene) {
        this.scene = scene;
        this.lights = [];
    }

    /**
     * Create all scene lights
     */
    init() {
        // Strong ambient light
        const hemi = new BABYLON.HemisphericLight(
            "hemiLight",
            new BABYLON.Vector3(0, 1, 0),
            this.scene
        );
        hemi.intensity = 0.9;
        hemi.groundColor = new BABYLON.Color3(0.25, 0.25, 0.35);
        this.lights.push(hemi);

        // Warm key light from above-right
        const key = new BABYLON.PointLight(
            "pointLight1",
            new BABYLON.Vector3(15, 40, 15),
            this.scene
        );
        key.intensity = 1.2;
        key.diffuse = new BABYLON.Color3(1, 0.95, 0.85);
        this.lights.push(key);

        // Cool fill from opposite side
        const fill = new BABYLON.PointLight(
            "pointLight2",
            new BABYLON.Vector3(-12, 30, -12),
            this.scene
        );
        fill.intensity = 0.8;
        fill.diffuse = new BABYLON.Color3(0.55, 0.7, 1);
        this.lights.push(fill);

        // Low directional for underneath surfaces
        const rim = new BABYLON.PointLight(
            "rimLight",
            new BABYLON.Vector3(0, -5, 0),
            this.scene
        );
        rim.intensity = 0.35;
        rim.diffuse = new BABYLON.Color3(0.6, 0.5, 0.9);
        this.lights.push(rim);

        return this.lights;
    }

    /**
     * Get all lights
     */
    getLights() {
        return this.lights;
    }
}
