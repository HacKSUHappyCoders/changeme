/**
 * MaterialManager - Handles material creation for the visualizer
 */
class MaterialManager {
    constructor(scene) {
        this.scene = scene;
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
     * Create a cap material (brighter version)
     */
    createCapMaterial(name, baseColor) {
        return this.createStainedGlassMaterial(name, {
            r: Math.min(baseColor.r * 1.5, 1),
            g: Math.min(baseColor.g * 1.5, 1),
            b: Math.min(baseColor.b * 1.5, 1),
            a: 0.9
        });
    }

    /**
     * Create path material
     */
    createPathMaterial(name) {
        const material = new BABYLON.StandardMaterial(name, this.scene);
        material.diffuseColor = new BABYLON.Color3(0.8, 0.7, 0.4);
        material.emissiveColor = new BABYLON.Color3(0.4, 0.35, 0.2);
        material.alpha = 0.6;
        return material;
    }
}
