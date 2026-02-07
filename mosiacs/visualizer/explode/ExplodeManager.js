/**
 * ExplodeManager - Handles click-to-shatter interaction on buildings.
 *
 * When a building is clicked it "shatters" into static floating shards.
 * Each shard represents a variable / value that lived inside that code block.
 *
 * Clicking a second time (or clicking another building) collapses the shards
 * back and restores the original building.
 *
 * Delegates to:
 *   ShardFactory             – mesh + label creation
 *   ShardAnimator            – fly-out animations (debug-column & ring)
 *   ExplodeCameraController  – camera save / restore / zoom
 *   StepLabelHelper          – label text & colour helpers
 */
class ExplodeManager {
    constructor(scene, camera, materialManager) {
        this.scene  = scene;
        this.camera = camera;
        this.materialManager = materialManager;

        // Sub-modules
        this.shardFactory    = new ShardFactory(scene, camera);
        this.shardAnimator   = new ShardAnimator(scene, camera);
        this.cameraCtrl      = new ExplodeCameraController(camera);

        /** Currently exploded building data (null when nothing is open) */
        this.exploded = null;

        /** Debug mode: shards fly to side column (true) or explode in rings (false) */
        this.debugColumnMode = true;

        this._setupPointerObservable();
    }

    // ─── public helpers ─────────────────────────────────────────────

    /**
     * Toggle between debug column mode and ring explosion mode
     */
    toggleDebugMode() {
        this.debugColumnMode = !this.debugColumnMode;
        console.log(`Debug column mode: ${this.debugColumnMode ? 'ON' : 'OFF'}`);
        return this.debugColumnMode;
    }

    /**
     * Collapse any currently exploded building (called from UI).
     */
    collapseIfExploded() {
        if (this.exploded) {
            this._collapse();
            return true;
        }
        return false;
    }

    // ─── click detection ────────────────────────────────────────────

    _setupPointerObservable() {
        this.scene.onPointerObservable.add((pointerInfo) => {
            if (pointerInfo.type !== BABYLON.PointerEventTypes.POINTERPICK) return;
            const pickResult = pointerInfo.pickInfo;
            if (!pickResult.hit || !pickResult.pickedMesh) return;

            const buildingMesh = this._findBuildingMesh(pickResult.pickedMesh);
            if (!buildingMesh) return;

            // Already exploded → collapse
            if (this.exploded && this.exploded.mesh === buildingMesh) {
                this._collapse();
                return;
            }

            // Different building exploded → collapse first, then explode new
            if (this.exploded) {
                this._collapse();
                setTimeout(() => this._explode(buildingMesh), 550);
            } else {
                this._explode(buildingMesh);
            }
        });
    }

    _findBuildingMesh(mesh) {
        let cur = mesh;
        while (cur) {
            if (cur.name && cur.name.startsWith('building_')) return cur;
            if (cur.name && cur.name.startsWith('shard_'))    return null;
            cur = cur.parent;
        }
        return null;
    }

    // ─── explode ────────────────────────────────────────────────────

    _explode(buildingMesh) {
        const bd = buildingMesh._buildingData;
        if (!bd) return;

        const childSteps = bd.childSteps || [];
        const centerPos  = buildingMesh.position.clone();
        const height     = buildingMesh._trapHeight || 2;
        const totalShards = this._calculateTotalShards(childSteps.length);

        const cameraViewInfo = this.cameraCtrl.calculateViewPosition(centerPos, height, totalShards);

        // Hide original building + cap
        buildingMesh.setEnabled(false);
        if (bd.capMesh) bd.capMesh.setEnabled(false);

        // ── create shards ───────────────────────────────────────────
        const shards = [];

        // Header – show the step type, name, and extra context (subtype, condition)
        const sd = bd.stepData;
        let headerLabel = `${sd.type}  ${sd.name || ''}`;
        if (sd.subtype)   headerLabel += `  [${sd.subtype}]`;
        if (sd.condition)  headerLabel += `  (${sd.condition})`;
        if (sd.line > 0)   headerLabel += `   L${sd.line}`;

        shards.push(this.shardFactory.createShard(
            `shard_header_${bd.step}`,
            headerLabel.trim(),
            centerPos, 0, totalShards, height,
            bd.color, true, 0,
            cameraViewInfo.direction,
            this.debugColumnMode
        ));

        let idx = 1;
        childSteps.forEach((child, i) => {
            // Main label
            shards.push(this.shardFactory.createShard(
                `shard_${bd.step}_${i}_main`,
                StepLabelHelper.labelForStep(child),
                centerPos, idx++, totalShards, height,
                StepLabelHelper.colorForChild(child), false, 0,
                cameraViewInfo.direction,
                this.debugColumnMode
            ));

            // Address shard
            if (child.address && child.address !== '0') {
                shards.push(this.shardFactory.createShard(
                    `shard_${bd.step}_${i}_addr`,
                    `@${child.address.substring(0, 16)}`,
                    centerPos, idx++, totalShards, height,
                    StepLabelHelper.colorForChild(child), false, 1,
                    cameraViewInfo.direction,
                    this.debugColumnMode
                ));
            }

            // Line shard
            if (child.line > 0) {
                shards.push(this.shardFactory.createShard(
                    `shard_${bd.step}_${i}_line`,
                    `line ${child.line}`,
                    centerPos, idx++, totalShards, height,
                    { ...StepLabelHelper.colorForChild(child), a: 0.7 }, false, 2,
                    cameraViewInfo.direction,
                    this.debugColumnMode
                ));
            }
        });

        // Empty placeholder
        if (childSteps.length === 0) {
            shards.push(this.shardFactory.createShard(
                `shard_empty_${bd.step}`,
                '(no variables)',
                centerPos, 1, 2, height,
                { r: 0.5, g: 0.5, b: 0.5, a: 0.7 }, false, 0,
                cameraViewInfo.direction,
                this.debugColumnMode
            ));
        }

        // ── animate ─────────────────────────────────────────────────
        this.shardAnimator.animateShardsOut(shards, this.debugColumnMode);

        // ── camera ──────────────────────────────────────────────────
        if (this.debugColumnMode) {
            // In debug mode, move camera to view the building + column
            // The column is offset +6 on the X axis from the building
            const columnCenter = centerPos.clone();
            columnCenter.x += 3; // midpoint between building and column
            const debugViewInfo = this.cameraCtrl.calculateViewPosition(
                columnCenter, height, shards.length
            );
            this.cameraCtrl.saveCameraAndMoveToFront(
                columnCenter, height, shards.length, debugViewInfo
            );
        } else {
            this.cameraCtrl.saveCameraAndMoveToFront(centerPos, height, shards.length, cameraViewInfo);
        }

        this.exploded = { mesh: buildingMesh, shards, buildingData: bd };
    }

    _calculateTotalShards(childCount) {
        return 1 + (childCount * 3) + 2;
    }

    // ─── collapse ───────────────────────────────────────────────────

    _collapse() {
        if (!this.exploded) return;

        const { mesh, shards, buildingData } = this.exploded;

        shards.forEach(s => {
            if (s.material) {
                if (s.material.diffuseTexture) s.material.diffuseTexture.dispose();
                s.material.dispose();
            }
            s.dispose();
        });

        mesh.setEnabled(true);
        if (buildingData.capMesh) buildingData.capMesh.setEnabled(true);

        this.cameraCtrl.restoreCamera();

        this.exploded = null;
    }
}
