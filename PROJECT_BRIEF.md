# Code Mosaic — Project Brief for AI Collaborators

> Use this document to get up to speed on what Code Mosaic is, how it works today, and where it's headed. Then brainstorm features with us.

---

## 1. What is Code Mosaic?

Code Mosaic is a **3D visual debugger** that transforms C program execution traces into an interactive spiral city rendered with [Babylon.js](https://www.babylonjs.com/). Instead of reading a debugger's text output, you fly through a glowing stained-glass cityscape where every building *is* a runtime concept — a function call, a variable, a loop, a branch.

The guiding metaphor: **time is a spiral, and code execution builds a city along it.**

---

## 2. Data Pipeline

```
C source code
     │
     ▼
Custom C parser/instrumenter  (external, not in this repo)
     │  produces JSON trace
     ▼
┌──────────────────────────┐
│  server.py (Flask)       │  serves static files + JSON API
└──────────────────────────┘
     │  GET /api/trace/<file>
     ▼
┌──────────────────────────┐
│  Browser (Babylon.js)    │
│  parser.js → WorldState  │
│  → CityRenderer → 3D    │
└──────────────────────────┘
```

### Trace JSON format

```json
{
  "metadata": {
    "file_name": "example.c",
    "language": "C",
    "total_lines": 110,
    "num_functions": 10,
    "num_variables": 25,
    "function_names": ["main", "factorial", "fibonacci", ...]
  },
  "traces": [
    { "type": "CALL",      "subject": "main",   "line_number": 1, "stack_depth": 1 },
    { "type": "DECL",      "subject": "sum",    "value": 0, "address": "0x...", "line_number": 4, "stack_depth": 1 },
    { "type": "LOOP",      "subtype": "for",    "condition": "i<5", "condition_result": 1, "line_number": 5 },
    { "type": "ASSIGN",    "subject": "sum",    "value": 10, "address": "0x...", "line_number": 6 },
    { "type": "CONDITION", "subject": "sum<10", "condition_result": 0, "line_number": 9 },
    { "type": "BRANCH",    "subtype": "else",   "line_number": 11 },
    { "type": "RETURN",    "subtype": "literal", "value": 0, "line_number": 16 }
  ]
}
```

**Seven trace event types:** `CALL`, `DECL`, `ASSIGN`, `LOOP`, `CONDITION`, `BRANCH`, `RETURN`.

---

## 3. Architecture (browser side)

| Module | File | Responsibility |
|--------|------|----------------|
| **CodeParser** | `parser.js` | Normalises raw JSON traces into step objects |
| **WorldState** | `visualizer/world/WorldState.js` | Runtime simulation engine — processes trace events, creates entity records (functions, variables, loops, branches), tracks creation order, call stack, container nesting |
| **CityRenderer** | `visualizer/world/CityRenderer.js` | Translates a WorldState snapshot into Babylon.js meshes on a descending spiral. Owns slot assignment, position computation, building mesh creation, and the main spiral tube |
| **SubSpiralRenderer** | `visualizer/world/SubSpiralRenderer.js` | On-demand sub-spirals that descend beneath a building when clicked. Tall & narrow helix layout, one at a time |
| **SceneManager** | `visualizer/scene/SceneManager.js` | Babylon.js engine, scene, camera, lights, glow layer |
| **ExplodeManager** | `visualizer/explode/ExplodeManager.js` | Click-to-inspect: shows an HTML inspector panel + triggers sub-spiral rendering |
| **MeshFactory** | `visualizer/world/MeshFactory.js` | Geometry & material creation for each building type |
| **LabelHelper** | `visualizer/world/LabelHelper.js` | Billboard floating labels using DynamicTexture |
| **ColorHash** | `visualizer/world/ColorHash.js` | Deterministic hash-based colouring per building type (RGB schema with locked 255 channels) |
| **SpiralConfig** | `visualizer/SpiralConfig.js` | Central config for spiral geometry (radius, growth, angle step, height step) |
| **CodeVisualizer** | `visualizer/index.js` | Main orchestrator — wires everything together |

---

## 4. The Five Building Types

Each building represents a **persistent runtime concept**, never a line of code or AST node.

| Building | Trigger | Visual Shape | Colour Family |
|----------|---------|-------------|---------------|
| **Function (District)** | `CALL` event | Tapered square cylinder with a cap | Blue family `(X, X, 255)` |
| **Variable (House)** | `DECL` event | Box with a pointed roof | Cyan family `(X, 255, 255)` |
| **For-Loop (Factory)** | First `LOOP subtype=for` iteration | Hexagonal cylinder with chimney | Yellow family `(255, 255, X)` |
| **While-Loop (Factory)** | First `LOOP subtype=while` iteration | Same shape, different colour | Green family `(X, 255, X)` |
| **Branch (Intersection)** | `CONDITION` event | Pointed diamond with true/false road indicators | Magenta family `(255, X, 255)` |

The `X` channel in each colour is determined by an FNV-1a hash of the entity's identifying name, so the same function always gets the same colour.

---

## 5. The Spiral

- Buildings are placed along a **descending spiral** — slot 0 is at the top, the path winds outward and downward.
- Slots are assigned in **trace creation order** (interleaved by type), not grouped by type.
- A golden translucent tube connects all slots to show the flow of time.
- Config (in `SpiralConfig.js`): `radiusStart: 3`, `radiusGrowth: 0.1`, `angleStep: 0.95`, `heightStep: 0.05`.

### Sub-spirals (click-to-reveal)

- Clicking a container building (function, loop, branch) spawns a **sub-spiral** beneath it.
- Sub-spirals are **tall & narrow** (radius ≈ 0.8, growth ≈ 0.02, heightStep ≈ 0.55) — a tight helix descending straight down.
- Each dot on the sub-spiral is colour-coded by trace step type.
- Only one sub-spiral is visible at a time (click another building to swap, or click again / press Close to dismiss).

---

## 6. Current State & Known Limitations

### What works
- Full trace parsing and world-state simulation
- All five building types rendered with hash-based colours
- Buildings positioned in trace order along the spiral
- Click-to-inspect with HTML inspector panel
- On-demand sub-spiral rendering on click
- Material freezing, glow layer tuning, and other perf optimizations
- Dropdown to pick between small/medium/big test data files

### Known issues / limitations
- **Large traces (800+ events)** still create many meshes — sub-spirals with lots of children can lag. Thin-instancing or LOD would help.
- **No step-through animation** — the city is rendered fully at load time. There's no "play/pause/step" to watch it build up over time.
- **Memory layer is minimal** — shared-address lines are drawn but there's no rich pointer visualization.
- **No search or filter** — can't find a specific variable or function easily.
- **Camera doesn't auto-focus** on a clicked building or sub-spiral.
- **Labels are always hidden** until hover — could be smarter about showing important ones.
- **No export** — can't save the visualization as an image or video.

---

## 7. Technology Stack

| Layer | Tech |
|-------|------|
| 3D engine | Babylon.js (CDN, no bundler) |
| Language | Vanilla JavaScript (no framework, no build step) |
| Server | Python Flask (serves static files + JSON API) |
| Styling | Pure CSS with glassmorphism UI |
| Data | JSON trace files produced by an external C parser |

---

## 8. Feature Ideas to Brainstorm

Here are directions we're interested in exploring. Feel free to riff on these or propose entirely new ones.

### Visualization
- **Step-through playback**: animate the city building up one trace event at a time, with play/pause/speed controls and a timeline scrubber.
- **Recursive spiral nesting**: sub-spirals can themselves contain sub-spirals (a function calls another function → spiral inside spiral inside spiral).
- **Building growth animation**: buildings could "grow" taller as more events happen inside them (e.g., a loop factory gets taller with each iteration).
- **Particle effects**: data flowing between buildings as particles (e.g., a RETURN sends a glowing orb back to the caller).
- **Day/night cycle or "heat map" mode**: colour buildings by how "hot" they are (how many events touched them).
- **Collapse/expand districts**: group all buildings belonging to a function call into a single compound that can be expanded.

### Interaction
- **Search**: type a variable name or function name and the camera flies to it, highlighting the building.
- **Timeline scrubber**: a horizontal bar at the bottom that lets you scrub through the trace; the city rebuilds to that point.
- **Diff mode**: load two traces and highlight what changed (useful for comparing before/after a bug fix).
- **Minimap**: a small top-down 2D map in the corner showing the spiral and building positions.
- **Breadcrumb trail**: show the current call stack as a clickable breadcrumb bar.

### Data & Integration
- **Live tracing**: connect to a running C program via a socket and watch the city build in real-time.
- **Multi-language support**: accept traces from Python, Java, Rust, etc. (the JSON format is language-agnostic).
- **Source code panel**: show the original C source alongside the 3D view, highlighting the current line as you step through.
- **Trace diffing**: compare two traces side-by-side to spot behavioral differences.

### Performance
- **Thin instancing** for sub-spiral dots (one draw call per colour instead of one per dot).
- **Level of detail (LOD)**: simplify distant buildings to boxes, only show full geometry when close.
- **Occlusion culling**: skip rendering buildings behind the camera.
- **Web Worker parsing**: move trace parsing and world-state computation off the main thread.
- **Progressive rendering**: render the first N buildings immediately, then add the rest in batches.

### Polish
- **Themes**: dark/light, different colour palettes, wireframe mode.
- **Accessibility**: keyboard navigation, screen-reader descriptions of the city.
- **Export**: screenshot, video recording, or shareable 3D snapshot URL.
- **Onboarding**: a guided tour that explains what each building type means.
- **Sound design**: subtle audio cues when stepping through events (a chime for CALL, a click for ASSIGN, etc.).

---

## 9. File Tree

```
server.py                          # Flask dev server
mosiacs/
├── index.html                     # Main HTML (loads Babylon.js from CDN)
├── main.js                        # DOM setup, button wiring
├── parser.js                      # Trace JSON → step objects
├── styles.css                     # Glassmorphism UI styling
├── AGENTS.md                      # Detailed building-type rules for AI agents
├── README.md                      # Original readme
├── data/
│   ├── small_test_data.json       # 20 trace events  (simple program)
│   ├── test_data.json             # 895 trace events  (copy of big)
│   └── big_test_data.json         # 895 trace events  (10 functions)
└── visualizer/
    ├── index.js                   # CodeVisualizer orchestrator
    ├── SpiralConfig.js            # Spiral geometry constants
    ├── building/
    │   └── SpiralPathBuilder.js   # (legacy) standalone spiral builder
    ├── explode/
    │   └── ExplodeManager.js      # Click-to-inspect + sub-spiral trigger
    ├── scene/
    │   └── SceneManager.js        # Babylon engine, camera, lights, glow
    └── world/
        ├── CityRenderer.js        # Main render loop, slot assignment, building placement
        ├── ColorHash.js           # Deterministic hash-based colours
        ├── LabelHelper.js         # Billboard text labels via DynamicTexture
        ├── MeshFactory.js         # Geometry creation per building type
        ├── SubSpiralRenderer.js   # On-demand sub-spirals (tall & narrow)
        └── WorldState.js          # Runtime simulation state engine
```

---

## 10. How to Run

```bash
pip install flask
python server.py
# Open http://localhost:5000
```

Select a trace file from the dropdown and click **Load Trace**. Click any building to inspect it and see its sub-spiral.

---

*Last updated: 7 February 2026*
