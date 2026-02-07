/**
 * GalaxyWarpManager — "Warp to Galaxy" feature (refactored)
 *
 * When the user double-clicks a building that has child steps (a sub-spiral),
 * this manager:
 *   1. Creates a full-size spiral "galaxy" at an offset position
 *   2. Draws animated warp effects connecting the source to the galaxy
 *   3. Smoothly flies the camera to the new galaxy
 *   4. Provides returnToMainGalaxy() to fly back and clean up
 *
 * Now split into smaller, focused modules:
 *   - GalaxyBuilder: builds galaxy spirals
 *   - WarpEffects: creates visual effects
 *   - This class: coordinates warping logic and stack management
 */
class GalaxyWarpManager {
    constructor(scene, sceneManager, mainCityRenderer) {
        this.scene = scene;
        this.sceneManager = sceneManager;
        this.mainCityRenderer = mainCityRenderer;

        // Helpers
        this.labelHelper = new LabelHelper(scene);
        this.galaxyBuilder = new GalaxyBuilder(scene, mainCityRenderer, this.labelHelper);
        this.warpEffects = new WarpEffects(scene, this.labelHelper);

        // Currently warped galaxy info, or null
        this.warpedGalaxy = null;

        // Galaxy stack for recursive warping
        this._galaxyStack = [];

        // Offset distance
        this.galaxyOffset = 200;
    }

    // ─── Public API ────────────────────────────────────────────────

    /**
     * Check if a building can be warped to
     */
    canWarp(buildingMesh) {
        if (!buildingMesh || !buildingMesh._entityData) return false;
        const entity = buildingMesh._entityData;
        
        if (entity.childStepIndices && entity.childStepIndices.length > 0) return true;
        if (buildingMesh._galaxyChildIndices && buildingMesh._galaxyChildIndices.length > 0) return true;
        if (entity.type === 'call' || entity.type === 'loop' || entity.type === 'condition') {
            if (entity.stepIndices && entity.stepIndices.length > 1) return true;
        }
        return false;
    }

    /**
     * Is the user currently in a warped galaxy?
     */
    isWarped() {
        return this.warpedGalaxy !== null;
    }

    /**
     * Warp to the galaxy for the given building
     */
    warpTo(buildingMesh) {
        if (!this.canWarp(buildingMesh)) return;

        const entity = buildingMesh._entityData;
        const sourcePos = buildingMesh.position.clone();

        // Determine sub-trace for this galaxy
        const subTrace = this._extractSubTrace(buildingMesh, entity);
        if (subTrace.length === 0) return;

        // Handle stacking
        if (this.warpedGalaxy) {
            this._galaxyStack.push(this.warpedGalaxy);
            this._dimGalaxyVisuals(this.warpedGalaxy, 0.45);
        } else {
            this._dimMainSpiral(0.3);
        }

        // Compute galaxy position
        const galaxyCenter = this._computeGalaxyPosition(sourcePos);
        
        // Get building color
        const bd = buildingMesh._buildingData || {};
        const color = this._colorForType(entity.colorType || entity.type || 'CALL');

        // Build the galaxy
        const galaxyData = this.galaxyBuilder.buildGalaxy(subTrace, galaxyCenter, entity);

        // Create warp effects
        this.warpEffects.createWarpLine(sourcePos, galaxyCenter, color);
        this.warpEffects.createSourceGlow(sourcePos, color);
        this.warpEffects.createGalaxyLabel(galaxyCenter, entity);

        // Store state
        this.warpedGalaxy = {
            buildingMesh,
            entity,
            sourcePos,
            galaxyCenter,
            galaxyData,
            color,
            ...this.warpEffects.getEffects(),
            subTrace
        };

        // Fly camera
        this._flyCamera(galaxyCenter, true);
        this._showReturnButton(true);
    }

    /**
     * Return from warped galaxy
     */
    returnToMainGalaxy(animate = true) {
        if (!this.warpedGalaxy) return;

        const camera = this.sceneManager.getCamera();
        this.scene.stopAnimation(camera);

        // Clean up current galaxy
        this.galaxyBuilder.cancelAnimations();
        this._disposeWarpedGalaxy(this.warpedGalaxy);

        if (this._galaxyStack.length > 0) {
            // Pop to parent galaxy
            const parent = this._galaxyStack.pop();
            this._restoreGalaxyVisuals(parent);
            this.warpedGalaxy = parent;

            if (animate) {
                this._flyCamera(parent.galaxyCenter, true);
            }
        } else {
            // Return to main spiral
            this.warpedGalaxy = null;
            this._dimMainSpiral(1.0);

            if (animate) {
                this._flyToMainSpiral();
            }

            this._showReturnButton(false);
        }
    }

