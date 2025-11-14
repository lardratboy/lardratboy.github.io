# DataPrism - TODO & Roadmap

## Current Status

**Version**: 1.0 (Monolithic)
**Status**: Production-ready, functional
**Next**: Begin modularization refactor

---

## Immediate Priorities

### Phase 1: Refactoring Foundation (Week 1-2)

#### Extract Pure Functions
- [ ] Create `utils/MathUtils.js`
  - [ ] Hilbert curve functions
  - [ ] Morton encoding (Z-curve)
  - [ ] Bit interleaving
  - [ ] Fibonacci sequence
  - [ ] Distance/interpolation helpers
- [ ] Create `utils/GeometryUtils.js`
  - [ ] Bounds calculation
  - [ ] Center computation
  - [ ] Bounding box creation
  - [ ] Disposal helpers
- [ ] Write unit tests for all utility functions
- [ ] Verify performance parity

#### Extract Projection Modules
- [ ] Create `projections/Projection.js` (base class)
- [ ] Create `projections/SimpleGrid.js`
- [ ] Create `projections/Hilbert.js`
- [ ] Create `projections/ZCurve.js`
- [ ] Create `projections/BitInterleaving.js`
- [ ] Create `projections/Fibonacci.js`
- [ ] Create `projections/Random.js`
- [ ] Create `projections/ProjectionFactory.js`
- [ ] Write tests for each projection
- [ ] Document projection algorithms

#### Extract Color Modules
- [ ] Create `colors/ColorScheme.js` (base class)
- [ ] Create `colors/ByteValue.js`
- [ ] Create `colors/RGBSplit.js`
- [ ] Create `colors/Position.js`
- [ ] Create `colors/Entropy.js`
- [ ] Create `colors/Gradient.js`
- [ ] Create `colors/ColorFactory.js`
- [ ] Write tests for color schemes
- [ ] Document color algorithms

### Phase 2: Core Infrastructure (Week 2-3)

#### File Processing
- [ ] Create `core/FileProcessor.js`
  - [ ] File validation
  - [ ] Chunking logic
  - [ ] Stats calculation
  - [ ] Async generator for chunks
- [ ] Write tests for file processing
- [ ] Benchmark performance

#### Worker Management
- [ ] Create `core/WorkerPool.js`
  - [ ] Worker lifecycle management
  - [ ] Task distribution
  - [ ] Error handling
  - [ ] Pool resizing
- [ ] Create `workers/ChunkWorker.js`
  - [ ] Extract worker code
  - [ ] Bundle worker separately
  - [ ] Optimize worker size
- [ ] Test worker communication
- [ ] Test error recovery

#### Data Processing
- [ ] Create `processing/TupleProcessor.js`
  - [ ] 2-tuple mode
  - [ ] 3-tuple mode
  - [ ] 4-tuple mode
  - [ ] 8-tuple mode
- [ ] Create `spatial/BVHBuilder.js`
  - [ ] Tree construction
  - [ ] Flattening
  - [ ] Visualization
- [ ] Write tests
- [ ] Benchmark BVH performance

### Phase 3: Rendering & UI (Week 3-4)

#### Rendering System
- [ ] Create `rendering/SceneManager.js`
  - [ ] Scene setup
  - [ ] Camera management
  - [ ] Renderer configuration
  - [ ] Controls setup
  - [ ] Lighting
- [ ] Create `rendering/PointCloudBuilder.js`
  - [ ] Point cloud creation
  - [ ] Path line creation
  - [ ] BVH visualization
  - [ ] Instanced rendering
- [ ] Create `rendering/CameraController.js`
  - [ ] Presets (top, front, side, diagonal)
  - [ ] Smooth transitions
  - [ ] Auto-framing
- [ ] Test rendering pipeline
- [ ] Verify memory cleanup

#### UI Components
- [ ] Create `ui/ControlPanel.js`
  - [ ] Settings management
  - [ ] Minimize/restore
  - [ ] Stats display
  - [ ] Event handling
- [ ] Create `ui/DropZone.js`
  - [ ] Drag/drop handling
  - [ ] Visual feedback
  - [ ] File validation UI
- [ ] Create `ui/LoadingDisplay.js`
  - [ ] Progress indicators
  - [ ] Status messages
  - [ ] Error display
- [ ] Test UI interactions
- [ ] Accessibility improvements

### Phase 4: Integration & Build (Week 4)

#### Main Orchestrator
- [ ] Create `core/DataPrism.js`
  - [ ] Module integration
  - [ ] State management
  - [ ] Lifecycle management
  - [ ] Public API
- [ ] Integration tests
- [ ] End-to-end testing
- [ ] Performance validation

#### Build System
- [ ] Choose bundler (esbuild/rollup)
- [ ] Configure module bundling
- [ ] Set up worker bundling
- [ ] Create HTML template
- [ ] Inline CSS
- [ ] Generate single-file build
- [ ] Optimize bundle size
- [ ] Test distribution build

---

## Feature Enhancements

### High Priority

