/**
 * BVH.js
 * Bounding Volume Hierarchy (BVH) Implementation
 * Creates a binary tree of axis-aligned bounding boxes for spatial organization
 */

/**
 * BVH class for building and managing bounding volume hierarchies
 */
export class BVH {
    /**
     * Build a BVH tree from points
     * @param {Float32Array} points - Array of 3D coordinates
     * @param {number} maxDepth - Maximum tree depth
     * @param {number} minPoints - Minimum points per leaf node
     * @returns {Object} Root node of BVH tree
     */
    static build(points, maxDepth = 8, minPoints = 8) {
        try {
            const numPoints = points.length / 3;
            const indices = new Array(numPoints);
            for (let i = 0; i < numPoints; i++) indices[i] = i;

            console.log(`Building BVH with ${numPoints} points, maxDepth=${maxDepth}, minPoints=${minPoints}`);

            return this.buildNode(points, indices, 0, maxDepth, minPoints);
        } catch (error) {
            console.error('Error in BVH.build:', error);
            console.error('Error stack:', error.stack);
            throw error;
        }
    }

    /**
     * Recursively build BVH node
     * @private
     */
    static buildNode(points, indices, depth, maxDepth, minPoints) {
        // Calculate AABB for this node
        const bounds = this.calculateAABB(points, indices);

        const node = {
            bounds: bounds,
            indices: indices,
            depth: depth,
            left: null,
            right: null,
            isLeaf: false
        };

        // Check termination conditions
        if (depth >= maxDepth || indices.length <= minPoints) {
            node.isLeaf = true;
            return node;
        }

        // Find longest axis and split
        const size = {
            x: bounds.max.x - bounds.min.x,
            y: bounds.max.y - bounds.min.y,
            z: bounds.max.z - bounds.min.z
        };

        let axis = 0; // 0=x, 1=y, 2=z
        let maxSize = size.x;
        if (size.y > maxSize) { axis = 1; maxSize = size.y; }
        if (size.z > maxSize) { axis = 2; maxSize = size.z; }

        // Sort indices along chosen axis
        indices.sort((a, b) => {
            const aVal = points[a * 3 + axis];
            const bVal = points[b * 3 + axis];
            return aVal - bVal;
        });

        // Split at median
        const mid = Math.floor(indices.length / 2);
        const leftIndices = indices.slice(0, mid);
        const rightIndices = indices.slice(mid);

        // Recursively build children
        if (leftIndices.length > 0) {
            node.left = this.buildNode(points, leftIndices, depth + 1, maxDepth, minPoints);
        }
        if (rightIndices.length > 0) {
            node.right = this.buildNode(points, rightIndices, depth + 1, maxDepth, minPoints);
        }

        return node;
    }

    /**
     * Calculate axis-aligned bounding box for point indices
     * @private
     */
    static calculateAABB(points, indices) {
        const bounds = {
            min: { x: Infinity, y: Infinity, z: Infinity },
            max: { x: -Infinity, y: -Infinity, z: -Infinity }
        };

        for (const idx of indices) {
            const i = idx * 3;
            const x = points[i];
            const y = points[i + 1];
            const z = points[i + 2];

            bounds.min.x = Math.min(bounds.min.x, x);
            bounds.min.y = Math.min(bounds.min.y, y);
            bounds.min.z = Math.min(bounds.min.z, z);
            bounds.max.x = Math.max(bounds.max.x, x);
            bounds.max.y = Math.max(bounds.max.y, y);
            bounds.max.z = Math.max(bounds.max.z, z);
        }

        return bounds;
    }

    /**
     * Count total nodes in tree (for instancing)
     */
    static countNodes(node) {
        if (!node) return 0;
        return 1 + this.countNodes(node.left) + this.countNodes(node.right);
    }

    /**
     * Flatten tree into arrays for instanced rendering
     * Note: Requires THREE.js to be available globally for Vector3 and Color
     * @param {Object} node - BVH root node
     * @param {Array} centers - Output array for centers (not used, kept for API compatibility)
     * @param {Array} sizes - Output array for sizes (not used, kept for API compatibility)
     * @param {Array} colors - Output array for colors (not used, kept for API compatibility)
     * @param {number} maxDepth - Maximum depth for coloring
     * @param {number} displayLevel - Optional: only show nodes at this depth level (-1 for all)
     * @returns {Array} Array of {center, size, color} objects
     */
    static flattenTree(node, centers, sizes, colors, maxDepth, displayLevel = -1) {
        const nodes = [];

        const traverse = (n) => {
            if (!n) return;

            // Skip if filtering by specific level
            if (displayLevel >= 0 && n.depth !== displayLevel) {
                traverse(n.left);
                traverse(n.right);
                return;
            }

            // Calculate center and size
            const center = new THREE.Vector3(
                (n.bounds.min.x + n.bounds.max.x) / 2,
                (n.bounds.min.y + n.bounds.max.y) / 2,
                (n.bounds.min.z + n.bounds.max.z) / 2
            );

            const size = new THREE.Vector3(
                n.bounds.max.x - n.bounds.min.x,
                n.bounds.max.y - n.bounds.min.y,
                n.bounds.max.z - n.bounds.min.z
            );

            // Color based on depth (rainbow gradient)
            const t = n.depth / Math.max(1, maxDepth);
            const color = new THREE.Color();
            color.setHSL(t * 0.7, 0.8, 0.5); // 0 to 0.7 goes from red to blue

            nodes.push({ center, size, color });

            traverse(n.left);
            traverse(n.right);
        };

        traverse(node);
        return nodes;
    }
}
