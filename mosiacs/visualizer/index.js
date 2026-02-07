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

        // Source code for the code panel
        this._sourceCode = null;
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

        // Wire up node-click → code panel highlight
        this.explodeManager.onNodeSelect = (line) => this.highlightLine(line);

        // Galaxy warp manager — double-click to warp into sub-spiral galaxies
        this.galaxyWarpManager = new GalaxyWarpManager(scene, this.sceneManager, this.cityRenderer);
        this.explodeManager.galaxyWarpManager = this.galaxyWarpManager;

        // Causality web renderer (Phase 3 Part 3)
        this.causalityRenderer = new CausalityRenderer(scene, this.cityRenderer);

        // Panoramic renderer (Phase 3 Part 4) — low-quality total render
        this.panoramicRenderer = new PanoramicRenderer(scene, this.sceneManager, this.cityRenderer);



        // Sequencer view (Phase 5)
        this.sequencerRenderer = new SequencerRenderer(scene, this.cityRenderer);

        // Memory pool renderer — address space underworld
        this.memoryPoolRenderer = new MemoryPoolRenderer(scene, this.cityRenderer);

        return this;
    }

    /**
     * Load and visualise a code trace.
     */
    visualize(codeTrace) {
        // Clear previous city and code panel
        this.cityRenderer.clear();
        this._removeCodePanel();

        // Clear any active galaxy warp
        if (this.galaxyWarpManager) {
            this.galaxyWarpManager.clear();
        }

        // Clear causality web
        if (this.causalityRenderer) {
            this.causalityRenderer.clear();
        }

        // Clear panoramic render
        if (this.panoramicRenderer) {
            this.panoramicRenderer.clear();
        }

        // Clear sequencer
        if (this.sequencerRenderer) {
            this.sequencerRenderer.clear();
        }

        // Clear memory pool
        if (this.memoryPoolRenderer) {
            this.memoryPoolRenderer.clear();
        }

        // Parse the trace
        const trace = this.parser.parse(codeTrace);

        // Show error notification if there's an error
        if (this.parser.error) {
            this._showErrorNotification(this.parser.error);
        }

        // Feed into world state (with error info if present)
        this.worldState.loadTrace(trace, this.parser.error);

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

        // Reset camera to a good overview position based on spiral size
        this.sceneManager.resetCamera(this.cityRenderer.getSpiralRadius());

        // Update stats
        this._updateStats(trace.length);

        // Build code panel if source code is available
        if (this._sourceCode) {
            this._buildCodePanel(this._sourceCode);
        }
    }

    // ─── Camera ────────────────────────────────────────────────────

    resetCamera() {
        this.sceneManager.resetCamera(this.cityRenderer.getSpiralRadius());
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
        const result = this.causalityRenderer.toggle();

        // Phase 4: Also toggle causality within bubbles
        if (this.cityRenderer && this.cityRenderer.loopBubbleRenderer) {
            this.cityRenderer.loopBubbleRenderer.setCausalityVisible(result);
        }

        return result;
    }

    isCausalityVisible() {
        return this.causalityRenderer.isVisible();
    }

    // ─── Panoramic render (Phase 3 Part 4) ─────────────────────────

    togglePanoramic() {
        return this.panoramicRenderer.toggle();
    }

    isPanoramicActive() {
        return this.panoramicRenderer.isActive();
    }

    // ─── Sequencer View ────────────────────────────────────────────

    toggleSequencer() {
        if (this.sequencerRenderer.isVisible()) {
            this.sequencerRenderer.hide();

            // Show city again? 
            // The city renderer doesn't have a simple hide/show. It's always there.
            // We can just rely on the sequencer overlapping or being separate.
            return false;
        } else {
            this.sequencerRenderer.show();
            return true;
        }
    }

    // ─── Memory Pool ─────────────────────────────────────────────

    toggleMemoryPool() {
        return this.memoryPoolRenderer.toggle();
    }

    isMemoryPoolVisible() {
        return this.memoryPoolRenderer.isVisible();
    }

    // ─── UI helpers ────────────────────────────────────────────────

    _updateStats(count) {
        const el = document.getElementById('stats');
        if (!el) return;

        let html = `<strong>Visualizing:</strong><br>${count} execution steps`;
        const meta = this.parser.metadata;
        if (meta) {
            if (meta.file_name) html += `<br>File: ${meta.file_name}`;
            if (meta.language) html += ` (${meta.language})`;
            if (meta.total_lines) html += `<br>${meta.total_lines} lines`;
            if (meta.num_functions) html += `, ${meta.num_functions} fn(s)`;
            if (meta.num_variables) html += `, ${meta.num_variables} vars`;
        }
        el.innerHTML = html;
    }

    _showErrorNotification(error) {
        // Create or update error notification panel
        let errorPanel = document.getElementById('errorNotification');
        if (!errorPanel) {
            errorPanel = document.createElement('div');
            errorPanel.id = 'errorNotification';
            errorPanel.style.cssText = `
                position: fixed;
                top: 80px;
                right: 20px;
                max-width: 400px;
                background: linear-gradient(135deg, rgba(139, 0, 0, 0.95) 0%, rgba(220, 20, 60, 0.95) 100%);
                border: 2px solid rgba(255, 69, 0, 0.8);
                border-radius: 8px;
                padding: 15px;
                color: white;
                font-family: monospace;
                font-size: 13px;
                box-shadow: 0 4px 20px rgba(255, 0, 0, 0.4);
                z-index: 10000;
                animation: slideIn 0.3s ease-out;
            `;
            document.body.appendChild(errorPanel);

            // Add slide-in animation
            const style = document.createElement('style');
            style.textContent = `
                @keyframes slideIn {
                    from { transform: translateX(100%); opacity: 0; }
                    to { transform: translateX(0); opacity: 1; }
                }
            `;
            document.head.appendChild(style);
        }

        const stageLabel = error.stage ? `[${error.stage.toUpperCase()}]` : '[ERROR]';

        // Different messaging for compile vs runtime errors
        let locationInfo = '';
        let helpText = '';

        if (error.line) {
            // Compile error with line number
            locationInfo = `<div style="margin-top: 8px; font-weight: bold;">Error at line ${error.line}</div>`;
            helpText = '<div style="margin-top: 8px; font-size: 11px; opacity: 0.8;">Buildings at/after this line are highlighted in red.</div>';
        } else if (error.stage === 'runtime') {
            // Runtime error - crashed after trace
            locationInfo = `<div style="margin-top: 8px; font-weight: bold;">Program crashed after execution</div>`;
            helpText = '<div style="margin-top: 8px; font-size: 11px; opacity: 0.8;">The last executed step is marked with [!]. Crash occurred after trace ended.</div>';
        } else {
            // Other errors (instrument, normalize, etc.)
            helpText = '<div style="margin-top: 8px; font-size: 11px; opacity: 0.8;">No visualization available for this error.</div>';
        }

        errorPanel.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 10px;">
                <div style="font-weight: bold; font-size: 16px;">${stageLabel} ERROR</div>
                <button onclick="this.parentElement.parentElement.remove()"
                        style="background: none; border: none; color: white; font-size: 20px; cursor: pointer; padding: 0; line-height: 1;">✕</button>
            </div>
            <div style="background: rgba(0,0,0,0.3); padding: 10px; border-radius: 4px; margin-bottom: 8px; max-height: 200px; overflow-y: auto;">
                ${error.message.replace(/\n/g, '<br>')}
            </div>
            ${locationInfo}
            ${helpText}
        `;
    }

    // ─── Code Panel ─────────────────────────────────────────────

    setSourceCode(code) {
        this._sourceCode = code;
    }

    _buildCodePanel(code) {
        this._removeCodePanel();

        const panel = document.createElement('div');
        panel.id = 'codePanel';
        panel.className = 'code-panel';

        // Header with filename + Save button
        const header = document.createElement('div');
        header.className = 'code-panel-header';
        const meta = this.parser.metadata;
        const filename = meta && meta.file_name ? meta.file_name : 'code.c';

        const titleSpan = document.createElement('span');
        titleSpan.textContent = filename;
        header.appendChild(titleSpan);

        const saveBtn = document.createElement('button');
        saveBtn.className = 'code-save-btn';
        saveBtn.textContent = 'Save & Run';
        saveBtn.addEventListener('click', () => this._saveCodePanel());
        header.appendChild(saveBtn);

        panel.appendChild(header);

        // Editor area: gutter + editor stack (overlay + textarea)
        const wrap = document.createElement('div');
        wrap.className = 'code-editor-wrap';

        const gutter = document.createElement('div');
        gutter.className = 'code-gutter';
        gutter.id = 'codeGutter';

        const stack = document.createElement('div');
        stack.className = 'code-editor-stack';

        const overlay = document.createElement('pre');
        overlay.className = 'code-overlay';
        overlay.id = 'codeOverlay';

        const textarea = document.createElement('textarea');
        textarea.className = 'code-textarea';
        textarea.id = 'codeTextarea';
        textarea.spellcheck = false;
        textarea.setAttribute('wrap', 'off');
        textarea.value = code;

        // Update gutter + syntax overlay on every keystroke
        const updateEditor = () => {
            const lines = textarea.value.split('\n');
            gutter.innerHTML = lines.map((_, i) =>
                `<div class="code-gutter-line" id="gutterLine${i + 1}">${i + 1}</div>`
            ).join('');
            overlay.innerHTML = this._syntaxHighlight(textarea.value);
        };
        textarea.addEventListener('input', updateEditor);
        updateEditor();

        // Tab inserts spaces; stop all keys from reaching Babylon.js
        textarea.addEventListener('keydown', (e) => {
            e.stopPropagation();
            if (e.key === 'Tab') {
                e.preventDefault();
                const s = textarea.selectionStart, end = textarea.selectionEnd;
                textarea.value = textarea.value.substring(0, s) + '    ' + textarea.value.substring(end);
                textarea.selectionStart = textarea.selectionEnd = s + 4;
                textarea.dispatchEvent(new Event('input'));
            }
        });
        textarea.addEventListener('keyup', (e) => e.stopPropagation());
        textarea.addEventListener('mousedown', (e) => e.stopPropagation());
        textarea.addEventListener('mousemove', (e) => e.stopPropagation());
        textarea.addEventListener('wheel', (e) => e.stopPropagation());

        // Sync scroll between gutter, overlay, and textarea
        textarea.addEventListener('scroll', () => {
            gutter.scrollTop = textarea.scrollTop;
            overlay.scrollTop = textarea.scrollTop;
            overlay.scrollLeft = textarea.scrollLeft;
        });

        stack.appendChild(overlay);
        stack.appendChild(textarea);
        wrap.appendChild(gutter);
        wrap.appendChild(stack);
        panel.appendChild(wrap);

        document.body.appendChild(panel);
        makeDraggable(panel, header);

        // Animate in
        requestAnimationFrame(() => panel.classList.add('open'));
    }

    _syntaxHighlight(code) {
        const lang = (this.parser.metadata && this.parser.metadata.language) || '';
        const isPy = /python/i.test(lang);
        const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const kwSet = new Set((isPy
            ? 'and|as|assert|async|await|break|class|continue|def|del|elif|else|except|finally|for|from|global|if|import|in|is|lambda|nonlocal|not|or|pass|raise|return|try|while|with|yield|None|True|False|self|print|range|len'
            : 'auto|break|case|const|continue|default|do|else|enum|extern|for|goto|if|return|sizeof|static|struct|switch|typedef|union|volatile|while'
        ).split('|'));
        const tySet = isPy ? new Set() : new Set('char|double|float|int|long|short|signed|unsigned|void|FILE|size_t|NULL|bool'.split('|'));

        let inBlock = false;
        return code.split('\n').map((line, idx) => {
            let out = '', i = 0;
            if (inBlock) {
                const end = line.indexOf('*/');
                if (end === -1) return `<div class="code-hl-line" id="hlLine${idx + 1}"><span class="hl-cmt">${esc(line) || ' '}</span></div>`;
                out += `<span class="hl-cmt">${esc(line.slice(0, end + 2))}</span>`;
                i = end + 2; inBlock = false;
            }
            while (i < line.length) {
                const c = line[i];
                if (!isPy && c === '/' && line[i + 1] === '*') {
                    const end = line.indexOf('*/', i + 2);
                    if (end === -1) { out += `<span class="hl-cmt">${esc(line.slice(i))}</span>`; inBlock = true; break; }
                    out += `<span class="hl-cmt">${esc(line.slice(i, end + 2))}</span>`; i = end + 2; continue;
                }
                if (isPy && c === '#') { out += `<span class="hl-cmt">${esc(line.slice(i))}</span>`; break; }
                if (!isPy && c === '/' && line[i + 1] === '/') { out += `<span class="hl-cmt">${esc(line.slice(i))}</span>`; break; }
                if (c === '"' || c === "'") {
                    let j = i + 1;
                    while (j < line.length && line[j] !== c) { if (line[j] === '\\') j++; j++; }
                    j = Math.min(j + 1, line.length);
                    out += `<span class="hl-str">${esc(line.slice(i, j))}</span>`; i = j; continue;
                }
                if (!isPy && c === '#' && !line.slice(0, i).trim()) { out += `<span class="hl-pre">${esc(line.slice(i))}</span>`; break; }
                if (/\d/.test(c) && (i === 0 || !/\w/.test(line[i - 1]))) {
                    let j = i; while (j < line.length && /[\da-fA-FxX.eE]/.test(line[j])) j++;
                    out += `<span class="hl-num">${esc(line.slice(i, j))}</span>`; i = j; continue;
                }
                if (/[a-zA-Z_]/.test(c)) {
                    let j = i; while (j < line.length && /\w/.test(line[j])) j++;
                    const w = line.slice(i, j);
                    if (kwSet.has(w)) out += `<span class="hl-kw">${esc(w)}</span>`;
                    else if (tySet.has(w)) out += `<span class="hl-ty">${esc(w)}</span>`;
                    else if (j < line.length && line[j] === '(') out += `<span class="hl-fn">${esc(w)}</span>`;
                    else out += esc(w);
                    i = j; continue;
                }
                out += esc(c); i++;
            }
            return `<div class="code-hl-line" id="hlLine${idx + 1}">${out || ' '}</div>`;
        }).join('');
    }

    _saveCodePanel() {
        const textarea = document.getElementById('codeTextarea');
        if (!textarea) return;

        const code = textarea.value;
        const meta = this.parser.metadata;
        const filename = meta && meta.file_name ? meta.file_name : 'code.c';

        // Create a File object from the edited text
        const blob = new Blob([code], { type: 'text/plain' });
        const file = new File([blob], filename);

        // Update stored source code
        this.setSourceCode(code);

        // Upload and re-visualize
        const saveBtn = document.querySelector('.code-save-btn');
        if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Processing...'; }

        CodeParser.upload(file)
            .then(json => {
                if (json.success === false) {
                    const err = json.error || {};
                    alert(`Error (${err.stage || 'unknown'}): ${err.message || 'Unknown error'}`);
                    return;
                }
                this.visualize(json);
            })
            .catch(err => alert('Save failed: ' + err.message))
            .finally(() => {
                if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save & Run'; }
            });
    }

    _removeCodePanel() {
        const panel = document.getElementById('codePanel');
        if (panel) {
            panel.classList.remove('open');
            setTimeout(() => { if (panel.parentNode) panel.parentNode.removeChild(panel); }, 300);
        }
    }

    highlightLine(lineNumber) {
        const oldG = document.querySelector('.code-gutter-line.highlighted');
        if (oldG) oldG.classList.remove('highlighted');
        const oldL = document.querySelector('.code-hl-line.highlighted');
        if (oldL) oldL.classList.remove('highlighted');

        if (!lineNumber) return;

        const gutterLine = document.getElementById('gutterLine' + lineNumber);
        if (gutterLine) gutterLine.classList.add('highlighted');

        const hlLine = document.getElementById('hlLine' + lineNumber);
        if (hlLine) hlLine.classList.add('highlighted');

        // Scroll textarea and sync overlay + gutter
        const textarea = document.getElementById('codeTextarea');
        if (!textarea) return;
        const lineHeight = parseFloat(getComputedStyle(textarea).lineHeight) || 20;
        const visibleLines = textarea.clientHeight / lineHeight;
        textarea.scrollTop = (lineNumber - visibleLines / 2) * lineHeight;

        const overlay = document.getElementById('codeOverlay');
        const gutter = document.getElementById('codeGutter');
        if (overlay) overlay.scrollTop = textarea.scrollTop;
        if (gutter) gutter.scrollTop = textarea.scrollTop;
    }

}