#### Performance Optimizations
- [ ] Implement LOD (Level of Detail) system
  - [ ] Distance-based point size
  - [ ] Chunk visibility culling
  - [ ] Adaptive quality
- [ ] Add WebGL2 features
  - [ ] Instancing improvements
  - [ ] Better attribute handling
  - [ ] Compute shaders (if beneficial)
- [ ] Optimize memory usage
  - [ ] Streaming for massive files
  - [ ] Progressive loading with cleanup
  - [ ] Memory pressure monitoring
- [ ] Improve worker efficiency
  - [ ] Dynamic worker count
  - [ ] Better task batching
  - [ ] Reduced communication overhead

#### User Experience
- [ ] Add file format detection
  - [ ] Show detected format
  - [ ] Format-specific defaults
  - [ ] Common format hints
- [ ] Improve progress feedback
  - [ ] Detailed progress bar
  - [ ] Estimated time remaining
  - [ ] Current operation display
- [ ] Add export capabilities
  - [ ] Screenshot/video capture
  - [ ] Export point cloud (PLY/OBJ)
  - [ ] Export visualization settings
- [ ] Better error messages
  - [ ] User-friendly explanations
  - [ ] Suggested fixes
  - [ ] Troubleshooting guide

### Medium Priority

#### Visualization Features
- [ ] Add more projection modes
  - [ ] Peano curve
  - [ ] Gray code ordering
  - [ ] Serpentine scan
  - [ ] Spiral patterns
- [ ] Add more color schemes
  - [ ] File format aware coloring
  - [ ] Statistical distribution
  - [ ] Frequency analysis
  - [ ] Custom gradients
- [ ] Animation support
  - [ ] Byte-by-byte playback
  - [ ] Chunk-by-chunk reveal
  - [ ] Rotating camera
  - [ ] Time-based coloring
- [ ] Selection & inspection
  - [ ] Click to inspect byte
  - [ ] Selection box
  - [ ] Range analysis
  - [ ] Jump to offset

#### Analysis Tools
- [ ] Statistical overlay
  - [ ] Byte value distribution
  - [ ] Entropy graph
  - [ ] Pattern detection
  - [ ] Structure hints
- [ ] Comparison mode
  - [ ] Side-by-side files
  - [ ] Diff visualization
  - [ ] Change highlighting
- [ ] Search functionality
  - [ ] Byte pattern search
  - [ ] String search
  - [ ] Regex support
  - [ ] Visual highlighting

### Low Priority

#### Advanced Features
- [ ] VR support
  - [ ] WebXR integration
  - [ ] Immersive visualization
  - [ ] Hand tracking
- [ ] Collaborative viewing
  - [ ] Share visualization
  - [ ] Multi-user viewing
  - [ ] Annotations
- [ ] Plugin system
  - [ ] Custom projections
  - [ ] Custom colors
  - [ ] Custom analysis
- [ ] Preset management
  - [ ] Save settings
  - [ ] Share presets
  - [ ] Preset library

---

## Bug Fixes & Technical Debt

### Known Issues

#### Critical
- [ ] WebGL context loss recovery
  - Sometimes fails on certain hardware
  - Need more robust recovery
  - Better error messaging

#### High Priority
- [ ] Memory usage with large files (>1GB)
  - Progressive loading incomplete
  - Need better streaming
  - Chunk disposal optimization
- [ ] Mobile performance
  - Limited testing
  - Touch controls need work
  - Mobile-specific optimizations
- [ ] Worker pool sizing
  - Fixed size may not be optimal
  - Should adapt to system
  - Better CPU detection

#### Medium Priority
- [ ] Safari compatibility
  - Some edge cases
  - Testing needed
  - Fallbacks for missing features
- [ ] File size limits
  - No hard limit set
  - Need UI warning
  - Better guidance
- [ ] Stats accuracy
  - Some calculations approximate
  - Need verification
  - Consistent units

### Technical Debt
- [ ] Add TypeScript definitions
  - JSDoc for now
  - Consider .d.ts files
  - Better IDE support
- [ ] Improve error handling
  - Inconsistent across modules
  - Need error boundaries
  - Better recovery strategies
- [ ] Code documentation
  - Some complex algorithms need explanation
  - API documentation
  - Architecture diagrams
- [ ] Performance profiling
  - Add built-in profiler
  - Collect metrics
  - A/B testing framework

---

## Testing

### Unit Tests
- [ ] Projection algorithms
  - [ ] Hilbert curve properties
  - [ ] Z-curve correctness
  - [ ] Boundary conditions
- [ ] Color functions
  - [ ] RGB conversion
  - [ ] Entropy calculation
  - [ ] Range validation
- [ ] Math utilities
  - [ ] Accuracy tests
  - [ ] Edge cases
  - [ ] Performance tests
- [ ] BVH construction
  - [ ] Tree correctness
  - [ ] Balance verification
  - [ ] Performance benchmarks
- [ ] Tuple processing
  - [ ] All modes
  - [ ] Boundary handling
  - [ ] Performance

