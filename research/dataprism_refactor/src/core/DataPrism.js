/**
 * DataPrism.js
 * Main application class for the DataPrism binary point cloud viewer
 *
 * Handles file loading, processing, visualization, and export of binary data
 * as 3D point clouds with various projection and quantization options.
 */

import { BVH } from '../spatial/BVH.js';
import { HilbertCurve3D } from '../utils/HilbertCurve3D.js';
import { createInstancedBVHBoxes } from '../rendering/BVHVisualization.js';
import { applyProjection } from '../utils/Projections.js';
import { quantizeProcessDataAs } from '../processing/DataProcessor.js';
import { DATA_TYPES } from '../utils/Constants.js';

/**
 * Main application class for DataPrism
 * @class DataPrism
 */
class DataPrism {
    /**
     * Creates a new DataPrism instance
     * Initializes the 3D scene, camera, renderer, and event handlers
     */
    constructor() {
        this.fileBuffer = null;
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.controls = null;
        this.pointClouds = [];
        this.pathLines = []; // Store path lines separately
        this.originalFileName = '';
        this.cameraRadius = 5;
        this.cameraAngle = 0;
        this.totalPoints = 0;
        this.controlsMinimized = false;
        this.contextLost = false; // Track WebGL context state

        this.init();
        this.setupEventListeners();
        this.setupDropZone();
        this.setupPasteHandling();
        this.setupVisibilityHandling();
        this.checkURLParameters();
        this.animate();
    }

    /**
     * Sets up clipboard paste handling for files and URLs
     */
    setupPasteHandling() {
        document.addEventListener('paste', (e) => {
            e.preventDefault();
            const items = (e.clipboardData || window.clipboardData).items;
            for (let item of items) {
                if (item.kind === 'file') {
                    const file = item.getAsFile();
                    this.handleDragDropFiles([file]);
                } else {
                    item.getAsString((text) => {
                        this.tryFetchAPI(text);
                    });
                }
            }
        });
    }

    /**
     * Attempts to fetch a file from a URL
     * @param {string} src - URL to fetch from
     */
    async tryFetchAPI(src) {
        try {
            console.log('Attempting to fetch from URL:', src);
            const response = await fetch(src);
            if (response.ok) {
                const blob = await response.blob();
                // Create a fake file from the blob
                const file = new File([blob], src.split('/').pop() || 'fetched_file', { type: blob.type });
                this.handleDragDropFiles([file]);
            } else {
                console.log('Failed to fetch URL, response not ok:', response.status);
            }
        } catch (error) {
            console.log('Failed to fetch URL:', error.message);
        }
    }

    /**
     * Handles non-file drops (like HTML content with image sources)
     * @param {string} text - Dropped text content
     */
    handleNonFileDrop(text) {
        if (text.startsWith('<meta')) {
            try {
                const parser = new DOMParser();
                const doc = parser.parseFromString(text, 'text/html');
                const img = doc.querySelector('img');
                if (img) {
                    const imgSrc = img.getAttribute('src');
                    this.tryFetchAPI(imgSrc);
                }
            } catch (error) {
                console.log('Failed to parse dropped HTML content:', error.message);
            }
        } else if (text.startsWith('http')) {
            // Direct URL
            this.tryFetchAPI(text);
        }
    }

    /**
     * Handles drop events
     * @param {DragEvent} e - Drop event
     */
    handleDrop(e) {
        const dt = e.dataTransfer;
        const files = dt.files;

        if (files && files.length > 0) {
            this.handleDragDropFiles(files);
            return;
        }

        // Handle non-file drops
        for (let i = 0; i < dt.items.length; i++) {
            const item = dt.items[i];
            if (item.kind === 'string') {
                item.getAsString((s) => {
                    this.handleNonFileDrop(s);
                });
            }
        }
    }

