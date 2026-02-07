/**
 * Main application entry point
 */

// Wait for DOM to be ready
document.addEventListener('DOMContentLoaded', () => {
    const canvas = document.getElementById('renderCanvas');
    const visualizer = new CodeVisualizer(canvas);
    
    // Initialize the visualizer
    visualizer.init();

    // Load trace data from the API on startup
    CodeParser.getExampleTrace()
        .then(json => visualizer.visualize(json))
        .catch(err => console.error('Failed to load trace data:', err));

    // Load example button — re-fetches from the API so you can
    // swap out data/test_data.json while the server is running
    document.getElementById('loadExample').addEventListener('click', () => {
        CodeParser.getExampleTrace()
            .then(json => visualizer.visualize(json))
            .catch(err => console.error('Failed to load trace data:', err));
    });

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
    console.log('Click any building to explode and see variable data.');
    console.log('Debug Column Mode is ON by default - shards will fly to the side of your screen!');
});
