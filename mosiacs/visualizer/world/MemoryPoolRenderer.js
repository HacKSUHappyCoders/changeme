/**
 * MemoryPoolRenderer — Memory Pool / Water Fountain Visualization
 *
 * Renders a 3D "underworld" beneath the spiral city showing the full
 * memory address space as a glowing water fountain:
 *   - Pool surface: semi-transparent glowing disc (the "basin")
 *   - Address nodes: glowing spheres on the pool, one per unique address
 *   - Fountain streams: high parabolic arcs from building bases down
 *     to their address nodes — like water arcing out of a fountain
 *   - Animated droplets: spheres that travel along each stream path
 *   - Splash rings: ripple torus rings at landing points on the pool
 *   - Convergence rings: pulsing torus rings around shared-address nodes
 *
 * Performance notes:
 *   - Single LineSystem for all fountain streams (one draw call)
 *   - Thin-instances for address nodes (one draw call)
 *   - Thin-instances for convergence rings (one draw call)
 *   - Thin-instances for splash rings (one draw call)
 *   - Animated droplets use individual spheres with shared material
 *     (one material, position-animated per frame via registerBeforeRender)
 *   - All static materials frozen, all static world matrices frozen
 *
 * Togglable on/off via the UI.
 */
class MemoryPoolRenderer {
    constructor(scene, cityRenderer) {
        this.scene = scene;
        this.cityRenderer = cityRenderer;

        /** Pool surface disc */
        this._poolSurface = null;
        this._poolSurfaceMat = null;

        /** Address node spheres (thin-instanced) */
        this._nodeRoot = null;
        this._nodeMat = null;

        /** Fountain stream lines (LineSystem) */
        this._lineSystem = null;
        this._lineMat = null;

        /** Convergence rings (thin-instanced torus) */
        this._ringRoot = null;
        this._ringMat = null;

        /** Splash rings at stream landing points (thin-instanced torus) */
        this._splashRoot = null;
        this._splashMat = null;

        /** Animated droplet spheres */
        this._droplets = [];        // array of mesh references
        this._dropletMat = null;    // shared material
        this._dropletPaths = [];    // array of { points: Vector3[], speed: number }
        this._dropletObserver = null; // registerBeforeRender handle

        /** Whether the pool is currently visible */
        this._visible = false;
    }

    // ─── Public API ────────────────────────────────────────────────

    isVisible() {
        return this._visible;
    }

    toggle() {
        if (this._visible) {
            this.hide();
        } else {
            this.show();
        }
        return this._visible;
    }

    show() {
        this.clear();
        const snapshot = this.cityRenderer._lastSnapshot;
        if (!snapshot || !snapshot.memory) return;

        const memoryNodes = snapshot.memory;
        if (!memoryNodes || memoryNodes.size === 0) return;

        const poolY = this._computePoolY();
        const addressPositions = this._computeAddressPositions(memoryNodes);
        if (addressPositions.size === 0) return;

        this._renderPoolSurface(poolY, addressPositions);
        this._renderAddressNodes(addressPositions, poolY);
        this._renderFountainStreams(memoryNodes, addressPositions, poolY);
        this._renderConvergenceRings(addressPositions, poolY);

        this._visible = true;
    }

    hide() {
        this.clear();
        this._visible = false;
    }

