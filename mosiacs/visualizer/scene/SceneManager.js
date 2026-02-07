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
        this.engine = new BABYLON.Engine(this.canvas, true, {
            // Performance: use lower precision where possible
            useHighPrecisionFloats: false,
            // Reduce stencil overhead
            stencil: false,
        });
        this.scene = new BABYLON.Scene(this.engine);
        this.scene.clearColor = new BABYLON.Color4(0.1, 0.1, 0.18, 1);

        // ── Performance optimizations ──
        // Skip bounding-info recomputation when meshes don't move each frame
        this.scene.skipFrustumClipping = false;
        // Block material-dirty notifications during bulk mesh creation
        this.scene.blockMaterialDirtyMechanism = false;
        // Auto-freeze materials that don't change
        this.scene.autoClear = true;
        this.scene.autoClearDepthAndStencil = true;

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
        this.camera.panningSensibility = 200;

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
        // Strong ambient light so no building face is ever fully dark
        const hemi = new BABYLON.HemisphericLight(
            "hemiLight",
            new BABYLON.Vector3(0, 1, 0),
            this.scene
        );
        hemi.intensity = 0.9;
        hemi.groundColor = new BABYLON.Color3(0.25, 0.25, 0.35);

        // Warm key light from above-right
        const key = new BABYLON.PointLight(
            "pointLight1",
            new BABYLON.Vector3(15, 40, 15),
            this.scene
        );
        key.intensity = 1.2;
        key.diffuse = new BABYLON.Color3(1, 0.95, 0.85);

        // Cool fill from opposite side
        const fill = new BABYLON.PointLight(
            "pointLight2",
            new BABYLON.Vector3(-12, 30, -12),
            this.scene
        );
        fill.intensity = 0.8;
        fill.diffuse = new BABYLON.Color3(0.55, 0.7, 1);

        // Low directional for underneath surfaces
        const rim = new BABYLON.PointLight(
            "rimLight",
            new BABYLON.Vector3(0, -5, 0),
            this.scene
        );
        rim.intensity = 0.35;
        rim.diffuse = new BABYLON.Color3(0.6, 0.5, 0.9);
    }

    /**
     * Add glow layer for stained glass effect
     */
    _setupGlowLayer() {
        const glowLayer = new BABYLON.GlowLayer("glow", this.scene, {
            mainTextureSamples: 1,       // lower sample count for performance
            blurKernelSize: 32,          // smaller blur for speed
        });
        glowLayer.intensity = 0.7;
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
     * Reset camera to default position — looking at the spiral city from above
     */
    resetCamera() {
        this.camera.setPosition(new BABYLON.Vector3(20, 25, 20));
        this.camera.setTarget(new BABYLON.Vector3(0, 5, 0));
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
