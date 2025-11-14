/**
 * Projections Module
 * Provides various projection modes for transforming 3D point clouds
 */

import { BVH } from '../spatial/BVH.js';
import { HilbertCurve3D } from './HilbertCurve3D.js';

/**
 * Apply projection transformation to 3D points
 *
 * @param {Float32Array} points - Array of 3D point coordinates (x, y, z, x, y, z, ...)
 * @param {string} projectionMode - The projection mode to apply:
 *   - 'standard': No projection (returns points as-is)
 *   - 'bvh-with-points': BVH visualization with points
 *   - 'bvh-only': BVH visualization without points
 *   - 'continuous-path': Creates a continuous path through points
 *   - 'hilbert-curve': Arranges points along a 3D Hilbert curve
 *   - 'lattice-2d': Projects to a 2D lattice grid
 *   - 'tiled': Tiled projection with quantization
 *   - 'orthographic-3plane': Creates 3 orthographic projections (XY, XZ, YZ)
 *   - 'orthographic-xy': Orthographic projection onto XY plane
 *   - 'orthographic-xz': Orthographic projection onto XZ plane
 *   - 'orthographic-yz': Orthographic projection onto YZ plane
 *   - 'stereographic': Stereographic projection from sphere to plane
 *   - 'equirectangular': Equirectangular projection (lat/lon)
 *   - 'cylindrical': Cylindrical projection around Y axis
 * @param {number} [quantizationBits=8] - Number of bits for quantization (used in tiled mode)
 * @returns {Float32Array|Object} Transformed points or special projection data object
 */
