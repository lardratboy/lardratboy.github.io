# DataPrism Architecture Documentation

## Overview

DataPrism is a 3D binary file visualization system built on THREE.js. It processes binary files in chunks using Web Workers and renders them as interactive point clouds with various projection and coloring algorithms.

## Core Architecture

### Current Structure (Monolithic)

The application currently exists as a single HTML file containing:
- HTML structure and UI elements
- CSS styling (embedded)
- JavaScript application code (~2400 lines)
- Web Worker code (inline data URL)

### Main Components

#### 1. BinaryPointCloudViewer (Main Application Class)
**Location**: Lines ~1360-2802  
**Responsibilities**:
- Application initialization
- THREE.js scene setup
- File loading orchestration
- Worker pool management
- Point cloud creation and management
- Camera and controls
- UI event handling
- Stats display

**Key Properties**:
```javascript
scene           // THREE.Scene instance
camera          // THREE.PerspectiveCamera
renderer        // THREE.WebGLRenderer
controls        // OrbitControls
pointClouds[]   // Array of point cloud groups
pathLines[]     // Array of path line objects
workers[]       // Web Worker pool
currentFile     // Currently loaded file
fileStats       // File processing statistics
```

#### 2. Web Worker System
**Location**: Lines ~228-1355  
**Responsibilities**:
- Binary data chunk processing
- Projection calculations (Hilbert, Z-curve, etc.)
- Color computations
- BVH tree construction
- Tuple mode processing

**Worker Communication**:
```javascript
// Main → Worker
{
    chunkIndex, arrayBuffer, offset, 
    chunkSize, numWorkers, projectionMode,
    tupleMode, colorMode, bvhMode, ...
}

// Worker → Main
{
    chunkIndex, points, colors, numPoints,
    pathData, bvhNodes, processingTime
}
```

#### 3. Projection Systems

##### Simple Grid Projection
Maps byte index to 3D grid coordinates:
```
x = index % width
y = (index / width) % height
z = index / (width * height)
```

##### Hilbert Curve Projection
Space-filling curve that preserves locality:
- Recursive subdivision algorithm
- Maintains byte proximity in 3D space
- Better for pattern recognition

##### Z-Curve (Morton Order)
Interleaves coordinate bits:
- Fast bit manipulation
- Good cache locality
- Hierarchical spatial indexing

##### Other Modes
- Bit Interleaving
- Fibonacci Sphere
- Random Distribution
- Continuous Path

#### 4. Tuple Processing Modes

##### 2-Tuple: (value, byte_index)
- Simplest mode
- Maps byte value and position
- Good for basic visualization

##### 3-Tuple: (value, prev_byte, next_byte)
- Adds context from neighbors
- Shows byte relationships
- Better pattern detection

##### 4-Tuple: (value, prev, next, byte_index)
- Combines context and position
- More information per point
- Useful for compression analysis

##### 8-Tuple: Extended Context
- Maximum context window
- Includes multiple neighbors
- Best for structure analysis

#### 5. BVH System

**Purpose**: Spatial organization and structure visualization

**Components**:
```javascript
BVHNode {
    min: [x, y, z],    // Bounding box minimum
    max: [x, y, z],    // Bounding box maximum
    center: [x, y, z], // Centroid
    count: number      // Points in node
}
```

**Construction**: Binary space partitioning with median split

**Visualization**: Instanced mesh for efficient rendering

#### 6. Color Systems

##### Color Modes
- **byte-value**: Grayscale based on byte value
- **rgb**: Split into R/G/B channels
- **position**: Based on spatial position
- **entropy**: Local randomness measure
- **gradient-rainbow**: Rainbow spectrum
- **gradient-heat**: Heat map colors

##### Color Functions
- HSL to RGB conversion
- Entropy calculation
- Channel extraction
- Position-based hashing

#### 7. Rendering Pipeline