    clear() {
        // Stop droplet animation loop
        if (this._dropletObserver) {
            this.scene.onBeforeRenderObservable.remove(this._dropletObserver);
            this._dropletObserver = null;
        }
        // Dispose droplet meshes
        for (const d of this._droplets) {
            if (d && !d.isDisposed()) d.dispose();
        }
        this._droplets = [];
        this._dropletPaths = [];
        if (this._dropletMat) {
            this._dropletMat.dispose();
            this._dropletMat = null;
        }

        if (this._poolSurface) {
            this._poolSurface.dispose();
            this._poolSurface = null;
        }
        if (this._poolSurfaceMat) {
            this._poolSurfaceMat.dispose();
            this._poolSurfaceMat = null;
        }
        if (this._nodeRoot) {
            this._nodeRoot.dispose();
            this._nodeRoot = null;
        }
        if (this._nodeMat) {
            this._nodeMat.dispose();
            this._nodeMat = null;
        }
        if (this._lineSystem) {
            this._lineSystem.dispose();
            this._lineSystem = null;
        }
        if (this._lineMat) {
            this._lineMat.dispose();
            this._lineMat = null;
        }
        if (this._ringRoot) {
            this._ringRoot.dispose();
            this._ringRoot = null;
        }
        if (this._ringMat) {
            this._ringMat.dispose();
            this._ringMat = null;
        }
        if (this._splashRoot) {
            this._splashRoot.dispose();
            this._splashRoot = null;
        }
        if (this._splashMat) {
            this._splashMat.dispose();
            this._splashMat = null;
        }
    }

    // ─── Pool Y Computation ────────────────────────────────────────

    _computePoolY() {
        let minY = Infinity;

        const scanCache = (cache) => {
            for (const [, entry] of cache) {
                if (entry.mesh && !entry.mesh.isDisposed()) {
                    const y = entry.mesh.position.y;
                    if (y < minY) minY = y;
                }
            }
        };

        scanCache(this.cityRenderer.functionMeshes);
        scanCache(this.cityRenderer.variableMeshes);
        scanCache(this.cityRenderer.loopMeshes);
        scanCache(this.cityRenderer.whileMeshes);
        scanCache(this.cityRenderer.branchMeshes);

        if (minY === Infinity) minY = 0;
        return minY - 8;
    }

    // ─── Address Position Computation ──────────────────────────────

    _computeAddressPositions(memoryNodes) {
        const positions = new Map();

        memoryNodes.forEach(node => {
            let sumX = 0, sumZ = 0, count = 0;

            node.variables.forEach(varKey => {
                const entry = this.cityRenderer.variableMeshes.get(varKey);
                if (!entry || !entry.mesh || entry.mesh.isDisposed()) return;
                sumX += entry.mesh.position.x;
                sumZ += entry.mesh.position.z;
                count++;
            });

            if (count === 0) return;

            const color = ColorHash.color('variable', node.address);
            positions.set(node.address, {
                x: sumX / count,
                z: sumZ / count,
                color,
                count
            });
        });

        return positions;
    }

    // ─── Pool Surface ──────────────────────────────────────────────

    _renderPoolSurface(poolY, addressPositions) {
        let maxDist = 0;
        for (const [, pos] of addressPositions) {
            const dist = Math.sqrt(pos.x * pos.x + pos.z * pos.z);
            if (dist > maxDist) maxDist = dist;
        }
        const discRadius = Math.max(maxDist + 8, 15);

        this._poolSurface = BABYLON.MeshBuilder.CreateDisc('memoryPoolSurface', {
            radius: discRadius,
            tessellation: 48
        }, this.scene);
        this._poolSurface.rotation.x = Math.PI / 2;
        this._poolSurface.position.y = poolY;
        this._poolSurface.isPickable = false;

        this._poolSurfaceMat = new BABYLON.StandardMaterial('memoryPoolSurfaceMat', this.scene);
        this._poolSurfaceMat.emissiveColor = new BABYLON.Color3(0.08, 0.3, 0.5);
        this._poolSurfaceMat.diffuseColor = new BABYLON.Color3(0.04, 0.15, 0.35);
        this._poolSurfaceMat.alpha = 0.3;
        this._poolSurfaceMat.backFaceCulling = false;
        this._poolSurfaceMat.freeze();
        this._poolSurface.material = this._poolSurfaceMat;
        this._poolSurface.freezeWorldMatrix();
    }

    // ─── Address Nodes ─────────────────────────────────────────────

