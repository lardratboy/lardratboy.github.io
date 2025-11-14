/**
 * HilbertCurve3D.js
 * 3D Hilbert Curve implementation for space-filling curve generation
 * Preserves locality by mapping 1D indices to 3D coordinates
 */

/**
 * HilbertCurve3D class for 3D space-filling curve operations
 */
export class HilbertCurve3D {
    // Rotation matrices for the 8 octants of the Hilbert curve
    static rotations = [
        [0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0],
        [2, 0, 1], [2, 1, 0], [0, 1, 2], [0, 2, 1]
    ];

    /**
     * Convert 3D coordinates to Hilbert index
     * @param {number} x - X coordinate
     * @param {number} y - Y coordinate
     * @param {number} z - Z coordinate
     * @param {number} order - Order of the Hilbert curve (resolution)
     * @returns {number} - Hilbert index
     */
    static coordsToIndex(x, y, z, order) {
        let index = 0;
        for (let i = order - 1; i >= 0; i--) {
            const bits = [
                (x >> i) & 1,
                (y >> i) & 1,
                (z >> i) & 1
            ];

            // Calculate octant
            const octant = bits[0] * 4 + bits[1] * 2 + bits[2];
            index = (index << 3) | octant;

            // Apply rotation for next level
            const temp = [bits[0], bits[1], bits[2]];
            const rot = this.rotations[octant];
            bits[0] = temp[rot[0]];
            bits[1] = temp[rot[1]];
            bits[2] = temp[rot[2]];
        }
        return index;
    }

    /**
     * Convert Hilbert index to 3D coordinates
     * @param {number} index - Hilbert index
     * @param {number} order - Order of the Hilbert curve (resolution)
     * @returns {Array} - [x, y, z] coordinates
     */
    static indexToCoords(index, order) {
        let x = 0, y = 0, z = 0;
        let octant = 0;

        for (let i = 0; i < order; i++) {
            octant = index & 7;
            index >>= 3;

            const rot = this.rotations[octant];
            const bits = [
                (octant >> 2) & 1,
                (octant >> 1) & 1,
                octant & 1
            ];

            // Apply inverse rotation
            x = (x << 1) | bits[rot[0]];
            y = (y << 1) | bits[rot[1]];
            z = (z << 1) | bits[rot[2]];
        }

        return [x, y, z];
    }
}
