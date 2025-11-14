# DataPrism

**What's in your file?**

DataPrism is an interactive 3D binary file visualization tool that transforms raw file data into explorable point cloud visualizations. By mapping bytes to 3D space using various projection algorithms, DataPrism reveals the hidden structure and patterns within any file format.

## Features

### Visualization Modes
- **Point Cloud Rendering** - Each byte becomes a colored point in 3D space
- **Path Lines** - Connect consecutive bytes to show data flow
- **BVH Visualization** - Display bounding volume hierarchies for spatial organization
- **Multiple Projection Modes** - Grid, Hilbert curve, Z-curve, and more

### Projection Algorithms
- **Simple Grid** - Linear byte-to-3D mapping
- **Hilbert Curve** - Space-filling curve for locality preservation
- **Z-Curve** - Morton order space-filling curve
- **Bit Interleaving** - Interleaved coordinate generation
- **Fibonacci Sphere** - Spherical distribution
- **Random** - Randomized positions

### Tuple Processing
- **2-Tuple Mode** - (value, byte_index) pairs
- **3-Tuple Mode** - (value, prev_byte, next_byte) triples
- **4-Tuple Mode** - (value, prev, next, index) quads
- **8-Tuple Mode** - Extended context window

### Color Schemes
- Byte Value (grayscale)
- RGB split (R/G/B channels)
- Position-based coloring
- Entropy visualization
- Custom gradients

### Performance
- **Web Worker Processing** - Multi-threaded chunk processing
- **Chunked Loading** - Handle files of any size
- **Instanced Rendering** - Efficient GPU utilization
- **LOD Support** - Level-of-detail for large datasets

## Usage

### Loading Files
1. **Drag & Drop** - Drop any file onto the window
2. **File Input** - Click "Choose File" button
3. **Automatic Processing** - File is chunked and visualized

### Controls
- **Mouse** - Orbit camera (left drag), pan (right drag), zoom (scroll)
- **Grid Size** - Number of chunks per dimension
- **Chunk Size** - Bytes per chunk
- **Point Size** - Visual size of each point
- **Projection** - Choose mapping algorithm
- **Tuple Mode** - Select data grouping
- **Color Mode** - Pick visualization color scheme
- **BVH Mode** - Toggle bounding volume visualization

### Camera Presets
- Top View
- Front View
- Side View
- Diagonal View
- Reset Camera

## Technical Details

### Architecture
- Pure vanilla JavaScript with THREE.js
- Web Workers for parallel processing
- WebGL-based rendering
- Single HTML file deployment

### Dependencies
- THREE.js r128 (via CDN)
- TWEEN.js (via CDN)

### Browser Support
- Modern browsers with WebGL support
- Chrome, Firefox, Edge, Safari
- Requires WebGL 1.0 or higher

## File Size Considerations

DataPrism can handle files from bytes to gigabytes:
- Small files (<1MB): Instant visualization
- Medium files (1-100MB): Quick chunked processing
- Large files (>100MB): Progressive loading with worker pools

## Use Cases

- **Reverse Engineering** - Visualize unknown file formats
- **Data Forensics** - Identify patterns in binary data
- **Compression Analysis** - See entropy distribution
- **File Structure Analysis** - Understand data organization
- **Education** - Learn about binary data representation
- **Art/Visualization** - Create unique 3D data art

## Performance Tips

1. Start with smaller grid sizes (3x3x3) for large files
2. Increase chunk size to reduce total chunks
3. Use BVH mode for spatial structure visualization
4. Disable path lines for better performance with many points
5. Minimize controls panel when not needed

## Future Enhancements

See `todo.md` for planned features and improvements.

## License

Open source - feel free to use and modify.

## Credits

Created with THREE.js for 3D rendering and visualization.
