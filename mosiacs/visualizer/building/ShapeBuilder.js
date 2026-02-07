/**
 * ShapeBuilder - Creates trapezoid meshes for buildings
 */
class ShapeBuilder {
    constructor(scene) {
        this.scene = scene;
    }

    /**
     * Get the shape profile (size/height) for each operation type.
     * 
     * Hierarchy (biggest → smallest):
     *   CALL      — tallest & widest (function entry, the "cathedral tower")
     *   RETURN    — tall but narrower (function exit, the "capstone")
     *   LOOP      — medium-large (loop structure, repeating motif)
     *   CONDITION — medium (evaluation of a predicate)
     *   BRANCH    — medium (branch taken — if/else path)
     *   IF/ELSE   — medium (legacy branching decisions)
     *   DECL      — medium-small (variable birth)
     *   ASSIGN    — smallest (incremental change, builds off parent)
     */
    getShapeProfile(type) {
        const profiles = {
            'CALL': {
                heightMin: 4.0, heightMax: 5.5,
                topWidthMin: 0.4, topWidthMax: 0.6,
                bottomWidthMin: 2.2, bottomWidthMax: 3.0,
                depthMin: 1.8, depthMax: 2.4,
                shape: 'trapezoidTower'
            },
            'RETURN': {
                heightMin: 3.0, heightMax: 4.0,
                topWidthMin: 1.2, topWidthMax: 1.6,
                bottomWidthMin: 0.6, bottomWidthMax: 0.8,
                depthMin: 1.2, depthMax: 1.6,
                shape: 'invertedTrapezoid'
            },
            'LOOP': {
                heightMin: 2.5, heightMax: 3.5,
                topWidthMin: 0.4, topWidthMax: 0.6,
                bottomWidthMin: 1.6, bottomWidthMax: 2.2,
                depthMin: 1.4, depthMax: 1.8,
                shape: 'trapezoidWide'
            },
            'CONDITION': {
                heightMin: 2.0, heightMax: 3.0,
                topWidthMin: 0.3, topWidthMax: 0.5,
                bottomWidthMin: 1.2, bottomWidthMax: 1.6,
                depthMin: 1.0, depthMax: 1.4,
                shape: 'trapezoidAngled'
            },
            'BRANCH': {
                heightMin: 1.8, heightMax: 2.8,
                topWidthMin: 0.3, topWidthMax: 0.5,
                bottomWidthMin: 1.2, bottomWidthMax: 1.6,
                depthMin: 1.0, depthMax: 1.4,
                shape: 'trapezoidAngled'
            },
            'IF': {
                heightMin: 2.0, heightMax: 3.0,
                topWidthMin: 0.3, topWidthMax: 0.5,
                bottomWidthMin: 1.2, bottomWidthMax: 1.6,
                depthMin: 1.0, depthMax: 1.4,
                shape: 'trapezoidAngled'
            },
            'ELSE': {
                heightMin: 1.8, heightMax: 2.8,
                topWidthMin: 0.3, topWidthMax: 0.5,
                bottomWidthMin: 1.2, bottomWidthMax: 1.6,
                depthMin: 1.0, depthMax: 1.4,
                shape: 'trapezoidAngled'
            },
            'DECL': {
                heightMin: 1.5, heightMax: 2.5,
                topWidthMin: 0.3, topWidthMax: 0.5,
                bottomWidthMin: 1.0, bottomWidthMax: 1.4,
                depthMin: 0.8, depthMax: 1.2,
                shape: 'trapezoidSlim' // slim trapezoid — declaration marker
            },
            'ASSIGN': {
                heightMin: 1.0, heightMax: 1.8,
                topWidthMin: 0.2, topWidthMax: 0.4,
                bottomWidthMin: 0.8, bottomWidthMax: 1.2,
                depthMin: 0.6, depthMax: 1.0,
                shape: 'trapezoidSmall' // smallest — incremental change
            },
            'DEFAULT': {
                heightMin: 1.2, heightMax: 2.0,
                topWidthMin: 0.3, topWidthMax: 0.5,
                bottomWidthMin: 0.9, bottomWidthMax: 1.3,
                depthMin: 0.7, depthMax: 1.1,
                shape: 'trapezoidSlim'
            }
        };
        return profiles[type] || profiles['DEFAULT'];
    }

    /**
     * Helper: random float in range
     */
    _rand(min, max) {
        return min + Math.random() * (max - min);
    }

    /**
     * Build a trapezoid (frustum) mesh from a shape profile.
     * 
     * Uses Babylon's CreateCylinder with tessellation=4 to produce a square-
     * cross-section frustum that tapers from a wider bottom to a narrower top
     * (or inverted).  The cylinder is created centered at the origin, then we
     * shift it UP by half its height so y=0 is the bottom face — this lets us
     * place the mesh directly on the spiral path point and have it rise upward
     * like a building sitting on a street.
     */
    createTrapezoidMesh(name, profile) {
        const h = this._rand(profile.heightMin, profile.heightMax);
        const tw = this._rand(profile.topWidthMin, profile.topWidthMax);
        const bw = this._rand(profile.bottomWidthMin, profile.bottomWidthMax);

        // For inverted trapezoid, swap top and bottom
        let topW, botW;
        if (profile.shape === 'invertedTrapezoid') {
            topW = bw;
            botW = tw;
        } else {
            topW = tw;
            botW = bw;
        }

        console.log(`Creating ${name}: shape=${profile.shape}, topW=${topW.toFixed(2)}, botW=${botW.toFixed(2)}, h=${h.toFixed(2)}`);

        // tessellation = 4 → square cross-section (building-like)
        // Using diameterTop / diameterBottom to get the taper
        const mesh = BABYLON.MeshBuilder.CreateCylinder(
            name,
            {
                height: h,
                diameterTop: topW,
                diameterBottom: botW,
                tessellation: 4,       // square footprint
                subdivisions: 1
            },
            this.scene
        );

        // Babylon creates the cylinder centered at y=0 with no rotation.
        // We want:
        //   1. Rotate 45° so the flat faces align to world X/Z axes
        //   2. Shift up by h/2 so the BASE sits at y=0 (building rises upward)
        // Bake both transforms into the vertex data so position/rotation stay clean.
        const bakeMatrix = BABYLON.Matrix.RotationY(Math.PI / 4)
            .multiply(BABYLON.Matrix.Translation(0, h / 2, 0));
        mesh.bakeTransformIntoVertices(bakeMatrix);

        // Store dimensions for cap placement and stacking
        mesh._trapHeight = h;
        mesh._trapTopWidth = topW;
        mesh._trapBottomWidth = botW;

        return mesh;
    }
}
