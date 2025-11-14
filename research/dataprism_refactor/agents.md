# DataPrism - Agent Guidance Document

This document provides guidance for AI coding assistants (like Claude, GPT, etc.) working on the DataPrism codebase.

## Project Overview

DataPrism is a 3D binary file visualization tool that:
- Maps binary data to 3D point clouds
- Uses Web Workers for parallel processing
- Renders with THREE.js and WebGL
- Supports multiple projection algorithms (Hilbert curves, Z-curves, grids, etc.)
- Provides real-time interactive visualization

## Code Style & Conventions

### General Principles
1. **Vanilla JavaScript**: Use modern ES6+ features but NO frameworks (React, Vue, etc.)
2. **HTML5 Idioms**: Follow HTML5 best practices
3. **Single File Preference**: When possible, bundle everything into one HTML file
4. **No Alerts**: Never use `alert()` - use console logging instead
5. **Self-Documenting**: Code should be readable without excessive comments

### JavaScript Style
```javascript
// ✅ Good: Modern ES6+ syntax
class ProjectionFactory {
    static create(mode, config = {}) {
        return new this.modes.get(mode)(config);
    }
}

// ✅ Good: Arrow functions for callbacks
workers.forEach(worker => worker.terminate());

// ✅ Good: Destructuring
const { points, colors, numPoints } = processedData;

// ✅ Good: Template literals
console.log(`Created ${numPoints} points in ${time}s`);

// ❌ Bad: alert() is forbidden
alert('File loaded'); // NEVER DO THIS

// ✅ Good: Console logging instead
console.log('File loaded');

// ✅ Good: Clear variable names
const projectionMode = 'hilbert';
const chunkSize = 2048;

// ❌ Bad: Unclear abbreviations
const pm = 'h';
const cs = 2048;
```

### Naming Conventions
- **Classes**: PascalCase (`ProjectionFactory`, `BVHBuilder`)
- **Functions/Methods**: camelCase (`computeColor`, `projectPoint`)
- **Constants**: UPPER_SNAKE_CASE (`MAX_WORKERS`, `DEFAULT_CHUNK_SIZE`)
- **Private properties**: Prefix with underscore (`_internalState`)
- **File names**: Match class name (`ProjectionFactory.js`)

### File Organization
```javascript
// Standard module structure:

// 1. Imports (if using modules)
import { MathUtils } from './utils/MathUtils.js';

// 2. Constants
const MAX_ITERATIONS = 100;
const DEFAULT_CONFIG = { /* ... */ };

// 3. Helper functions (if needed)
function helperFunction() { /* ... */ }

// 4. Main class
export class MainClass {
    constructor() { /* ... */ }
    
    // Public methods
    publicMethod() { /* ... */ }
    
    // Private methods (underscore prefix)
    _privateMethod() { /* ... */ }
}

// 5. Exports
export { MainClass, MAX_ITERATIONS };
```

## Project Architecture

### Current State: Monolithic
- Single HTML file with ~2800 lines
- Inline Web Worker code
- Embedded CSS
- All logic in one namespace

### Target State: Modular
- 14+ focused modules
- Separate worker files
- Clear separation of concerns
- Maintained single-file build option

### Key Architectural Layers
1. **Core Layer**: Application orchestration, file handling
2. **Processing Layer**: Data transformation, workers
3. **Projection Layer**: Coordinate mapping algorithms
4. **Color Layer**: Color scheme implementations
5. **Spatial Layer**: BVH and spatial structures
6. **Rendering Layer**: THREE.js integration
7. **UI Layer**: Controls and interactions
8. **Utility Layer**: Math and helper functions

## Module Interaction Rules

### Dependencies Should Flow
```
UI Layer → Core Layer → Processing Layer → Utility Layer
         → Rendering Layer →
```

### Never Allow
- Circular dependencies
- UI depending on rendering internals
- Workers depending on THREE.js
- Utils depending on application state

