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
        this.camera.panningSensibility = 60;

        // ── Blender-style controls ──
        // Remove default mouse and keyboard inputs so we can reconfigure them
        this.camera.inputs.removeByType("ArcRotateCameraPointersInput");
        this.camera.inputs.removeByType("ArcRotateCameraKeyboardMoveInput");

        // Re-add pointers input with button mapping:
        //   Left mouse (0) = orbit
        //   Shift + Left mouse = pan
        const pointersInput = new BABYLON.ArcRotateCameraPointersInput();
        // Only left-mouse-button orbits (button index 0)
        pointersInput.buttons = [0];
        // Shift + left-mouse pans instead of orbiting
        pointersInput._useCtrlForPanning = false;   // don't require Ctrl
        pointersInput.panningSensibility = 60;
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
     *
     *   Arrow keys        — orbit (rotate alpha / beta)
     *   Shift + Arrow keys — pan (translate camera target)
     *   Ctrl modifier      — slow down either mode
     */
    _setupBlenderKeyboardShortcuts() {
        // Track which arrow keys are currently held
        const held = new Set();
        let shiftHeld = false;
        let ctrlHeld = false;

        const navKeys = new Set(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','PageUp','PageDown']);
        window.addEventListener('keydown', (e) => {
            if (navKeys.has(e.code)) {
                e.preventDefault();
                held.add(e.code);
            }
            if (e.key === 'Shift')   shiftHeld = true;
            if (e.key === 'Control') ctrlHeld = true;
        });
        window.addEventListener('keyup', (e) => {
            held.delete(e.code);
            if (e.key === 'Shift')   shiftHeld = false;
            if (e.key === 'Control') ctrlHeld = false;
        });
        window.addEventListener('blur', () => { held.clear(); shiftHeld = false; ctrlHeld = false; });

        // Apply smooth per-frame movement via the render loop
        this.scene.onBeforeRenderObservable.add(() => {
            if (held.size === 0) return;

            const dt = this.engine.getDeltaTime() / 1000; // seconds
            const slow = ctrlHeld ? 0.25 : 1.0;

            if (shiftHeld) {
                // Shift + Arrow/PgUp/PgDn = pan relative to camera orientation
                const cam = this.camera;
                const panSpeed = 1.8 * (cam.radius / 60) * slow * dt * 60;

                // Forward = camera-to-target direction (full 3D)
                const fwd = cam.target.subtract(cam.position);
                fwd.normalize();
                // Right = cross(forward, worldUp)
                const right = BABYLON.Vector3.Cross(fwd, BABYLON.Vector3.Up());
                right.normalize();

                const offset = BABYLON.Vector3.Zero();
                if (held.has('ArrowLeft'))  offset.addInPlace(right);
                if (held.has('ArrowRight')) offset.addInPlace(right.scale(-1));
                if (held.has('ArrowUp'))    offset.y += 1;
                if (held.has('ArrowDown'))  offset.y -= 1;
                if (held.has('PageUp'))     offset.addInPlace(fwd);
                if (held.has('PageDown'))   offset.addInPlace(fwd.scale(-1));

                cam.target.addInPlace(offset.scale(panSpeed));
            } else {
                // Arrow = orbit, PgUp/PgDn = forward/back pan
                const cam = this.camera;
                const orbitSpeed = 2.0 * slow * dt;
                if (held.has('ArrowLeft'))  cam.alpha += orbitSpeed;
                if (held.has('ArrowRight')) cam.alpha -= orbitSpeed;
                if (held.has('ArrowUp'))    cam.beta = Math.max(0.01, cam.beta - orbitSpeed);
                if (held.has('ArrowDown'))  cam.beta = Math.min(Math.PI, cam.beta + orbitSpeed);

                if (held.has('PageUp') || held.has('PageDown')) {
                    const panSpeed = 1.8 * (cam.radius / 60) * slow * dt * 60;
                    const fwd = cam.target.subtract(cam.position).normalize();
                    const dir = held.has('PageUp') ? 1 : -1;
                    cam.target.addInPlace(fwd.scale(dir * panSpeed));
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
     */
    resetCamera() {
        this.camera.setPosition(new BABYLON.Vector3(5, 65, 5));
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