    _renderAddressNodes(addressPositions, poolY) {
        if (addressPositions.size === 0) return;

        this._nodeMat = new BABYLON.StandardMaterial('memoryNodeMat', this.scene);
        this._nodeMat.emissiveColor = new BABYLON.Color3(0.3, 0.7, 0.9);
        this._nodeMat.diffuseColor = new BABYLON.Color3(0.2, 0.5, 0.8);
        this._nodeMat.alpha = 0.8;
        this._nodeMat.freeze();

        this._nodeRoot = BABYLON.MeshBuilder.CreateSphere('memoryNodeRoot', {
            diameter: 0.8, segments: 6
        }, this.scene);
        this._nodeRoot.material = this._nodeMat;
        this._nodeRoot.isPickable = false;
        this._nodeRoot.isVisible = false;

        for (const [, pos] of addressPositions) {
            const scale = pos.count >= 2 ? 1.5 : 1.0;
            const mat = BABYLON.Matrix.Compose(
                new BABYLON.Vector3(scale, scale, scale),
                BABYLON.Quaternion.Identity(),
                new BABYLON.Vector3(pos.x, poolY + 0.5, pos.z)
            );
            this._nodeRoot.thinInstanceAdd(mat);
        }

        this._nodeRoot.thinInstanceRefreshBoundingInfo();
        this._nodeRoot.freezeWorldMatrix();
    }

    // ─── Cubic Bézier helper ───────────────────────────────────────

    /**
     * Evaluate a cubic Bézier at parameter t.
     */
    _cubicBezier(p0, p1, p2, p3, t) {
        const mt = 1 - t;
        const mt2 = mt * mt;
        const mt3 = mt2 * mt;
        const t2 = t * t;
        const t3 = t2 * t;
        return new BABYLON.Vector3(
            mt3 * p0.x + 3 * mt2 * t * p1.x + 3 * mt * t2 * p2.x + t3 * p3.x,
            mt3 * p0.y + 3 * mt2 * t * p1.y + 3 * mt * t2 * p2.y + t3 * p3.y,
            mt3 * p0.z + 3 * mt2 * t * p1.z + 3 * mt * t2 * p2.z + t3 * p3.z
        );
    }

    // ─── Fountain Streams ──────────────────────────────────────────