```
File Input
    ↓
File Chunking (Main Thread)
    ↓
Worker Pool Distribution
    ↓
Parallel Chunk Processing (Workers)
    ↓
Geometry Creation (Main Thread)
    ↓
THREE.js Scene Addition
    ↓
WebGL Rendering
```

### Data Flow

1. **File Load**: User drops/selects file
2. **Chunking**: File divided into chunks (configurable size)
3. **Worker Assignment**: Chunks distributed to worker pool
4. **Processing**: Workers compute positions, colors, BVH
5. **Transfer**: Processed data sent back to main thread
6. **Geometry Creation**: THREE.BufferGeometry created
7. **Scene Integration**: Point clouds added to scene
8. **Rendering**: Animation loop renders scene

### Performance Characteristics

#### Strengths
- Parallel processing via workers
- Efficient GPU usage with BufferGeometry
- Instanced rendering for BVH
- Minimal memory copying
- Progressive loading

#### Bottlenecks
- Main thread geometry creation
- Large file initial parsing
- Memory usage for massive files
- Worker communication overhead

#### Optimization Strategies
- Static geometry usage hints
- Array buffer transfers (not copies)
- Geometry disposal on reload
- Camera frustum culling
- LOD system (potential)

### State Management

**Global State**: Stored in BinaryPointCloudViewer instance
**UI State**: Synchronized with controls inputs
**Worker State**: Stateless (pure functions)

### Event System

**File Events**:
- dragover, dragleave, drop
- file input change

**UI Events**:
- Control input changes
- Button clicks
- Camera preset selection

**WebGL Events**:
- webglcontextlost
- webglcontextrestored

**Window Events**:
- resize
- error
- unhandledrejection

### Memory Management

**Cleanup on Reload**:
```javascript
// Dispose geometries
pointClouds.forEach(pc => pc.geometry.dispose())
// Dispose materials
materials.forEach(m => m.dispose())
// Clear arrays
pointClouds.length = 0
pathLines.length = 0
// Terminate workers
workers.forEach(w => w.terminate())
```

### Error Handling

**Levels**:
1. Global error handler
2. Unhandled promise rejection handler
3. WebGL context loss recovery
4. Worker error handling
5. Render loop error catching

### Configuration

**Default Settings**:
- Grid Size: 5x5x5
- Chunk Size: 2048 bytes
- Point Size: 0.2
- Worker Pool: 4 workers
- Projection: Simple Grid
- Tuple Mode: 2-tuple
- Color Mode: byte-value

### External Dependencies

**THREE.js (r128)**:
- Core rendering
- BufferGeometry
- PointsMaterial
- OrbitControls

**TWEEN.js**:
- Camera animations
- Smooth transitions

## Design Patterns

### Current Patterns
- **Singleton**: Single BinaryPointCloudViewer instance
- **Object Pool**: Worker pool management
- **Factory**: Point cloud creation
- **Observer**: Event-driven UI updates

### Anti-Patterns to Address
- **God Object**: BinaryPointCloudViewer does too much
- **Tight Coupling**: Worker and main thread logic intertwined
- **Global State**: Configuration spread across closures
- **Code Duplication**: Similar logic in workers and main thread

## Testing Considerations

**Current State**: No automated tests

**Testable Components** (after refactoring):
- Projection algorithms (pure functions)
- Color functions (pure functions)
- BVH construction
- Tuple processing
- File chunking logic

**Integration Tests**:
- File loading pipeline
- Worker communication
- Rendering pipeline
- UI interactions

## Browser Compatibility

**Requirements**:
- ES6+ (classes, arrow functions, promises)
- Web Workers
- File API
- WebGL
- Typed Arrays

**Tested Browsers**:
- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+

## Known Issues

1. **Memory**: Very large files can cause memory pressure
2. **Workers**: Fixed pool size may not be optimal for all systems
3. **Context Loss**: Recovery attempts but may fail on some hardware
4. **Mobile**: Limited testing on mobile devices
5. **Performance**: Main thread can block during geometry creation

## Future Architecture Vision

See `refactor.md` for planned modular architecture.
