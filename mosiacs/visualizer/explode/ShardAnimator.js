/**
 * ShardAnimator - Animates shards between their start and target positions.
 *
 * Supports two modes:
 *   • Debug-column mode  – shards fly to a side column (camera-local space)
 *   • Ring mode           – shards explode outward in world space
 */
class ShardAnimator {
    constructor(scene, camera) {
        this.scene = scene;
        this.camera = camera;
    }

    /**
     * Animate an array of shards outward to their target positions.
     *
     * @param {Array}   shards
     * @param {boolean} debugColumnMode
     */
    animateShardsOut(shards, debugColumnMode) {
        shards.forEach((shard, i) => {
            if (debugColumnMode) {
                this._animateDebugColumn(shard, i);
            } else {
                this._animateRing(shard);
            }
        });
    }

    // ─── debug-column animation ─────────────────────────────────────

    _animateDebugColumn(shard, index) {
        const target = shard._targetPos;
        const start  = shard.position.clone();
        const layer  = shard._layer || 0;
        const frames = 40 + (layer * 5);

        // Position
        const posAnim = new BABYLON.Animation(
            'shardOut_' + shard.name,
            'position',
            60,
            BABYLON.Animation.ANIMATIONTYPE_VECTOR3,
            BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT
        );
        const ease = new BABYLON.CubicEase();
        ease.setEasingMode(BABYLON.EasingFunction.EASINGMODE_EASEOUT);
        posAnim.setEasingFunction(ease);
        posAnim.setKeys([
            { frame: 0, value: start },
            { frame: frames, value: target }
        ]);

        // Subtle rotation
        const rotAnim = new BABYLON.Animation(
            'shardRotate_' + shard.name,
            'rotation.z',
            60,
            BABYLON.Animation.ANIMATIONTYPE_FLOAT,
            BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT
        );
        rotAnim.setKeys([
            { frame: 0, value: 0 },
            { frame: frames, value: (Math.random() - 0.5) * 0.3 }
        ]);

        shard.animations = [posAnim, rotAnim];
        this.scene.beginAnimation(shard, 0, frames, false);
    }

    // ─── ring-explosion animation ───────────────────────────────────

    _animateRing(shard) {
        const target = shard._targetPos;
        const start  = shard.position.clone();
        const layer  = shard._layer || 0;
        const frames = 30 + (layer * 10);

        // Position
        const posAnim = new BABYLON.Animation(
            'shardOut_' + shard.name,
            'position',
            60,
            BABYLON.Animation.ANIMATIONTYPE_VECTOR3,
            BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT
        );
        const ease = new BABYLON.CubicEase();
        ease.setEasingMode(BABYLON.EasingFunction.EASINGMODE_EASEOUT);
        posAnim.setEasingFunction(ease);
        posAnim.setKeys([
            { frame: 0, value: start },
            { frame: frames, value: target }
        ]);

        // Tumble rotation
        const rotAnim = new BABYLON.Animation(
            'shardRotate_' + shard.name,
            'rotation.y',
            60,
            BABYLON.Animation.ANIMATIONTYPE_FLOAT,
            BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT
        );
        const startRot = shard.rotation.y;
        rotAnim.setKeys([
            { frame: 0, value: startRot },
            { frame: frames, value: startRot + ((Math.random() - 0.5) * Math.PI * 2) }
        ]);

        shard.animations = [posAnim, rotAnim];
        this.scene.beginAnimation(shard, 0, frames, false);
    }
}
