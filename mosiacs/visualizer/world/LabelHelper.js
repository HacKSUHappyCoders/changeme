/**
 * LabelHelper — Creates and updates billboard floating labels
 * using Babylon.js DynamicTexture on a plane mesh.
 */
class LabelHelper {
    constructor(scene) {
        this.scene = scene;
    }

    /**
     * Create a floating billboard label at the given position.
     *
     * @param {string}  name    – unique mesh name
     * @param {string}  text    – label text (word-wrapped)
     * @param {BABYLON.Vector3} pos – base position
     * @param {number}  yOffset – extra Y above pos
     * @param {{r,g,b,a}} color – label colour
     * @param {number}  [scale=1]
     * @returns {BABYLON.Mesh} The label plane (with _dynTex and _labelColor)
     */
    create(name, text, pos, yOffset, color, scale) {
        scale = scale || 1;
        // Increased label size for better visibility
        const planeSize = 4.5 * scale;
        const plane = BABYLON.MeshBuilder.CreatePlane(name, {
            width: planeSize, height: planeSize * 0.5
        }, this.scene);
        plane.position = pos.clone();
        plane.position.y += yOffset;
        plane.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;

        // High resolution texture for crisp text
        const texW = 768;
        const texH = 384;
        const dynTex = new BABYLON.DynamicTexture(
            name + '_tex', { width: texW, height: texH }, this.scene, false
        );

        this._drawTexture(dynTex, text, color, texW, texH);

        const mat = new BABYLON.StandardMaterial(name + '_mat', this.scene);
        mat.diffuseTexture = dynTex;
        mat.diffuseTexture.hasAlpha = true;
        // Minimal emissive - just enough to see the text
        mat.emissiveColor = new BABYLON.Color3(0.05, 0.05, 0.05);
        mat.opacityTexture = dynTex;
        mat.backFaceCulling = false;
        plane.material = mat;

        plane._dynTex = dynTex;
        plane._labelColor = color;
        plane.isVisible = false;  // Hidden by default, shown on hover
        return plane;
    }

    /**
     * Update the text on an existing label plane.
     */
    update(plane, text) {
        if (!plane || !plane._dynTex) return;
        this._drawTexture(
            plane._dynTex, text, plane._labelColor, 768, 384
        );
    }

    // ─── internal ──────────────────────────────────────────────────

    _drawTexture(dynTex, text, color, texW, texH) {
        const ctx = dynTex.getContext();
        ctx.clearRect(0, 0, texW, texH);

        // Background with semi-transparent dark box
        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.fillRect(0, 0, texW, texH);

        // Border for better definition
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 8;
        ctx.strokeRect(8, 8, texW - 16, texH - 16);

        // Even larger text for better visibility
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 100px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        const lines = this._wrapText(ctx, text, texW - 100);
        const lineH = 110;
        const startY = texH / 2 - ((lines.length - 1) * lineH) / 2;
        
        lines.forEach((line, i) => {
            ctx.fillText(line, texW / 2, startY + i * lineH);
        });

        dynTex.update();
    }

    _wrapText(ctx, text, maxWidth) {
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
        return lines;
    }
}
