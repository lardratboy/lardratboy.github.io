# DataPrism Refactoring Plan

## Goals

1. **Modularity**: Break monolithic structure into focused, reusable modules
2. **Maintainability**: Easier to understand, test, and modify
3. **Testability**: Enable unit and integration testing
4. **Extensibility**: Simple to add new projections, colors, features
5. **Performance**: Maintain or improve current performance
6. **Deployment**: Keep single-file deployment option

## Proposed Module Structure

### Core Modules

#### 1. `core/FileProcessor.js`
**Responsibility**: File loading, validation, chunking

**Exports**:
```javascript
class FileProcessor {
    static validateFile(file)
    static chunkFile(file, chunkSize)
    static calculateStats(file)
    async loadFile(file)
    async *getChunks() // Generator
}
```

**Size**: ~100-150 lines

---

#### 2. `core/WorkerPool.js`
**Responsibility**: Worker lifecycle, task distribution

**Exports**:
```javascript
class WorkerPool {
    constructor(size, workerScript)
    async process(tasks)
    terminate()
    resize(newSize)
}
```

**Size**: ~150-200 lines

---

#### 3. `projections/ProjectionFactory.js`
**Responsibility**: Coordinate projection algorithms

**Exports**:
```javascript
class ProjectionFactory {
    static create(mode, config)
    static getAvailableModes()
}

// Individual projection classes
class SimpleGridProjection { project(index, value, context) }
class HilbertProjection { project(index, value, context) }
class ZCurveProjection { project(index, value, context) }
class BitInterleavingProjection { project(index, value, context) }
class FibonacciProjection { project(index, value, context) }
class RandomProjection { project(index, value, context) }
```

**Size**: ~400-500 lines total
- ProjectionFactory: ~50 lines
- SimpleGrid: ~40 lines
- Hilbert: ~100 lines
- ZCurve: ~60 lines
- BitInterleaving: ~50 lines
- Fibonacci: ~60 lines
- Random: ~30 lines

---

#### 4. `colors/ColorFactory.js`
**Responsibility**: Color mapping algorithms

**Exports**:
```javascript
class ColorFactory {
    static create(mode, config)
    static getAvailableModes()
}

// Color scheme classes
class ByteValueColor { compute(value, context) }
class RGBSplitColor { compute(value, context) }
class PositionColor { compute(value, context) }
class EntropyColor { compute(value, context) }
class GradientColor { compute(value, context) }
```

**Size**: ~300-400 lines total
- ColorFactory: ~40 lines
- ByteValue: ~30 lines
- RGBSplit: ~50 lines
- Position: ~40 lines
- Entropy: ~80 lines
- Gradient: ~60 lines
- Utilities (HSL/RGB): ~50 lines

---

#### 5. `processing/TupleProcessor.js`
**Responsibility**: Byte tuple extraction and processing

**Exports**:
```javascript
class TupleProcessor {
    static process(data, mode)
    static get2Tuples(data)
    static get3Tuples(data)
    static get4Tuples(data)
    static get8Tuples(data)
}
```

**Size**: ~150-200 lines

---

#### 6. `spatial/BVHBuilder.js`
**Responsibility**: Bounding volume hierarchy construction

**Exports**:
```javascript
class BVHNode {
    constructor(min, max, points)
    split()
    getBounds()
}

class BVHBuilder {
    static build(points, maxDepth)
    static flatten(root)
}
```

**Size**: ~200-250 lines

---

#### 7. `rendering/SceneManager.js`
**Responsibility**: THREE.js scene setup and management

**Exports**:
```javascript
class SceneManager {
    constructor(container)
    setupScene()
    setupCamera()
    setupRenderer()
    setupControls()
    setupLights()
    clear()
    dispose()
}
```

**Size**: ~200-250 lines

---

#### 8. `rendering/PointCloudBuilder.js`
**Responsibility**: Point cloud geometry creation

**Exports**:
```javascript
class PointCloudBuilder {
    static createPointCloud(processedData, options)
    static createPointGeometry(points, colors, numPoints)
    static createPathLines(points, colors, numPoints)
    static createBVHVisualization(bvhNodes)
}
```

**Size**: ~200-250 lines

---

#### 9. `ui/ControlPanel.js`
**Responsibility**: UI controls and settings

**Exports**:
```javascript
class ControlPanel {
    constructor(container, onChange)
    getSettings()
    updateSetting(key, value)
    minimize()
    restore()
    showStats(stats)
}
```

