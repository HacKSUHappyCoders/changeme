/**
 * SequencerRenderer — A 2D Timeline/Gantt view of the execution.
 *
 * REFACTORED: Now renders into a floating HTML5 Canvas panel.
 * 
 * Visualizes the call stack over time (steps).
 * X-axis: Time (Trace Step)
 * Y-axis: Stack Depth
 */
class SequencerRenderer {
    constructor(scene, cityRenderer) {
        this.scene = scene;
        this.cityRenderer = cityRenderer;

        this._panel = null;
        this._canvas = null;
        this._ctx = null;

        this._visible = false;

        // View state
        this._zoom = 10; // Pixels per step
        this._scrollX = 0;
        this._scrollY = 0;

        // Data cache
        this._snapshot = null;
        this._blocks = [];

        // Resize observer
        this._resizeObserver = null;
    }

    isVisible() {
        return this._visible;
    }

    toggle() {
        if (this._visible) {
            this.hide();
        } else {
            this.show();
        }
        return this._visible;
    }

    show() {
        if (this._visible) return;

        console.log("Sequencer Panel: Creating...");

        this._ensurePanel();
        this._panel.classList.add('open');
        this._visible = true;

        const snapshot = this.cityRenderer._lastSnapshot;
        if (snapshot) {
            // Only reload if data has changed
            if (this._snapshot !== snapshot) {
                this._loadData(snapshot);
            } else {
                console.log("Sequencer Panel: Using cached data.");
            }
            // Always render (canvas might have been cleared or resizing needed)
            this._render();
        } else {
            console.log("Sequencer Panel: No snapshot data to load.");
        }
    }

    hide() {
        if (!this._visible) return;
        if (this._panel) {
            this._panel.classList.remove('open');
        }
        this._visible = false;
    }

    clear() {
        this._snapshot = null;
        this._blocks = [];
        if (this._ctx && this._canvas) {
            this._ctx.clearRect(0, 0, this._canvas.width, this._canvas.height);
        }
    }

    _ensurePanel() {
        if (this._panel) return;

        // Create Panel DOM
        this._panel = document.createElement('div');
        this._panel.className = 'sequencer-panel';

        const header = document.createElement('div');
        header.className = 'sequencer-header';

        const titleGroup = document.createElement('div');
        titleGroup.style.display = 'flex';
        titleGroup.style.gap = '10px';
        titleGroup.style.alignItems = 'center';

        const title = document.createElement('div');
        title.className = 'sequencer-title';
        title.textContent = 'Sequencer Timeline';
        titleGroup.appendChild(title);

        // Zoom controls in header
        const zoomIn = document.createElement('button');
        zoomIn.className = 'sequencer-btn';
        zoomIn.textContent = '+';
        zoomIn.onclick = (e) => { e.stopPropagation(); this._applyZoom(1.2); };

        const zoomOut = document.createElement('button');
        zoomOut.className = 'sequencer-btn';
        zoomOut.textContent = '-';
        zoomOut.onclick = (e) => { e.stopPropagation(); this._applyZoom(1 / 1.2); };

        titleGroup.appendChild(zoomOut);
        titleGroup.appendChild(zoomIn);

        header.appendChild(titleGroup);

        const closeBtn = document.createElement('button');
        closeBtn.className = 'sequencer-close';
        closeBtn.innerHTML = '×';
        closeBtn.onclick = () => this.hide();
        header.appendChild(closeBtn);

        this._panel.appendChild(header);

        const content = document.createElement('div');
        content.className = 'sequencer-content';

        this._canvas = document.createElement('canvas');
        this._canvas.className = 'sequencer-canvas';
        content.appendChild(this._canvas);

        this._panel.appendChild(content);

        document.body.appendChild(this._panel);

        // Make draggable
        if (typeof makeDraggable === 'function') {
            makeDraggable(this._panel, header);
        }

        this._ctx = this._canvas.getContext('2d');

        // Interaction
        this._setupInteraction();

        // Handle resizing
        this._resizeObserver = new ResizeObserver(() => this._onResize());
        this._resizeObserver.observe(content);

        console.log("Sequencer Panel created.");
    }