    /**
     * Sets up drag and drop functionality for the drop zone
     */
    setupDropZone() {
        const dropZone = document.getElementById('dropZone');

        // Prevent default drag behaviors on the document
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            document.addEventListener(eventName, (e) => {
                e.preventDefault();
                e.stopPropagation();
            }, false);
        });

        // Show drop zone when dragging over document
        document.addEventListener('dragenter', (e) => {
            dropZone.style.display = 'flex';
            dropZone.classList.remove('dragover');
        });

        // Hide drop zone when leaving the drop zone itself
        dropZone.addEventListener('dragleave', (e) => {
            // Only hide if we're leaving the dropZone entirely, not just moving between child elements
            if (!dropZone.contains(e.relatedTarget)) {
                dropZone.style.display = 'none';
                dropZone.classList.remove('dragover');
            }
        });

        // Highlight drop zone when dragging over it
        dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropZone.classList.add('dragover');
        });

        // Handle the actual drop
        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropZone.style.display = 'none';
            dropZone.classList.remove('dragover');
            this.handleDrop(e);
        });
    }

    /**
     * Handles file loading from input or drag/drop
     * @param {FileList} files - Files to handle
     */
    handleFiles(files) {
        if (!files || files.length === 0) return;

        const file = files[0]; // Take the first file
        this.originalFileName = file.name;

        const fileInfoDiv = document.getElementById('fileInfo');
        fileInfoDiv.innerHTML = `
            <strong>File:</strong> <span class="filename-truncate" title="${file.name}">${file.name}</span> <strong>Size:</strong> ${(file.size / (1024 * 1024)).toFixed(2)} MB
        `;

        const reader = new FileReader();
        reader.onload = (e) => {
            this.fileBuffer = e.target.result;
            document.getElementById('processButton').disabled = false;
            document.getElementById('exportPlyButton').disabled = true;
            this.highlightProcessButton(); // Highlight when file is loaded
            console.log('File loaded successfully:', file.name);
        };
        reader.onerror = () => {
            console.error('Failed to read file:', file.name);
        };
        reader.readAsArrayBuffer(file);
    }

    /**
     * Handles files specifically from drag and drop
     * @param {FileList} files - Files dropped
     */
    handleDragDropFiles(files) {
        // Clear the file input to prevent conflicts
        const fileInput = document.getElementById('fileInput');
        fileInput.value = '';

        this.handleFiles(files);
    }

    /**
     * Highlights the process button to indicate action is needed
     */
    highlightProcessButton() {
        const processButton = document.getElementById('processButton');
        if (!processButton.disabled) {
            processButton.classList.add('highlight');
            // Check if this is a new file or changed settings
            const isFirstLoad = this.pointClouds.length === 0;
            processButton.textContent = isFirstLoad ?
                '🔄 Process File (Ready)' :
                '🔄 Process File (Changes Ready)';
        }
    }

    /**
     * Removes highlight from process button
     */
    unhighlightProcessButton() {
        const processButton = document.getElementById('processButton');
        processButton.classList.remove('highlight');
        processButton.textContent = '🔄 Process File';
    }

    /**
     * Checks URL parameters for auto-fetch functionality
     */
    checkURLParameters() {
        const argument = new URL(document.URL).searchParams.get('fetch');
        if (argument) {
            console.log('Auto-fetching from URL parameter:', argument);
            this.tryFetchAPI(argument);
        }
    }

    /**
     * Toggles the controls panel visibility
     */
    toggleControls() {
        const controls = document.getElementById('controls');
        const restoreButton = document.getElementById('restoreButton');

        this.controlsMinimized = !this.controlsMinimized;

        if (this.controlsMinimized) {
            controls.classList.add('minimized');
            restoreButton.style.display = 'flex';
        } else {
            controls.classList.remove('minimized');
            restoreButton.style.display = 'none';
        }
    }

    /**
     * Shows the export dialog for PLY file export
     */
    showExportDialog() {
        // Show export dialog
        const dialog = document.getElementById('exportDialog');
        const filenameInput = document.getElementById('exportFilename');
        const formatDiv = document.getElementById('exportFormat');
        const cancelButton = document.getElementById('cancelExport');
        const confirmButton = document.getElementById('confirmExport');

        // Generate default filename from original file
        const baseFilename = this.originalFileName.split('.')[0] || 'pointcloud';
        filenameInput.value = baseFilename + '_pointcloud';

        // Update dialog title and format info
        document.querySelector('#exportDialog h3').textContent = 'Export to PLY';
        formatDiv.textContent = 'Format: PLY';

        // Show dialog
        dialog.style.display = 'block';

        // Handle cancel
        cancelButton.onclick = () => {
            dialog.style.display = 'none';
        };

        // Handle confirm
        confirmButton.onclick = () => {
            // Get user filename
            let filename = filenameInput.value.trim();

            // Add default if empty
            if (!filename) {
                filename = baseFilename + '_pointcloud';
            }

            // Add extension if not present
            const ext = '.ply';
            if (!filename.toLowerCase().endsWith(ext)) {
                filename += ext;
            }

            // Hide dialog
            dialog.style.display = 'none';

            // Perform the actual export
            this._generatePLYFile(filename);
        };
    }

    /**
     * Exports the current point cloud to PLY format
     */
    exportToPLY() {
        if (this.pointClouds.length === 0) {
            console.log('No point clouds to export');
            return;
        }

        this.showExportDialog();
    }

    /**
     * Memory-efficient PLY export using streaming approach
     * @param {string} filename - Output filename
     * @private
     */
    _generatePLYFile(filename) {
        // Show loading message
        document.getElementById('loadingMessage').style.display = 'block';
        document.getElementById('loadingMessage').innerHTML = '<div>📝 Generating PLY file...</div><div style="font-size: 12px; margin-top: 8px; opacity: 0.8;">Preparing export...</div>';

        try {
            // Extract all Points objects from point clouds (which may be Groups)
            const pointObjects = [];
            for (const cloudOrGroup of this.pointClouds) {
                if (cloudOrGroup.type === 'Points') {
                    // Direct Points object (old style)
                    pointObjects.push(cloudOrGroup);
                } else if (cloudOrGroup.type === 'Group') {
                    // Group containing Points and possibly other objects
                    cloudOrGroup.traverse((child) => {
                        if (child.type === 'Points') {
                            pointObjects.push(child);
                        }
                    });
                }
            }

            if (pointObjects.length === 0) {
                console.error('No point objects found to export');
                this._handleExportError('No points to export');
                return;
            }

            // Count total number of vertices
            let totalVertices = 0;
            for (const pointObj of pointObjects) {
                if (pointObj.geometry && pointObj.geometry.attributes && pointObj.geometry.attributes.position) {
                    totalVertices += pointObj.geometry.attributes.position.count;
                } else {
                    console.warn('Point object missing geometry or position attribute:', pointObj);
                }
            }

            if (totalVertices === 0) {
                console.error('No vertices found in point objects');
                this._handleExportError('No vertices to export');
                return;
            }

            console.log(`Exporting ${totalVertices.toLocaleString()} vertices from ${pointObjects.length} point objects`);

            // Check if dataset is very large and warn user
            if (totalVertices > 10000000) { // 10M points
                console.log(`Warning: Large dataset detected (${totalVertices.toLocaleString()} points). This may take several minutes.`);
            }

            // Create PLY header
            const header = [
                'ply',
                'format ascii 1.0',
                'comment Created by Binary Point Cloud Viewer',
                `element vertex ${totalVertices}`,
                'property float x',
                'property float y',
                'property float z',
                'property uchar red',
                'property uchar green',
                'property uchar blue',
                'end_header'
            ].join('\n') + '\n';

            // Use smaller chunks for very large datasets to prevent memory issues
            const baseChunkSize = totalVertices > 5000000 ? 25000 : 50000;
            let processedVertices = 0;
            const chunks = [];

            // Add header as first chunk
            chunks.push(new Blob([header], { type: 'text/plain' }));

            // Process point objects with smaller memory footprint
            const processPoints = (objIndex = 0) => {
                if (objIndex >= pointObjects.length) {
                    // All objects processed, create final blob and download
                    this._downloadBlobChunks(chunks, filename, totalVertices);
                    return;
                }

                // Get current point object
                const pointObj = pointObjects[objIndex];
                const positions = pointObj.geometry.attributes.position.array;
                const colors = pointObj.geometry.attributes.color.array;
                const count = pointObj.geometry.attributes.position.count;

                // Get the point object's world position (from parent group)
                let worldPos = new THREE.Vector3();
                pointObj.getWorldPosition(worldPos);

                // Process points in very small chunks to avoid memory spikes
                const processPointsChunk = (startIdx = 0) => {
                    try {
                        // Calculate end index for this chunk
                        const endIdx = Math.min(startIdx + baseChunkSize, count);

                        // Use array for better performance than string concatenation
                        const lines = [];

                        // Add vertices for this chunk
                        for (let i = startIdx; i < endIdx; i++) {
                            const idx = i * 3;

                            // Calculate world coordinates
                            const x = positions[idx] + worldPos.x;
                            const y = positions[idx + 1] + worldPos.y;
                            const z = positions[idx + 2] + worldPos.z;

                            // Convert normalized colors [0,1] to RGB [0,255]
                            const r = Math.floor(colors[idx] * 255);
                            const g = Math.floor(colors[idx + 1] * 255);
                            const b = Math.floor(colors[idx + 2] * 255);

                            // Add vertex line
                            lines.push(`${x} ${y} ${z} ${r} ${g} ${b}`);
                        }

                        // Create blob for this chunk and add to chunks array
                        const chunkContent = lines.join('\n') + '\n';
                        chunks.push(new Blob([chunkContent], { type: 'text/plain' }));

                        // Update counters
                        processedVertices += (endIdx - startIdx);

                        // Update progress
                        const overallProgress = (processedVertices / totalVertices * 100).toFixed(1);
                        const objProgress = (endIdx / count * 100).toFixed(1);

                        document.getElementById('loadingMessage').innerHTML =
                            `<div>📝 Generating PLY file...</div><div style="font-size: 11px; margin-top: 8px; opacity: 0.8;">${overallProgress}% (${processedVertices.toLocaleString()}/${totalVertices.toLocaleString()} points)<br>Object ${objIndex+1}/${pointObjects.length}: ${objProgress}%</div>`;

                        // Process next chunk or next object
                        if (endIdx < count) {
                            // Use shorter timeout for smaller chunks to maintain responsiveness
                            setTimeout(() => processPointsChunk(endIdx), 5);
                        } else {
                            setTimeout(() => processPoints(objIndex + 1), 10);
                        }

                    } catch (error) {
                        console.error('Error processing points chunk:', error);
                        this._handleExportError('Memory error during point processing. Try reducing grid size or chunk size.');
                    }
                };

                // Start processing points for this object
                processPointsChunk();
            };

            // Start processing point objects
            setTimeout(() => processPoints(), 100);

        } catch (error) {
            console.error('Error during PLY export setup:', error);
            this._handleExportError('Failed to initialize PLY export. The dataset may be too large.');
        }
    }

    /**
     * Helper method to download blob chunks efficiently
     * @param {Blob[]} chunks - Array of blob chunks
     * @param {string} filename - Output filename
     * @param {number} totalVertices - Total number of vertices
     * @private
     */
    _downloadBlobChunks(chunks, filename, totalVertices) {
        try {
            document.getElementById('loadingMessage').innerHTML =
                '<div>📝 Finalizing file...</div><div style="font-size: 11px; margin-top: 8px; opacity: 0.8;">Creating download...</div>';

            // Create final blob from all chunks
            const finalBlob = new Blob(chunks, { type: 'text/plain' });
            const url = URL.createObjectURL(finalBlob);

            // Download file
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            a.style.display = 'none';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);

            // Clean up
            setTimeout(() => {
                URL.revokeObjectURL(url);
            }, 1000);

            // Hide loading message
            document.getElementById('loadingMessage').style.display = 'none';

            console.log(`Successfully exported ${totalVertices.toLocaleString()} points to PLY file: ${filename}`);

        } catch (error) {
            console.error('Error during file download:', error);
            this._handleExportError('Failed to create download file. The file may be too large for your browser.');
        }
    }

    /**
     * Helper method to handle export errors gracefully
     * @param {string} message - Error message to display
     * @private
     */
    _handleExportError(message) {
        document.getElementById('loadingMessage').innerHTML =
            `<div style="color: #ff6b6b;">❌ Export Failed</div><div style="font-size: 11px; margin-top: 8px; opacity: 0.8;">${message}</div>`;

        setTimeout(() => {
            document.getElementById('loadingMessage').style.display = 'none';
        }, 5000);

        console.error('PLY Export Error:', message);
    }

    /**
     * Initializes the Three.js scene, camera, renderer, and controls
     */
    init() {
        try {
            // Create scene
            this.scene = new THREE.Scene();
            this.scene.background = new THREE.Color(0x000000);

            // Create camera
            this.camera = new THREE.PerspectiveCamera(
                75,
                window.innerWidth / window.innerHeight,
                0.1,
                1000
            );
            this.camera.position.set(0, 0, this.cameraRadius);
            this.camera.lookAt(0, 0, 0);

            // Create renderer with context loss handling
            this.renderer = new THREE.WebGLRenderer({ antialias: false });
            this.renderer.setSize(window.innerWidth, window.innerHeight);
            document.getElementById('container').appendChild(this.renderer.domElement);

            // Add WebGL context loss handlers
            const canvas = this.renderer.domElement;
            canvas.addEventListener('webglcontextlost', (event) => {
                event.preventDefault();
                console.error('WebGL context lost! Attempting to recover...');
                this.handleContextLost();
            }, false);

            canvas.addEventListener('webglcontextrestored', () => {
                console.log('WebGL context restored! Reinitializing...');
                this.handleContextRestored();
            }, false);

            this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);

            // Add grid helper
            const gridHelper = new THREE.GridHelper(10, 10);
            this.scene.add(gridHelper);

            // Add axes helper
            const axesHelper = new THREE.AxesHelper(5);
            this.scene.add(axesHelper);

            // Add ambient light
            const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
            this.scene.add(ambientLight);

            // Add directional light
            const directionalLight = new THREE.DirectionalLight(0xffffff, 0.5);
            directionalLight.position.set(1, 1, 1);
            this.scene.add(directionalLight);

            // Handle window resize
            window.addEventListener('resize', () => {
                try {
                    if (this.camera && this.renderer) {
                        this.camera.aspect = window.innerWidth / window.innerHeight;
                        this.camera.updateProjectionMatrix();
                        this.renderer.setSize(window.innerWidth, window.innerHeight);
                    }
                } catch (error) {
                    console.error('Error in resize handler:', error);
                }
            });

            console.log('Initialization complete');
        } catch (error) {
            console.error('Error during initialization:', error);
            throw error;
        }
    }

    /**
     * Handles WebGL context loss
     */
    handleContextLost() {
        // Stop the animation loop
        this.contextLost = true;
        console.log('Context lost - animation loop paused');
    }

    /**
     * Handles WebGL context restoration
     */
    handleContextRestored() {
        // Reinitialize renderer
        try {
            this.contextLost = false;

            // Recreate the scene elements
            if (this.pointClouds.length > 0 || this.pathLines.length > 0) {
                console.log('Recreating scene after context restoration...');
                // The geometries and materials should be recreated automatically by Three.js
            }

            console.log('Context restored - resuming animation loop');
        } catch (error) {
            console.error('Error restoring context:', error);
        }
    }

    /**
     * Sets up event listeners for UI controls
     */
    setupEventListeners() {
        const fileInput = document.getElementById('fileInput');
        const processButton = document.getElementById('processButton');
        const resetButton = document.getElementById('resetButton');
        const exportPlyButton = document.getElementById('exportPlyButton');
        const minimizeButton = document.getElementById('minimizeButton');
        const restoreButton = document.getElementById('restoreButton');
        const projectionModeSelect = document.getElementById('projectionMode');
        const tupleModeSelect = document.getElementById('tupleMode');

        // Control panel minimize/restore functionality
        minimizeButton.addEventListener('click', () => {
            this.toggleControls();
        });

        restoreButton.addEventListener('click', () => {
            this.toggleControls();
        });

        // Projection mode change handler
        projectionModeSelect.addEventListener('change', () => {
            // Show/hide BVH controls based on mode
            const isBVHMode = projectionModeSelect.value === 'bvh-with-points' ||
                             projectionModeSelect.value === 'bvh-only';

            document.getElementById('bvhControls').style.display = isBVHMode ? 'flex' : 'none';
            document.getElementById('bvhMinPointsControl').style.display = isBVHMode ? 'flex' : 'none';
            document.getElementById('bvhLevelControl').style.display = isBVHMode ? 'flex' : 'none';

            // Highlight process button to indicate changes need processing
            if (this.fileBuffer) {
                this.highlightProcessButton();
            }
        });

        // Tuple mode change handler
        tupleModeSelect.addEventListener('change', () => {
            // Highlight process button to indicate changes need processing
            if (this.fileBuffer) {
                this.highlightProcessButton();
            }
        });

        // Add change listeners to other processing-related controls
        const processingControls = ['dataType', 'startOffset', 'chunkSize', 'gridSize',
                                   'spacing', 'pointSize', 'endianness', 'useQuantization', 'quantizationBits',
                                   'bvhMaxDepth', 'bvhMinPoints', 'bvhDisplayLevel'];

        processingControls.forEach(controlId => {
            const control = document.getElementById(controlId);
            if (control) {
                control.addEventListener('change', () => {
                    if (this.fileBuffer) {
                        this.highlightProcessButton();
                    }
                });
                control.addEventListener('input', () => {
                    if (this.fileBuffer) {
                        this.highlightProcessButton();
                    }
                });
            }
        });

        fileInput.addEventListener('change', (event) => {
            this.handleFiles(event.target.files);
        });

        // Also add a click handler to clear the input first (to handle selecting same file twice)
        fileInput.addEventListener('click', (event) => {
            // Clear the input value so that selecting the same file will trigger change event
            event.target.value = '';
        });

        processButton.addEventListener('click', () => {
            if (!this.fileBuffer) return;
            this.processFile();
            // Enable export button after processing
            setTimeout(() => {
                exportPlyButton.disabled = false;
            }, 100);
        });

        resetButton.addEventListener('click', () => {
            this.resetCamera();
        });

        exportPlyButton.addEventListener('click', () => {
            this.exportToPLY();
        });
    }

    /**
     * Resets camera to initial position with smooth animation
     */
    resetCamera() {
        try {
            if (!this.camera) {
                console.error('Cannot reset camera - camera is null');
                return;
            }

            new TWEEN.Tween(this.camera.position)
                .to({
                    x: 0,
                    y: 0,
                    z: this.cameraRadius
                }, 1000)
                .easing(TWEEN.Easing.Quadratic.InOut)
                .start();

            this.cameraAngle = 0;
        } catch (error) {
            console.error('Error in resetCamera():', error);
        }
    }

    /**
     * Sets up visibility handling to detect when tab becomes inactive
     */
    setupVisibilityHandling() {
        // Monitor page visibility to detect when tab becomes inactive
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                console.log('Page hidden - idle state started at', new Date().toISOString());
            } else {
                console.log('Page visible - resuming from idle at', new Date().toISOString());

                // Check if renderer is still valid
                if (this.renderer) {
                    const gl = this.renderer.getContext();
                    if (gl) {
                        const contextLost = gl.isContextLost();
                        if (contextLost) {
                            console.error('WebGL context was lost while page was hidden');
                        } else {
                            console.log('WebGL context is still valid');
                        }
                    }
                }
            }
        });
    }

    /**
     * Processes the loaded file with current settings
     */
    processFile() {
        // Remove highlight when processing starts
        this.unhighlightProcessButton();

        // Clear existing point clouds and path lines
        this.clearPointClouds();

        // Get user options
        const tupleMode = document.getElementById('tupleMode').value;
        const dataType = document.getElementById('dataType').value;
        const startOffset = parseInt(document.getElementById('startOffset').value) || 0;
        const chunkSizeMB = parseFloat(document.getElementById('chunkSize').value);
        const gridSize = parseInt(document.getElementById('gridSize').value);
        const spacing = parseFloat(document.getElementById('spacing').value);
        const pointSize = parseFloat(document.getElementById('pointSize').value);
        const isLittleEndian = document.getElementById('endianness').value === 'true';
        const useQuantization = document.getElementById('useQuantization').checked;
        const quantizationBits = parseInt(document.getElementById('quantizationBits').value) || 8;
        const projectionMode = document.getElementById('projectionMode').value;

        // Validate quantization bits
        if (quantizationBits < 2 || quantizationBits > 10) {
            console.log('Quantization bits must be between 2 and 10, using default 8');
            document.getElementById('quantizationBits').value = 8;
            return;
        }

        // Validate start offset
        if (startOffset < 0) {
            console.log('Start offset cannot be negative, using 0');
            document.getElementById('startOffset').value = 0;
            return;
        }

        if (startOffset >= this.fileBuffer.byteLength) {
            console.log(`Start offset (${startOffset}) is beyond file size (${this.fileBuffer.byteLength}), using 0`);
            document.getElementById('startOffset').value = 0;
            return;
        }

        // Calculate chunk size in bytes
        const chunkSize = Math.floor(chunkSizeMB * 1024 * 1024);

        // Show loading message
        const loadingMsg = document.getElementById('loadingMessage');
        loadingMsg.style.display = 'block';

        let loadingText = `<div>⏳ Processing data...</div><div style="font-size: 12px; margin-top: 8px; opacity: 0.8;">`;
        loadingText += `Mode: <span class="tuple-mode-indicator">${tupleMode.toUpperCase()}</span><br>`;
        loadingText += `Projection: ${projectionMode}`;
        if (projectionMode === 'continuous-path') {
            loadingText += ` <span class="continuous-path-indicator">(PATH)</span>`;
        } else if (projectionMode === 'hilbert-curve') {
            loadingText += ` <span class="hilbert-indicator">(HILBERT)</span>`;
        } else if (projectionMode === 'bvh-with-points') {
            loadingText += ` <span class="bvh-indicator">(BVH+PTS)</span>`;
        } else if (projectionMode === 'bvh-only') {
            loadingText += ` <span class="bvh-indicator">(BVH)</span>`;
        } else if (projectionMode === 'lattice-2d') {
            loadingText += ` <span class="lattice-indicator">(LATTICE)</span>`;
        } else if (projectionMode === 'tiled') {
            loadingText += ` <span class="tiled-indicator">(TILED)</span>`;
        } else if (projectionMode === 'orthographic-3plane') {
            loadingText += ` (3x points)`;
        }
        loadingText += `<br>`;
        if (useQuantization) {
            const qRange = Math.pow(2, quantizationBits);
            loadingText += `Using ${quantizationBits}-bit quantization (${qRange}³ positions)<br>`;
        } else {
            loadingText += 'Standard processing<br>';
        }
        loadingText += `Start offset: ${startOffset} bytes</div>`;
        loadingMsg.innerHTML = loadingText;

        // Reset total points counter
        this.totalPoints = 0;

        // Process file asynchronously to allow UI updates
        setTimeout(async () => {
            await this.createPointCloudLattice(
                this.fileBuffer,
                dataType,
                startOffset,
                chunkSize,
                gridSize,
                spacing,
                pointSize,
                isLittleEndian,
                useQuantization,
                quantizationBits,
                projectionMode,
                tupleMode
            );
        }, 100);
    }

    /**
     * Clears all existing point clouds and path lines from the scene
     */
    clearPointClouds() {
        try {
            // Remove point clouds
            for (const cloud of this.pointClouds) {
                try {
                    if (cloud && this.scene) {
                        this.scene.remove(cloud);
                        // Dispose geometry and material to prevent memory leaks
                        if (cloud.geometry) cloud.geometry.dispose();
                        if (cloud.material) cloud.material.dispose();
                    }
                } catch (error) {
                    console.error('Error removing point cloud:', error);
                }
            }
            this.pointClouds = [];

            // Remove path lines
            for (const line of this.pathLines) {
                try {
                    if (line && this.scene) {
                        this.scene.remove(line);
                        // Dispose geometry and material to prevent memory leaks
                        if (line.geometry) line.geometry.dispose();
                        if (line.material) line.material.dispose();
                    }
                } catch (error) {
                    console.error('Error removing path line:', error);
                }
            }
            this.pathLines = [];

            this.totalPoints = 0;
            this.updateStatsDisplay();
        } catch (error) {
            console.error('Error in clearPointClouds():', error);
        }
    }

    /**
     * Updates the stats display with current point cloud information
     */
    updateStatsDisplay() {
        const statsDiv = document.getElementById('statsInfo');
        if (this.totalPoints > 0) {
            const tupleMode = document.getElementById('tupleMode').value;
            const useQuantization = document.getElementById('useQuantization').checked;
            const quantizationBits = parseInt(document.getElementById('quantizationBits').value) || 8;
            const startOffset = parseInt(document.getElementById('startOffset').value) || 0;
            const dataType = document.getElementById('dataType').value;
            const projectionMode = document.getElementById('projectionMode').value;
            const config = DATA_TYPES[dataType];

            let statsText = `<strong>Points:</strong> ${this.totalPoints.toLocaleString()}`;

            if (this.pathLines.length > 0) {
                statsText += `<br><strong>Paths:</strong> ${this.pathLines.length} <span class="continuous-path-indicator">LINES</span>`;
            }

            if (startOffset > 0) {
                statsText += `<br><strong>Offset:</strong> ${startOffset} bytes`;
            }

            statsText += `<br><strong>Mode:</strong> <span class="tuple-mode-indicator">${tupleMode.toUpperCase()}</span>`;
            statsText += `<br><strong>Type:</strong> ${dataType.toUpperCase()}`;

            if (config.isFloat) {
                statsText += ` (tanh normalized)`;
            } else {
                statsText += ` (linear normalized)`;
            }

            statsText += `<br><strong>Projection:</strong> ${projectionMode}`;
            if (projectionMode === 'continuous-path') {
                statsText += ` <span class="continuous-path-indicator">(PATH)</span>`;
            } else if (projectionMode === 'hilbert-curve') {
                statsText += ` <span class="hilbert-indicator">(HILBERT)</span>`;
            } else if (projectionMode === 'bvh-with-points') {
                statsText += ` <span class="bvh-indicator">(BVH+PTS)</span>`;
            } else if (projectionMode === 'bvh-only') {
                statsText += ` <span class="bvh-indicator">(BVH)</span>`;
            } else if (projectionMode === 'lattice-2d') {
                statsText += ` <span class="lattice-indicator">(LATTICE)</span>`;
            } else if (projectionMode === 'tiled') {
                statsText += ` <span class="tiled-indicator">(TILED)</span>`;
            }

            if (useQuantization) {
                const qRange = Math.pow(2, quantizationBits);
                statsText += `<br><strong>Method:</strong> ${quantizationBits}-bit quantized (${qRange}³)`;
            } else {
                statsText += `<br><strong>Method:</strong> Standard`;
            }

            statsDiv.innerHTML = statsText;
        } else {
            statsDiv.innerHTML = '';
        }
    }

    /**
     * Creates a lattice of point clouds from the buffer
     * @param {ArrayBuffer} buffer - Binary data buffer
     * @param {string} dataType - Data type configuration key
     * @param {number} startOffset - Offset in bytes to start reading from
     * @param {number} chunkSize - Size of each chunk in bytes
     * @param {number} gridSize - Size of the 3D grid (gridSize x gridSize x gridSize)
     * @param {number} spacing - Spacing between grid cells
     * @param {number} pointSize - Size of rendered points
     * @param {boolean} isLittleEndian - Endianness of data
     * @param {boolean} useQuantization - Whether to use quantization
     * @param {number} quantizationBits - Number of bits for quantization
     * @param {string} projectionMode - Projection mode to use
     * @param {string} tupleMode - Tuple interpretation mode (rgb, xyz, etc.)
     */
    async createPointCloudLattice(buffer, dataType, startOffset, chunkSize, gridSize, spacing, pointSize, isLittleEndian, useQuantization, quantizationBits, projectionMode, tupleMode) {
        // Apply start offset to buffer
        const effectiveBuffer = startOffset > 0 ? buffer.slice(startOffset) : buffer;

        // Calculate how many chunks we need
        const totalChunks = Math.min(
            gridSize * gridSize * gridSize,
            Math.floor(effectiveBuffer.byteLength / chunkSize) + 1
        );

        // Calculate offset from center based on user-defined spacing
        const offset = (gridSize - 1) * spacing / 2;

        console.log(`Creating point cloud lattice with ${totalChunks} chunks in ${tupleMode} mode, spacing: ${spacing}, quantization: ${useQuantization ? quantizationBits + '-bit' : 'off'}, projection: ${projectionMode}, start offset: ${startOffset}`);

        const loadingMsg = document.getElementById('loadingMessage');
        const startTime = Date.now();

        // Process chunks incrementally with progress updates
        const processChunk = async (chunkIndex, x, y, z) => {
            // Update progress message
            const progress = ((chunkIndex + 1) / totalChunks * 100).toFixed(1);
            const elapsedTime = ((Date.now() - startTime) / 1000).toFixed(1);
            const pointsProcessed = this.totalPoints.toLocaleString();

            const projectionInfo = projectionMode === 'continuous-path' ? ` • PATH` :
                                 projectionMode === 'hilbert-curve' ? ` • HILBERT` :
                                 projectionMode === 'bvh-with-points' ? ` • BVH+PTS` :
                                 projectionMode === 'bvh-only' ? ` • BVH` :
                                 projectionMode === 'lattice-2d' ? ` • LATTICE` :
                                 projectionMode === 'tiled' ? ` • TILED` :
                                 projectionMode === 'orthographic-3plane' ? ` • 3-Plane` : '';

            loadingMsg.innerHTML = `
                <div>🔄 Processing chunks...</div>
                <div style="font-size: 11px; margin-top: 8px; opacity: 0.8;">
                    Chunk ${chunkIndex + 1}/${totalChunks} (${progress}%)<br>
                    Points: ${pointsProcessed} • Time: ${elapsedTime}s<br>
                    Mode: <span class="tuple-mode-indicator">${tupleMode.toUpperCase()}</span> • Position: [${x}, ${y}, ${z}]<br>
                    Projection: ${projectionMode}${projectionInfo}
                </div>
            `;

            // Calculate chunk position in the grid using user-defined spacing
            const posX = (x * spacing) - offset;
            const posY = (y * spacing) - offset;
            const posZ = (z * spacing) - offset;

            // Calculate chunk start and end offsets (relative to effective buffer)
            const chunkStartOffset = chunkIndex * chunkSize;
            const chunkEndOffset = Math.min(chunkStartOffset + chunkSize, effectiveBuffer.byteLength);

            // Check if we have enough data for this chunk
            if (chunkStartOffset >= effectiveBuffer.byteLength) {
                return false; // Signal to stop processing
            }

            // Extract chunk buffer
            const chunkBuffer = effectiveBuffer.slice(chunkStartOffset, chunkEndOffset);

            // Process chunk data using selected method and projection
            const processedData = quantizeProcessDataAs(chunkBuffer, dataType, isLittleEndian, quantizationBits, projectionMode, tupleMode);

            // Create point cloud and optionally path lines
            const pointCloud = this.createPointCloud(
                processedData,
                pointSize,
                posX,
                posY,
                posZ
            );

            // Add to scene
            this.scene.add(pointCloud);
            this.pointClouds.push(pointCloud);

            // Add to total points count
            this.totalPoints += processedData.numPoints;

            return true; // Continue processing
        };

        // Process all chunks with progress updates
        let chunkIndex = 0;
        for (let x = 0; x < gridSize && chunkIndex < totalChunks; x++) {
            for (let y = 0; y < gridSize && chunkIndex < totalChunks; y++) {
                for (let z = 0; z < gridSize && chunkIndex < totalChunks; z++) {
                    // Process this chunk
                    const shouldContinue = await processChunk(chunkIndex, x, y, z);
                    if (!shouldContinue) break;

                    chunkIndex++;

                    // Add small delay to allow UI updates (every few chunks)
                    if (chunkIndex % 3 === 0) {
                        await new Promise(resolve => setTimeout(resolve, 10));
                    }
                }
            }
        }

        // Final progress update
        const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
        loadingMsg.innerHTML = `
            <div>✅ Processing complete!</div>
            <div style="font-size: 11px; margin-top: 8px; opacity: 0.8;">
                ${this.pointClouds.length} clouds • ${this.totalPoints.toLocaleString()} points<br>
                ${this.pathLines.length > 0 ? `${this.pathLines.length} paths • ` : ''}Mode: <span class="tuple-mode-indicator">${tupleMode.toUpperCase()}</span> • Projection: ${projectionMode}<br>
                Completed in ${totalTime}s
            </div>
        `;

        // Adjust camera distance based on grid size and spacing
        this.cameraRadius = Math.max(5, (gridSize * spacing) * 1.2);
        this.resetCamera();

        console.log(`Created ${this.pointClouds.length} point clouds with ${this.totalPoints.toLocaleString()} total points and ${this.pathLines.length} path lines in ${totalTime}s using ${tupleMode} mode with ${projectionMode} projection`);

        // Hide loading message after a short delay
        setTimeout(() => {
            loadingMsg.style.display = 'none';
            this.updateStatsDisplay();
        }, 1500);
    }

    /**
     * Creates a point cloud or group from processed data
     * @param {Object} processedData - Processed point cloud data
     * @param {number} pointSize - Size of rendered points
     * @param {number} x - X position
     * @param {number} y - Y position
     * @param {number} z - Z position
     * @returns {THREE.Group|THREE.Points} Point cloud or group
     */
    createPointCloud(processedData, pointSize, x, y, z) {
        const { points, colors, numPoints, pathData, bvhNodes, bvhMode, showPoints } = processedData;

        // Create container group for this chunk
        const group = new THREE.Group();
        group.position.set(x, y, z);

        // Handle BVH mode
        if (bvhMode && bvhNodes && bvhNodes.length > 0) {
            // Create instanced BVH boxes
            const bvhBoxes = createInstancedBVHBoxes(bvhNodes);
            if (bvhBoxes) {
                group.add(bvhBoxes);
                console.log(`Added ${bvhNodes.length} BVH boxes to scene`);
            }

            // Optionally add points if in "bvh-with-points" mode
            if (showPoints && numPoints > 0) {
                const pointCloud = this.createPointGeometry(points, colors, numPoints, pointSize);
                group.add(pointCloud);
                console.log(`Added ${numPoints} points with BVH boxes`);
            }

            // Return early - don't process as standard point cloud
            return group;
        }

        // Standard mode - create point cloud geometry
        if (numPoints > 0) {
            const pointCloud = this.createPointGeometry(points, colors, numPoints, pointSize);
            group.add(pointCloud);

            // If this is continuous path mode or Hilbert curve, also create line geometry
            if (pathData && numPoints > 1) {
                const actualPoints = points.slice(0, numPoints * 3);
                const actualColors = colors.slice(0, numPoints * 3);

                // Create line geometry connecting consecutive points
                const lineGeometry = new THREE.BufferGeometry();

                // Create line positions - same as point positions
                lineGeometry.setAttribute('position', new THREE.BufferAttribute(actualPoints, 3));

                // Create line colors - same as point colors
                lineGeometry.setAttribute('color', new THREE.BufferAttribute(actualColors, 3));

                // Create line material with smaller width and transparency
                const lineMaterial = new THREE.LineBasicMaterial({
                    vertexColors: true,
                    opacity: 0.6,
                    transparent: true,
                    linewidth: 1
                });

                // Create line object
                const pathLine = new THREE.Line(lineGeometry, lineMaterial);

                // Add to group
                group.add(pathLine);

                // Track path line separately for cleanup
                this.pathLines.push(pathLine);

                console.log(`Created path line with ${numPoints} connected points at position [${x}, ${y}, ${z}]`);
            }
        }

        return group;
    }

    /**
     * Creates point geometry from position and color arrays
     * @param {Float32Array} points - Point positions
     * @param {Float32Array} colors - Point colors
     * @param {number} numPoints - Number of points
     * @param {number} pointSize - Size of rendered points
     * @returns {THREE.Points} Points object
     */
    createPointGeometry(points, colors, numPoints, pointSize) {
        // Create buffer geometry for points
        const geometry = new THREE.BufferGeometry();

        // Slice arrays to actual size
        const actualPoints = points.slice(0, numPoints * 3);
        const actualColors = colors.slice(0, numPoints * 3);

        // Set position attributes
        const positionAttribute = new THREE.BufferAttribute(actualPoints, 3);
        positionAttribute.setUsage(THREE.StaticDrawUsage);
        geometry.setAttribute('position', positionAttribute);

        // Set color attributes
        const colorAttribute = new THREE.BufferAttribute(actualColors, 3);
        colorAttribute.setUsage(THREE.StaticDrawUsage);
        geometry.setAttribute('color', colorAttribute);

        // Create point cloud material
        const material = new THREE.PointsMaterial({
            size: pointSize,
            vertexColors: true,
            sizeAttenuation: true
        });

        // Create points object
        const pointCloud = new THREE.Points(geometry, material);

        return pointCloud;
    }

    /**
     * Animation loop
     */
    animate() {
        requestAnimationFrame(() => this.animate());

        try {
            // Skip rendering if context is lost
            if (this.contextLost) {
                return;
            }

            // Update TWEEN with error handling
            try {
                TWEEN.update();
            } catch (tweenError) {
                console.error('Error in TWEEN.update():', tweenError);
            }

            // Update controls with error handling
            try {
                if (this.controls && this.controls.update) {
                    this.controls.update();
                }
            } catch (controlsError) {
                console.error('Error in controls.update():', controlsError);
            }

            // Render scene with error handling
            try {
                if (this.renderer && this.scene && this.camera) {
                    this.renderer.render(this.scene, this.camera);
                } else {
                    console.error('Missing required objects for rendering:', {
                        renderer: !!this.renderer,
                        scene: !!this.scene,
                        camera: !!this.camera
                    });
                }
            } catch (renderError) {
                console.error('Error in renderer.render():', renderError);
                // Check if this is a context loss
                if (renderError.message && renderError.message.includes('context')) {
                    console.error('Possible context loss detected in render error');
                    this.contextLost = true;
                }
            }
        } catch (error) {
            console.error('Critical error in animation loop:', error);
            console.error('Error stack:', error.stack);
        }
    }
}

export default DataPrism;