**Size**: ~200-250 lines

---

#### 10. `ui/DropZone.js`
**Responsibility**: Drag-and-drop file handling

**Exports**:
```javascript
class DropZone {
    constructor(container, onFileDrop)
    show()
    hide()
    enable()
    disable()
}
```

**Size**: ~100-150 lines

---

#### 11. `workers/ChunkWorker.js`
**Responsibility**: Chunk processing in worker context

**Exports**: Worker script (to be compiled/bundled)
```javascript
// Message handler
self.onmessage = (e) => {
    const result = processChunk(e.data)
    self.postMessage(result)
}

function processChunk(config) {
    // Processing logic
}
```

**Size**: ~600-800 lines (includes all projection/color logic)

---

#### 12. `utils/MathUtils.js`
**Responsibility**: Mathematical helper functions

**Exports**:
```javascript
class MathUtils {
    static hilbertIndex(x, y, z, order)
    static mortonEncode(x, y, z)
    static interleave(a, b, c)
    static fibonacci(n)
    static clamp(value, min, max)
    static lerp(a, b, t)
}
```

**Size**: ~150-200 lines

---

#### 13. `utils/GeometryUtils.js`
**Responsibility**: Geometry helper functions

**Exports**:
```javascript
class GeometryUtils {
    static computeBounds(points)
    static computeCenter(points)
    static createBoundingBox(min, max)
    static disposeGeometry(geometry)
}
```

**Size**: ~100-150 lines

---

#### 14. `core/DataPrism.js`
**Responsibility**: Main application orchestrator

**Exports**:
```javascript
class DataPrism {
    constructor(container, options)
    async loadFile(file)
    updateSettings(settings)
    resetCamera()
    dispose()
}
```

**Size**: ~300-400 lines (much thinner than current main class)

---

## File Structure

```
dataprism/
├── src/
│   ├── core/
│   │   ├── DataPrism.js          // Main orchestrator
│   │   ├── FileProcessor.js      // File handling
│   │   └── WorkerPool.js         // Worker management
│   ├── projections/
│   │   ├── ProjectionFactory.js
│   │   ├── SimpleGrid.js
│   │   ├── Hilbert.js
│   │   ├── ZCurve.js
│   │   ├── BitInterleaving.js
│   │   ├── Fibonacci.js
│   │   └── Random.js
│   ├── colors/
│   │   ├── ColorFactory.js
│   │   ├── ByteValue.js
│   │   ├── RGBSplit.js
│   │   ├── Position.js
│   │   ├── Entropy.js
│   │   └── Gradient.js
│   ├── processing/
│   │   └── TupleProcessor.js
│   ├── spatial/
│   │   └── BVHBuilder.js
│   ├── rendering/
│   │   ├── SceneManager.js
│   │   └── PointCloudBuilder.js
│   ├── ui/
│   │   ├── ControlPanel.js
│   │   └── DropZone.js
│   ├── workers/
│   │   └── ChunkWorker.js
│   └── utils/
│       ├── MathUtils.js
│       └── GeometryUtils.js
├── dist/
│   └── dataprism.html           // Single-file build
├── docs/
│   ├── readme.md
│   ├── dataprism.md
│   ├── agents.md
│   ├── claude.md
│   └── todo.md
├── tests/
│   ├── unit/
│   └── integration/
└── build/
    └── bundle.js                // Build script
```

## Refactoring Strategy

### Phase 1: Extract Pure Functions
**Duration**: 1-2 days

1. Extract projection algorithms
2. Extract color functions
3. Extract math utilities
4. **Goal**: Testable pure functions

**Files Created**:
- `utils/MathUtils.js`
- `projections/*.js`
- `colors/*.js`

### Phase 2: Extract Workers
**Duration**: 1 day

1. Create `ChunkWorker.js`
2. Move worker code from inline
3. Set up worker bundling
4. **Goal**: Separate worker context

**Files Created**:
- `workers/ChunkWorker.js`
- Worker build configuration

### Phase 3: Extract UI Components
**Duration**: 1-2 days

1. Create `ControlPanel.js`
2. Create `DropZone.js`
3. Separate UI event handling
4. **Goal**: Isolated UI logic

**Files Created**:
- `ui/ControlPanel.js`
- `ui/DropZone.js`

### Phase 4: Extract Processing Logic
**Duration**: 2-3 days