    _loadData(snapshot) {
        console.time("SequencerLoad");
        console.log(`Sequencer Panel: Loading ${snapshot.functions.length} functions...`);
        this._snapshot = snapshot;
        this._blocks = [];

        const functions = snapshot.functions || [];
        const colorCache = new Map();

        functions.forEach(fn => {
            const start = fn.enterStep;
            const end = fn.exitStep !== null ? fn.exitStep : snapshot.step;
            const duration = Math.max(1, end - start);
            const depth = fn.depth || 0;

            let colorStr = colorCache.get(fn.name);
            if (!colorStr) {
                const c = ColorHash.color('function', fn.name);
                colorStr = `rgb(${Math.floor(c.r * 255)}, ${Math.floor(c.g * 255)}, ${Math.floor(c.b * 255)})`;
                colorCache.set(fn.name, colorStr);
            }

            this._blocks.push({
                name: fn.name,
                start,
                end,
                duration,
                depth,
                color: colorStr
            });
        });

        // Auto-center current step
        this._scrollX = (snapshot.step * this._zoom) - (this._canvas.width / 2);
        console.timeEnd("SequencerLoad");
    }

    _onResize() {
        if (!this._panel || !this._canvas) return;
        const Rect = this._canvas.parentElement.getBoundingClientRect();
        this._canvas.width = Rect.width;
        this._canvas.height = Rect.height;
        this._render();
    }

    _setupInteraction() {
        let isPanning = false;
        let lastX = 0;
        let lastY = 0;

        this._canvas.addEventListener('pointerdown', e => {
            isPanning = true;
            lastX = e.clientX;
            lastY = e.clientY;
            this._canvas.setPointerCapture(e.pointerId);
        });

        this._canvas.addEventListener('pointermove', e => {
            if (!isPanning) return;
            const dx = e.clientX - lastX;
            const dy = e.clientY - lastY;
            lastX = e.clientX;
            lastY = e.clientY;

            this._scrollX -= dx;
            this._scrollY -= dy;
            this._render();
        });

        this._canvas.addEventListener('pointerup', e => {
            isPanning = false;
            this._canvas.releasePointerCapture(e.pointerId);
        });

        this._canvas.addEventListener('wheel', e => {
            e.preventDefault();
            // Zoom or scroll? Let's scroll X with wheel
            this._scrollX += e.deltaY;
            this._render();
        }, { passive: false });
    }

    _applyZoom(factor) {
        const oldZoom = this._zoom;
        this._zoom *= factor;
        this._zoom = Math.max(0.1, Math.min(100, this._zoom));

        // Adjust scroll to keep center
        const centerStep = (this._scrollX + this._canvas.width / 2) / oldZoom;
        this._scrollX = (centerStep * this._zoom) - (this._canvas.width / 2);

        this._render();
    }

    _render() {
        if (!this._ctx || !this._canvas) return;

        const w = this._canvas.width;
        const h = this._canvas.height;
        const ctx = this._ctx;

        // Clear background
        ctx.fillStyle = '#1e1e24';
        ctx.fillRect(0, 0, w, h);

        if (!this._blocks.length) return;

        const rowHeight = 30;
        const gap = 2;

        ctx.save();
        ctx.translate(-this._scrollX, -this._scrollY + 20); // +20 padding top

        // Draw blocks
        let visibleCount = 0;

        for (const block of this._blocks) {
            const bx = block.start * this._zoom;
            const bw = block.duration * this._zoom;
            // Cull off-screen
            if (bx + bw < this._scrollX || bx > this._scrollX + w) continue;

            const by = block.depth * (rowHeight + gap);
            const bh = rowHeight;

            // Draw rect
            ctx.fillStyle = block.color;
            ctx.fillRect(bx, by, bw, bh);

            // Draw border
            ctx.strokeStyle = 'rgba(255,255,255,0.3)';
            ctx.lineWidth = 1;
            ctx.strokeRect(bx, by, bw, bh);

            // Text clipping
            if (bw > 20) {
                ctx.save();
                ctx.beginPath();
                ctx.rect(bx, by, bw, bh);
                ctx.clip();

                ctx.fillStyle = '#fff';
                ctx.font = '11px Consolas';
                ctx.fillText(block.name, bx + 4, by + 18);

                ctx.restore();
            }

            visibleCount++;
        }

        // Playhead
        if (this._snapshot) {
            const px = this._snapshot.step * this._zoom;
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(px, -1000);
            ctx.lineTo(px, 1000); // Infinite vertical line
            ctx.stroke();

            // Playhead label
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 12px sans-serif';
            ctx.fillText(`Step ${this._snapshot.step}`, px + 5, this._scrollY + 15);
        }

        ctx.restore();

        // Stats overlay
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(0, 0, 150, 20);
        ctx.fillStyle = '#aaa';
        ctx.font = '10px sans-serif';
        ctx.fillText(`Zoom: ${this._zoom.toFixed(2)} | Visible: ${visibleCount}`, 5, 14);
    }
}
