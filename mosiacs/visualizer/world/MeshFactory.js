/**
 * MeshFactory — Creates the 3D meshes and materials for each building type.
 *
 * Keeps CityRenderer focused on layout and state management while this
 * class owns the Babylon.js geometry and material details.
 */
class MeshFactory {
    constructor(scene, labelHelper) {
        this.scene = scene;
        this.labelHelper = labelHelper;
    }

    // ─── Material helper ───────────────────────────────────────────

    /**
     * Create a stained-glass material with strong emissive glow.
     */
    glowMaterial(name, color) {
        const mat = new BABYLON.StandardMaterial(name, this.scene);
        mat.diffuseColor = new BABYLON.Color3(color.r, color.g, color.b);
        mat.emissiveColor = new BABYLON.Color3(
            color.r * 0.45, color.g * 0.45, color.b * 0.45
        );
        mat.specularColor = new BABYLON.Color3(0.6, 0.6, 0.6);
        mat.specularPower = 32;
        mat.alpha = color.a !== undefined ? color.a : 0.85;
        return mat;
    }

    // ─── Animation helper ──────────────────────────────────────────

    animateScaleIn(mesh) {
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

    // ─── Function District ─────────────────────────────────────────

    createFunctionDistrict(fn, pos) {
        const height = 4 + fn.depth * 2.5;
        const width = 3.5;

        const mesh = BABYLON.MeshBuilder.CreateCylinder(`building_${fn.key}`, {
            height,
            diameterTop: width * 0.5,
            diameterBottom: width,
            tessellation: 4,
            subdivisions: 1
        }, this.scene);
        const bake = BABYLON.Matrix.RotationY(Math.PI / 4)
            .multiply(BABYLON.Matrix.Translation(0, height / 2, 0));
        mesh.bakeTransformIntoVertices(bake);
        mesh.position = pos.clone();

        const color = { r: 0.8, g: 0.2, b: 0.2, a: 0.85 };
        mesh.material = this.glowMaterial(`fnMat_${fn.key}`, color);

        const cap = BABYLON.MeshBuilder.CreateBox(`fnCap_${fn.key}`, {
            height: 0.3, width: width * 0.7, depth: width * 0.7
        }, this.scene);
        cap.position = pos.clone();
        cap.position.y += height + 0.15;
        cap.material = this.glowMaterial(`fnCapMat_${fn.key}`, {
            r: Math.min(color.r * 1.5, 1),
            g: Math.min(color.g * 1.5, 1),
            b: Math.min(color.b * 1.5, 1),
            a: 0.9
        });

        this.animateScaleIn(mesh);
        this.animateScaleIn(cap);

        const label = this.labelHelper.create(
            `fnLabel_${fn.key}`, fn.name, pos.clone(), height + 0.5, color
        );
        label.setEnabled(false);

        mesh._buildingData = {
            step: fn.enterStep,
            stepData: { type: 'CALL', name: fn.name, depth: fn.depth, line: 0 },
            color, type: 'CALL',
            childSteps: MeshFactory.fnChildSteps(fn),
            capMesh: cap
        };
        mesh._trapHeight = height;
        mesh._entityData = fn;

        return { mesh, cap, label, height, color, type: 'function' };
    }

    // ─── Variable House ────────────────────────────────────────────

    createVariableHouse(v, pos) {
        const height = 2;
        const width = 1.4;

        const mesh = BABYLON.MeshBuilder.CreateBox(`building_${v.key}`, {
            height, width, depth: width
        }, this.scene);
        mesh.position = pos.clone();
        mesh.position.y += height / 2;

        const color = { r: 0.2, g: 0.4, b: 0.8, a: 0.85 };
        mesh.material = this.glowMaterial(`varMat_${v.key}`, color);

        const roof = BABYLON.MeshBuilder.CreateCylinder(`varRoof_${v.key}`, {
            height: 0.7, diameterTop: 0, diameterBottom: width * 1.5, tessellation: 4
        }, this.scene);
        roof.bakeTransformIntoVertices(BABYLON.Matrix.RotationY(Math.PI / 4));
        roof.position = pos.clone();
        roof.position.y += height + 0.35;
        roof.material = this.glowMaterial(`varRoofMat_${v.key}`, {
            r: Math.min(color.r * 1.4, 1),
            g: Math.min(color.g * 1.4, 1),
            b: Math.min(color.b * 1.4, 1),
            a: 0.9
        });

        this.animateScaleIn(mesh);
        this.animateScaleIn(roof);

        const labelText = `${v.name} = ${v.currentValue}`;
        const label = this.labelHelper.create(
            `varLabel_${v.key}`, labelText, pos.clone(), height + 1.3, color
        );
        label.setEnabled(false);

        mesh._buildingData = {
            step: v.declStep,
            stepData: { type: 'DECL', name: v.name, value: v.currentValue, address: v.address, line: 0 },
            color, type: 'DECL',
            childSteps: MeshFactory.varChildSteps(v),
            capMesh: roof
        };
        mesh._trapHeight = height;
        mesh._entityData = v;

        return { mesh, roof, label, height, color, type: 'variable' };
    }

    // ─── Loop Factory ──────────────────────────────────────────────

    createLoopFactory(loop, pos) {
        const height = 3;
        const width = 2.6;

        const mesh = BABYLON.MeshBuilder.CreateCylinder(`building_${loop.key}`, {
            height, diameterTop: width * 0.75, diameterBottom: width, tessellation: 6
        }, this.scene);
        mesh.position = pos.clone();
        mesh.position.y += height / 2;

        const color = { r: 0.6, g: 0.2, b: 0.8, a: 0.85 };
        mesh.material = this.glowMaterial(`loopMat_${loop.key}`, color);

        const chimney = BABYLON.MeshBuilder.CreateCylinder(`loopChimney_${loop.key}`, {
            height: 1.3, diameter: 0.45, tessellation: 8
        }, this.scene);
        chimney.position = pos.clone();
        chimney.position.y += height + 0.65;
        chimney.position.x += 0.7;
        chimney.material = this.glowMaterial(`loopChimneyMat_${loop.key}`, {
            r: 0.4, g: 0.15, b: 0.6, a: 0.9
        });

        this.animateScaleIn(mesh);
        this.animateScaleIn(chimney);

        const labelText = `${loop.subtype.toUpperCase()} (${loop.condition}) ×${loop.iterations}`;
        const label = this.labelHelper.create(
            `loopLabel_${loop.key}`, labelText, pos.clone(), height + 2, color
        );
        label.setEnabled(false);

        mesh._buildingData = {
            step: loop.steps[0] || 0,
            stepData: { type: 'LOOP', name: '', subtype: loop.subtype, condition: loop.condition, line: 0 },
            color, type: 'LOOP',
            childSteps: MeshFactory.loopChildSteps(loop),
            capMesh: chimney
        };
        mesh._trapHeight = height;
        mesh._entityData = loop;

        return { mesh, chimney, label, height, color, type: 'loop' };
    }

    // ─── Branch Intersection ───────────────────────────────────────

    createBranchIntersection(br, pos) {
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
        mesh.material = this.glowMaterial(`branchMat_${br.key}`, color);

        const truePath = this._createPathIndicator(
            `brTrue_${br.key}`, pos, 1.6, Math.PI / 6, true
        );
        const falsePath = this._createPathIndicator(
            `brFalse_${br.key}`, pos, 1.6, -Math.PI / 6, false
        );

        this.animateScaleIn(mesh);

        const labelText = `IF (${br.condition}) → ${br.result ? 'true' : 'false'}`;
        const label = this.labelHelper.create(
            `brLabel_${br.key}`, labelText, pos.clone(), height + 1, color
        );
        label.setEnabled(false);

        mesh._buildingData = {
            step: br.step,
            stepData: { type: 'CONDITION', name: br.condition, conditionResult: br.result, line: 0 },
            color, type: 'CONDITION',
            childSteps: [
                { type: 'CONDITION', name: br.condition, value: br.result ? 'true' : 'false', address: '0', line: 0 },
                ...(br.chosenBranch
                    ? [{ type: 'BRANCH', name: br.chosenBranch, value: '', address: '0', line: 0, subtype: br.chosenBranch }]
                    : [])
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
        path.material = this.glowMaterial(name + '_mat', color);
        return path;
    }

    // ─── Static child-step helpers ─────────────────────────────────

    static fnChildSteps(fn) {
        const children = [];
        fn.localVars.forEach(vk => {
            children.push({ type: 'DECL', name: vk, value: '', address: '0', line: 0 });
        });
        if (fn.returnValue !== null && fn.returnValue !== undefined) {
            children.push({ type: 'RETURN', name: '', value: String(fn.returnValue), address: '0', line: 0, subtype: '' });
        }
        return children;
    }

    static varChildSteps(v) {
        return v.values.map(entry => ({
            type: 'ASSIGN', name: v.name, value: String(entry.value),
            address: v.address, line: 0, step: entry.step
        }));
    }

    static loopChildSteps(loop) {
        return loop.steps.map((s, i) => ({
            type: 'LOOP', name: `iteration ${i + 1}`,
            value: i < loop.iterations ? '✓' : '✗',
            address: '0', line: 0, condition: loop.condition
        }));
    }
}
