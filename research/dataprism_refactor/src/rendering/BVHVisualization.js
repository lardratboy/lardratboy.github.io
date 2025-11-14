/**
 * BVHVisualization.js
 * Creates instanced wireframe boxes for BVH (Bounding Volume Hierarchy) visualization
 * Uses custom shaders to apply per-instance transforms efficiently
 */

/**
 * Create instanced wireframe boxes for BVH visualization
 * @param {Array} bvhNodes - Array of BVH nodes with {center, size, color} properties
 * @returns {THREE.LineSegments} - Instanced line segments mesh for rendering
 */
export function createInstancedBVHBoxes(bvhNodes) {
    try {
        const numBoxes = bvhNodes.length;

        if (numBoxes === 0) {
            console.warn('No BVH nodes to render');
            return null;
        }

        console.log(`Creating instanced BVH boxes for ${numBoxes} nodes`);

        // Create unit cube edge geometry (12 edges, 24 vertices)
        const edges = [
            // Bottom face
            [-0.5, -0.5, -0.5], [0.5, -0.5, -0.5],
            [0.5, -0.5, -0.5], [0.5, -0.5, 0.5],
            [0.5, -0.5, 0.5], [-0.5, -0.5, 0.5],
            [-0.5, -0.5, 0.5], [-0.5, -0.5, -0.5],
            // Top face
            [-0.5, 0.5, -0.5], [0.5, 0.5, -0.5],
            [0.5, 0.5, -0.5], [0.5, 0.5, 0.5],
            [0.5, 0.5, 0.5], [-0.5, 0.5, 0.5],
            [-0.5, 0.5, 0.5], [-0.5, 0.5, -0.5],
            // Vertical edges
            [-0.5, -0.5, -0.5], [-0.5, 0.5, -0.5],
            [0.5, -0.5, -0.5], [0.5, 0.5, -0.5],
            [0.5, -0.5, 0.5], [0.5, 0.5, 0.5],
            [-0.5, -0.5, 0.5], [-0.5, 0.5, 0.5]
        ];

        // Flatten edge vertices
        const positions = new Float32Array(edges.length * 3);
        for (let i = 0; i < edges.length; i++) {
            positions[i * 3] = edges[i][0];
            positions[i * 3 + 1] = edges[i][1];
            positions[i * 3 + 2] = edges[i][2];
        }

        // Create instanced buffer geometry
        const geometry = new THREE.InstancedBufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

        // Create instance attributes (one per box)
        const instanceCenters = new Float32Array(numBoxes * 3);
        const instanceSizes = new Float32Array(numBoxes * 3);
        const instanceColors = new Float32Array(numBoxes * 3);

        for (let i = 0; i < numBoxes; i++) {
            const node = bvhNodes[i];

            if (!node || !node.center || !node.size || !node.color) {
                console.error(`Invalid BVH node at index ${i}:`, node);
                throw new Error(`Invalid BVH node at index ${i}`);
            }

            // Center
            instanceCenters[i * 3] = node.center.x;
            instanceCenters[i * 3 + 1] = node.center.y;
            instanceCenters[i * 3 + 2] = node.center.z;

            // Size (half-extents become full extents for scaling)
            instanceSizes[i * 3] = node.size.x;
            instanceSizes[i * 3 + 1] = node.size.y;
            instanceSizes[i * 3 + 2] = node.size.z;

            // Color
            instanceColors[i * 3] = node.color.r;
            instanceColors[i * 3 + 1] = node.color.g;
            instanceColors[i * 3 + 2] = node.color.b;
        }

        geometry.setAttribute('instanceCenter', new THREE.InstancedBufferAttribute(instanceCenters, 3));
        geometry.setAttribute('instanceSize', new THREE.InstancedBufferAttribute(instanceSizes, 3));
        geometry.setAttribute('instanceColor', new THREE.InstancedBufferAttribute(instanceColors, 3));

        // Custom shader material for instanced lines
        const material = new THREE.ShaderMaterial({
            vertexShader: `
                attribute vec3 instanceCenter;
                attribute vec3 instanceSize;
                attribute vec3 instanceColor;

                varying vec3 vColor;

                void main() {
                    vColor = instanceColor;

                    // Apply instance transform: scale then translate
                    vec3 transformed = position * instanceSize + instanceCenter;

                    gl_Position = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);
                }
            `,
            fragmentShader: `
                varying vec3 vColor;

                void main() {
                    gl_FragColor = vec4(vColor, 1.0);
                }
            `,
            transparent: false,
            depthTest: true,
            depthWrite: true
        });

        // Create line segments
        const lineSegments = new THREE.LineSegments(geometry, material);

        console.log(`Successfully created BVH line segments with ${numBoxes} instances`);

        return lineSegments;
    } catch (error) {
        console.error('Error in createInstancedBVHBoxes:', error);
        console.error('Error stack:', error.stack);
        throw error;
    }
}
