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
     *   CALL     — tallest & widest (function entry, the "cathedral tower")
     *   RETURN   — tall but narrower (function exit, the "capstone")
     *   LOOP     — medium-large (loop structure, repeating motif)
     *   IF/ELSE  — medium (branching decisions)
     *   DECL     — medium-small (variable birth)
     *   ASSIGN   — smallest (incremental change, builds off parent)
     */
    getShapeProfile(type) {
        const profiles = {
            'CALL': {
                heightMin: 4.0, heightMax: 5.5,
                topWidthMin: 0.4, topWidthMax: 0.6,    // Much narrower top
                bottomWidthMin: 2.2, bottomWidthMax: 3.0, // Much wider base
                depthMin: 1.8, depthMax: 2.4,
                shape: 'trapezoidTower' // wide base, narrow top — grand tower
            },
            'RETURN': {
                heightMin: 3.0, heightMax: 4.0,
                topWidthMin: 1.2, topWidthMax: 1.6,    // Wide top
                bottomWidthMin: 0.6, bottomWidthMax: 0.8, // Narrow base
                depthMin: 1.2, depthMax: 1.6,
                shape: 'invertedTrapezoid' // narrow base, wide top — capstone
            },
            'LOOP': {
                heightMin: 2.5, heightMax: 3.5,
                topWidthMin: 0.4, topWidthMax: 0.6,
                bottomWidthMin: 1.6, bottomWidthMax: 2.2,
                depthMin: 1.4, depthMax: 1.8,
                shape: 'trapezoidWide' // wide and squat — repeating block
            },
            'IF': {
                heightMin: 2.0, heightMax: 3.0,
                topWidthMin: 0.3, topWidthMax: 0.5,
                bottomWidthMin: 1.2, bottomWidthMax: 1.6,
                depthMin: 1.0, depthMax: 1.4,
                shape: 'trapezoidAngled' // asymmetric trapezoid — decision
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
     * Build a trapezoid mesh from a shape profile.
     * Uses per-face vertices (24 total) so each face gets correct flat normals.
     * The shape tapers from a wider bottom to a narrower top (or inverted).
     * Both X-width AND Z-depth taper, creating a true truncated pyramid / trapezoid prism.
     */
    createTrapezoidMesh(name, profile) {
        const h = this._rand(profile.heightMin, profile.heightMax);
        const tw = this._rand(profile.topWidthMin, profile.topWidthMax);
        const bw = this._rand(profile.bottomWidthMin, profile.bottomWidthMax);
        const d = this._rand(profile.depthMin, profile.depthMax);

        // For inverted trapezoid, swap top and bottom
        let topW, botW, topD, botD;
        if (profile.shape === 'invertedTrapezoid') {
            topW = bw;  
            botW = tw;  
            topD = d;
            botD = d * (botW / topW); // scale depth proportionally
        } else {
            topW = tw;  
            botW = bw;  
            // Make depth taper similarly to width for true trapezoid shape
            topD = d * 0.6; // top depth is proportionally smaller
            botD = d;
        }

        const tw2 = topW / 2, bw2 = botW / 2;
        const td2 = topD / 2, bd2 = botD / 2;

        // 8 corner positions of the frustum
        // Bottom (y=0)
        const b0 = [-bw2, 0,  bd2]; // bottom-left-front
        const b1 = [ bw2, 0,  bd2]; // bottom-right-front
        const b2 = [ bw2, 0, -bd2]; // bottom-right-back
        const b3 = [-bw2, 0, -bd2]; // bottom-left-back
        // Top (y=h)
        const t0 = [-tw2, h,  td2]; // top-left-front
        const t1 = [ tw2, h,  td2]; // top-right-front
        const t2 = [ tw2, h, -td2]; // top-right-back
        const t3 = [-tw2, h, -td2]; // top-left-back

        // Per-face vertices (4 verts × 6 faces = 24 vertices)
        // Each face duplicates its corner positions so normals are independent
        const positions = [
            // Front face (z positive)
            ...b0, ...b1, ...t1, ...t0,
            // Back face (z negative)
            ...b2, ...b3, ...t3, ...t2,
            // Right face (x positive)
            ...b1, ...b2, ...t2, ...t1,
            // Left face (x negative)
            ...b3, ...b0, ...t0, ...t3,
            // Top face (y = h)
            ...t0, ...t1, ...t2, ...t3,
            // Bottom face (y = 0)
            ...b3, ...b2, ...b1, ...b0,
        ];

        // Two triangles per face: 0,1,2 and 0,2,3
        const indices = [];
        for (let face = 0; face < 6; face++) {
            const off = face * 4;
            indices.push(off, off + 1, off + 2, off, off + 2, off + 3);
        }

        // Compute proper per-face normals
        const normals = [];
        BABYLON.VertexData.ComputeNormals(positions, indices, normals);

        // UVs per face
        const uvs = [];
        for (let face = 0; face < 6; face++) {
            uvs.push(0, 0,  1, 0,  1, 1,  0, 1);
        }

        const vertexData = new BABYLON.VertexData();
        vertexData.positions = positions;
        vertexData.indices = indices;
        vertexData.normals = normals;
        vertexData.uvs = uvs;

        const mesh = new BABYLON.Mesh(name, this.scene);
        vertexData.applyToMesh(mesh);

        mesh._trapHeight = h;
        mesh._trapTopWidth = topW;
        mesh._trapBottomWidth = botW;

        return mesh;
    }
}
