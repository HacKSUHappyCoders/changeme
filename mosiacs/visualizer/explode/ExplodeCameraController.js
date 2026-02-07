/**
 * ExplodeCameraController - Manages camera transitions for the explode feature.
 *
 * Saves / restores the ArcRotateCamera state and smoothly animates it
 * to face the shattered building (ring mode only; debug-column mode
 * leaves the camera untouched).
 */
class ExplodeCameraController {
    constructor(camera) {
        this.camera = camera;

        /** Saved state so we can restore on collapse */
        this.savedCamera = null;
    }

    // ─── public API ─────────────────────────────────────────────────

    /**
     * Calculate the optimal camera position to view the shattered building.
     */
    calculateViewPosition(center, buildingHeight, shardCount) {
        const viewDistance = 15 + (shardCount * 0.1);

        const buildingAngle = Math.atan2(center.z, center.x);
        const cameraAngle = buildingAngle + Math.PI + Math.PI / 4;

        const offsetX = Math.cos(cameraAngle) * viewDistance;
        const offsetZ = Math.sin(cameraAngle) * viewDistance;
        const offsetY = buildingHeight * 1.5;

        const cameraPosition = new BABYLON.Vector3(
            center.x + offsetX,
            center.y + buildingHeight * 0.5 + offsetY,
            center.z + offsetZ
        );

        const direction = cameraPosition.subtract(center).normalize();

        return {
            position: cameraPosition,
            direction: direction,
            distance: viewDistance
        };
    }

    /**
     * Move camera in front of the shattered building (ring mode).
     */
    saveCameraAndMoveToFront(center, buildingHeight, shardCount, cameraViewInfo) {
        this.savedCamera = {
            target: this.camera.target.clone(),
            radius: this.camera.radius,
            alpha:  this.camera.alpha,
            beta:   this.camera.beta,
            position: this.camera.position.clone()
        };

        const targetPos = center.clone();
        targetPos.y += buildingHeight * 0.5;

        const newCameraPos = cameraViewInfo.position;
        const dirToTarget  = targetPos.subtract(newCameraPos);
        const distance     = dirToTarget.length();

        const targetAlpha  = Math.atan2(dirToTarget.x, dirToTarget.z);
        const targetBeta   = Math.acos(dirToTarget.y / distance);
        const targetRadius = distance;

        const dur = 50; // frames at 60 fps
        this._animateProp('camRadius', 'radius', this.camera.radius, targetRadius, dur);
        this._animateProp('camAlpha',  'alpha',  this.camera.alpha,  targetAlpha,  dur);
        this._animateProp('camBeta',   'beta',   this.camera.beta,   targetBeta,   dur);

        BABYLON.Animation.CreateAndStartAnimation(
            'camTarget', this.camera, 'target',
            60, dur,
            this.camera.target.clone(), targetPos,
            BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT
        );
    }

    /**
     * Restore camera to its state before the explosion.
     */
    restoreCamera() {
        if (!this.savedCamera) return;

        const dur = 50;
        this._animateProp('camRadiusR', 'radius', this.camera.radius, this.savedCamera.radius, dur);
        this._animateProp('camAlphaR',  'alpha',  this.camera.alpha,  this.savedCamera.alpha,  dur);
        this._animateProp('camBetaR',   'beta',   this.camera.beta,   this.savedCamera.beta,   dur);

        BABYLON.Animation.CreateAndStartAnimation(
            'camTargetR', this.camera, 'target',
            60, dur,
            this.camera.target.clone(), this.savedCamera.target,
            BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT
        );

        this.savedCamera = null;
    }

    // ─── internal ───────────────────────────────────────────────────

    _animateProp(animName, prop, from, to, dur) {
        BABYLON.Animation.CreateAndStartAnimation(
            animName, this.camera, prop,
            60, dur,
            from, to,
            BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT
        );
    }
}