1. Create `FileProcessor.js`
2. Create `TupleProcessor.js`
3. Create `BVHBuilder.js`
4. Create `WorkerPool.js`
5. **Goal**: Separate data processing

**Files Created**:
- `core/FileProcessor.js`
- `processing/TupleProcessor.js`
- `spatial/BVHBuilder.js`
- `core/WorkerPool.js`

### Phase 5: Extract Rendering
**Duration**: 2-3 days

1. Create `SceneManager.js`
2. Create `PointCloudBuilder.js`
3. Separate THREE.js logic
4. **Goal**: Isolated rendering

**Files Created**:
- `rendering/SceneManager.js`
- `rendering/PointCloudBuilder.js`
- `utils/GeometryUtils.js`

### Phase 6: Create Main Orchestrator
**Duration**: 1-2 days

1. Create lean `DataPrism.js`
2. Wire up all modules
3. Test integration
4. **Goal**: Clean architecture

**Files Created**:
- `core/DataPrism.js`

### Phase 7: Build System
**Duration**: 1-2 days

1. Set up module bundler (esbuild/rollup)
2. Create single-file build
3. Inline CSS
4. Bundle workers
5. **Goal**: Single HTML file output

**Files Created**:
- Build scripts
- `dist/dataprism.html`

### Phase 8: Testing & Documentation
**Duration**: 2-3 days

1. Write unit tests
2. Write integration tests
3. Update documentation
4. Performance testing
5. **Goal**: Production-ready

**Files Created**:
- Test files
- Updated docs

**Total Estimated Duration**: 12-18 days

## Build System

### Option 1: esbuild
**Pros**: Fast, simple, great for bundling
**Cons**: Less plugin ecosystem

```javascript
// build.js
require('esbuild').build({
    entryPoints: ['src/core/DataPrism.js'],
    bundle: true,
    outfile: 'dist/dataprism.bundle.js',
    format: 'iife',
    minify: true
})
```

### Option 2: Rollup
**Pros**: Better tree-shaking, plugins
**Cons**: Slower than esbuild

```javascript
// rollup.config.js
export default {
    input: 'src/core/DataPrism.js',
    output: {
        file: 'dist/dataprism.bundle.js',
        format: 'iife',
        name: 'DataPrism'
    }
}
```

### HTML Template
```html
<!DOCTYPE html>
<html>
<head>
    <title>DataPrism</title>
    <style>/* Inlined CSS */</style>
</head>
<body>
    <div id="container"></div>
    <script src="three.min.js"></script>
    <script src="tween.min.js"></script>
    <script>/* Bundled application */</script>
    <script>
        // Initialize
        const app = new DataPrism('#container');
    </script>
</body>
</html>
```

## Module Interfaces

### Example: Projection Module
```javascript
// projections/ProjectionFactory.js
export class ProjectionFactory {
    static modes = new Map([
        ['simple-grid', SimpleGridProjection],
        ['hilbert', HilbertProjection],
        ['z-curve', ZCurveProjection],
        // ... more
    ]);
    
    static create(mode, config = {}) {
        const ProjectionClass = this.modes.get(mode);
        if (!ProjectionClass) {
            throw new Error(`Unknown projection mode: ${mode}`);
        }
        return new ProjectionClass(config);
    }
    
    static getAvailableModes() {
        return Array.from(this.modes.keys());
    }
}

// Base class for all projections
export class Projection {
    constructor(config) {
        this.config = config;
    }
    
    // Must be implemented by subclasses
    project(index, value, context) {
        throw new Error('project() must be implemented');
    }
}
```

### Example: Color Module
```javascript
// colors/ColorFactory.js
export class ColorFactory {
    static modes = new Map([
        ['byte-value', ByteValueColor],
        ['rgb', RGBSplitColor],
        // ... more
    ]);
    
    static create(mode, config = {}) {
        const ColorClass = this.modes.get(mode);
        if (!ColorClass) {
            throw new Error(`Unknown color mode: ${mode}`);
        }
        return new ColorClass(config);
    }
}

export class ColorScheme {
    compute(value, context) {
        throw new Error('compute() must be implemented');
    }
}
```

### Example: Worker Communication
```javascript
// core/WorkerPool.js
export class WorkerPool {
    async process(tasks) {
        const promises = tasks.map((task, i) => {
            const worker = this.workers[i % this.workers.length];
            return this.sendTask(worker, task);
        });
        return Promise.all(promises);
    }
    
    sendTask(worker, task) {
        return new Promise((resolve, reject) => {
            const handler = (e) => {
                worker.removeEventListener('message', handler);
                resolve(e.data);
            };
            worker.addEventListener('message', handler);
            worker.postMessage(task, [task.arrayBuffer]);
        });
    }
}
```