export function applyProjection(points, projectionMode, quantizationBits = 8) {
    if (projectionMode === 'standard') {
        return points; // No projection
    }

    // BVH visualization modes
    if (projectionMode === 'bvh-with-points' || projectionMode === 'bvh-only') {
        try {
            const numPoints = points.length / 3;

            console.log(`Starting BVH projection mode: ${projectionMode}, numPoints: ${numPoints}`);

            // Get BVH parameters from UI
            const maxDepthElement = document.getElementById('bvhMaxDepth');
            const minPointsElement = document.getElementById('bvhMinPoints');
            const displayLevelElement = document.getElementById('bvhDisplayLevel');

            const maxDepth = maxDepthElement ? parseInt(maxDepthElement.value) : 8;
            const minPoints = minPointsElement ? parseInt(minPointsElement.value) : 8;
            const displayLevel = displayLevelElement ? parseInt(displayLevelElement.value) : -1;

            console.log(`BVH parameters: maxDepth=${maxDepth}, minPoints=${minPoints}, displayLevel=${displayLevel}`);

            // Validate parameters
            if (isNaN(maxDepth) || maxDepth < 1 || maxDepth > 12) {
                throw new Error(`Invalid maxDepth: ${maxDepth}`);
            }
            if (isNaN(minPoints) || minPoints < 1) {
                throw new Error(`Invalid minPoints: ${minPoints}`);
            }
            if (numPoints === 0) {
                throw new Error('No points to build BVH');
            }

            // Build BVH tree
            console.log('Building BVH tree...');
            const bvhRoot = BVH.build(points, maxDepth, minPoints);
            console.log('BVH tree built successfully');

            // Flatten tree for rendering
            console.log('Flattening BVH tree...');
            const bvhNodes = BVH.flattenTree(bvhRoot, null, null, null, maxDepth, displayLevel);
            console.log(`BVH flattened: ${bvhNodes.length} boxes at ${displayLevel >= 0 ? 'level ' + displayLevel : 'all levels'}`);

            if (bvhNodes.length === 0) {
                console.warn('No BVH nodes generated - returning standard points');
                return points; // Just return points as-is for standard handling
            }

            // Return special structure indicating BVH mode
            // We return the points as-is and attach bvhData which will be handled specially
            return {
                points: points, // Keep original points
                bvhData: {
                    nodes: bvhNodes,
                    showPoints: projectionMode === 'bvh-with-points'
                }
            };
        } catch (error) {
            console.error('Error in BVH projection mode:', error);
            console.error('Error stack:', error.stack);
            console.error('Error details:', {
                message: error.message,
                name: error.name,
                projectionMode: projectionMode,
                pointsLength: points.length
            });
            // Return standard points as fallback
            return points;
        }
    }

    // Special case for continuous path - return both points and path data
    if (projectionMode === 'continuous-path') {
        return {
            points: points,
            pathData: true, // Flag to indicate this chunk should create path lines
            numPoints: points.length / 3
        };
    }

    // Hilbert curve projection - rearrange points along a 3D Hilbert curve
    if (projectionMode === 'hilbert-curve') {
        const numPoints = points.length / 3;
        const order = Math.max(2, Math.min(8, Math.ceil(Math.log2(Math.cbrt(numPoints))))); // Adaptive order
        const gridSize = Math.pow(2, order);

        // Create array to store points with their Hilbert indices
        const indexedPoints = [];

        for (let i = 0; i < numPoints; i++) {
            const pointIndex = i * 3;
            const x = points[pointIndex];
            const y = points[pointIndex + 1];
            const z = points[pointIndex + 2];

            // Convert normalized coordinates [-1,1] to discrete grid [0, gridSize-1]
            const discreteX = Math.max(0, Math.min(gridSize - 1, Math.floor((x + 1) / 2 * gridSize)));
            const discreteY = Math.max(0, Math.min(gridSize - 1, Math.floor((y + 1) / 2 * gridSize)));
            const discreteZ = Math.max(0, Math.min(gridSize - 1, Math.floor((z + 1) / 2 * gridSize)));

            // Calculate Hilbert index for this point
            const hilbertIndex = HilbertCurve3D.coordsToIndex(discreteX, discreteY, discreteZ, order);

            indexedPoints.push({
                hilbertIndex: hilbertIndex,
                originalIndex: i,
                x: x,
                y: y,
                z: z
            });
        }

        // Sort points by Hilbert index to create a continuous path
        indexedPoints.sort((a, b) => a.hilbertIndex - b.hilbertIndex);

        // Create new point array in Hilbert order
        const orderedPoints = new Float32Array(points.length);
        for (let i = 0; i < indexedPoints.length; i++) {
            const pt = indexedPoints[i];
            orderedPoints[i * 3] = pt.x;
            orderedPoints[i * 3 + 1] = pt.y;
            orderedPoints[i * 3 + 2] = pt.z;
        }

        // Return with path data flag to draw connecting lines
        return {
            points: orderedPoints,
            pathData: true,
            numPoints: numPoints
        };
    }

    // New Lattice 2D projection case
    if (projectionMode === 'lattice-2d') {
        const numPoints = points.length / 3;
        const latticeSize = Math.ceil(Math.sqrt(numPoints));

        // Create new projected points array
        const projectedPoints = new Float32Array(points.length);

        for (let i = 0; i < numPoints; i++) {
            const pointIndex = i * 3;

            // Calculate lattice position
            const row = Math.floor(i / latticeSize);
            const col = i % latticeSize;

            // Map to normalized coordinates [-1, 1] with proper spacing
            const x = latticeSize > 1 ? (col / (latticeSize - 1)) * 2 - 1 : 0;
            const y = latticeSize > 1 ? (row / (latticeSize - 1)) * 2 - 1 : 0;

            projectedPoints[pointIndex] = x;
            projectedPoints[pointIndex + 1] = y;
            projectedPoints[pointIndex + 2] = 0; // Flatten to z=0 plane
        }

        return projectedPoints;
    }

    // New Tiled projection case
    if (projectionMode === 'tiled') {
        const q = quantizationBits;
        const qRange = Math.pow(2, q);
        const sqrtQRange = Math.floor(Math.sqrt(qRange));

        // Create new projected points array
        const projectedPoints = new Float32Array(points.length);

        for (let i = 0; i < points.length; i += 3) {
            const x = points[i];
            const y = points[i + 1];
            const z = points[i + 2];

            // Convert normalized coordinates [-1,1] to discrete grid [0, qRange-1]
            const discreteX = Math.max(0, Math.min(qRange - 1, Math.floor((x + 1) / 2 * qRange)));
            const discreteY = Math.max(0, Math.min(qRange - 1, Math.floor((y + 1) / 2 * qRange)));
            const discreteZ = Math.max(0, Math.min(qRange - 1, Math.floor((z + 1) / 2 * qRange)));

            // Apply tiling formula: (col, row) = (z % sqrt(2^q), floor(z / sqrt(2^q)))
            const col = discreteZ % sqrtQRange;
            const row = Math.floor(discreteZ / sqrtQRange);

            // Calculate tiled coordinates: col * 2^q + x, row * 2^q + y
            const tiledX = col * qRange + discreteX;
            const tiledY = row * qRange + discreteY;

            // Normalize back for display (scale to fit in reasonable viewing area)
            const maxTiledCoord = Math.max(sqrtQRange * qRange + qRange - 1, 1);
            projectedPoints[i] = (tiledX / maxTiledCoord) * 2 - 1;
            projectedPoints[i + 1] = (tiledY / maxTiledCoord) * 2 - 1;
            projectedPoints[i + 2] = 0; // Flatten to z=0 plane
        }

        return projectedPoints;
    }

    // Special case for 3-plane orthographic - creates 3x more points
    if (projectionMode === 'orthographic-3plane') {
        const projectedPoints = new Float32Array(points.length * 3); // Triple the size

        for (let i = 0; i < points.length; i += 3) {
            const x = points[i];
            const y = points[i + 1];
            const z = points[i + 2];

            // Calculate base index for the three projected points
            const baseIdx = i * 3;

            // Project onto XY plane (z = 0)
            projectedPoints[baseIdx] = x;
            projectedPoints[baseIdx + 1] = y;
            projectedPoints[baseIdx + 2] = 0;

            // Project onto XZ plane (y = 0)
            projectedPoints[baseIdx + 3] = x;
            projectedPoints[baseIdx + 4] = 0;
            projectedPoints[baseIdx + 5] = z;

            // Project onto YZ plane (x = 0)
            projectedPoints[baseIdx + 6] = 0;
            projectedPoints[baseIdx + 7] = y;
            projectedPoints[baseIdx + 8] = z;
        }

        return projectedPoints;
    }

    // Standard single-point projections
    const projectedPoints = new Float32Array(points.length);

    for (let i = 0; i < points.length; i += 3) {
        let x = points[i];
        let y = points[i + 1];
        let z = points[i + 2];

        switch (projectionMode) {
            case 'stereographic':
                // Normalize to unit sphere
                const magnitude = Math.sqrt(x * x + y * y + z * z);
                if (magnitude > 0) {
                    x /= magnitude;
                    y /= magnitude;
                    z /= magnitude;
                }

                // Stereographic projection from north pole (0,0,1) to z=0 plane
                if (z < 0.999) { // Avoid division by zero
                    const denominator = 1 - z;
                    const projX = x / denominator;
                    const projY = y / denominator;

                    // Scale down the projection for better visualization
                    const scale = 0.5;
                    projectedPoints[i] = projX * scale;
                    projectedPoints[i + 1] = projY * scale;
                    projectedPoints[i + 2] = 0; // Flatten to z=0 plane
                } else {
                    // Point very close to north pole, place at origin
                    projectedPoints[i] = 0;
                    projectedPoints[i + 1] = 0;
                    projectedPoints[i + 2] = 0;
                }
                break;

            case 'equirectangular':
                // Convert cartesian to spherical coordinates
                const r = Math.sqrt(x * x + y * y + z * z);
                if (r > 0) {
                    // Spherical coordinates: theta (azimuth), phi (elevation)
                    const theta = Math.atan2(y, x); // azimuth [-π, π]
                    const phi = Math.acos(Math.abs(z) / r); // elevation [0, π]

                    // Map to equirectangular coordinates
                    // Longitude: theta mapped to [-1, 1]
                    // Latitude: phi mapped to [-1, 1]
                    projectedPoints[i] = theta / Math.PI; // maps [-π,π] to [-1,1]
                    projectedPoints[i + 1] = (phi / Math.PI) * 2 - 1; // maps [0,π] to [-1,1]
                    projectedPoints[i + 2] = 0; // Flatten to z=0 plane
                } else {
                    projectedPoints[i] = 0;
                    projectedPoints[i + 1] = 0;
                    projectedPoints[i + 2] = 0;
                }
                break;

            case 'orthographic-xy':
                // Project onto XY plane (view from Z axis)
                projectedPoints[i] = x;
                projectedPoints[i + 1] = y;
                projectedPoints[i + 2] = 0;
                break;

            case 'orthographic-xz':
                // Project onto XZ plane (view from Y axis)
                projectedPoints[i] = x;
                projectedPoints[i + 1] = z;
                projectedPoints[i + 2] = 0;
                break;

            case 'orthographic-yz':
                // Project onto YZ plane (view from X axis)
                projectedPoints[i] = y;
                projectedPoints[i + 1] = z;
                projectedPoints[i + 2] = 0;
                break;

            case 'cylindrical':
                // Cylindrical projection: wrap around Y axis
                const radius = Math.sqrt(x * x + z * z);
                if (radius > 0) {
                    // Azimuth angle around Y axis
                    const angle = Math.atan2(z, x); // [-π, π]

                    // Map to cylindrical coordinates
                    projectedPoints[i] = angle / Math.PI; // maps [-π,π] to [-1,1]
                    projectedPoints[i + 1] = y; // height remains the same
                    projectedPoints[i + 2] = 0; // Flatten to z=0 plane
                } else {
                    projectedPoints[i] = 0;
                    projectedPoints[i + 1] = y;
                    projectedPoints[i + 2] = 0;
                }
                break;

            default:
                // Fallback to standard (no projection)
                projectedPoints[i] = x;
                projectedPoints[i + 1] = y;
                projectedPoints[i + 2] = z;
                break;
        }
    }

    return projectedPoints;
}
