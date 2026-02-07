/**
 * AnimationController - Handles animations for buildings and objects
 */
class AnimationController {
    constructor(scene) {
        this.scene = scene;
        this.isAnimating = true;
    }

    /**
     * Animate building appearance (scale in)
     */
    animateScaleIn(mesh, step, duration = 30) {
        mesh.scaling = new BABYLON.Vector3(0.01, 0.01, 0.01);
        BABYLON.Animation.CreateAndStartAnimation(
            `anim_${step}`,
            mesh,
            "scaling",
            60,
            duration,
            new BABYLON.Vector3(0.01, 0.01, 0.01),
            new BABYLON.Vector3(1, 1, 1),
            BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT
        );
    }

    /**
     * Add subtle floating animation to a mesh
     */
    addFloatingAnimation(mesh, step, floatAmount = 0.15) {
        const floatAnim = new BABYLON.Animation(
            `float_${step}`,
            "position.y",
            30,
            BABYLON.Animation.ANIMATIONTYPE_FLOAT,
            BABYLON.Animation.ANIMATIONLOOPMODE_CYCLE
        );
        const baseY = mesh.position.y;
        const keys = [
            { frame: 0, value: baseY },
            { frame: 60, value: baseY + floatAmount },
            { frame: 120, value: baseY }
        ];
        floatAnim.setKeys(keys);
        mesh.animations.push(floatAnim);
        this.scene.beginAnimation(mesh, 0, 120, true);
    }

    /**
     * Toggle animation state
     */
    toggleAnimation() {
        this.isAnimating = !this.isAnimating;
        return this.isAnimating;
    }

    /**
     * Get animation state
     */
    getAnimationState() {
        return this.isAnimating;
    }
}
