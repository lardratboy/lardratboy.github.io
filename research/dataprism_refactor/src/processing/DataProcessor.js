/**
 * DataProcessor Module
 * Handles binary data processing, quantization, and normalization
 */

import { applyProjection } from '../utils/Projections.js';
import { DATA_TYPES, NORMALIZERS } from '../utils/Constants.js';
import { createExtendedDataView } from '../utils/FloatUtils.js';

/**
 * Process binary data into quantized normalized 3D points with colors (removes duplicates)
 *
 * This function reads binary data of various types, normalizes values to [-1,1] range,
 * performs spatial quantization to remove duplicate points, and optionally applies
 * projection transformations.
 *
 * @param {ArrayBuffer} buffer - The input binary data
 * @param {string} dataType - The data type to interpret the buffer as (int8, uint8, int16, uint16, int32, uint32, fp16, bf16, fp32, fp8_e4m3, fp8_e5m2)
 * @param {boolean} isLittleEndian - Whether to read as little endian
 * @param {number} quantizationBits - Number of bits for quantization (2-10)
 * @param {string} [projectionMode='standard'] - Projection mode to apply (see applyProjection for options)
 * @param {string} [tupleMode='3-tuple'] - Tuple mode: '3-tuple' (XYZ) or '6-tuple' (XYZ+RGB)
 * @returns {{ points: Float32Array, colors: Float32Array, numPoints: number, pathData?: boolean, bvhNodes?: Array, bvhMode?: boolean, showPoints?: boolean }}
 */