## Testing Strategy

### Unit Tests (Jest/Vitest)
```javascript
// tests/unit/projections/Hilbert.test.js
import { HilbertProjection } from '@/projections/Hilbert';

describe('HilbertProjection', () => {
    test('projects index 0 to origin', () => {
        const proj = new HilbertProjection({ order: 3 });
        const [x, y, z] = proj.project(0, 42, {});
        expect([x, y, z]).toEqual([0, 0, 0]);
    });
    
    test('maintains locality', () => {
        const proj = new HilbertProjection({ order: 3 });
        const p1 = proj.project(0, 0, {});
        const p2 = proj.project(1, 0, {});
        const distance = Math.hypot(
            p2[0] - p1[0],
            p2[1] - p1[1],
            p2[2] - p1[2]
        );
        expect(distance).toBeLessThanOrEqual(1);
    });
});
```

### Integration Tests
```javascript
// tests/integration/file-processing.test.js
import { DataPrism } from '@/core/DataPrism';

describe('File Processing', () => {
    test('loads and processes file', async () => {
        const container = document.createElement('div');
        const app = new DataPrism(container);
        
        const file = new File(['test data'], 'test.bin');
        await app.loadFile(file);
        
        expect(app.pointClouds.length).toBeGreaterThan(0);
    });
});
```

## Migration Path

### Backward Compatibility
1. Keep `ChunkedBinaryViewer.html` as legacy version
2. Create `DataPrism.html` as new modular version
3. Both versions available during transition
4. Deprecate old version after testing

### API Stability
```javascript
// Old way (still works)
const app = new BinaryPointCloudViewer();

// New way (recommended)
const app = new DataPrism('#container', {
    gridSize: 5,
    chunkSize: 2048,
    // ... options
});
```

## Performance Considerations

### Module Loading
- Use ES6 modules with static imports
- Bundle into single file for production
- Tree-shaking removes unused code

### Worker Bundle Size
- Keep worker bundle minimal
- Only include processing logic
- Avoid THREE.js in worker

### Memory Management
- Maintain current disposal patterns
- Add module-level cleanup hooks
- Test for memory leaks

## Documentation Updates

All documentation files (`readme.md`, `dataprism.md`, `agents.md`, `claude.md`, `todo.md`) should be updated to reflect:
1. New module structure
2. Updated API examples
3. Build instructions
4. Testing procedures
5. Contributing guidelines

## Success Metrics

1. **Code Quality**
   - Cyclomatic complexity < 10 per function
   - File size < 300 lines per module
   - Test coverage > 80%

2. **Performance**
   - Load time ≤ current
   - Processing time ≤ current
   - Memory usage ≤ current

3. **Maintainability**
   - New projection mode: < 100 lines
   - New color scheme: < 100 lines
   - New feature: < 500 lines

4. **Developer Experience**
   - Clear module boundaries
   - Self-documenting code
   - Easy to test
   - Simple to extend

## Risks & Mitigations

### Risk 1: Performance Degradation
**Mitigation**: Benchmark before/after, maintain hot paths

### Risk 2: Increased Complexity
**Mitigation**: Clear documentation, simple interfaces

### Risk 3: Build System Issues
**Mitigation**: Keep build simple, test thoroughly

### Risk 4: Worker Bundling
**Mitigation**: Test worker generation, use proven tools

### Risk 5: Breaking Changes
**Mitigation**: Maintain backward compatibility, version properly

## Next Steps

1. Review and approve refactoring plan
2. Set up development branch
3. Begin Phase 1 (Pure Functions)
4. Establish testing framework
5. Iterative development with frequent testing
6. Regular progress reviews
7. Final migration and release

## Questions to Resolve

1. Bundler choice: esbuild vs rollup vs webpack?
2. Test framework: Jest vs Vitest vs custom?
3. Module system: ES6 modules or other?
4. Worker bundling strategy?
5. Versioning scheme?
6. Release cadence?
7. Backward compatibility duration?

---

**Target Completion**: 3-4 weeks with focused effort
**Estimated LOC**: ~3500-4000 (vs current ~2800, but more maintainable)
**Module Count**: 14 main modules + utilities
**Test Files**: 20-30 test files
