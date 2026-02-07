/**
 * Main application entry point
 */

// Wait for DOM to be ready
document.addEventListener('DOMContentLoaded', () => {
    const canvas = document.getElementById('renderCanvas');
    const visualizer = new CodeVisualizer(canvas);
    
    // Initialize the visualizer
    visualizer.init();

    const traceSelect = document.getElementById('traceFile');

    /** Load the currently selected trace file. */
    function loadSelectedTrace() {
        const filename = traceSelect ? traceSelect.value : undefined;
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

    // Toggle animation button
    const toggleBtn = document.getElementById('toggleAnimation');
    toggleBtn.addEventListener('click', () => {
        const isAnimating = visualizer.toggleAnimation();
        toggleBtn.textContent = isAnimating ? 'Pause Animation' : 'Resume Animation';
    });

    // Show welcome message
    console.log('🎨 Code Mosaic Visualizer initialized!');
    console.log('Click "Load Example Code" to see the visualization.');
    console.log('Click any building to inspect its data.');
});