    /**
     * Draw high parabolic fountain arcs from each variable building's base
     * down to its address node. The streams shoot upward from the building
     * base, arc high above the city, then plunge down into the pool — like
     * a real water fountain.
     *
     * Also spawns animated droplet spheres that flow along each path,
     * and splash rings where streams land.
     */
    _renderFountainStreams(memoryNodes, addressPositions, poolY) {
        const allLines = [];
        const allColors = [];
        const splashPositions = [];
        const streamCurves = [];  // store control points for droplet animation
        let streamIndex = 0;

        memoryNodes.forEach(node => {
            const addrPos = addressPositions.get(node.address);
            if (!addrPos) return;

            const addrColor = ColorHash.color('variable', node.address);

            node.variables.forEach(varKey => {
                const entry = this.cityRenderer.variableMeshes.get(varKey);
                if (!entry || !entry.mesh || entry.mesh.isDisposed()) return;

                const meshPos = entry.mesh.position;
                const baseY = meshPos.y - (entry.height || 1);

                // Start: building base
                const p0 = new BABYLON.Vector3(meshPos.x, baseY, meshPos.z);
                // End: pool node
                const p3 = new BABYLON.Vector3(addrPos.x, poolY + 0.5, addrPos.z);

                const midX = (p0.x + p3.x) / 2;
                const midZ = (p0.z + p3.z) / 2;
                const totalDrop = p0.y - p3.y;

                // Outward offset for spray fan
                const dx = midX;
                const dz = midZ;
                const hDist = Math.sqrt(dx * dx + dz * dz) || 1;
                const spreadAmount = Math.min(totalDrop * 0.4, 6) + (streamIndex % 3) * 0.8;
                const offsetX = (dx / hDist) * spreadAmount;
                const offsetZ = (dz / hDist) * spreadAmount;

                // HIGH ARC: Control point 1 — shoots up well above building
                // The "nozzle launch": water blasts upward
                const p1 = new BABYLON.Vector3(
                    p0.x + offsetX * 0.3,
                    p0.y + totalDrop * 0.6,    // rise 60% of the total drop ABOVE the building
                    p0.z + offsetZ * 0.3
                );

                // HIGH ARC: Control point 2 — the peak, high and spread outward
                // This is the top of the fountain arc
                const p2 = new BABYLON.Vector3(
                    midX + offsetX * 0.8,
                    p0.y + totalDrop * 0.35,   // still well above building base
                    midZ + offsetZ * 0.8
                );

                // Generate cubic Bézier curve (32 segments)
                const segments = 32;
                const pts = [];
                for (let i = 0; i <= segments; i++) {
                    pts.push(this._cubicBezier(p0, p1, p2, p3, i / segments));
                }

                // Color gradient: bright at nozzle, fading as stream falls
                const cols = [];
                for (let i = 0; i <= segments; i++) {
                    const t = i / segments;
                    const brightness = 1.0 - t * 0.35;
                    const alpha = 0.65 - t * 0.2;
                    cols.push(new BABYLON.Color4(
                        addrColor.r * brightness,
                        addrColor.g * brightness,
                        addrColor.b * brightness,
                        alpha
                    ));
                }

                allLines.push(pts);
                allColors.push(cols);
                splashPositions.push({ x: p3.x, y: p3.y, z: p3.z });

                // Store curve control points for droplet animation
                streamCurves.push({ p0, p1, p2, p3, color: addrColor });

                streamIndex++;
            });
        });

        if (allLines.length === 0) return;

        // ── Fountain stream lines (single draw call) ──
        this._lineSystem = BABYLON.MeshBuilder.CreateLineSystem('memoryPoolStreams', {
            lines: allLines,
            colors: allColors
        }, this.scene);
        this._lineMat = new BABYLON.StandardMaterial('memoryPoolStreamMat', this.scene);
        this._lineMat.emissiveColor = new BABYLON.Color3(0.25, 0.65, 0.85);
        this._lineMat.disableLighting = true;
        this._lineMat.freeze();
        this._lineSystem.material = this._lineMat;
        this._lineSystem.isPickable = false;
        this._lineSystem.freezeWorldMatrix();

        // ── Splash rings at landing points (thin-instanced) ──
        if (splashPositions.length > 0) {
            this._splashMat = new BABYLON.StandardMaterial('memorySplashMat', this.scene);
            this._splashMat.emissiveColor = new BABYLON.Color3(0.35, 0.75, 0.95);
            this._splashMat.diffuseColor = new BABYLON.Color3(0.2, 0.5, 0.8);
            this._splashMat.alpha = 0.4;
            this._splashMat.freeze();

            this._splashRoot = BABYLON.MeshBuilder.CreateTorus('memorySplashRoot', {
                diameter: 1.4,
                thickness: 0.06,
                tessellation: 32
            }, this.scene);
            this._splashRoot.material = this._splashMat;
            this._splashRoot.isPickable = false;
            this._splashRoot.isVisible = false;

            for (const sp of splashPositions) {
                const mat = BABYLON.Matrix.Translation(sp.x, sp.y + 0.1, sp.z);
                this._splashRoot.thinInstanceAdd(mat);
            }
            this._splashRoot.thinInstanceRefreshBoundingInfo();
            this._splashRoot.freezeWorldMatrix();
        }

        // ── Animated flowing droplets ──
        this._spawnFlowingDroplets(streamCurves);
    }

    // ─── Animated Droplets ─────────────────────────────────────────

