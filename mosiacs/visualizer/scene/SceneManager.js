/**
 * SceneManager - Handles Babylon.js scene setup and coordination (refactored)
 * 
 * Now delegates to:
 * - CameraController: camera setup and controls
 * - LightingManager: lighting setup
 */
class SceneManager {
    constructor(canvas) {
        this.canvas = canvas;
        this.engine = null;
        this.scene = null;
        this.cameraController = null;
        this.lightingManager = null;
        this.glowLayer = null;
    }

    /**
     * Initialize the Babylon.js scene
     */
    init() {
        this.engine = new BABYLON.Engine(this.canvas, true, {
            useHighPrecisionFloats: false,
            stencil: false,
            adaptToDeviceRatio: false,
        });
        
        this.scene = new BABYLON.Scene(this.engine);
        this.scene.clearColor = new BABYLON.Color4(0.1, 0.1, 0.18, 1);

        // Performance optimizations
        this._setupSceneOptimizations();

        // Initialize camera controller
        this.cameraController = new CameraController(this.canvas, this.scene);
        this.cameraController.init();

        // Initialize lighting
        this.lightingManager = new LightingManager(this.scene);
        this.lightingManager.init();

        // Setup glow layer
        this._setupGlowLayer();

        // Start render loop and handle resizing
        this._startRenderLoop();
        this._setupResizeHandler();

        // Reset camera to initial position
        this.resetCamera();

        return this;
    }

    /**
     * Get the scene instance
     */
    getScene() {
        return this.scene;
    }

    /**
     * Get the camera instance
     */
    getCamera() {
        return this.cameraController ? this.cameraController.getCamera() : null;
    }

    /**
     * Get the engine instance
     */
    getEngine() {
        return this.engine;
    }

    /**
     * Reset camera to bird's-eye view
     */
    resetCamera(spiralRadius) {
        if (this.cameraController) {
            this.cameraController.reset(spiralRadius);
        }
    }

    // ─── Private Methods ───────────────────────────────────────────

    _setupSceneOptimizations() {
        this.scene.skipFrustumClipping = false;
        this.scene.blockMaterialDirtyMechanism = false;
        this.scene.autoClear = true;
        this.scene.autoClearDepthAndStencil = true;
        this.scene.pointerMovePredicate = (mesh) => mesh._buildingData != null;
        this.scene.skipPointerMovePicking = false;
    }

    _setupGlowLayer() {
        this.glowLayer = new BABYLON.GlowLayer("glow", this.scene, {
            mainTextureFixedSize: 512,
            blurKernelSize: 32
        });
        this.glowLayer.intensity = 0.5;
    }

    _startRenderLoop() {
        this.engine.runRenderLoop(() => {
            this.scene.render();
        });
    }

    _setupResizeHandler() {
        window.addEventListener('resize', () => {
            this.engine.resize();
        });
    }
}
