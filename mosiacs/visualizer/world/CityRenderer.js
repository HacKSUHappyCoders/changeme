/**
 * CityRenderer — Translates WorldState snapshots into 3D Babylon.js meshes
 * arranged along a **descending spiral path**.
 *
 * Buildings represent persistent runtime concepts (AGENTS.md):
 *   Function Districts  → large landmark towers (height scales with stack depth)
 *   Variable Houses     → small houses with value displays
 *   Loop Factories      → industrial buildings with iteration counters
 *   Branch Intersections→ diamond decision-point structures
 *   Memory Nodes        → underground glowing connection lines
 */
class CityRenderer {
    constructor(scene, materialManager) {
        this.scene = scene;
        this.materialManager = materialManager;

        // Mesh caches:  entityKey → { mesh, extras… }
        this.functionMeshes = new Map();
        this.variableMeshes = new Map();
        this.loopMeshes = new Map();
        this.branchMeshes = new Map();
        this.memoryLines = [];

        // Spiral layout config
        this.spiralRadiusStart = 3;
        this.spiralRadiusGrowth = 0.35;
        this.spiralAngleStep = 0.55;
        this.spiralHeightStep = 0.45;

        // Slot management
        this._nextSlot = 0;
        this._slotMap = new Map();

        this._spiralTube = null;

        // Hover label tracking
        this._hoveredLabel = null;
        this._setupHoverObserver();
    }

    // ─── Hover observer — show/hide floating labels ────────────────

    _setupHoverObserver() {
        // Delayed — scene may not exist yet in constructor, so we
        // attach on first render call instead.
        this._hoverAttached = false;
    }

    _ensureHoverObserver() {
        if (this._hoverAttached) return;
        this._hoverAttached = true;

        this.scene.onPointerObservable.add((pointerInfo) => {
            if (pointerInfo.type !== BABYLON.PointerEventTypes.POINTERMOVE) return;

            const pick = this.scene.pick(
                this.scene.pointerX,
                this.scene.pointerY,
                (m) => m._buildingData != null
            );

            if (pick && pick.hit && pick.pickedMesh && pick.pickedMesh._buildingData) {
                const entry = this._entryForMesh(pick.pickedMesh);
                if (entry && entry.label) {
                    if (this._hoveredLabel && this._hoveredLabel !== entry.label) {
                        this._hoveredLabel.setEnabled(false);
                    }
                    entry.label.setEnabled(true);
                    this._hoveredLabel = entry.label;
                }
            } else {
                if (this._hoveredLabel) {
                    this._hoveredLabel.setEnabled(false);
                    this._hoveredLabel = null;
                }
            }
        });
    }

    /** Look up the cache entry that owns a given building mesh. */
    _entryForMesh(mesh) {
        for (const cache of [this.functionMeshes, this.variableMeshes, this.loopMeshes, this.branchMeshes]) {
            for (const [, entry] of cache) {
                if (entry.mesh === mesh) return entry;
            }
        }
        return null;
    }

    // ─── Spiral geometry ───────────────────────────────────────────

    _spiralPosition(slot) {
        const angle = slot * this.spiralAngleStep;
        const radius = this.spiralRadiusStart + slot * this.spiralRadiusGrowth;
        const totalHeight = Math.max(this._nextSlot, 1) * this.spiralHeightStep;
        const y = totalHeight - slot * this.spiralHeightStep;
        return new BABYLON.Vector3(
            Math.cos(angle) * radius,
            y,
            Math.sin(angle) * radius
        );
    }

    _slotFor(key) {
        if (!this._slotMap.has(key)) {
            this._slotMap.set(key, this._nextSlot++);
        }
        return this._slotMap.get(key);
    }

    // ─── Main render entry ─────────────────────────────────────────

    render(snapshot) {
        this._ensureHoverObserver();
        this._renderFunctions(snapshot.functions, snapshot.callStack);
        this._renderVariables(snapshot.variables);
        this._renderLoops(snapshot.loops);
        this._renderBranches(snapshot.branches);
        this._renderMemoryLayer(snapshot.memory);
        this._renderSpiralPath();
    }

    clear() {
        [this.functionMeshes, this.variableMeshes, this.loopMeshes, this.branchMeshes].forEach(cache => {
            cache.forEach(entry => this._disposeEntry(entry));
            cache.clear();
        });
        this.memoryLines.forEach(l => l.dispose());
        this.memoryLines = [];
        if (this._spiralTube) { this._spiralTube.dispose(); this._spiralTube = null; }
        this._nextSlot = 0;
        this._slotMap.clear();
    }

