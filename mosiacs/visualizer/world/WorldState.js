/**
 * WorldState — The runtime simulation state engine (Phase 2).
 *
 * Building creation rules:
 *   Functions  – new building per invocation (unique key per CALL)
 *   Variables  – new building per DECL (reuses if same scope+name+addr is still active)
 *   For loops  – new building on first iteration of each loop run
 *   While loops– same as for loops (new building type)
 *   If/Branch  – building per CONDITION; if/elif/else chain linked together
 *
 * Each "container" building (function, for, while, if) records which
 * trace-step range it owns, so the renderer can spawn sub-spirals.
 */
class WorldState {
    constructor() {
        this.trace = [];
        this.currentStep = -1;

        // Persistent entities
        this.functionDistricts = new Map();
        this.variableHouses = new Map();
        this.forLoopFactories = new Map();
        this.whileLoopFactories = new Map();
        this.branchIntersections = new Map();
        this.memoryNodes = new Map();

        // Invocation counters for unique keys
        this._fnCallCount = new Map();
        this._forLoopCount = new Map();
        this._whileLoopCount = new Map();
        this._condCount = new Map();

        // Call stack
        this.callStack = [];

        // Track "active" containers for sub-step recording
        this._containerStack = [];

        this.processedSteps = [];

        // Ordered list of entity keys in the order they first appear in the trace.
        // This is used by the renderer to assign spiral slots in trace-order
        // instead of grouping by type.
        this.creationOrder = [];
    }

    loadTrace(trace) {
        this.trace = trace;
        this.reset();
    }

    reset() {
        this.currentStep = -1;
        this.functionDistricts.clear();
        this.variableHouses.clear();
        this.forLoopFactories.clear();
        this.whileLoopFactories.clear();
        this.branchIntersections.clear();
        this.memoryNodes.clear();
        this._fnCallCount.clear();
        this._forLoopCount.clear();
        this._whileLoopCount.clear();
        this._condCount.clear();
        this.callStack = [];
        this._containerStack = [];
        this.processedSteps = [];
        this.creationOrder = [];
    }

    seekTo(targetStep) {
        targetStep = Math.max(-1, Math.min(targetStep, this.trace.length - 1));
        if (targetStep < this.currentStep) this.reset();
        while (this.currentStep < targetStep) this._applyStep(this.currentStep + 1);
    }

    currentScope() {
        return this.callStack.length > 0
            ? this.callStack[this.callStack.length - 1]
            : '__global__';
    }

    // ─── internal: apply a single trace step ───────────────────────

    _applyStep(index) {
        const step = this.trace[index];
        this.currentStep = index;
        this.processedSteps.push(step);

        // Record this step index on all open containers
        for (const c of this._containerStack) {
            c.children.push(index);
        }

        switch (step.type) {
            case 'CALL':      this._handleCall(step); break;
            case 'RETURN':    this._handleReturn(step); break;
            case 'DECL':      this._handleDecl(step); break;
            case 'ASSIGN':    this._handleAssign(step); break;
            case 'LOOP':      this._handleLoop(step); break;
            case 'CONDITION': this._handleCondition(step); break;
            case 'BRANCH':    this._handleBranch(step); break;
        }
    }

    // ─── helpers ───────────────────────────────────────────────────

    _nextCount(map, base) {
        const n = (map.get(base) || 0) + 1;
        map.set(base, n);
        return n;
    }

    // ─── CALL — new building per invocation ────────────────────────

    _handleCall(step) {
        const n = this._nextCount(this._fnCallCount, step.name);
        const key = `fn_${step.name}_#${n}`;

        this.functionDistricts.set(key, {
            key,
            name: step.name,
            depth: step.depth,
            invocation: n,
            enterStep: this.currentStep,
            exitStep: null,
            active: true,
            localVars: [],
            returnValue: null,
            childStepIndices: []
        });

        this.creationOrder.push(key);

        this.callStack.push(key);
        this._containerStack.push({
            key, type: 'function',
            startStep: this.currentStep,
            endStep: null,
            children: this.functionDistricts.get(key).childStepIndices
        });
    }

    // ─── RETURN ────────────────────────────────────────────────────

    _handleReturn(step) {
        const key = this.callStack.length > 0
            ? this.callStack[this.callStack.length - 1]
            : null;

        if (key && this.functionDistricts.has(key)) {
            const d = this.functionDistricts.get(key);
            d.exitStep = this.currentStep;
            d.active = false;
            d.returnValue = step.value;

            d.localVars.forEach(vk => {
                const house = this.variableHouses.get(vk);
                if (house) house.active = false;
            });
        }

        this.callStack.pop();

        // Pop the matching container
        for (let i = this._containerStack.length - 1; i >= 0; i--) {
            if (this._containerStack[i].key === key) {
                this._containerStack[i].endStep = this.currentStep;
                this._containerStack.splice(i, 1);
                break;
            }
        }
    }

    // ─── DECL ──────────────────────────────────────────────────────

    _handleDecl(step) {
        const scope = this.currentScope();

        // Reuse existing active house for same scope+name+address
        let existingKey = null;
        for (const [k, v] of this.variableHouses) {
            if (v.scope === scope && v.name === step.name && v.address === step.address && v.active) {
                existingKey = k;
                break;
            }
        }

        if (existingKey) {
            const house = this.variableHouses.get(existingKey);
            house.values.push({ value: step.value, step: this.currentStep });
            house.currentValue = step.value;
            house.lastWriter = this.currentStep;
        } else {
            const key = `var_${scope}_${step.name}_${step.address}_s${this.currentStep}`;
            this.variableHouses.set(key, {
                key,
                name: step.name,
                address: step.address,
                scope,
                values: [{ value: step.value, step: this.currentStep }],
                currentValue: step.value,
                lastWriter: this.currentStep,
                declStep: this.currentStep,
                active: true
            });

            this.creationOrder.push(key);

            const fnKey = this.callStack.length > 0
                ? this.callStack[this.callStack.length - 1]
                : null;
            if (fnKey && this.functionDistricts.has(fnKey)) {
                const d = this.functionDistricts.get(fnKey);
                if (!d.localVars.includes(key)) d.localVars.push(key);
            }

            this._registerMemoryNode(step.address, key);
        }
    }

