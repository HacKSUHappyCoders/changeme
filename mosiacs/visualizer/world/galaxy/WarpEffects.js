/**
 * WarpEffects — Creates visual effects for galaxy warps
 *
 * Handles:
 * - Warp lines (connecting source to galaxy)
 * - Warp particles (traveling along warp lines)
 * - Source glow rings
 * - Galaxy labels
 */
class WarpEffects {
    constructor(scene, labelHelper) {
        this.scene = scene;
        this.labelHelper = labelHelper;
        
        // Current effect instances
        this._warpLine = null;
        this._warpLineMat = null;
        this._warpParticles = [];
        this._warpParticleSharedMat = null;
        this._sourceGlow = null;
        this._galaxyLabel = null;
    }

    /**
     * Create animated warp line connecting source to galaxy
     */
    createWarpLine(from, to, color) {
        this.disposeWarpLine();

        // Create curved path (catenary-like arc)
        const mid = BABYLON.Vector3.Lerp(from, to, 0.5);
        mid.y += 25;

        const pathPoints = [];
        const segments = 30;
        for (let i = 0; i <= segments; i++) {
            const t = i / segments;
            const p = new BABYLON.Vector3(
                (1 - t) * (1 - t) * from.x + 2 * (1 - t) * t * mid.x + t * t * to.x,
                (1 - t) * (1 - t) * from.y + 2 * (1 - t) * t * mid.y + t * t * to.y,
                (1 - t) * (1 - t) * from.z + 2 * (1 - t) * t * mid.z + t * t * to.z,
            );
            pathPoints.push(p);
        }

        // Create tube with varying radius
        const radiusFunction = (i, distance) => {
            const t = i / segments;
            return 0.15 + 0.25 * Math.sin(t * Math.PI);
        };

        this._warpLine = BABYLON.MeshBuilder.CreateTube('warpLine', {
            path: pathPoints,
            radiusFunction,
            sideOrientation: BABYLON.Mesh.DOUBLESIDE,
            tessellation: 8
        }, this.scene);

        // Animated material
        const mat = new BABYLON.StandardMaterial('warpLineMat', this.scene);
        mat.emissiveColor = new BABYLON.Color3(
            color.r * 0.8, color.g * 0.8, color.b * 0.8
        );
        mat.diffuseColor = new BABYLON.Color3(color.r, color.g, color.b);
        mat.alpha = 0.7;
        mat.backFaceCulling = false;
        this._warpLine.material = mat;
        this._warpLine.isPickable = false;
        this._warpLine.freezeWorldMatrix();
        this._warpLineMat = mat;

        // Animate emissive color pulse
        const colorAnim = new BABYLON.Animation(
            'warpColorPulse', 'material.emissiveColor', 30,
            BABYLON.Animation.ANIMATIONTYPE_COLOR3,
            BABYLON.Animation.ANIMATIONLOOPMODE_CYCLE
        );
        const c = color;
        colorAnim.setKeys([
            { frame: 0, value: new BABYLON.Color3(c.r * 0.5, c.g * 0.5, c.b * 0.5) },
            { frame: 30, value: new BABYLON.Color3(
                Math.min(c.r * 1.2, 1), Math.min(c.g * 1.2, 1), Math.min(c.b * 1.2, 1)
            )},
            { frame: 60, value: new BABYLON.Color3(c.r * 0.5, c.g * 0.5, c.b * 0.5) },
        ]);
        this.scene.beginDirectAnimation(this._warpLine, [colorAnim], 0, 60, true);

        // Create particles
        this.createWarpParticles(pathPoints, color);
    }