export function quantizeProcessDataAs(buffer, dataType, isLittleEndian, quantizationBits, projectionMode = 'standard', tupleMode = '3-tuple') {
    // Input validation
    if (!buffer || !(buffer instanceof ArrayBuffer)) {
        throw new Error('Invalid buffer provided - must be an ArrayBuffer');
    }

    const config = DATA_TYPES[dataType];
    if (!config) {
        throw new Error(`Unsupported data type: ${dataType}. Supported types: ${Object.keys(DATA_TYPES).join(', ')}`);
    }

    // Validate quantization bits
    if (quantizationBits < 2 || quantizationBits > 10) {
        throw new Error('Quantization bits must be between 2 and 10');
    }

    const typeSize = config.size;
    const valuesPerTuple = tupleMode === '6-tuple' ? 6 : 3;
    const tupleSize = typeSize * valuesPerTuple;

    if (buffer.byteLength < tupleSize) {
        throw new Error(`Buffer too small for data type ${dataType} in ${tupleMode} mode. Need at least ${tupleSize} bytes, got ${buffer.byteLength}`);
    }

    const view = createExtendedDataView(buffer);
    const maxOffset = buffer.byteLength - tupleSize;
    const maxTuples = Math.floor(buffer.byteLength / tupleSize);

    // Pre-allocate typed arrays for better performance
    let points = new Float32Array(maxTuples * 3);
    const colors = new Float32Array(maxTuples * 3);

    // Setup normalization function based on data type
    const readMethod = view[config.method].bind(view);
    let normalize;

    if (config.isFloat) {
        // Use tanh for floating point normalization
        normalize = value => {
            // Handle special values
            if (!isFinite(value)) {
                return isNaN(value) ? 0 : (value > 0 ? 1 : -1);
            }
            // Apply tanh for smooth [-1, 1] mapping
            return Math.tanh(value);
        };
    } else {
        // Use linear normalization for integers
        const { multiplier, offset } = NORMALIZERS[dataType];
        normalize = value => ((value - offset) * multiplier) - 1;
    }

    let pointIndex = 0;
    let baseOffset = 0;

    // Calculate quantization parameters based on bit size
    const qRange = Math.pow(2, quantizationBits);
    const qHalfRange = qRange / 2;
    const qMaxIndex = qRange - 1;

    // For 6-tuple mode, we need to quantize both coordinates and colors
    // But we only deduplicate based on coordinates to preserve color variation
    const totalQuantizedPositions = qRange * qRange * qRange;
    const bitArraySizeInUint32 = Math.ceil(totalQuantizedPositions / 32);
    const tupleBitArray = new Uint32Array(bitArraySizeInUint32);

    // Calculate bit shifts for index generation based on quantization bits
    const yShift = quantizationBits;
    const zShift = quantizationBits * 2;

    console.log(`Using ${quantizationBits}-bit quantization in ${tupleMode} mode: ${qRange}³ = ${totalQuantizedPositions.toLocaleString()} possible positions`);

    try {
        while (baseOffset <= maxOffset) {
            // Read and normalize coordinates
            const x = normalize(readMethod(baseOffset, isLittleEndian));
            const y = normalize(readMethod(baseOffset + typeSize, isLittleEndian));
            const z = normalize(readMethod(baseOffset + typeSize * 2, isLittleEndian));

            // Quantize coordinates: map [-1,1] to [0,qMaxIndex] with bounds checking
            const qx = Math.max(0, Math.min(qMaxIndex, Math.floor((x + 1) * qHalfRange)));
            const qy = Math.max(0, Math.min(qMaxIndex, Math.floor((y + 1) * qHalfRange)));
            const qz = Math.max(0, Math.min(qMaxIndex, Math.floor((z + 1) * qHalfRange)));

            // Create unique index for this quantized position using variable bit shifts
            const qIndex = (qz << zShift) | (qy << yShift) | qx;

            // Check if we've seen this quantized position before
            const elementIndex = qIndex >> 5;
            const bitPosition = qIndex & 0x1F;
            const mask = 1 << bitPosition;

            if ((tupleBitArray[elementIndex] & mask) === 0) {
                // Mark this position as seen
                tupleBitArray[elementIndex] |= mask;

                // Store points (original normalized coordinates, not quantized)
                points[pointIndex] = x;
                points[pointIndex + 1] = y;
                points[pointIndex + 2] = z;

                // Handle colors based on tuple mode
                if (tupleMode === '6-tuple') {
                    // Read explicit color values and normalize to [-1,1] then convert to [0,1]
                    const r = normalize(readMethod(baseOffset + typeSize * 3, isLittleEndian));
                    const g = normalize(readMethod(baseOffset + typeSize * 4, isLittleEndian));
                    const b = normalize(readMethod(baseOffset + typeSize * 5, isLittleEndian));

                    // Convert from [-1,1] to [0,1] for Three.js rendering
                    colors[pointIndex] = (r + 1) / 2;
                    colors[pointIndex + 1] = (g + 1) / 2;
                    colors[pointIndex + 2] = (b + 1) / 2;
                } else {
                    // Generate colors from coordinates (map from [-1,1] to [0,1] for Three.js)
                    colors[pointIndex] = (x + 1) / 2;
                    colors[pointIndex + 1] = (y + 1) / 2;
                    colors[pointIndex + 2] = (z + 1) / 2;
                }

                pointIndex += 3;
            }

            baseOffset += tupleSize;
        }
    } catch (e) {
        console.error(`Error processing data at offset: ${baseOffset}`, e);
        // Return what we've processed so far rather than failing completely
    }

    // Apply projection if requested
    if (projectionMode !== 'standard') {
        const projectionResult = applyProjection(points.slice(0, pointIndex), projectionMode, quantizationBits);

        // Handle different projection return types
        if (projectionResult && projectionResult.pathData) {
            // Continuous path mode - return original points with path flag
            points = projectionResult.points.slice(0, pointIndex);

            return {
                points,
                colors: colors.slice(0, pointIndex),
                numPoints: pointIndex / 3,
                pathData: true
            };
        } else if (projectionResult && projectionResult.bvhData) {
            // BVH mode - return points, colors, and BVH data
            points = projectionResult.points;

            return {
                points,
                colors: colors.slice(0, pointIndex),
                numPoints: projectionResult.bvhData.showPoints ? (pointIndex / 3) : 0,
                bvhNodes: projectionResult.bvhData.nodes,
                bvhMode: true,
                showPoints: projectionResult.bvhData.showPoints
            };
        } else if (projectionMode === 'orthographic-3plane') {
            // Handle color expansion for 3-plane orthographic projection
            const expandedColors = new Float32Array(colors.length * 3);
            for (let i = 0; i < pointIndex; i += 3) {
                const baseIdx = i * 3;

                // Copy original colors for all three projected points
                // XY plane projection
                expandedColors[baseIdx] = colors[i];
                expandedColors[baseIdx + 1] = colors[i + 1];
                expandedColors[baseIdx + 2] = colors[i + 2];

                // XZ plane projection
                expandedColors[baseIdx + 3] = colors[i];
                expandedColors[baseIdx + 4] = colors[i + 1];
                expandedColors[baseIdx + 5] = colors[i + 2];

                // YZ plane projection
                expandedColors[baseIdx + 6] = colors[i];
                expandedColors[baseIdx + 7] = colors[i + 1];
                expandedColors[baseIdx + 8] = colors[i + 2];
            }

            return {
                points: projectionResult,
                colors: expandedColors,
                numPoints: (pointIndex / 3) * 3
            };
        } else {
            // Standard projection
            points = projectionResult;
        }
    } else {
        points = points.slice(0, pointIndex);
    }

    return {
        points,
        colors: colors.slice(0, pointIndex),
        numPoints: pointIndex / 3
    };
}