    // ─── ASSIGN ────────────────────────────────────────────────────

    _handleAssign(step) {
        const scope = this.currentScope();
        let house = null;
        for (const [, v] of this.variableHouses) {
            if (v.name === step.name && v.address === step.address && v.active) {
                house = v;
                if (v.scope === scope) break;
            }
        }

        if (house) {
            house.values.push({ value: step.value, step: this.currentStep });
            house.currentValue = step.value;
            house.lastWriter = this.currentStep;
        } else {
            this._handleDecl({ ...step, type: 'DECL' });
        }
    }

    // ─── LOOP — for vs while, new building on first iteration ──────

    _handleLoop(step) {
        const scope = this.currentScope();
        const isWhile = (step.subtype === 'while');
        const map = isWhile ? this.whileLoopFactories : this.forLoopFactories;
        const countMap = isWhile ? this._whileLoopCount : this._forLoopCount;
        const baseLookup = `${scope}_L${step.line}_${step.condition}`;

        // Find the currently-running factory for this source location
        let activeKey = null;
        for (const [k, f] of map) {
            if (f._baseLookup === baseLookup && f.running) {
                activeKey = k;
                break;
            }
        }

        if (activeKey && step.conditionResult) {
            // Continuing an existing loop run
            const factory = map.get(activeKey);
            factory.iterations++;
            factory.steps.push(this.currentStep);
        } else if (step.conditionResult) {
            // First iteration → new building
            const n = this._nextCount(countMap, baseLookup);
            const typeTag = isWhile ? 'while' : 'for';
            const key = `${typeTag}_${baseLookup}_#${n}`;

            const factory = {
                key,
                subtype: step.subtype,
                condition: step.condition,
                iterations: 1,
                active: true,
                running: true,
                steps: [this.currentStep],
                childStepIndices: [],
                _baseLookup: baseLookup
            };
            map.set(key, factory);

            this.creationOrder.push(key);

            this._containerStack.push({
                key, type: typeTag,
                startStep: this.currentStep,
                endStep: null,
                children: factory.childStepIndices
            });
        } else {
            // condition_result == 0 → loop ends
            if (activeKey) {
                const factory = map.get(activeKey);
                factory.running = false;
                factory.active = true;
                factory.steps.push(this.currentStep);

                for (let i = this._containerStack.length - 1; i >= 0; i--) {
                    if (this._containerStack[i].key === activeKey) {
                        this._containerStack[i].endStep = this.currentStep;
                        this._containerStack.splice(i, 1);
                        break;
                    }
                }
            }
        }
    }

    // ─── CONDITION ─────────────────────────────────────────────────

    _handleCondition(step) {
        const scope = this.currentScope();
        const baseLookup = `${scope}_L${step.line}_${step.name}`;
        const n = this._nextCount(this._condCount, baseLookup);
        const key = `cond_${baseLookup}_#${n}`;

        const intersection = {
            key,
            condition: step.name,
            result: !!step.conditionResult,
            chosenBranch: null,
            active: true,
            step: this.currentStep,
            childStepIndices: [],
            chainLinks: [],
            _baseLookup: baseLookup
        };
        this.branchIntersections.set(key, intersection);

        this.creationOrder.push(key);

        this._containerStack.push({
            key, type: 'branch',
            startStep: this.currentStep,
            endStep: null,
            children: intersection.childStepIndices
        });
    }

    // ─── BRANCH ────────────────────────────────────────────────────

    _handleBranch(step) {
        for (let i = this._containerStack.length - 1; i >= 0; i--) {
            const c = this._containerStack[i];
            if (c.type === 'branch') {
                const intersection = this.branchIntersections.get(c.key);
                if (intersection && !intersection.chosenBranch) {
                    intersection.chosenBranch = step.subtype || step.name || 'taken';
                    intersection.chainLinks.push({
                        branch: intersection.chosenBranch,
                        step: this.currentStep
                    });
                    c.endStep = this.currentStep;
                    this._containerStack.splice(i, 1);
                    break;
                }
            }
        }
    }

    // ─── Memory ────────────────────────────────────────────────────

    _registerMemoryNode(address, houseKey) {
        if (!address || address === '0') return;
        if (!this.memoryNodes.has(address)) {
            this.memoryNodes.set(address, { address, variables: new Set() });
        }
        this.memoryNodes.get(address).variables.add(houseKey);
    }

    // ─── Snapshot ──────────────────────────────────────────────────

    getSnapshot() {
        return {
            step: this.currentStep,
            totalSteps: this.trace.length,
            trace: this.trace,
            creationOrder: [...this.creationOrder],
            functions: [...this.functionDistricts.values()],
            variables: [...this.variableHouses.values()],
            loops: [...this.forLoopFactories.values()],
            whileLoops: [...this.whileLoopFactories.values()],
            branches: [...this.branchIntersections.values()],
            memory: [...this.memoryNodes.values()],
            callStack: [...this.callStack],
            currentEvent: this.currentStep >= 0 ? this.trace[this.currentStep] : null
        };
    }
}