    /**
     * Create glowing particles traveling along warp line
     */
    createWarpParticles(pathPoints, color) {
        this.disposeWarpParticles();

        const numParticles = 4;

        // Shared material for performance
        const sharedMat = new BABYLON.StandardMaterial('warpParticleSharedMat', this.scene);
        sharedMat.emissiveColor = new BABYLON.Color3(
            Math.min(color.r * 1.1, 1),
            Math.min(color.g * 1.1, 1),
            Math.min(color.b * 1.1, 1)
        );
        sharedMat.alpha = 0.85;
        sharedMat.freeze();
        this._warpParticleSharedMat = sharedMat;

        for (let p = 0; p < numParticles; p++) {
            const sphere = BABYLON.MeshBuilder.CreateSphere(
                `warpParticle_${p}`,
                { diameter: 0.4, segments: 4 },
                this.scene
            );
            sphere.material = sharedMat;
            sphere.isPickable = false;

            // Animate along path
            const posAnim = new BABYLON.Animation(
                `warpParticlePos_${p}`, 'position', 20,
                BABYLON.Animation.ANIMATIONTYPE_VECTOR3,
                BABYLON.Animation.ANIMATIONLOOPMODE_CYCLE
            );
            const keys = [];
            const totalFrames = 80;
            for (let i = 0; i <= totalFrames; i += 2) {
                const rawT = (i / totalFrames + p / numParticles) % 1.0;
                const pathIdx = Math.floor(rawT * (pathPoints.length - 1));
                keys.push({ frame: i, value: pathPoints[pathIdx].clone() });
            }
            posAnim.setKeys(keys);
            this.scene.beginDirectAnimation(sphere, [posAnim], 0, totalFrames, true);

            this._warpParticles.push(sphere);
        }
    }

    /**
     * Create glowing ring around source building
     */
    createSourceGlow(pos, color) {
        this.disposeSourceGlow();

        const ring = BABYLON.MeshBuilder.CreateTorus('sourceGlow', {
            diameter: 5,
            thickness: 0.3,
            tessellation: 16
        }, this.scene);
        ring.position = pos.clone();
        ring.position.y -= 0.2;

        const mat = new BABYLON.StandardMaterial('sourceGlowMat', this.scene);
        mat.emissiveColor = new BABYLON.Color3(color.r, color.g, color.b);
        mat.diffuseColor = new BABYLON.Color3(0, 0, 0);
        mat.alpha = 0.7;
        ring.material = mat;
        ring.isPickable = false;

        // Rotate animation
        const rotAnim = new BABYLON.Animation(
            'sourceGlowRot', 'rotation.y', 30,
            BABYLON.Animation.ANIMATIONTYPE_FLOAT,
            BABYLON.Animation.ANIMATIONLOOPMODE_CYCLE
        );
        rotAnim.setKeys([
            { frame: 0, value: 0 },
            { frame: 120, value: Math.PI * 2 }
        ]);
        this.scene.beginDirectAnimation(ring, [rotAnim], 0, 120, true);

        // Pulse animation
        const pulseAnim = new BABYLON.Animation(
            'sourceGlowPulse', 'material.alpha', 30,
            BABYLON.Animation.ANIMATIONTYPE_FLOAT,
            BABYLON.Animation.ANIMATIONLOOPMODE_CYCLE
        );
        pulseAnim.setKeys([
            { frame: 0, value: 0.5 },
            { frame: 30, value: 0.8 },
            { frame: 60, value: 0.5 }
        ]);
        this.scene.beginDirectAnimation(ring, [pulseAnim], 0, 60, true);

        this._sourceGlow = ring;
    }

    /**
     * Create floating label for galaxy
     */
    createGalaxyLabel(center, entity) {
        if (this._galaxyLabel) {
            if (this._galaxyLabel.material) {
                if (this._galaxyLabel.material.diffuseTexture) {
                    this._galaxyLabel.material.diffuseTexture.dispose();
                }
                this._galaxyLabel.material.dispose();
            }
            this._galaxyLabel.dispose();
            this._galaxyLabel = null;
        }

        const name = entity.name || entity.condition || entity.key || 'Galaxy';
        const text = `✦ ${name} Galaxy ✦`;
        const color = { r: 1.0, g: 0.9, b: 0.3, a: 1.0 };

        const label = this.labelHelper.create(
            'galaxyLabel',
            text,
            center.clone(),
            12,
            color,
            1.2
        );
        label.isVisible = true;
        label.isPickable = false;

        this._galaxyLabel = label;
    }

