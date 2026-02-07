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
        const planeSize = 3 * scale;
        const plane = BABYLON.MeshBuilder.CreatePlane(name, {
            width: planeSize, height: planeSize * 0.5
        }, this.scene);
        plane.position = pos.clone();
        plane.position.y += yOffset;
        plane.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;

        const texW = 512;
        const texH = 256;
        const dynTex = new BABYLON.DynamicTexture(
            name + '_tex', { width: texW, height: texH }, this.scene, false
        );

        this._drawTexture(dynTex, text, color, texW, texH);

        const mat = new BABYLON.StandardMaterial(name + '_mat', this.scene);
        mat.diffuseTexture = dynTex;
        mat.emissiveColor = new BABYLON.Color3(
            color.r * 0.2, color.g * 0.2, color.b * 0.2
        );
        mat.alpha = color.a || 0.85;
        mat.backFaceCulling = false;
        plane.material = mat;

        plane._dynTex = dynTex;
        plane._labelColor = color;
        return plane;
    }

    /**
     * Update the text on an existing label plane.
     */
    update(plane, text) {
        if (!plane || !plane._dynTex) return;
        this._drawTexture(
            plane._dynTex, text, plane._labelColor, 512, 256
        );
    }

    // ─── internal ──────────────────────────────────────────────────

    _drawTexture(dynTex, text, color, texW, texH) {
        const ctx = dynTex.getContext();
        ctx.clearRect(0, 0, texW, texH);

        // Background
        ctx.fillStyle = `rgba(${Math.floor(color.r * 200)}, ${Math.floor(color.g * 200)}, ${Math.floor(color.b * 200)}, 0.75)`;
        ctx.fillRect(0, 0, texW, texH);

        // Border
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 4;
        ctx.strokeRect(4, 4, texW - 8, texH - 8);

        // Text
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 36px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        const lines = this._wrapText(ctx, text, texW - 40);
        const lineH = 42;
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