### Communication Patterns
```javascript
// ✅ Good: Event-based communication
class ControlPanel {
    constructor(onChange) {
        this.onChange = onChange;
    }
    
    handleChange(setting, value) {
        this.onChange({ setting, value });
    }
}

// ✅ Good: Promise-based async
async loadFile(file) {
    const chunks = await this.fileProcessor.chunkFile(file);
    const results = await this.workerPool.process(chunks);
    return results;
}

// ❌ Bad: Tight coupling
class ControlPanel {
    handleChange() {
        // Directly modifying global state
        window.app.settings.value = newValue;
    }
}
```

## Common Tasks & Patterns

### Adding a New Projection Mode

1. Create new projection class:
```javascript
// projections/MyProjection.js
import { Projection } from './Projection.js';

export class MyProjection extends Projection {
    constructor(config) {
        super(config);
        // Initialize
    }
    
    project(index, value, context) {
        // Your algorithm here
        const x = /* ... */;
        const y = /* ... */;
        const z = /* ... */;
        return [x, y, z];
    }
}
```

2. Register in factory:
```javascript
// projections/ProjectionFactory.js
import { MyProjection } from './MyProjection.js';

ProjectionFactory.modes.set('my-mode', MyProjection);
```

3. Update worker code to include projection
4. Add UI option
5. Write tests
6. Document in readme

### Adding a New Color Scheme

1. Create color class:
```javascript
// colors/MyColorScheme.js
export class MyColorScheme {
    compute(value, context) {
        const r = /* ... */;
        const g = /* ... */;
        const b = /* ... */;
        return [r, g, b];
    }
}
```

2. Register in ColorFactory
3. Update worker
4. Add UI option
5. Test and document

### Processing Large Files

```javascript
// ✅ Good: Chunked processing with progress
async processLargeFile(file) {
    const chunkSize = this.settings.chunkSize;
    const totalChunks = Math.ceil(file.size / chunkSize);
    
    for (let i = 0; i < totalChunks; i++) {
        const chunk = await this.readChunk(file, i, chunkSize);
        const result = await this.processChunk(chunk);
        this.addToScene(result);
        
        // Update progress
        const progress = ((i + 1) / totalChunks) * 100;
        console.log(`Progress: ${progress.toFixed(1)}%`);
    }
}

// ❌ Bad: Loading entire file into memory
async processLargeFile(file) {
    const entireFile = await file.arrayBuffer(); // Memory issue!
    // Process all at once
}
```

### Worker Communication

```javascript
// ✅ Good: Transferable objects
const arrayBuffer = await file.slice(offset, offset + size).arrayBuffer();
worker.postMessage({
    chunkIndex: i,
    arrayBuffer: arrayBuffer,
    // ... config
}, [arrayBuffer]); // Transfer, don't copy!

// ❌ Bad: Copying large data
worker.postMessage({
    chunkIndex: i,
    arrayBuffer: arrayBuffer // Copied, not transferred
});
```

### Memory Management

```javascript
// ✅ Good: Proper cleanup
dispose() {
    // Dispose geometries
    this.pointClouds.forEach(cloud => {
        cloud.geometry.dispose();
        cloud.material.dispose();
    });
    
    // Clear arrays
    this.pointClouds.length = 0;
    
    // Terminate workers
    this.workerPool.terminate();
    
    // Remove event listeners
    this.removeEventListeners();
}

// ❌ Bad: Memory leaks
dispose() {
    this.pointClouds = []; // Geometries not disposed!
}
```

## Testing Guidelines

### Unit Tests
```javascript
// tests/unit/projections/Hilbert.test.js
import { HilbertProjection } from '@/projections/Hilbert';

describe('HilbertProjection', () => {
    let projection;
    
    beforeEach(() => {
        projection = new HilbertProjection({ order: 3 });
    });
    
    test('projects origin correctly', () => {
        const [x, y, z] = projection.project(0, 0, {});
        expect([x, y, z]).toEqual([0, 0, 0]);
    });
    
    test('maintains locality', () => {
        const p1 = projection.project(0, 0, {});
        const p2 = projection.project(1, 0, {});
        const dist = distance(p1, p2);
        expect(dist).toBeLessThanOrEqual(1);
    });
});
```