    // ─── Spiral timeline tube ──────────────────────────────────────

    _renderSpiralPath() {
        if (this._spiralTube) { this._spiralTube.dispose(); this._spiralTube = null; }
        if (this._nextSlot < 2) return;

        const points = [];
        for (let i = 0; i < this._nextSlot; i++) {
            const p = this._spiralPosition(i);
            p.y -= 0.05;
            points.push(p);
        }

        this._spiralTube = BABYLON.MeshBuilder.CreateTube('spiralTimeline', {
            path: points, radius: 0.12, sideOrientation: BABYLON.Mesh.DOUBLESIDE
        }, this.scene);
        const mat = new BABYLON.StandardMaterial('spiralMat', this.scene);
        mat.emissiveColor = new BABYLON.Color3(0.8, 0.7, 0.3);
        mat.diffuseColor = new BABYLON.Color3(0.9, 0.8, 0.4);
        mat.alpha = 0.55;
        this._spiralTube.material = mat;
    }

    // ─── Function Districts ────────────────────────────────────────

    _renderFunctions(functions, callStack) {
        const activeKeys = new Set();
        functions.forEach(fn => {
            activeKeys.add(fn.key);
            if (!this.functionMeshes.has(fn.key)) {
                const slot = this._slotFor(fn.key);
                const pos = this._spiralPosition(slot);
                this.functionMeshes.set(fn.key, this._createFunctionDistrict(fn, pos));
            }
            const isOnStack = callStack.includes(fn.key);
            this._updateFunctionState(this.functionMeshes.get(fn.key), fn, isOnStack);
        });
        this.functionMeshes.forEach((entry, key) => {
            if (!activeKeys.has(key)) this._setInactive(entry);
        });
    }

    _createFunctionDistrict(fn, pos) {
        const height = 4 + fn.depth * 2.5;
        const width = 3.5;

        const mesh = BABYLON.MeshBuilder.CreateCylinder(`building_${fn.key}`, {
            height, diameterTop: width * 0.5, diameterBottom: width, tessellation: 4, subdivisions: 1
        }, this.scene);
        const bake = BABYLON.Matrix.RotationY(Math.PI / 4)
            .multiply(BABYLON.Matrix.Translation(0, height / 2, 0));
        mesh.bakeTransformIntoVertices(bake);
        mesh.position = pos.clone();

        const color = { r: 0.8, g: 0.2, b: 0.2, a: 0.85 };
        mesh.material = this._glowMaterial(`fnMat_${fn.key}`, color);

        const cap = BABYLON.MeshBuilder.CreateBox(`fnCap_${fn.key}`, {
            height: 0.3, width: width * 0.7, depth: width * 0.7
        }, this.scene);
        cap.position = pos.clone();
        cap.position.y += height + 0.15;
        cap.material = this._glowMaterial(`fnCapMat_${fn.key}`, {
            r: Math.min(color.r * 1.5, 1), g: Math.min(color.g * 1.5, 1),
            b: Math.min(color.b * 1.5, 1), a: 0.9
        });

        this._animateScaleIn(mesh);
        this._animateScaleIn(cap);

        const label = this._createFloatingLabel(`fnLabel_${fn.key}`, fn.name, pos.clone(), height + 0.5, color);
        label.setEnabled(false);

        mesh._buildingData = {
            step: fn.enterStep,
            stepData: { type: 'CALL', name: fn.name, depth: fn.depth, line: 0 },
            color, type: 'CALL',
            childSteps: this._fnChildSteps(fn),
            capMesh: cap
        };
        mesh._trapHeight = height;
        mesh._entityData = fn;

        return { mesh, cap, label, height, color, type: 'function' };
    }

    _fnChildSteps(fn) {
        const children = [];
        fn.localVars.forEach(vk => {
            children.push({ type: 'DECL', name: vk, value: '', address: '0', line: 0 });
        });
        if (fn.returnValue !== null && fn.returnValue !== undefined) {
            children.push({ type: 'RETURN', name: '', value: String(fn.returnValue), address: '0', line: 0, subtype: '' });
        }
        return children;
    }

