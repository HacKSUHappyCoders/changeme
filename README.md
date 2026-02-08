# Spiral

Traditional debuggers show walls of text. Spiral turns that into art.

Spiral transforms C and Python source code into explorable 3D cities. Upload a file, and Spiral traces its execution, then renders every function call, loop, branch, and assignment as a building on a descending spiral you can fly through in your browser. Words become mosaics of spirals, buildings, balloons, and trees.

![Babylon.js](https://img.shields.io/badge/Babylon.js-3D-bb464b) ![Python](https://img.shields.io/badge/Python-3.13-blue) ![Flask](https://img.shields.io/badge/Flask-server-lightgrey)

## Why

> "The number of engineers that I work with that can't follow the flow of variables and arguments is astonishing."
>
> - Andrew Sutton, C++ standards committee member and designer of static reflection in C++26

He isn't talking about juniors. Reading code at runtime is hard for everyone. Traditional debuggers only show textual interpretations of runtime state - heavy data that must be mentally deconstructed, requiring deep understanding of the program just to locate the problem.

Spiral flips that on its head. Instead of reading state, you *see* it.

## What you can see

- **Variable flow** - The spiral shape lets you visually trace what happened in the past and watch every variable change that occurred.
- **Data relationships** - The causality web shows which variables impacted what data, and when.
- **Code inefficiencies** - Loops and recursion pop out of the spiral as visual towers, making expensive constructs immediately obvious.
- **Memory layout** - The memory pool shows exactly where each variable lives in memory and where pointers go - making one of the hardest parts of learning to program something you can simply look at.
- **Conditional execution** - See exactly which branch of an if/else was taken and what caused it to execute.
- **Error pinpointing** - When code crashes, the failure point is marked with a blinking red dot at the last executed operation, showing precisely how far the program got before failing.

## How it works

1. **Trace** - The parser instruments your source file, compiles/runs it, and captures every operation (calls, declarations, assignments, loops, branches, returns).
2. **Build** - Trace data is normalized into a structured JSON format with metadata and nested scopes.
3. **Render** - Babylon.js arranges the trace as a spiral city. Each operation becomes a building whose shape, color, and position encode what happened at runtime.

## Quickstart

```
pip install flask
python server.py
```

Open [localhost:5000](http://localhost:5000), upload a `.c` or `.py` file, and explore.

### Docker

```
docker compose up --build
```

The app will be available on port 3000.

## Navigation

| Input | Action |
|---|---|
| Left mouse + drag | Orbit |
| Shift + left mouse | Pan |
| Scroll wheel | Zoom |
| Click a building | Inspect its data |
| Double-click | Warp into its sub-spiral |
| A / D | Step through nodes |
| W / S | Warp in / warp out |

## Views

- **Panoramic** - See all galaxies at once
- **Causality Web** - Trace data dependencies between variables
- **Memory Pool** - Visualize memory allocations and pointer relationships
- **Sequencer** - Step through execution in order

## Project structure

```
spiral/
  server.py        Flask server & API
  parser/          Instrumentation, tracing, and JSON normalization
  mosiacs/         Front-end: Babylon.js visualizer, styles, assets
  app/             Production Flask app factory
  Dockerfile
  docker-compose.yml
```