### Integration Tests
- [ ] File loading pipeline
  - [ ] Various file sizes
  - [ ] Different formats
  - [ ] Error conditions
- [ ] Worker communication
  - [ ] Data transfer
  - [ ] Error handling
  - [ ] Timeout handling
- [ ] Rendering pipeline
  - [ ] Geometry creation
  - [ ] Scene integration
  - [ ] Memory cleanup
- [ ] UI interactions
  - [ ] Control changes
  - [ ] File drop
  - [ ] Camera presets

### Performance Tests
- [ ] Benchmark suite
  - [ ] Projection algorithms
  - [ ] Color calculations
  - [ ] BVH building
  - [ ] Rendering
- [ ] Memory profiling
  - [ ] Leak detection
  - [ ] Peak usage
  - [ ] Cleanup verification
- [ ] Load testing
  - [ ] Small files (<1MB)
  - [ ] Medium files (1-100MB)
  - [ ] Large files (>100MB)

### Browser Testing
- [ ] Chrome (desktop)
- [ ] Firefox (desktop)
- [ ] Safari (desktop)
- [ ] Edge (desktop)
- [ ] Chrome (mobile)
- [ ] Safari (mobile)

---

## Documentation

### User Documentation
- [x] README.md (basic)
- [ ] User guide
  - [ ] Getting started
  - [ ] Controls reference
  - [ ] Tips & tricks
  - [ ] Troubleshooting
- [ ] Tutorial videos
  - [ ] Basic usage
  - [ ] Advanced features
  - [ ] Real-world examples
- [ ] FAQ
  - [ ] Common questions
  - [ ] Performance tips
  - [ ] Format support

### Developer Documentation
- [x] dataprism.md (architecture)
- [x] refactor.md (plan)
- [x] agents.md (AI guidance)
- [x] claude.md (Claude-specific)
- [ ] API documentation
  - [ ] Public API
  - [ ] Module interfaces
  - [ ] Events
- [ ] Contributing guide
  - [ ] Code style
  - [ ] Testing requirements
  - [ ] PR process
- [ ] Algorithm documentation
  - [ ] Projection explanations
  - [ ] Color theory
  - [ ] BVH details

### Examples
- [ ] Sample files
  - [ ] Various formats
  - [ ] Interesting patterns
  - [ ] Known structures
- [ ] Code examples
  - [ ] Custom projections
  - [ ] Custom colors
  - [ ] Embedding DataPrism
- [ ] Use case studies
  - [ ] Reverse engineering
  - [ ] Forensics
  - [ ] Education

---

## Research & Exploration

### Ideas to Investigate
- [ ] WebGPU support
  - Faster than WebGL?
  - Better compute?
  - Browser support?
- [ ] Machine learning integration
  - Pattern detection?
  - Format classification?
  - Anomaly detection?
- [ ] Audio visualization
  - Sonify the data
  - Rhythm from patterns
  - Interactive sound
- [ ] Alternative rendering
  - Volume rendering
  - Voxel approach
  - Ray marching
- [ ] Compression visualization
  - Show compression artifacts
  - Entropy mapping
  - Redundancy detection

---

## Community & Distribution

### Release Process
- [ ] Version numbering scheme
- [ ] Changelog automation
- [ ] Release notes template
- [ ] Distribution channels

### Community Building
- [ ] GitHub repository setup
- [ ] Issue templates
- [ ] PR templates
- [ ] Code of conduct
- [ ] Contributing guidelines

### Marketing
- [ ] Demo video
- [ ] Screenshots
- [ ] Blog post
- [ ] Social media presence
- [ ] Example gallery

---

## Metrics & Success Criteria

### Performance Targets
- Load time < 2s for 10MB file
- 60 FPS rendering with 1M points
- Memory < 2x file size
- Worker processing > 50MB/s

### Code Quality
- Test coverage > 80%
- No circular dependencies
- Max file size < 300 lines
- Cyclomatic complexity < 10

### User Experience
- One-click file loading
- Smooth interactions
- Clear error messages
- Responsive controls

---

## Long-term Vision

### 1-Year Goals
- Stable 2.0 release (modular)
- 1000+ GitHub stars
- Featured in visualization galleries
- Used in education/research

### 3-Year Goals
- Industry standard for binary visualization
- Plugin ecosystem
- Commercial support options
- Conference presentations

### 5-Year Goals
- Web standard integration
- Native browser support
- Academic citations
- Forensics tool standard

---

## Notes & Ideas

### Random Ideas (To Sort)
- VR file explorer (walk through data)
- Audio representation of data
- Collaborative annotations
- Time-travel debugging for files
- Diff visualization
- Git integration
- Real-time streaming visualization
- Network packet visualization
- Memory dump explorer
- Executable format analyzer

### Questions to Answer
- What's the maximum practical file size?
- Can we detect file formats automatically?
- Should we support drag-and-drop folders?
- What about compressed files?
- Real-time file monitoring?

---

**Last Updated**: [To be maintained during development]
**Current Focus**: Phase 1 - Refactoring Foundation
**Next Milestone**: Extract pure functions and utilities