    _updateFunctionState(entry, fn, isOnStack) {
        if (!entry.mesh) return;
        if (entry.mesh.material) entry.mesh.material.alpha = 0.85;
        if (entry.cap && entry.cap.material) entry.cap.material.alpha = 0.9;
        if (entry.mesh._buildingData) {
            entry.mesh._buildingData.childSteps = this._fnChildSteps(fn);
        }
        // Update label text
        if (fn.returnValue !== null && fn.returnValue !== undefined) {
            this._updateLabelText(entry.label, `${fn.name} → ${fn.returnValue}`);
        }
    }

    // ─── Variable Houses ───────────────────────────────────────────

    _renderVariables(variables) {
        const activeKeys = new Set();
        variables.forEach(v => {
            activeKeys.add(v.key);
            if (!this.variableMeshes.has(v.key)) {
                const slot = this._slotFor(v.key);
                const pos = this._spiralPosition(slot);
                this.variableMeshes.set(v.key, this._createVariableHouse(v, pos));
            }
            this._updateVariableState(this.variableMeshes.get(v.key), v);
        });
        this.variableMeshes.forEach((entry, key) => {
            if (!activeKeys.has(key)) this._setInactive(entry);
        });
    }

    _createVariableHouse(v, pos) {
        const height = 2;
        const width = 1.4;

        const mesh = BABYLON.MeshBuilder.CreateBox(`building_${v.key}`, {
            height, width, depth: width
        }, this.scene);
        mesh.position = pos.clone();
        mesh.position.y += height / 2;

        const color = { r: 0.2, g: 0.4, b: 0.8, a: 0.85 };
        mesh.material = this._glowMaterial(`varMat_${v.key}`, color);

        const roof = BABYLON.MeshBuilder.CreateCylinder(`varRoof_${v.key}`, {
            height: 0.7, diameterTop: 0, diameterBottom: width * 1.5, tessellation: 4
        }, this.scene);
        roof.bakeTransformIntoVertices(BABYLON.Matrix.RotationY(Math.PI / 4));
        roof.position = pos.clone();
        roof.position.y += height + 0.35;
        roof.material = this._glowMaterial(`varRoofMat_${v.key}`, {
            r: Math.min(color.r * 1.4, 1), g: Math.min(color.g * 1.4, 1),
            b: Math.min(color.b * 1.4, 1), a: 0.9
        });

        this._animateScaleIn(mesh);
        this._animateScaleIn(roof);

        const labelText = `${v.name} = ${v.currentValue}`;
        const label = this._createFloatingLabel(`varLabel_${v.key}`, labelText, pos.clone(), height + 1.3, color);
        label.setEnabled(false);

        mesh._buildingData = {
            step: v.declStep,
            stepData: { type: 'DECL', name: v.name, value: v.currentValue, address: v.address, line: 0 },
            color, type: 'DECL',
            childSteps: this._varChildSteps(v),
            capMesh: roof
        };
        mesh._trapHeight = height;
        mesh._entityData = v;

        return { mesh, roof, label, height, color, type: 'variable' };
    }

    _varChildSteps(v) {
        return v.values.map(entry => ({
            type: 'ASSIGN', name: v.name, value: String(entry.value),
            address: v.address, line: 0, step: entry.step
        }));
    }

    _updateVariableState(entry, v) {
        if (!entry.mesh) return;
        if (entry.mesh.material) {
            entry.mesh.material.alpha = 0.85;
            entry.mesh.material.emissiveColor = new BABYLON.Color3(
                entry.color.r * 0.5, entry.color.g * 0.5, entry.color.b * 0.5
            );
        }
        if (entry.roof && entry.roof.material) entry.roof.material.alpha = 0.9;
        if (entry.mesh._buildingData) {
            entry.mesh._buildingData.childSteps = this._varChildSteps(v);
            entry.mesh._buildingData.stepData.value = v.currentValue;
        }
        if (entry.label) {
            this._updateLabelText(entry.label, `${v.name} = ${v.currentValue}`);
        }
    }

    // ─── Loop Factories ────────────────────────────────────────────

    _renderLoops(loops) {
        const activeKeys = new Set();
        loops.forEach(loop => {
            activeKeys.add(loop.key);
            if (!this.loopMeshes.has(loop.key)) {
                const slot = this._slotFor(loop.key);
                const pos = this._spiralPosition(slot);
                this.loopMeshes.set(loop.key, this._createLoopFactory(loop, pos));
            }
            this._updateLoopState(this.loopMeshes.get(loop.key), loop);
        });
        this.loopMeshes.forEach((entry, key) => {
            if (!activeKeys.has(key)) this._setInactive(entry);
        });
    }

