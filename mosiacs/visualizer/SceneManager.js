/**
 * SceneManager - Handles Babylon.js scene, camera, and lighting setup
 */
class SceneManager {
    constructor(canvas) {
        this.canvas = canvas;
        this.engine = null;
        this.scene = null;
        this.camera = null;
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
            Math.PI / 2,
            Math.PI / 4, // slightly above looking down
            60,
            new BABYLON.Vector3(0, 10, 0), // target above origin
            this.scene
        );
        this.camera.attachControl(this.canvas, true);
        this.camera.lowerRadiusLimit = 10;
        this.camera.upperRadiusLimit = 150;
        this.camera.wheelPrecision = 5;

        this._setupLighting();
        this._setupGlowLayer();
        this._startRenderLoop();
        this._setupResizeHandler();
        this.resetCamera();

        return this;
    }

    /**
     * Create scene lights
     */
    _setupLighting() {
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
    }

    /**
     * Add glow layer for stained glass effect
     */
    _setupGlowLayer() {
        const glowLayer = new BABYLON.GlowLayer("glow", this.scene);
        glowLayer.intensity = 0.5;
    }

    /**
     * Start the render loop
     */
    _startRenderLoop() {
        this.engine.runRenderLoop(() => {
            this.scene.render();
        });
    }

    /**
     * Handle window resize
     */
    _setupResizeHandler() {
        window.addEventListener('resize', () => {
            this.engine.resize();
        });
    }

    /**
     * Reset camera to default position — looking at the top of the spiral
     */
    resetCamera() {
        this.camera.setPosition(new BABYLON.Vector3(25, 30, 25));
        this.camera.setTarget(new BABYLON.Vector3(0, 10, 0));
    }

    /**
     * Update camera target
     */
    setCameraTarget(position) {
        this.camera.setTarget(position);
    }

    /**
     * Toggle scene animations
     */
    toggleAnimations(enabled) {
        this.scene.animationsEnabled = enabled;
    }

    /**
     * Get the scene
     */
    getScene() {
        return this.scene;
    }

    /**
     * Get the camera
     */
    getCamera() {
        return this.camera;
    }
}
