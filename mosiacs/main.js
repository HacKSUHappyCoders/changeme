/**
 * Main application entry point
 */

// Wait for DOM to be ready
document.addEventListener('DOMContentLoaded', () => {
    const canvas = document.getElementById('renderCanvas');
    const visualizer = new CodeVisualizer(canvas);
    
    // Initialize the visualizer
    visualizer.init();

    // Load example code by default
    const exampleTrace = CodeParser.getExampleTrace();
    visualizer.visualize(exampleTrace);

    // Load example button
    document.getElementById('loadExample').addEventListener('click', () => {
        const exampleTrace = CodeParser.getExampleTrace();
        visualizer.visualize(exampleTrace);
    });

    // Reset camera button
    document.getElementById('resetCamera').addEventListener('click', () => {
        visualizer.resetCamera();
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
});