    _createLoopFactory(loop, pos) {
        const height = 3;
        const width = 2.6;

        const mesh = BABYLON.MeshBuilder.CreateCylinder(`building_${loop.key}`, {
            height, diameterTop: width * 0.75, diameterBottom: width, tessellation: 6
        }, this.scene);
        mesh.position = pos.clone();
        mesh.position.y += height / 2;

        const color = { r: 0.6, g: 0.2, b: 0.8, a: 0.85 };
        mesh.material = this._glowMaterial(`loopMat_${loop.key}`, color);

        const chimney = BABYLON.MeshBuilder.CreateCylinder(`loopChimney_${loop.key}`, {
            height: 1.3, diameter: 0.45, tessellation: 8
        }, this.scene);
        chimney.position = pos.clone();
        chimney.position.y += height + 0.65;
        chimney.position.x += 0.7;
        chimney.material = this._glowMaterial(`loopChimneyMat_${loop.key}`,
            { r: 0.4, g: 0.15, b: 0.6, a: 0.9 });

        this._animateScaleIn(mesh);
        this._animateScaleIn(chimney);

        const labelText = `${loop.subtype.toUpperCase()} (${loop.condition}) ×${loop.iterations}`;
        const label = this._createFloatingLabel(`loopLabel_${loop.key}`, labelText, pos.clone(), height + 2, color);
        label.setEnabled(false);

        mesh._buildingData = {
            step: loop.steps[0] || 0,
            stepData: { type: 'LOOP', name: '', subtype: loop.subtype, condition: loop.condition, line: 0 },
            color, type: 'LOOP',
            childSteps: this._loopChildSteps(loop),
            capMesh: chimney
        };
        mesh._trapHeight = height;
        mesh._entityData = loop;

        return { mesh, chimney, label, height, color, type: 'loop' };
    }

    _loopChildSteps(loop) {
        return loop.steps.map((s, i) => ({
            type: 'LOOP', name: `iteration ${i + 1}`, value: i < loop.iterations ? '✓' : '✗',
            address: '0', line: 0, condition: loop.condition
        }));
    }

    _updateLoopState(entry, loop) {
        if (!entry.mesh) return;
        if (entry.mesh.material) {
            entry.mesh.material.alpha = 0.85;
            entry.mesh.material.emissiveColor = new BABYLON.Color3(
                entry.color.r * 0.6, entry.color.g * 0.6, entry.color.b * 0.6
            );
        }
        if (entry.chimney && entry.chimney.material) entry.chimney.material.alpha = 0.9;
        if (entry.mesh._buildingData) {
            entry.mesh._buildingData.childSteps = this._loopChildSteps(loop);
        }
        if (entry.label) {
            this._updateLabelText(entry.label, `${loop.subtype.toUpperCase()} (${loop.condition}) ×${loop.iterations}`);
        }
    }

    // ─── Branch Intersections ──────────────────────────────────────

    _renderBranches(branches) {
        const activeKeys = new Set();
        branches.forEach(br => {
            activeKeys.add(br.key);
            if (!this.branchMeshes.has(br.key)) {
                const slot = this._slotFor(br.key);
                const pos = this._spiralPosition(slot);
                this.branchMeshes.set(br.key, this._createBranchIntersection(br, pos));
            }
            this._updateBranchState(this.branchMeshes.get(br.key), br);
        });
        this.branchMeshes.forEach((entry, key) => {
            if (!activeKeys.has(key)) this._setInactive(entry);
        });
    }