### Integration Tests
```javascript
describe('File Loading Pipeline', () => {
    test('processes file end-to-end', async () => {
        const app = new DataPrism('#container');
        const file = createTestFile(1024);
        
        await app.loadFile(file);
        
        expect(app.pointClouds.length).toBeGreaterThan(0);
        expect(app.scene.children.length).toBeGreaterThan(0);
    });
});
```

### Test Coverage Goals
- Pure functions: 100%
- Core logic: 90%+
- UI components: 70%+
- Integration: Key workflows

## Performance Optimization

### Critical Paths
1. **File chunking**: Must be fast, minimal copying
2. **Worker processing**: Parallel, efficient algorithms
3. **Geometry creation**: Use BufferGeometry, static usage hints
4. **Rendering**: Let THREE.js optimize, don't interfere

### Performance Patterns
```javascript
// ✅ Good: BufferGeometry with usage hints
const geometry = new THREE.BufferGeometry();
const positions = new Float32Array(numPoints * 3);
const positionAttribute = new THREE.BufferAttribute(positions, 3);
positionAttribute.setUsage(THREE.StaticDrawUsage);
geometry.setAttribute('position', positionAttribute);

// ✅ Good: Reuse objects
const tempVector = new THREE.Vector3();
for (const point of points) {
    tempVector.set(point.x, point.y, point.z);
    // Use tempVector
}

// ❌ Bad: Creating objects in loops
for (const point of points) {
    const vector = new THREE.Vector3(point.x, point.y, point.z); // GC pressure!
}
```

### Profiling
Always profile before optimizing:
```javascript
console.time('operation');
// ... code to profile
console.timeEnd('operation');

// Or more detailed:
const start = performance.now();
// ... code
const end = performance.now();
console.log(`Took ${(end - start).toFixed(2)}ms`);
```

## Common Pitfalls to Avoid

### 1. Context Loss
```javascript
// ✅ Good: Handle context loss
canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    this.contextLost = true;
    console.error('WebGL context lost');
});

canvas.addEventListener('webglcontextrestored', () => {
    this.contextLost = false;
    this.reinitialize();
});
```

### 2. Worker Errors
```javascript
// ✅ Good: Error handling in workers
self.onmessage = (e) => {
    try {
        const result = processChunk(e.data);
        self.postMessage({ success: true, data: result });
    } catch (error) {
        self.postMessage({ 
            success: false, 
            error: error.message,
            stack: error.stack 
        });
    }
};
```

### 3. Memory Leaks
```javascript
// ✅ Good: Clean up event listeners
class Component {
    constructor() {
        this.handleResize = this.handleResize.bind(this);
        window.addEventListener('resize', this.handleResize);
    }
    
    dispose() {
        window.removeEventListener('resize', this.handleResize);
    }
}
```

### 4. Blocking Main Thread
```javascript
// ✅ Good: Use workers for heavy computation
async function heavyComputation(data) {
    return await workerPool.process(data);
}

// ❌ Bad: Heavy computation on main thread
function heavyComputation(data) {
    for (let i = 0; i < 1000000; i++) {
        // Blocks UI!
    }
}
```

## Debugging Tips

### Console Logging Strategy
```javascript
// Development: Verbose logging
console.log(`Processing chunk ${i}/${total}`);
console.log(`Created ${numPoints} points`);
console.log(`Projection: ${projectionMode}`);

// Production: Minimal logging
if (DEBUG) {
    console.log(...);
}

// Errors: Always log with context
console.error('Failed to process chunk:', {
    chunkIndex,
    error: error.message,
    stack: error.stack
});
```

