/**
 * CodeVisualizer — Main orchestrator for the 3D visual debugger.
 *
 * Architecture (AGENTS.md compliant):
 *   WorldState         – runtime simulation: functions, variables, loops, branches, memory
 *   CityRenderer       – translates world snapshots into Babylon.js meshes
 *   TimelineController – forward / backward / seek / auto-play
 *   SceneManager       – Babylon.js scene, camera, lights
 *   MaterialManager    – stained-glass material factory
 *
 * A building represents a persistent runtime concept (function, variable,
 * loop, branch) — NOT a line of code or AST node.
 *
 * The spiral path represents time.  Each trace event advances one step.
 * The user can scrub forward and backward; the city updates deterministically.
 */
class CodeVisualizer {
    constructor(canvas) {
        this.canvas = canvas;
        this.parser = new CodeParser();

        // Managers — initialised in init()
        this.sceneManager = null;
        this.materialManager = null;
        this.worldState = null;
        this.cityRenderer = null;
        this.timeline = null;

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
        const camera = this.sceneManager.getCamera();

        // Material factory
        this.materialManager = new MaterialManager(scene);

        // World state engine
        this.worldState = new WorldState();

        // City renderer — turns world snapshots into 3D geometry
        this.cityRenderer = new CityRenderer(scene, this.materialManager);

        // Timeline controller — drives WorldState and triggers re-renders
        this.timeline = new TimelineController(this.worldState, (snapshot) => {
            this.cityRenderer.render(snapshot);
            this._updateTimelineUI(snapshot);
        });

        // Explode manager for click-to-inspect
        this.explodeManager = new ExplodeManager(scene, camera, this.materialManager);

        return this;
    }

    /**
     * Load and visualise a code trace.
     */
    visualize(codeTrace) {
        // Clear previous city
        this.cityRenderer.clear();

        // Parse the trace
        const trace = this.parser.parse(codeTrace);

        // Feed into world state
        this.worldState.loadTrace(trace);

        // Advance to the end so the full city is visible
        this.worldState.seekTo(trace.length - 1);

        // Render the current world state
        this.cityRenderer.render(this.worldState.getSnapshot());

        // Reset camera to a good overview position
        this.sceneManager.resetCamera();

        // Update stats
        this._updateStats(trace.length);
        this._updateTimelineUI(this.worldState.getSnapshot());
    }

    // ─── Timeline controls (called from main.js) ──────────────────

    stepForward()  { this.timeline.stepForward(); }
    stepBackward() { this.timeline.stepBackward(); }
    seekTo(step)   { this.timeline.seekTo(step); }
    goToStart()    { this.timeline.goToStart(); }
    goToEnd()      { this.timeline.goToEnd(); }

    togglePlay() {
        return this.timeline.togglePlay();
    }

    setSpeed(ms) {
        this.timeline.setSpeed(ms);
    }

    // ─── Camera ────────────────────────────────────────────────────

    resetCamera() {
        this.sceneManager.resetCamera();
    }

    // ─── Explode ───────────────────────────────────────────────────

    collapseExplodedBuilding() {
        return this.explodeManager.collapseIfExploded();
    }

    // ─── Animation toggle ──────────────────────────────────────────

    toggleAnimation() {
        const scene = this.sceneManager.getScene();
        scene.animationsEnabled = !scene.animationsEnabled;
        return scene.animationsEnabled;
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

    _updateTimelineUI(snapshot) {
        // Timeline slider
        const slider = document.getElementById('timelineSlider');
        if (slider) {
            slider.max = snapshot.totalSteps - 1;
            slider.value = snapshot.step;
        }

        // Step counter
        const counter = document.getElementById('stepCounter');
        if (counter) {
            counter.textContent = `Step ${snapshot.step + 1} / ${snapshot.totalSteps}`;
        }

        // Current event display
        const eventEl = document.getElementById('currentEvent');
        if (eventEl && snapshot.currentEvent) {
            const e = snapshot.currentEvent;
            let text = e.type;
            if (e.name) text += ` ${e.name}`;
            if (e.value !== undefined && e.value !== '') text += ` = ${e.value}`;
            if (e.condition) text += ` (${e.condition})`;
            eventEl.textContent = text;
        } else if (eventEl) {
            eventEl.textContent = '—';
        }
    }
}
