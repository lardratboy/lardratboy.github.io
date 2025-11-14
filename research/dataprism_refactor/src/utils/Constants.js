/**
 * Constants.js
 * Data type configuration and normalization constants for DataPrism
 */

/**
 * Data type configuration constants
 * Defines supported data types with their properties
 */
export const DATA_TYPES = {
    int8: { size: 1, min: -128, max: 127, method: 'getInt8', isFloat: false },
    uint8: { size: 1, min: 0, max: 255, method: 'getUint8', isFloat: false },
    int16: { size: 2, min: -32768, max: 32767, method: 'getInt16', isFloat: false },
    uint16: { size: 2, min: 0, max: 65535, method: 'getUint16', isFloat: false },
    int32: { size: 4, min: -2147483648, max: 2147483647, method: 'getInt32', isFloat: false },
    uint32: { size: 4, min: 0, max: 4294967295, method: 'getUint32', isFloat: false },
    fp16: { size: 2, method: 'getFloat16', isFloat: true },
    bf16: { size: 2, method: 'getBFloat16', isFloat: true },
    fp32: { size: 4, method: 'getFloat32', isFloat: true },
    fp8_e4m3: { size: 1, method: 'getFloat8E4M3', isFloat: true },
    fp8_e5m2: { size: 1, method: 'getFloat8E5M2', isFloat: true }
};

/**
 * Pre-calculated normalization multipliers for integer types
 * Used for efficient value normalization during data processing
 */
export const NORMALIZERS = Object.fromEntries(
    Object.entries(DATA_TYPES)
        .filter(([type, config]) => !config.isFloat)
        .map(([type, config]) => [
            type,
            {
                multiplier: 2 / (config.max - config.min),
                offset: config.min
            }
        ])
);
