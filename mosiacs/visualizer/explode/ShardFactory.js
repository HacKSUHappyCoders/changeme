/**
 * ShardFactory - Creates individual shard meshes with dynamic-texture labels.
 *
 * Responsible for:
 *   • Building the Box mesh at the right size
 *   • Calculating the target position (debug-column vs ring mode)
 *   • Rendering the dynamic-texture label (background, border, word-wrapped text)
 *   • Optionally parenting the shard to the camera (debug mode)
 */
class ShardFactory {
    constructor(scene, camera) {
        this.scene = scene;
        this.camera = camera;
    }

    /**
     * Create a single shard – a flat panel with a dynamic-texture label.
     *
     * @param {string}  name
     * @param {string}  label       - text displayed on the shard face
     * @param {Vector3} center      - world-space center of the building
     * @param {number}  index       - position in the list (0 = header)
     * @param {number}  total       - total shard count
     * @param {number}  buildingH   - height of the original building
     * @param {object}  color       - {r, g, b, a}
     * @param {boolean} isHeader
     * @param {number}  layer       - 0=inner, 1=middle, 2=outer
     * @param {Vector3} cameraDir   - direction from building to camera
     * @param {boolean} debugColumnMode - true → column layout, false → ring layout
     */
    createShard(name, label, center, index, total, buildingH, color, isHeader, layer, cameraDir, debugColumnMode) {
        // Shard dimensions
        const w = isHeader ? 3.5 : (2.5 - layer * 0.2);
        const h = isHeader ? 1.8 : (1.3 - layer * 0.15);
        const depth = 0.15;

        const shard = BABYLON.MeshBuilder.CreateBox(
            name,
            { width: w, height: h, depth: depth },
            this.scene
        );

        // ── target position ─────────────────────────────────────────
        const targetPos = debugColumnMode
            ? this._calcDebugColumnTarget(index, total, center, buildingH)
            : this._calcRingTarget(index, total, layer, center, buildingH);

        // Start at the building centre
        shard.position = center.clone();
        shard.position.y += buildingH * 0.5;

        shard._targetPos = targetPos;

        // Billboard mode – always face camera
        shard.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;

        // ── material + dynamic texture ──────────────────────────────
        this._applyLabelMaterial(shard, name, label, color, isHeader, layer);

        shard._isHeader = isHeader;
        shard._layer = layer;

        return shard;
    }

    // ─── positioning strategies ─────────────────────────────────────

    /**
     * Debug-column layout: arrange shards in a vertical column next to
     * the building in world space.  The column is offset to the side and
     * scaled so that all shards fit within a reasonable viewport height.
     */
    _calcDebugColumnTarget(index, total, center, buildingH) {
        // Maximum world-space height we want the column to occupy
        const maxColumnHeight = 14;

        // Compute spacing so the column fits within maxColumnHeight
        const defaultSpacing = 1.8;
        const verticalSpacing = total > 1
            ? Math.min(defaultSpacing, maxColumnHeight / (total - 1))
            : defaultSpacing;

        // Column centre sits beside the building
        const rightOffset = 6;
        const columnCenterY = center.y + buildingH * 0.5;

        // Top-to-bottom arrangement centred on the building
        const totalColumnHeight = (total - 1) * verticalSpacing;
        const topY = columnCenterY + totalColumnHeight / 2;
        const ty = topY - index * verticalSpacing;

        return new BABYLON.Vector3(
            center.x + rightOffset,
            ty,
            center.z
        );
    }

    /**
     * Ring layout: arrange shards in concentric rings around the building.
     */
    _calcRingTarget(index, total, layer, center, buildingH) {
        const baseRingRadius = 3.5 + total * 0.1;
        const ringRadius = baseRingRadius + (layer * 2.0);

        const angle = (index / total) * Math.PI * 2;
        const tx = center.x + Math.cos(angle) * ringRadius;
        const tz = center.z + Math.sin(angle) * ringRadius;
        const ty = center.y + buildingH * 0.5 + (index % 4) * 0.4 + (layer * 0.25);

        return new BABYLON.Vector3(tx, ty, tz);
    }

    // ─── material / texture ─────────────────────────────────────────

    /**
     * Create a StandardMaterial with a DynamicTexture label and apply it.
     */
    _applyLabelMaterial(shard, name, label, color, isHeader, layer) {
        const mat = new BABYLON.StandardMaterial(name + '_mat', this.scene);
        const texSize = 512;
        const dynTex = new BABYLON.DynamicTexture(name + '_tex', texSize, this.scene, false);
        const ctx = dynTex.getContext();

        // Background – translucent shard colour
        ctx.fillStyle = `rgba(${Math.floor(color.r * 255)}, ${Math.floor(color.g * 255)}, ${Math.floor(color.b * 255)}, 0.85)`;
        ctx.fillRect(0, 0, texSize, texSize);

        // Border
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 6;
        ctx.strokeRect(8, 8, texSize - 16, texSize - 16);

        // Text
        ctx.fillStyle = '#ffffff';
        ctx.font = isHeader ? 'bold 42px monospace' : `bold ${layer === 2 ? '28px' : '34px'} monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        const lines = ShardFactory._wrapText(ctx, label, texSize - 40);
        const lineH = isHeader ? 50 : (layer === 2 ? 35 : 40);
        const startY = texSize / 2 - ((lines.length - 1) * lineH) / 2;
        lines.forEach((line, li) => {
            ctx.fillText(line, texSize / 2, startY + li * lineH);
        });

        dynTex.update();
        mat.diffuseTexture = dynTex;
        mat.emissiveColor = new BABYLON.Color3(color.r * 0.25, color.g * 0.25, color.b * 0.25);
        mat.alpha = color.a || 0.9;
        mat.backFaceCulling = false;

        shard.material = mat;
    }

    /**
     * Simple word-wrap helper for canvas 2-D context.
     */
    static _wrapText(ctx, text, maxWidth) {
        const words = text.split(' ');
        const lines = [];
        let cur = '';
        words.forEach(w => {
            const test = cur ? cur + ' ' + w : w;
            if (ctx.measureText(test).width > maxWidth && cur) {
                lines.push(cur);
                cur = w;
            } else {
                cur = test;
            }
        });
        if (cur) lines.push(cur);
        return lines.length ? lines : [text];
    }
}