    // ─── Sub-trace Extraction ──────────────────────────────────────

    /**
     * Extract the sub-trace that will populate the galaxy
     */
    _extractSubTrace(buildingMesh, entity) {
        let subTrace;

        if (buildingMesh._galaxySubTrace && buildingMesh._galaxyChildIndices && 
            buildingMesh._galaxyChildIndices.length > 0) {
            // Recursive warp from galaxy building
            const parentSubTrace = buildingMesh._galaxySubTrace;
            const childIndices = buildingMesh._galaxyChildIndices;
            subTrace = childIndices.map(idx => parentSubTrace[idx]).filter(Boolean);
        } else if (buildingMesh._galaxySubTrace && entity.stepIndices && 
                   entity.stepIndices.length > 0) {
            // Galaxy building without explicit child indices
            subTrace = this._extractByStepIndices(buildingMesh._galaxySubTrace, entity);
        } else {
            // Main-spiral building
            const trace = this.mainCityRenderer._lastTrace || [];
            const childIndices = entity.childStepIndices;
            subTrace = childIndices.map(idx => trace[idx]).filter(Boolean);
        }

        return subTrace || [];
    }

    /**
     * Extract sub-trace using step indices (for calls/loops/conditions)
     */
    _extractByStepIndices(parentSubTrace, entity) {
        const firstIdx = entity.stepIndices[0];

        if (entity.type === 'call') {
            // Collect steps until matching RETURN
            const children = [];
            let callBalance = 1;
            for (let j = firstIdx + 1; j < parentSubTrace.length; j++) {
                const step = parentSubTrace[j];
                if (!step) continue;
                if (step.type === 'CALL') callBalance++;
                if (step.type === 'RETURN') {
                    callBalance--;
                    if (callBalance <= 0) {
                        children.push(parentSubTrace[j]);
                        break;
                    }
                }
                children.push(parentSubTrace[j]);
            }
            return children;
        } else {
            // For loops/conditions
            const minIdx = Math.min(...entity.stepIndices);
            const maxIdx = Math.max(...entity.stepIndices);
            const expandedEnd = Math.min(maxIdx + 20, parentSubTrace.length - 1);
            const collected = [];
            for (let j = minIdx; j <= expandedEnd; j++) {
                if (parentSubTrace[j]) collected.push(parentSubTrace[j]);
            }
            return collected;
        }
    }

    // ─── Position & Camera ─────────────────────────────────────────

    /**
     * Compute galaxy center position based on stack depth
     */
    _computeGalaxyPosition(sourcePos) {
        const stackDepth = this._galaxyStack.length;
        const dirX = sourcePos.x || 1;
        const dirZ = sourcePos.z || 1;
        const dirLen = Math.sqrt(dirX * dirX + dirZ * dirZ) || 1;
        const offset = this.galaxyOffset + stackDepth * 60;
        
        return new BABYLON.Vector3(
            sourcePos.x + (dirX / dirLen) * offset,
            sourcePos.y + 10 + stackDepth * 15,
            sourcePos.z + (dirZ / dirLen) * offset
        );
    }

    /**
     * Fly camera to target position
     */
    _flyCamera(target, toGalaxy) {
        const camera = this.sceneManager.getCamera();
        this.scene.stopAnimation(camera);

        const viewOffset = toGalaxy
            ? new BABYLON.Vector3(15, 20, 15)
            : new BABYLON.Vector3(20, 25, 20);

        const newPos = target.add(viewOffset);
        const newTarget = target.clone();

        const posAnim = new BABYLON.Animation(
            'cameraFlyPos', 'position', 30,
            BABYLON.Animation.ANIMATIONTYPE_VECTOR3,
            BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT
        );
        posAnim.setKeys([
            { frame: 0, value: camera.position.clone() },
            { frame: 60, value: newPos }
        ]);
        const ease = new BABYLON.CubicEase();
        ease.setEasingMode(BABYLON.EasingFunction.EASINGMODE_EASEINOUT);
        posAnim.setEasingFunction(ease);

        const targetAnim = new BABYLON.Animation(
            'cameraFlyTarget', 'target', 30,
            BABYLON.Animation.ANIMATIONTYPE_VECTOR3,
            BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT
        );
        targetAnim.setKeys([
            { frame: 0, value: camera.target.clone() },
            { frame: 60, value: newTarget }
        ]);
        targetAnim.setEasingFunction(ease);

        this.scene.beginDirectAnimation(camera, [posAnim, targetAnim], 0, 60, false);
    }

