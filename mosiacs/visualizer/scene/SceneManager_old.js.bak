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
            // Use hardware scaling for better resize performance
            adaptToDeviceRatio: false,
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
        // Pointer-move is expensive; limit pick frequency
        this.scene.pointerMovePredicate = (mesh) => mesh._buildingData != null;
        // Skip non-pickable meshes during picking (avoids iterating labels, tubes, etc.)
        this.scene.skipPointerMovePicking = false;

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
        this.camera.lowerRadiusLimit = 5;
        this.camera.upperRadiusLimit = 500;
        this.camera.wheelPrecision = 3;
        this.camera.panningSensibility = 200;

        // ── Blender-style controls ──
        // Remove all default mouse inputs so we can reconfigure them
        this.camera.inputs.removeByType("ArcRotateCameraPointersInput");

        // Re-add pointers input with button mapping:
        //   Left mouse (0) = orbit
        //   Shift + Left mouse = pan
        const pointersInput = new BABYLON.ArcRotateCameraPointersInput();
        // Only left-mouse-button orbits (button index 0)
        pointersInput.buttons = [0];
        // Shift + left-mouse pans instead of orbiting
        pointersInput._useCtrlForPanning = false;   // don't require Ctrl
        pointersInput.panningSensibility = 200;
        this.camera.inputs.add(pointersInput);

        // Store reference so we can tweak later if needed
        this._pointersInput = pointersInput;

        // Intercept pointer events to implement Shift+MMB = pan
        this._setupBlenderPanShortcut();
        this._setupBlenderKeyboardShortcuts();

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
     * Shift + Left Mouse = Pan
     * We intercept pointer events to temporarily switch the camera into
     * panning mode when Shift is held, then switch back on release.
     */
    _setupBlenderPanShortcut() {
        let shiftHeld = false;

        // Track Shift key state globally
        window.addEventListener('keydown', (e) => {
            if (e.key === 'Shift') shiftHeld = true;
        });
        window.addEventListener('keyup', (e) => {
            if (e.key === 'Shift') shiftHeld = false;
        });

        // Before the camera processes a pointer-down, check Shift state.
        // If Shift is held during a left-click, temporarily set buttons
        // to [2] (right-click) which Babylon maps to panning.
        this.scene.onPrePointerObservable.add((pointerInfo) => {
            if (pointerInfo.type === BABYLON.PointerEventTypes.POINTERDOWN) {
                const evt = pointerInfo.event;
                if (evt.button === 0 && shiftHeld) {
                    // Force Babylon to treat this as a pan (right-click equivalent)
                    this._pointersInput.buttons = [2];
                    // Simulate a right-click button so the camera input recognises panning
                    Object.defineProperty(evt, 'button', { value: 2, writable: true });
                }
            }
            if (pointerInfo.type === BABYLON.PointerEventTypes.POINTERUP) {
                // Restore orbit mode for next interaction
                this._pointersInput.buttons = [0];
            }
        });
    }

    /**
     * Blender-style keyboard shortcuts:
     *   Numpad 5  — toggle perspective / orthographic
     *   Numpad .  — focus camera on origin (or selected)
     *   Numpad 1  — front view
     *   Numpad 3  — right view
     *   Numpad 7  — top view
     */
    _setupBlenderKeyboardShortcuts() {
        window.addEventListener('keydown', (e) => {
            switch (e.code) {
                // Numpad 5 — toggle perspective / orthographic
                case 'Numpad5': {
                    e.preventDefault();
                    const cam = this.camera;
                    if (cam.mode === BABYLON.Camera.PERSPECTIVE_CAMERA) {
                        // Switch to ortho — compute ortho size from current distance
                        cam.mode = BABYLON.Camera.ORTHOGRAPHIC_CAMERA;
                        const aspect = this.engine.getAspectRatio(cam);
                        const halfRadius = cam.radius / 2;
                        cam.orthoTop = halfRadius;
                        cam.orthoBottom = -halfRadius;
                        cam.orthoLeft = -halfRadius * aspect;
                        cam.orthoRight = halfRadius * aspect;
                    } else {
                        cam.mode = BABYLON.Camera.PERSPECTIVE_CAMERA;
                    }
                    break;
                }
                // Numpad . — focus / frame on target
                case 'NumpadDecimal': {
                    e.preventDefault();
                    this.camera.setTarget(new BABYLON.Vector3(0, 0, 0));
                    // Animate zoom to a comfortable distance
                    BABYLON.Animation.CreateAndStartAnimation(
                        'focusZoom', this.camera, 'radius',
                        60, 15, this.camera.radius, 40,
                        BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT
                    );
                    break;
                }
                // Numpad 1 — front view
                case 'Numpad1': {
                    e.preventDefault();
                    this._animateCameraAngle(Math.PI / 2, Math.PI / 2); // alpha, beta
                    break;
                }
                // Numpad 3 — right view
                case 'Numpad3': {
                    e.preventDefault();
                    this._animateCameraAngle(0, Math.PI / 2);
                    break;
                }
                // Numpad 7 — top view
                case 'Numpad7': {
                    e.preventDefault();
                    this._animateCameraAngle(Math.PI / 2, 0.01); // near-zero beta = top-down
                    break;
                }
            }
        });
    }

    /**
     * Smoothly animate camera alpha/beta angles (Blender numpad views).
     */
    _animateCameraAngle(targetAlpha, targetBeta) {
        const fps = 60;
        const frames = 15;
        BABYLON.Animation.CreateAndStartAnimation(
            'camAlpha', this.camera, 'alpha',
            fps, frames, this.camera.alpha, targetAlpha,
            BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT
        );
        BABYLON.Animation.CreateAndStartAnimation(
            'camBeta', this.camera, 'beta',
            fps, frames, this.camera.beta, targetBeta,
            BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT
        );
    }

    /**
     * Add glow layer for stained glass effect
     */
    _setupGlowLayer() {
        const glowLayer = new BABYLON.GlowLayer("glow", this.scene, {
            mainTextureSamples: 1,       // lower sample count for performance
            blurKernelSize: 16,          // smaller blur for speed (reduced from 32)
            mainTextureFixedSize: 256,   // fixed-size render target for perf
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
     * Handle window resize — debounced to avoid excessive engine.resize() calls
     */
    _setupResizeHandler() {
        let resizeTimeout = null;
        window.addEventListener('resize', () => {
            if (resizeTimeout) clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(() => {
                this.engine.resize();
                resizeTimeout = null;
            }, 100);
        });
    }

    /**
     * Reset camera to default position — looking DOWN upon the spiral
     * mosaic from a bird's-eye view, zoomed out to see the whole city.
     *
     * @param {number} [spiralRadius] — outer radius of the spiral.
     *   When provided the camera height and distance are computed so
     *   the entire spiral fits comfortably in view.  Falls back to a
     *   sensible default when omitted (e.g. before any trace is loaded).
     */
    resetCamera(spiralRadius) {
        if (spiralRadius != null && spiralRadius > 0) {
            // Position the camera above and slightly offset so the full
            // spiral diameter is visible with some breathing room.
            const height = spiralRadius * 2.2 + 10;   // scale with spiral + base offset
            const offset = spiralRadius * 0.15;        // slight lateral offset for depth
            this.camera.setPosition(new BABYLON.Vector3(offset, height, offset));
        } else {
            // No spiral data yet — use a reasonable fallback
            this.camera.setPosition(new BABYLON.Vector3(5, 65, 5));
        }
        this.camera.setTarget(new BABYLON.Vector3(0, 0, 0));
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