    /**
     * Spawn small spheres that continuously flow along each stream path.
     * Each stream gets 3 droplets staggered at different t-offsets so they
     * appear to be a continuous flow of water. Uses a single shared material
     * and a registerBeforeRender loop that updates positions each frame.
     */
    _spawnFlowingDroplets(streamCurves) {
        if (streamCurves.length === 0) return;

        // Shared material for all droplets
        this._dropletMat = new BABYLON.StandardMaterial('memoryDropletMat', this.scene);
        this._dropletMat.emissiveColor = new BABYLON.Color3(0.5, 0.85, 1.0);
        this._dropletMat.diffuseColor = new BABYLON.Color3(0.3, 0.7, 0.95);
        this._dropletMat.alpha = 0.7;
        this._dropletMat.freeze();

        const dropletsPerStream = 3;

        for (let si = 0; si < streamCurves.length; si++) {
            const curve = streamCurves[si];

            for (let di = 0; di < dropletsPerStream; di++) {
                const sphere = BABYLON.MeshBuilder.CreateSphere(
                    `memDrop_${si}_${di}`,
                    { diameter: 0.3, segments: 4 },
                    this.scene
                );
                sphere.material = this._dropletMat;
                sphere.isPickable = false;

                this._droplets.push(sphere);
                this._dropletPaths.push({
                    p0: curve.p0,
                    p1: curve.p1,
                    p2: curve.p2,
                    p3: curve.p3,
                    // Stagger each droplet along the stream and add per-stream
                    // variation so they don't all move in lockstep
                    offset: di / dropletsPerStream,
                    speed: 0.3 + (si % 5) * 0.04  // slight speed variation
                });
            }
        }

        // Animation loop — update every droplet's position each frame
        let time = 0;
        this._dropletObserver = this.scene.onBeforeRenderObservable.add(() => {
            const dt = this.scene.getEngine().getDeltaTime() / 1000;
            time += dt;

            for (let i = 0; i < this._droplets.length; i++) {
                const drop = this._droplets[i];
                if (drop.isDisposed()) continue;

                const path = this._dropletPaths[i];
                // t cycles 0→1 then wraps. Each droplet is offset within the cycle.
                const rawT = ((time * path.speed) + path.offset) % 1.0;

                // Ease: accelerate as the droplet "falls" (gravity feel)
                // Use a power curve so the droplet moves slowly at the peak
                // and fast at the bottom — like real water
                const t = rawT * rawT * (3 - 2 * rawT); // smoothstep for natural motion

                const pos = this._cubicBezier(path.p0, path.p1, path.p2, path.p3, t);
                drop.position.copyFrom(pos);

                // Scale: smaller at peak (far away feel), bigger near endpoints
                const peakDist = Math.abs(t - 0.35);  // peak is roughly at t=0.35
                const scale = 0.22 + peakDist * 0.25;
                drop.scaling.setAll(scale);
            }
        });
    }

    // ─── Convergence Rings ─────────────────────────────────────────

    _renderConvergenceRings(addressPositions, poolY) {
        const shared = [];
        for (const [, pos] of addressPositions) {
            if (pos.count >= 2) shared.push(pos);
        }
        if (shared.length === 0) return;

        this._ringMat = new BABYLON.StandardMaterial('memoryRingMat', this.scene);
        this._ringMat.emissiveColor = new BABYLON.Color3(0.5, 0.9, 1.0);
        this._ringMat.diffuseColor = new BABYLON.Color3(0.3, 0.7, 0.9);
        this._ringMat.alpha = 0.55;
        this._ringMat.freeze();

        this._ringRoot = BABYLON.MeshBuilder.CreateTorus('memoryRingRoot', {
            diameter: 2.0,
            thickness: 0.1,
            tessellation: 24
        }, this.scene);
        this._ringRoot.material = this._ringMat;
        this._ringRoot.isPickable = false;
        this._ringRoot.isVisible = false;

        for (const pos of shared) {
            const mat = BABYLON.Matrix.Translation(pos.x, poolY + 0.5, pos.z);
            this._ringRoot.thinInstanceAdd(mat);
        }

        this._ringRoot.thinInstanceRefreshBoundingInfo();
        this._ringRoot.freezeWorldMatrix();
    }
}