    /**
     * Fly camera back to main spiral
     */
    _flyToMainSpiral() {
        const spiralRadius = this.mainCityRenderer.getSpiralRadius();
        const camera = this.sceneManager.getCamera();
        this.scene.stopAnimation(camera);

        let height, offset;
        if (spiralRadius != null && spiralRadius > 0) {
            height = spiralRadius * 2.2 + 10;
            offset = spiralRadius * 0.15;
        } else {
            height = 65;
            offset = 5;
        }

        const newPos = new BABYLON.Vector3(offset, height, offset);
        const newTarget = new BABYLON.Vector3(0, 0, 0);

        const posAnim = new BABYLON.Animation(
            'cameraFlyPos', 'position', 30,
            BABYLON.Animation.ANIMATIONTYPE_VECTOR3,
            BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT
        );
        posAnim.setKeys([
            { frame: 0, value: camera.position.clone() },
            { frame: 60, value: newPos }
        ]);
        const ease = new BABYLON.CubicEase();
        ease.setEasingMode(BABYLON.EasingFunction.EASINGMODE_EASEINOUT);
        posAnim.setEasingFunction(ease);

        const targetAnim = new BABYLON.Animation(
            'cameraFlyTarget', 'target', 30,
            BABYLON.Animation.ANIMATIONTYPE_VECTOR3,
            BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT
        );
        targetAnim.setKeys([
            { frame: 0, value: camera.target.clone() },
            { frame: 60, value: newTarget }
        ]);
        targetAnim.setEasingFunction(ease);

        this.scene.beginDirectAnimation(camera, [posAnim, targetAnim], 0, 60, false);
    }

    // ─── Visual Management ─────────────────────────────────────────

    /**
     * Dim galaxy visuals when stacking deeper
     */
    _dimGalaxyVisuals(galaxy, alpha) {
        // Dim meshes
        const allMeshes = [...(galaxy.galaxyData.meshes || [])];
        for (const mesh of allMeshes) {
            if (mesh && !mesh.isDisposed() && mesh.material && !mesh.material.isFrozen) {
                mesh.material.alpha = (mesh.material.alpha || 0.85) * alpha;
            }
        }

        // Dim effects using temporary WarpEffects instance
        const tempEffects = new WarpEffects(this.scene, this.labelHelper);
        tempEffects._warpLine = galaxy.warpLine;
        tempEffects._warpParticles = galaxy.warpParticles || [];
        tempEffects._sourceGlow = galaxy.sourceGlow;
        tempEffects.dimVisuals(alpha);
    }

    /**
     * Restore galaxy visuals when returning from deeper warp
     */
    _restoreGalaxyVisuals(galaxy) {
        // Restore meshes
        const allMeshes = [...(galaxy.galaxyData.meshes || [])];
        for (const mesh of allMeshes) {
            if (mesh && !mesh.isDisposed() && mesh.material) {
                if (mesh.material.isFrozen) mesh.material.unfreeze();
                mesh.material.alpha = 0.85;
            }
        }

        // Restore effects
        const tempEffects = new WarpEffects(this.scene, this.labelHelper);
        tempEffects._warpLine = galaxy.warpLine;
        tempEffects._warpParticles = galaxy.warpParticles || [];
        tempEffects._sourceGlow = galaxy.sourceGlow;
        tempEffects.restoreVisuals();
    }