    _createBranchIntersection(br, pos) {
        const height = 2.2;
        const width = 2.2;

        const mesh = BABYLON.MeshBuilder.CreateCylinder(`building_${br.key}`, {
            height, diameterTop: 0.3, diameterBottom: width, tessellation: 4
        }, this.scene);
        const bake = BABYLON.Matrix.RotationY(Math.PI / 4)
            .multiply(BABYLON.Matrix.Translation(0, height / 2, 0));
        mesh.bakeTransformIntoVertices(bake);
        mesh.position = pos.clone();

        const color = { r: 0.9, g: 0.4, b: 0.2, a: 0.85 };
        mesh.material = this._glowMaterial(`branchMat_${br.key}`, color);

        const truePath = this._createPathIndicator(`brTrue_${br.key}`, pos, 1.6, Math.PI / 6, true);
        const falsePath = this._createPathIndicator(`brFalse_${br.key}`, pos, 1.6, -Math.PI / 6, false);

        this._animateScaleIn(mesh);

        const labelText = `IF (${br.condition}) → ${br.result ? 'true' : 'false'}`;
        const label = this._createFloatingLabel(`brLabel_${br.key}`, labelText, pos.clone(), height + 1, color);
        label.setEnabled(false);

        mesh._buildingData = {
            step: br.step,
            stepData: { type: 'CONDITION', name: br.condition, conditionResult: br.result, line: 0 },
            color, type: 'CONDITION',
            childSteps: [
                { type: 'CONDITION', name: br.condition, value: br.result ? 'true' : 'false', address: '0', line: 0 },
                ...(br.chosenBranch ? [{ type: 'BRANCH', name: br.chosenBranch, value: '', address: '0', line: 0, subtype: br.chosenBranch }] : [])
            ],
            capMesh: null
        };
        mesh._trapHeight = height;
        mesh._entityData = br;

        return { mesh, truePath, falsePath, label, height, color, type: 'branch' };
    }

    _createPathIndicator(name, basePos, length, angle, isTrue) {
        const path = BABYLON.MeshBuilder.CreateBox(name, {
            width: length, height: 0.15, depth: 0.35
        }, this.scene);
        path.position = basePos.clone();
        path.position.y += 0.1;
        path.position.x += Math.cos(angle) * length / 2;
        path.position.z += Math.sin(angle) * length / 2;
        path.rotation.y = -angle;

        const color = isTrue
            ? { r: 0.2, g: 0.9, b: 0.3, a: 0.8 }
            : { r: 0.9, g: 0.2, b: 0.2, a: 0.8 };
        path.material = this._glowMaterial(name + '_mat', color);
        return path;
    }

    _updateBranchState(entry, br) {
        if (!entry.mesh) return;
        if (entry.truePath && entry.truePath.material)
            entry.truePath.material.alpha = 0.9;
        if (entry.falsePath && entry.falsePath.material)
            entry.falsePath.material.alpha = 0.9;
        if (entry.label) {
            this._updateLabelText(entry.label, `IF (${br.condition}) → ${br.result ? 'true' : 'false'}`);
        }
    }

    // ─── Memory Layer ──────────────────────────────────────────────

    _renderMemoryLayer(memoryNodes) {
        this.memoryLines.forEach(l => l.dispose());
        this.memoryLines = [];

        memoryNodes.forEach(node => {
            if (node.variables.size < 2) return;
            const positions = [];
            node.variables.forEach(varKey => {
                const entry = this.variableMeshes.get(varKey);
                if (entry && entry.mesh) positions.push(entry.mesh.position.clone());
            });
            if (positions.length < 2) return;

            for (let i = 0; i < positions.length - 1; i++) {
                const p1 = positions[i].clone(); p1.y = -0.5;
                const p2 = positions[i + 1].clone(); p2.y = -0.5;
                const line = BABYLON.MeshBuilder.CreateTube(`memLine_${node.address}_${i}`, {
                    path: [p1, p2], radius: 0.06, sideOrientation: BABYLON.Mesh.DOUBLESIDE
                }, this.scene);
                const mat = new BABYLON.StandardMaterial(`memLineMat_${node.address}_${i}`, this.scene);
                mat.emissiveColor = new BABYLON.Color3(0.3, 0.8, 0.3);
                mat.alpha = 0.4;
                line.material = mat;
                this.memoryLines.push(line);
            }
        });
    }

    // ─── Material helper (brighter emissive) ────────────────────────

    /**
     * Create a stained-glass material with strong emissive glow so
     * buildings are always well-lit regardless of camera angle.
     */
    _glowMaterial(name, color) {
        const mat = new BABYLON.StandardMaterial(name, this.scene);
        mat.diffuseColor = new BABYLON.Color3(color.r, color.g, color.b);
        mat.emissiveColor = new BABYLON.Color3(color.r * 0.45, color.g * 0.45, color.b * 0.45);
        mat.specularColor = new BABYLON.Color3(0.6, 0.6, 0.6);
        mat.specularPower = 32;
        mat.alpha = color.a !== undefined ? color.a : 0.85;
        return mat;
    }

    // ─── Shared helpers ────────────────────────────────────────────