### Performance Debugging
```javascript
// Mark specific operations
performance.mark('chunk-start');
processChunk();
performance.mark('chunk-end');
performance.measure('chunk-processing', 'chunk-start', 'chunk-end');

// View in DevTools Performance tab
const measures = performance.getEntriesByType('measure');
console.table(measures);
```

## Dependencies

### THREE.js (r128)
- Core 3D rendering library
- Use CDN: `https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js`
- Key classes: Scene, Camera, Renderer, BufferGeometry, Points
- OrbitControls for camera manipulation

### TWEEN.js
- Animation library
- Use CDN: `https://cdnjs.cloudflare.com/ajax/libs/tween.js/18.6.4/tween.umd.js`
- For smooth camera transitions

### No Other Dependencies
- Keep dependencies minimal
- Prefer vanilla JS solutions
- Avoid npm packages for client-side code

## Build & Deploy

### Development
```bash
# Simple HTTP server
python -m http.server 8000
# or
npx serve .
```

### Building Single File
```javascript
// build.js - example bundler script
import { build } from 'esbuild';

await build({
    entryPoints: ['src/core/DataPrism.js'],
    bundle: true,
    outfile: 'dist/bundle.js',
    format: 'iife',
    minify: true
});

// Then inline into HTML template
```

### Testing Build
```bash
# Run tests
npm test

# Check bundle size
ls -lh dist/dataprism.html

# Profile performance
# Open in Chrome DevTools Performance tab
```

## Documentation Standards

### Code Comments
```javascript
/**
 * Projects a byte index to 3D coordinates using Hilbert curve.
 * 
 * @param {number} index - Byte position in file
 * @param {number} value - Byte value (0-255)
 * @param {Object} context - Additional context (prev/next bytes)
 * @returns {Array<number>} [x, y, z] coordinates
 */
project(index, value, context) {
    // Implementation
}
```

### Inline Comments
```javascript
// Calculate grid dimensions
const gridSize = Math.cbrt(totalBytes);

// Apply Hilbert curve transformation
const [x, y, z] = hilbertIndex(index, order);

// Map to world coordinates
return [
    (x - gridSize / 2) * spacing,
    (y - gridSize / 2) * spacing,
    (z - gridSize / 2) * spacing
];
```

## Refactoring Guidelines

### When Refactoring
1. **Write tests first** for existing behavior
2. **Small changes**: One module at a time
3. **Test frequently**: After each change
4. **Commit often**: Small, focused commits
5. **Keep working**: Old version should always work
6. **Document changes**: Update relevant docs

### Refactoring Checklist
- [ ] Tests pass before refactoring
- [ ] Extract module
- [ ] Write module tests
- [ ] Update imports/exports
- [ ] Integration tests pass
- [ ] Performance unchanged
- [ ] Documentation updated
- [ ] Commit changes

## Communication with Human Developer

### When Unsure
- Ask clarifying questions
- Propose multiple solutions
- Explain tradeoffs
- Show code examples

### When Blocked
- Explain the blocker clearly
- Suggest workarounds
- Identify missing information
- Propose investigation steps

### When Complete
- Summarize changes made
- Note any issues encountered
- Suggest next steps
- Highlight testing results

## Key Principles Summary

1. **Vanilla JavaScript Only** - No frameworks
2. **No Alert()** - Use console logging
3. **Single File When Possible** - Bundle for distribution
4. **Test Everything** - Especially pure functions
5. **Performance Matters** - Profile before optimizing
6. **Clean Code** - Readable > Clever
7. **Memory Management** - Always clean up
8. **Error Handling** - Graceful degradation
9. **Documentation** - Code explains "how", docs explain "why"
10. **Modularity** - Focused, reusable components

## Questions? Issues?

When working on DataPrism:
1. Check this document first
2. Review `refactor.md` for architecture
3. Consult `dataprism.md` for technical details
4. See `todo.md` for planned work
5. Read `readme.md` for user perspective
6. Ask the human developer for clarification

---

**Remember**: DataPrism is about making binary data beautiful and understandable. Keep the visualization smooth, the code clean, and the experience delightful.