    /**
     * Dim main spiral when entering first galaxy
     */
    _dimMainSpiral(targetAlpha) {
        const dim = (cache) => {
            for (const [, entry] of cache) {
                if (entry.mesh && entry.mesh.material) {
                    entry.mesh.material.alpha = entry.mesh.material.alpha * targetAlpha;
                }
                for (const part of ['cap', 'roof', 'chimney', 'truePath', 'falsePath']) {
                    if (entry[part] && entry[part].material) {
                        entry[part].material.alpha = entry[part].material.alpha * targetAlpha;
                    }
                }
            }
        };

        if (targetAlpha < 1.0) {
            dim(this.mainCityRenderer.functionMeshes);
            dim(this.mainCityRenderer.variableMeshes);
            dim(this.mainCityRenderer.loopMeshes);
            dim(this.mainCityRenderer.whileMeshes);
            dim(this.mainCityRenderer.branchMeshes);
            if (this.mainCityRenderer._spiralTube && this.mainCityRenderer._spiralTube.material) {
                this.mainCityRenderer._spiralTube.material.alpha *= targetAlpha;
            }
        } else {
            // Restore
            if (this.mainCityRenderer._lastSnapshot) {
                const restore = (cache) => {
                    for (const [, entry] of cache) {
                        if (entry.mesh && entry.mesh.material) {
                            entry.mesh.material.alpha = 0.85;
                        }
                        for (const part of ['cap', 'roof', 'chimney', 'truePath', 'falsePath']) {
                            if (entry[part] && entry[part].material) {
                                entry[part].material.alpha = 0.9;
                            }
                        }
                    }
                };
                restore(this.mainCityRenderer.functionMeshes);
                restore(this.mainCityRenderer.variableMeshes);
                restore(this.mainCityRenderer.loopMeshes);
                restore(this.mainCityRenderer.whileMeshes);
                restore(this.mainCityRenderer.branchMeshes);
                if (this.mainCityRenderer._spiralTube && this.mainCityRenderer._spiralTube.material) {
                    this.mainCityRenderer._spiralTube.material.alpha = 0.55;
                }
            }
        }
    }

    // ─── Cleanup ───────────────────────────────────────────────────

    /**
     * Dispose a warped galaxy entry
     */
    _disposeWarpedGalaxy(galaxy) {
        if (!galaxy) return;

        const cachedMats = new Set(this.galaxyBuilder._matCache.values());

        // Dispose galaxy meshes
        const allMeshes = galaxy.galaxyData.meshes || [];
        for (const mesh of allMeshes) {
            if (mesh && !mesh.isDisposed()) {
                this.scene.stopAnimation(mesh);
                if (mesh.material) {
                    if (!cachedMats.has(mesh.material)) {
                        if (mesh.material.diffuseTexture) mesh.material.diffuseTexture.dispose();
                        mesh.material.dispose();
                    } else {
                        mesh.material = null;
                    }
                }
                mesh.dispose();
            }
        }

        // Dispose warp effects using temporary instance
        const tempEffects = new WarpEffects(this.scene, this.labelHelper);
        tempEffects._warpLine = galaxy.warpLine;
        tempEffects._warpLineMat = galaxy.warpLineMat;
        tempEffects._warpParticles = galaxy.warpParticles || [];
        tempEffects._warpParticleSharedMat = galaxy.warpParticleSharedMat;
        tempEffects._sourceGlow = galaxy.sourceGlow;
        tempEffects._galaxyLabel = galaxy.galaxyLabel;
        tempEffects.disposeAll();
    }

    /**
     * UI helper
     */
    _showReturnButton(show) {
        const btn = document.getElementById('returnToMainGalaxy');
        if (btn) {
            btn.style.display = show ? 'block' : 'none';
        }
    }

    /**
     * Color helper
     */
    _colorForType(type) {
        switch (type) {
            case 'CALL':      return { r: 0.9, g: 0.3, b: 0.3, a: 0.85 };
            case 'RETURN':    return { r: 0.9, g: 0.6, b: 0.2, a: 0.85 };
            case 'DECL':      return { r: 0.3, g: 0.5, b: 0.9, a: 0.85 };
            case 'PARAM':     return { r: 0.4, g: 0.6, b: 1.0, a: 0.85 };
            case 'ASSIGN':    return { r: 0.3, g: 0.8, b: 0.9, a: 0.85 };
            case 'READ':      return { r: 0.2, g: 0.9, b: 0.7, a: 0.85 };
            case 'LOOP':      return { r: 0.7, g: 0.3, b: 0.9, a: 0.85 };
            case 'CONDITION': return { r: 0.9, g: 0.5, b: 0.2, a: 0.85 };
            case 'BRANCH':    return { r: 0.9, g: 0.8, b: 0.2, a: 0.85 };
            default:          return { r: 0.5, g: 0.5, b: 0.5, a: 0.85 };
        }
    }

    /**
     * Full cleanup
     */
    clear() {
        this.galaxyBuilder.cancelAnimations();

        // Dispose all galaxies on stack
        for (const galaxy of this._galaxyStack) {
            this._disposeWarpedGalaxy(galaxy);
        }
        this._galaxyStack = [];

        // Dispose current galaxy
        if (this.warpedGalaxy) {
            this._disposeWarpedGalaxy(this.warpedGalaxy);
        }

        // Dispose cached materials
        this.galaxyBuilder.disposeMaterials();

        // Restore main spiral
        this._dimMainSpiral(1.0);

        this.warpedGalaxy = null;
        this._showReturnButton(false);
    }
}
