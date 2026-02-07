/**
 * SceneManager - Coordinates scene initialization and component delegation
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
     * Initialize the Babylon.js scene and all components
     */
    init() {
        this._setupEngine();
        this._setupScene();
        this._setupSceneOptimizations();

        // Initialize delegated components
        this.cameraController = new CameraController(this.canvas, this.scene);
        this.cameraController.init();

        this.lightingManager = new LightingManager(this.scene);
        this.lightingManager.init();

        this._setupGlowLayer();
        this._startRenderLoop();
        this._setupResizeHandler();

        return this;
    }

    /**
     * Create engine with optimized settings
     */
    _setupEngine() {
        this.engine = new BABYLON.Engine(this.canvas, true, {
            useHighPrecisionFloats: false,
            stencil: false,
            adaptToDeviceRatio: false,
        });
    }

    /**
     * Create base scene
     */
    _setupScene() {
        this.scene = new BABYLON.Scene(this.engine);
        this.scene.clearColor = new BABYLON.Color4(0.1, 0.1, 0.18, 1);
    }

    /**
     * Apply scene-level optimizations
     */
    _setupSceneOptimizations() {
        this.scene.skipFrustumClipping = false;
        this.scene.blockMaterialDirtyMechanism = false;
        this.scene.autoClear = true;
        this.scene.autoClearDepthAndStencil = true;
        this.scene.pointerMovePredicate = (mesh) =>
            mesh._buildingData != null;
        this.scene.skipPointerMovePicking = false;

        // ── Extra performance optimisations ──
        // Disable subsystems we don't use (particles, sprites, lens flares, probes)
        this.scene.particlesEnabled = false;
        this.scene.spritesEnabled = false;
        this.scene.lensFlaresEnabled = false;
        this.scene.probesEnabled = false;
        // NOTE: Do NOT set postProcessesEnabled=false — it breaks the GlowLayer
    }

    /**
     * Setup glow layer for stained glass effect
     */
    _setupGlowLayer() {
        this.glowLayer = new BABYLON.GlowLayer("glow", this.scene, {
            mainTextureSamples: 1,
            blurKernelSize: 12,
            mainTextureFixedSize: 300,
        });
        this.glowLayer.intensity = 0.6;
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
     * Handle window resize with debouncing
     */
    _setupResizeHandler() {
        let resizeTimeout = null;
        window.addEventListener("resize", () => {
            if (resizeTimeout) clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(() => {
                this.engine.resize();
                resizeTimeout = null;
            }, 100);
        });
    }

    // ─── Public API ───────────────────────────────────────────

    getScene() {
        return this.scene;
    }

    getCamera() {
        return this.cameraController?.getCamera() ?? null;
    }

    getEngine() {
        return this.engine;
    }

    resetCamera(spiralRadius = 60) {
        this.cameraController?.reset(spiralRadius);
    }
}