    _createFloatingLabel(name, text, pos, yOffset, color, scale) {
        scale = scale || 1;
        const planeSize = 3 * scale;
        const plane = BABYLON.MeshBuilder.CreatePlane(name, { width: planeSize, height: planeSize * 0.5 }, this.scene);
        plane.position = pos.clone();
        plane.position.y += yOffset;
        plane.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;

        const mat = new BABYLON.StandardMaterial(name + '_mat', this.scene);
        const texW = 512;
        const texH = 256;
        const dynTex = new BABYLON.DynamicTexture(name + '_tex', { width: texW, height: texH }, this.scene, false);
        const ctx = dynTex.getContext();

        ctx.fillStyle = `rgba(${Math.floor(color.r * 200)}, ${Math.floor(color.g * 200)}, ${Math.floor(color.b * 200)}, 0.75)`;
        ctx.fillRect(0, 0, texW, texH);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 4;
        ctx.strokeRect(4, 4, texW - 8, texH - 8);
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 36px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        const words = text.split(' ');
        const lines = [];
        let cur = '';
        words.forEach(w => {
            const test = cur ? cur + ' ' + w : w;
            if (ctx.measureText(test).width > texW - 40 && cur) { lines.push(cur); cur = w; }
            else cur = test;
        });
        if (cur) lines.push(cur);
        const lineH = 42;
        const startY = texH / 2 - ((lines.length - 1) * lineH) / 2;
        lines.forEach((line, i) => ctx.fillText(line, texW / 2, startY + i * lineH));

        dynTex.update();
        mat.diffuseTexture = dynTex;
        mat.emissiveColor = new BABYLON.Color3(color.r * 0.2, color.g * 0.2, color.b * 0.2);
        mat.alpha = color.a || 0.85;
        mat.backFaceCulling = false;
        plane.material = mat;

        plane._dynTex = dynTex;
        plane._labelColor = color;
        return plane;
    }

    _updateLabelText(plane, text) {
        if (!plane || !plane._dynTex) return;
        const dynTex = plane._dynTex;
        const color = plane._labelColor;
        const ctx = dynTex.getContext();
        const texW = 512;
        const texH = 256;

        ctx.clearRect(0, 0, texW, texH);
        ctx.fillStyle = `rgba(${Math.floor(color.r * 200)}, ${Math.floor(color.g * 200)}, ${Math.floor(color.b * 200)}, 0.75)`;
        ctx.fillRect(0, 0, texW, texH);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 4;
        ctx.strokeRect(4, 4, texW - 8, texH - 8);
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 36px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        const words = text.split(' ');
        const lines = [];
        let cur = '';
        words.forEach(w => {
            const test = cur ? cur + ' ' + w : w;
            if (ctx.measureText(test).width > texW - 40 && cur) { lines.push(cur); cur = w; }
            else cur = test;
        });
        if (cur) lines.push(cur);
        const lineH = 42;
        const startY = texH / 2 - ((lines.length - 1) * lineH) / 2;
        lines.forEach((line, i) => ctx.fillText(line, texW / 2, startY + i * lineH));

        dynTex.update();
    }

    _animateScaleIn(mesh) {
        if (!mesh) return;
        mesh.scaling = new BABYLON.Vector3(0.01, 0.01, 0.01);
        BABYLON.Animation.CreateAndStartAnimation(
            `scaleIn_${mesh.name}`, mesh, 'scaling',
            60, 30,
            new BABYLON.Vector3(0.01, 0.01, 0.01),
            new BABYLON.Vector3(1, 1, 1),
            BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT
        );
    }

    _setInactive(entry) {
        if (!entry) return;
        // All buildings stay fully lit — no dimming
        if (entry.mesh && entry.mesh.material) entry.mesh.material.alpha = 0.85;
        if (entry.cap && entry.cap.material) entry.cap.material.alpha = 0.9;
        if (entry.roof && entry.roof.material) entry.roof.material.alpha = 0.9;
        if (entry.chimney && entry.chimney.material) entry.chimney.material.alpha = 0.9;
        if (entry.truePath && entry.truePath.material) entry.truePath.material.alpha = 0.9;
        if (entry.falsePath && entry.falsePath.material) entry.falsePath.material.alpha = 0.9;
    }

    _disposeEntry(entry) {
        if (!entry) return;
        const disposable = ['mesh', 'cap', 'roof', 'chimney', 'truePath', 'falsePath', 'label'];
        disposable.forEach(k => {
            if (entry[k]) {
                if (entry[k].material) entry[k].material.dispose();
                entry[k].dispose();
            }
        });
    }
}
