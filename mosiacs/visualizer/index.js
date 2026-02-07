/**
 * CodeVisualizer — Main orchestrator for the 3D visual debugger.
 *
 * Architecture:
 *   WorldState    – runtime simulation: functions, variables, loops, branches, memory
 *   CityRenderer  – translates world snapshots into Babylon.js meshes
 *   SceneManager  – Babylon.js scene, camera, lights
 *
 * A building represents a persistent runtime concept (function, variable,
 * loop, branch) — NOT a line of code or AST node.
 *
 * The spiral path represents time.  Each trace event advances one step.
 */
class CodeVisualizer {
    constructor(canvas) {
        this.canvas = canvas;
        this.parser = new CodeParser();

        // Managers — initialised in init()
        this.sceneManager = null;
        this.worldState = null;
        this.cityRenderer = null;

        // Explode interaction (click-to-inspect)
        this.explodeManager = null;
    }

    /**
     * Initialise Babylon.js and all sub-systems.
     */
    init() {
        // Scene setup
        this.sceneManager = new SceneManager(this.canvas);
        this.sceneManager.init();

        const scene = this.sceneManager.getScene();

        // World state engine
        this.worldState = new WorldState();

        // City renderer — turns world snapshots into 3D geometry
        this.cityRenderer = new CityRenderer(scene);

        // Explode manager for click-to-inspect (pass cityRenderer for sub-spirals)
        this.explodeManager = new ExplodeManager(scene, this.cityRenderer);

        // Galaxy warp manager — double-click to warp into sub-spiral galaxies
        this.galaxyWarpManager = new GalaxyWarpManager(scene, this.sceneManager, this.cityRenderer);
        this.explodeManager.galaxyWarpManager = this.galaxyWarpManager;

        // Causality web renderer (Phase 3 Part 3)
        this.causalityRenderer = new CausalityRenderer(scene, this.cityRenderer);

        return this;
    }

    /**
     * Load and visualise a code trace.
     */
    visualize(codeTrace) {
        // Clear previous city
        this.cityRenderer.clear();

        // Clear any active galaxy warp
        if (this.galaxyWarpManager) {
            this.galaxyWarpManager.clear();
        }

        // Clear causality web
        if (this.causalityRenderer) {
            this.causalityRenderer.clear();
        }

        // Parse the trace
        const trace = this.parser.parse(codeTrace);

        // Feed into world state
        this.worldState.loadTrace(trace);

        // Advance to the end so the full city is visible
        this.worldState.seekTo(trace.length - 1);

        // Block material dirty notifications during bulk mesh creation
        // (major perf win for large traces)
        const scene = this.sceneManager.getScene();
        scene.blockMaterialDirtyMechanism = true;

        // Render the current world state
        this.cityRenderer.render(this.worldState.getSnapshot());

        // Re-enable material updates
        scene.blockMaterialDirtyMechanism = false;

        // Reset camera to a good overview position
        this.sceneManager.resetCamera();

        // Update stats
        this._updateStats(trace.length);
    }

    // ─── Camera ────────────────────────────────────────────────────

    resetCamera() {
        this.sceneManager.resetCamera();
    }

    // ─── Explode ───────────────────────────────────────────────────

    collapseExplodedBuilding() {
        return this.explodeManager.collapseIfExploded();
    }

    // ─── Galaxy Warp ───────────────────────────────────────────────

    returnFromGalaxy() {
        if (this.galaxyWarpManager && this.galaxyWarpManager.isWarped()) {
            this.galaxyWarpManager.returnToMainGalaxy(true);
            return true;
        }
        return false;
    }

    isInGalaxy() {
        return this.galaxyWarpManager && this.galaxyWarpManager.isWarped();
    }

    // ─── Animation toggle ──────────────────────────────────────────

    toggleAnimation() {
        const scene = this.sceneManager.getScene();
        scene.animationsEnabled = !scene.animationsEnabled;
        return scene.animationsEnabled;
    }

    // ─── Causality web (Phase 3 Part 3) ────────────────────────────

    toggleCausality() {
        return this.causalityRenderer.toggle();
    }

    isCausalityVisible() {
        return this.causalityRenderer.isVisible();
    }

    // ─── UI helpers ────────────────────────────────────────────────

    _updateStats(count) {
        const el = document.getElementById('stats');
        if (!el) return;

        let html = `<strong>Visualizing:</strong><br>${count} execution steps`;
        const meta = this.parser.metadata;
        if (meta) {
            if (meta.file_name) html += `<br>File: ${meta.file_name}`;
            if (meta.language)  html += ` (${meta.language})`;
            if (meta.total_lines) html += `<br>${meta.total_lines} lines`;
            if (meta.num_functions) html += `, ${meta.num_functions} fn(s)`;
            if (meta.num_variables) html += `, ${meta.num_variables} vars`;
        }
        el.innerHTML = html;
    }

}
