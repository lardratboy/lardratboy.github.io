/**
 * FloatUtils.js
 * Floating-point format conversion utilities for DataPrism
 * Supports fp16, bf16, fp8_e4m3, and fp8_e5m2 formats
 */

/**
 * Convert IEEE 754 half precision (fp16) to single precision (fp32)
 * @param {number} uint16Value - 16-bit unsigned integer representing fp16
 * @returns {number} - JavaScript number (fp32/fp64)
 */
export function fp16ToFloat32(uint16Value) {
    const sign = (uint16Value & 0x8000) >> 15;
    const exponent = (uint16Value & 0x7C00) >> 10;
    const mantissa = uint16Value & 0x03FF;

    if (exponent === 0) {
        if (mantissa === 0) {
            // Zero
            return sign === 0 ? 0.0 : -0.0;
        } else {
            // Subnormal
            return (sign === 0 ? 1 : -1) * Math.pow(2, -14) * (mantissa / 1024);
        }
    } else if (exponent === 31) {
        if (mantissa === 0) {
            // Infinity
            return sign === 0 ? Infinity : -Infinity;
        } else {
            // NaN
            return NaN;
        }
    } else {
        // Normal
        return (sign === 0 ? 1 : -1) * Math.pow(2, exponent - 15) * (1 + mantissa / 1024);
    }
}

/**
 * Convert Google's bfloat16 (bf16) to single precision (fp32)
 * @param {number} uint16Value - 16-bit unsigned integer representing bf16
 * @returns {number} - JavaScript number (fp32/fp64)
 */
export function bf16ToFloat32(uint16Value) {
    const sign = (uint16Value & 0x8000) >> 15;
    const exponent = (uint16Value & 0x7F80) >> 7;  // bits 14-7 (8 bits)
    const mantissa = uint16Value & 0x007F;         // bits 6-0 (7 bits)

    if (exponent === 0) {
        if (mantissa === 0) {
            // Zero
            return sign === 0 ? 0.0 : -0.0;
        } else {
            // Subnormal
            return (sign === 0 ? 1 : -1) * Math.pow(2, -126) * (mantissa / 128);
        }
    } else if (exponent === 255) {
        if (mantissa === 0) {
            // Infinity
            return sign === 0 ? Infinity : -Infinity;
        } else {
            // NaN
            return NaN;
        }
    } else {
        // Normal
        return (sign === 0 ? 1 : -1) * Math.pow(2, exponent - 127) * (1 + mantissa / 128);
    }
}

/**
 * Convert 8-bit floating point E4M3 format to single precision (fp32)
 * @param {number} uint8Value - 8-bit unsigned integer representing fp8_e4m3
 * @returns {number} - JavaScript number (fp32/fp64)
 */
export function fp8e4m3ToFloat32(uint8Value) {
    const sign = (uint8Value & 0x80) >> 7;
    const exponent = (uint8Value & 0x78) >> 3; // 4 bits
    const mantissa = uint8Value & 0x07;        // 3 bits

    if (exponent === 0) {
        // Subnormal or zero
        if (mantissa === 0) return sign ? -0.0 : 0.0;
        return (sign ? -1 : 1) * Math.pow(2, -6) * (mantissa / 8);
    }
    if (exponent === 0xF) {
        // Inf or NaN
        return mantissa === 0 ? (sign ? -Infinity : Infinity) : NaN;
    }
    return (sign ? -1 : 1) * Math.pow(2, exponent - 7) * (1 + mantissa / 8);
}

/**
 * Convert 8-bit floating point E5M2 format to single precision (fp32)
 * @param {number} uint8Value - 8-bit unsigned integer representing fp8_e5m2
 * @returns {number} - JavaScript number (fp32/fp64)
 */
export function fp8e5m2ToFloat32(uint8Value) {
    const sign = (uint8Value & 0x80) >> 7;
    const exponent = (uint8Value & 0x7C) >> 2; // 5 bits
    const mantissa = uint8Value & 0x03;        // 2 bits

    if (exponent === 0) {
        if (mantissa === 0) return sign ? -0.0 : 0.0;
        return (sign ? -1 : 1) * Math.pow(2, -14) * (mantissa / 4);
    }
    if (exponent === 0x1F) {
        return mantissa === 0 ? (sign ? -Infinity : Infinity) : NaN;
    }
    return (sign ? -1 : 1) * Math.pow(2, exponent - 15) * (1 + mantissa / 4);
}

/**
 * Create an Extended DataView with support for custom floating-point formats
 * @param {ArrayBuffer} buffer - The buffer to wrap
 * @returns {DataView} - Extended DataView with additional methods
 */
export function createExtendedDataView(buffer) {
    const view = new DataView(buffer);

    // Add fp16 support
    view.getFloat16 = function(byteOffset, littleEndian = false) {
        const uint16Value = this.getUint16(byteOffset, littleEndian);
        return fp16ToFloat32(uint16Value);
    };

    // Add bf16 support
    view.getBFloat16 = function(byteOffset, littleEndian = false) {
        const uint16Value = this.getUint16(byteOffset, littleEndian);
        return bf16ToFloat32(uint16Value);
    };

    // Add fp8_e4m3 support
    view.getFloat8E4M3 = function(byteOffset) {
        const uint8Value = this.getUint8(byteOffset);
        return fp8e4m3ToFloat32(uint8Value);
    };

    // Add fp8_e5m2 support
    view.getFloat8E5M2 = function(byteOffset) {
        const uint8Value = this.getUint8(byteOffset);
        return fp8e5m2ToFloat32(uint8Value);
    };

    return view;
}
