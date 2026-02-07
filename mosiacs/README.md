# Code Mosaic Visualizer

A beautiful stained-glass spiral visualization of C code execution using Babylon.js.

## Overview

This project creates a 3D visualization of code execution traces, displaying them as a spiral path with colorful "buildings" representing different operations. Each building uses stained-glass aesthetics with vibrant, translucent colors.

## Features

- **Spiral Path Visualization**: Code execution flows along a spiral path
- **Stained Glass Buildings**: Each operation type has its own color:
  - 🔴 CALL - Ruby Red
  - 🔵 DECL - Sapphire Blue
  - 🟣 LOOP - Amethyst Purple
  - 🟢 ASSIGN - Emerald Green
  - 🟡 RETURN - Amber Gold
- **Interactive 3D**: Rotate, pan, and zoom to explore the visualization
- **Animated**: Buildings appear with smooth animations and floating effects
- **Glow Effects**: Enhanced with glow layers for that magical stained-glass look

## How to Use

1. Open `index.html` in a modern web browser
2. Click "Load Example Code" to visualize the example trace
3. Use mouse controls to navigate:
   - **Left click + drag**: Rotate camera
   - **Right click + drag**: Pan camera
   - **Scroll wheel**: Zoom in/out

## Code Format

The visualizer expects execution traces in the format:
```
TYPE|name|value|address|line|depth
```

Example:
```
CALL|main|||1
DECL|sum|0|00000049923FF88C|2|1
LOOP|iter|3|1
ASSIGN|sum|0|00000049923FF88C|4|1
RETURN|literal|0|0|7|1
```

## Files

- `index.html` - Main HTML file with UI
- `main.js` - Application entry point
- `parser.js` - Code trace parser
- `visualizer.js` - Babylon.js visualization logic

## Technologies

- [Babylon.js](https://www.babylonjs.com/) - 3D rendering engine
- Vanilla JavaScript
- HTML5 Canvas

## Future Enhancements

- Load custom code traces from files
- Export visualizations as images/videos
- More building shapes based on operation types
- Interactive tooltips showing operation details
- Different visualization themes

---

Built with 💎 and ✨ for beautiful code visualization
