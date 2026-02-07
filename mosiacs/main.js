/**
 * Main application entry point
 */

// Wait for DOM to be ready
document.addEventListener('DOMContentLoaded', () => {
    const canvas = document.getElementById('renderCanvas');
    const visualizer = new CodeVisualizer(canvas);
    
    // Initialize the visualizer
    visualizer.init();

    // Make static panels draggable
    makeDraggable(document.getElementById('controls'), document.querySelector('#controls h2'));
    makeDraggable(document.getElementById('info'), document.querySelector('#info > strong'));

    const traceSelect = document.getElementById('traceFile');

    /** Load the currently selected trace file. */
    function loadSelectedTrace() {
        const filename = traceSelect ? traceSelect.value : undefined;
        visualizer.setSourceCode(null); // No source code for example traces
        CodeParser.getExampleTrace(filename)
            .then(json => visualizer.visualize(json))
            .catch(err => console.error('Failed to load trace data:', err));
    }

    // Load trace data from the API on startup
    loadSelectedTrace();

    // Load example button — loads the selected file from the dropdown
    document.getElementById('loadExample').addEventListener('click', loadSelectedTrace);

    // Reset camera button
    document.getElementById('resetCamera').addEventListener('click', () => {
        visualizer.resetCamera();
    });

    // Collapse/De-explode building button
    document.getElementById('collapseBuilding').addEventListener('click', () => {
        const wasCollapsed = visualizer.collapseExplodedBuilding();
        if (!wasCollapsed) {
            console.log('No building is currently exploded.');
        }
    });

    // Return from galaxy warp button
    document.getElementById('returnToMainGalaxy').addEventListener('click', () => {
        const returned = visualizer.returnFromGalaxy();
        if (!returned) {
            console.log('Not currently in a galaxy.');
        }
    });

    // Toggle animation button
    const toggleBtn = document.getElementById('toggleAnimation');
    toggleBtn.addEventListener('click', () => {
        const isAnimating = visualizer.toggleAnimation();
        toggleBtn.textContent = isAnimating ? 'Pause Animation' : 'Resume Animation';
    });

    // Toggle causality web button (Phase 3 Part 3)
    const causalityBtn = document.getElementById('toggleCausality');
    causalityBtn.addEventListener('click', () => {
        const isShowing = visualizer.toggleCausality();
        causalityBtn.textContent = isShowing ? '🕸️ Hide Causality Web' : '🕸️ Show Causality Web';
    });

    // Upload file button
    const uploadBtn = document.getElementById('uploadBtn');
    const fileInput = document.getElementById('fileUpload');
    uploadBtn.addEventListener('click', () => {
        const file = fileInput.files[0];
        if (!file) {
            alert('Please select a .c or .py file first.');
            return;
        }
        uploadBtn.disabled = true;
        uploadBtn.textContent = 'Processing...';

        // Read source code text and upload in parallel
        Promise.all([file.text(), CodeParser.upload(file)])
            .then(([sourceCode, json]) => {
                if (json.success === false) {
                    const err = json.error || {};
                    alert(`Error (${err.stage || 'unknown'}): ${err.message || 'Unknown error'}`);
                    return;
                }
                visualizer.setSourceCode(sourceCode);
                visualizer.visualize(json);
                // Refresh the trace dropdown
                return fetch('/api/traces').then(r => r.json()).then(files => {
                    traceSelect.innerHTML = '';
                    files.forEach(f => {
                        const opt = document.createElement('option');
                        opt.value = f;
                        opt.textContent = f.replace('.json', '');
                        traceSelect.appendChild(opt);
                    });
                });
            })
            .catch(err => alert('Upload failed: ' + err.message))
            .finally(() => {
                uploadBtn.disabled = false;
                uploadBtn.textContent = 'Upload & Visualize';
            });
    });

    // Toggle panoramic render button (Phase 3 Part 4)
    const panoramicBtn = document.getElementById('togglePanoramic');
    panoramicBtn.addEventListener('click', () => {
        const isActive = visualizer.togglePanoramic();
        panoramicBtn.textContent = isActive ? '🌌 Exit Panoramic' : '🌌 Panoramic Render';
        panoramicBtn.classList.toggle('active', isActive);
    });

    // Toggle memory pool button
    const memoryPoolBtn = document.getElementById('toggleMemoryPool');
    memoryPoolBtn.addEventListener('click', () => {
        const isShowing = visualizer.toggleMemoryPool();
        memoryPoolBtn.textContent = isShowing ? '🌊 Hide Memory Pool' : '🌊 Show Memory Pool';
        memoryPoolBtn.classList.toggle('active', isShowing);
    });

    // Show welcome message
    console.log('🎨 Code Mosaic Visualizer initialized!');
    console.log('Click "Load Example Code" to see the visualization.');
    console.log('Click any building to inspect its data.');
});
