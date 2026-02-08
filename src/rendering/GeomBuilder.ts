/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/


import * as THREE from 'three';
import { CapsuleGeometry } from './CapsuleGeometry';
import { Reflector } from './Reflector';
import { MujocoModel, MujocoModule } from '../types';

/**
 * GeomBuilder
 * RESPONSIBILITY: Manufacturing visual objects.
 * 
 * This class knows how to read a single MuJoCo 'geom' (collision shape) definition
 * and build the corresponding Three.js Mesh for it.
 * It handles all the different shape types (Box, Sphere, Cylinder, generic Mesh, etc.).
 */
export class GeomBuilder {
    private mujoco: MujocoModule; 

    constructor(mujoco: MujocoModule) {
        this.mujoco = mujoco;
    }

    /**
     * Creates a Three.js Object3D (usually a Mesh) for a specific geometry in the MuJoCo model.
     * Returns null if the geometry shouldn't be rendered (e.g., invisible collision triggers).
     */
    create(mjModel: MujocoModel, g: number): THREE.Object3D | null {
        // 1. Check if this geom is meant to be visible
        // Group 3 in MuJoCo is conventionally used for invisible 'helper' geoms.
        if (mjModel.geom_group[g] === 3) return null;

        // 2. Read raw data from MuJoCo's WASM memory arrays
        const type = mjModel.geom_type[g];
        const size = mjModel.geom_size.subarray(g * 3, g * 3 + 3); // [x, y, z] size parameters
        const pos = mjModel.geom_pos.subarray(g * 3, g * 3 + 3);   // [x, y, z] local position
        const quat = mjModel.geom_quat.subarray(g * 4, g * 4 + 4); // [w, x, y, z] local rotation

        // 3. Determine material color
        // Sometimes color is on the geom itself, sometimes it uses a shared material definition.
        const matId = mjModel.geom_matid[g];
        const color = new THREE.Color(0xffffff);
        let opacity = 1.0;

        if (matId >= 0) {
            // Use shared material
            const rgba = mjModel.mat_rgba.subarray(matId * 4, matId * 4 + 4);
            color.setRGB(rgba[0], rgba[1], rgba[2]);
            opacity = rgba[3];
        } else {
            // Use geom-specific color
            const rgba = mjModel.geom_rgba.subarray(g * 4, g * 4 + 4);
            color.setRGB(rgba[0], rgba[1], rgba[2]);
            opacity = rgba[3];
        }

        // 4. Build the Geometry based on type
        const MG = this.mujoco.mjtGeom; // Short alias for MuJoCo Geometry Types enum
        let geo: THREE.BufferGeometry | null = null;

        // The '.value ?? MG.XYZ' pattern handles slightly different versions of the mujoco-js bindings.
        const getVal = (v: unknown) => (v as { value: number })?.value ?? v;

        if (type === getVal(MG.mjGEOM_PLANE)) {
            // Planes are infinite in MuJoCo, but we need a finite mesh for Three.js. 
            // Fallback reduced to 5m to match grid as requested.
            geo = new THREE.PlaneGeometry(size[0] * 2 || 5, size[1] * 2 || 5);
        } else if (type === getVal(MG.mjGEOM_SPHERE)) {
            geo = new THREE.SphereGeometry(size[0], 24, 24);
        } else if (type === getVal(MG.mjGEOM_CAPSULE)) {
            // Capsules in MuJoCo are Z-axis aligned by default.
            // Our custom CapsuleGeometry might need rotation to match.
            geo = new CapsuleGeometry(size[0], size[1] * 2, 24, 12);
            geo.rotateX(Math.PI / 2); 
        } else if (type === getVal(MG.mjGEOM_BOX)) {
            // MuJoCo defines box size as "half-extents" (center to edge). Three.js uses full width.
            geo = new THREE.BoxGeometry(size[0] * 2, size[1] * 2, size[2] * 2);
        } else if (type === getVal(MG.mjGEOM_CYLINDER)) {
            geo = new THREE.CylinderGeometry(size[0], size[0], size[1] * 2, 24);
            geo.rotateX(Math.PI / 2);
        } else if (type === getVal(MG.mjGEOM_MESH)) {
            // Arbitrary 3D meshes (like the robot parts).
            // We must read the vertex and face data directly from MuJoCo's buffers.
            const mId = mjModel.geom_dataid[g];
            const vAdr = mjModel.mesh_vertadr[mId];
            const vNum = mjModel.mesh_vertnum[mId];
            const fAdr = mjModel.mesh_faceadr[mId];
            const fNum = mjModel.mesh_facenum[mId];

            geo = new THREE.BufferGeometry();
            // 'position' attribute = vertices
            geo.setAttribute('position', new THREE.Float32BufferAttribute(mjModel.mesh_vert.subarray(vAdr * 3, (vAdr + vNum) * 3), 3));
            // 'index' = faces (triangles connecting vertices)
            geo.setIndex(Array.from(mjModel.mesh_face.subarray(fAdr * 3, (fAdr + fNum) * 3)));
            geo.computeVertexNormals(); // Auto-calculate smooth lighting normals
        }

        // 5. Construct the final Mesh
        if (geo) {
            let mesh;
            // Special handling for the floor plane to make it shiny
            if (type === getVal(MG.mjGEOM_PLANE)) {
                mesh = new Reflector(geo, {
                    clipBias: 0.003,
                    textureWidth: 1024, textureHeight: 1024,
                    color,
                    mixStrength: 0.25
                });
            } else {
                // Standard physical material for everything else
                mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
                    color,
                    transparent: opacity < 1,
                    opacity,
                    roughness: 0.6,
                    metalness: 0.2
                }));
                // Enable shadows
                mesh.castShadow = true;
                mesh.receiveShadow = true;
            }

            // Apply the local position offset and rotation specified in the MJCF XML
            mesh.position.set(pos[0], pos[1], pos[2]);
            // MuJoCo quaternions are [w, x, y, z], Three.js are [x, y, z, w]
            mesh.quaternion.set(quat[1], quat[2], quat[3], quat[0]);

            // Tag the mesh with its MuJoCo body and geom IDs for interaction (picking/dragging)
            mesh.userData.bodyID = mjModel.geom_bodyid[g];
            mesh.userData.geomID = g;

            return mesh;
        }

        return null;
    }
}