    /**
     * Dim warp visuals (for stacked galaxies)
     */
    dimVisuals(alpha) {
        if (this._warpLine && !this._warpLine.isDisposed() && this._warpLine.material) {
            if (this._warpLine.material.isFrozen) this._warpLine.material.unfreeze();
            this._warpLine.material.alpha *= alpha;
        }
        if (this._warpParticles) {
            for (const p of this._warpParticles) {
                if (p && !p.isDisposed() && p.material) {
                    if (p.material.isFrozen) p.material.unfreeze();
                    p.material.alpha *= alpha;
                }
            }
        }
        if (this._sourceGlow && !this._sourceGlow.isDisposed() && this._sourceGlow.material) {
            if (this._sourceGlow.material.isFrozen) this._sourceGlow.material.unfreeze();
            this._sourceGlow.material.alpha *= alpha;
        }
    }

    /**
     * Restore warp visuals to full opacity
     */
    restoreVisuals() {
        if (this._warpLine && !this._warpLine.isDisposed() && this._warpLine.material) {
            if (this._warpLine.material.isFrozen) this._warpLine.material.unfreeze();
            this._warpLine.material.alpha = 0.7;
        }
        if (this._warpParticles) {
            for (const p of this._warpParticles) {
                if (p && !p.isDisposed() && p.material) {
                    if (p.material.isFrozen) p.material.unfreeze();
                    p.material.alpha = 0.85;
                }
            }
        }
        if (this._sourceGlow && !this._sourceGlow.isDisposed() && this._sourceGlow.material) {
            if (this._sourceGlow.material.isFrozen) this._sourceGlow.material.unfreeze();
            this._sourceGlow.material.alpha = 0.7;
        }
    }

    /**
     * Get current effect instances for storage/restoration
     */
    getEffects() {
        return {
            warpLine: this._warpLine,
            warpLineMat: this._warpLineMat,
            warpParticles: [...this._warpParticles],
            warpParticleSharedMat: this._warpParticleSharedMat,
            sourceGlow: this._sourceGlow,
            galaxyLabel: this._galaxyLabel
        };
    }

    /**
     * Dispose warp line
     */
    disposeWarpLine() {
        if (this._warpLine) {
            this.scene.stopAnimation(this._warpLine);
            if (this._warpLine.material) this._warpLine.material.dispose();
            this._warpLine.dispose();
            this._warpLine = null;
            this._warpLineMat = null;
        }
        this.disposeWarpParticles();
    }

    /**
     * Dispose warp particles
     */
    disposeWarpParticles() {
        for (const p of this._warpParticles) {
            if (p && !p.isDisposed()) {
                this.scene.stopAnimation(p);
                p.material = null;
                p.dispose();
            }
        }
        this._warpParticles = [];

        if (this._warpParticleSharedMat) {
            this._warpParticleSharedMat.dispose();
            this._warpParticleSharedMat = null;
        }
    }

    /**
     * Dispose source glow
     */
    disposeSourceGlow() {
        if (this._sourceGlow) {
            this.scene.stopAnimation(this._sourceGlow);
            if (this._sourceGlow.material) this._sourceGlow.material.dispose();
            this._sourceGlow.dispose();
            this._sourceGlow = null;
        }
    }

    /**
     * Dispose all effects
     */
    disposeAll() {
        this.disposeWarpLine();
        this.disposeSourceGlow();
        
        if (this._galaxyLabel) {
            this.scene.stopAnimation(this._galaxyLabel);
            if (this._galaxyLabel.material) {
                if (this._galaxyLabel.material.diffuseTexture) {
                    this._galaxyLabel.material.diffuseTexture.dispose();
                }
                this._galaxyLabel.material.dispose();
            }
            this._galaxyLabel.dispose();
            this._galaxyLabel = null;
        }
    }
}
