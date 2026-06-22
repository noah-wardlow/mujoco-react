/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/


import * as THREE from 'three';
import { CapsuleGeometry } from './CapsuleGeometry';
import { getName } from '../core/SceneLoader';
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
    private textureCache = new Map<number, THREE.Texture>();

    constructor(mujoco: MujocoModule) {
        this.mujoco = mujoco;
    }

    private getMaterialTexture(mjModel: MujocoModel, matId: number): THREE.Texture | null {
        if (matId < 0 || !mjModel.mat_texid || !mjModel.tex_data) return null;

        const materialCount = Math.max(1, Math.floor(mjModel.mat_rgba.length / 4));
        const textureRoles = Math.max(1, Math.floor(mjModel.mat_texid.length / materialCount));
        let texId = -1;
        for (let role = 0; role < textureRoles; role += 1) {
            const candidate = mjModel.mat_texid[matId * textureRoles + role];
            if (candidate >= 0) {
                texId = candidate;
                break;
            }
        }
        if (texId < 0) return null;

        const cached = this.textureCache.get(texId);
        if (cached) return cached;

        const width = Number(mjModel.tex_width[texId]);
        const height = Number(mjModel.tex_height[texId]);
        const channels = Number(mjModel.tex_nchannel[texId]);
        const offset = Number(mjModel.tex_adr[texId]);
        if (width <= 0 || height <= 0 || channels <= 0 || offset < 0) return null;

        const source = mjModel.tex_data.subarray(offset, offset + width * height * channels);
        const rgba = new Uint8Array(width * height * 4);
        for (let i = 0, j = 0; i < width * height; i += 1, j += channels) {
            const r = source[j] ?? 255;
            const g = channels > 1 ? source[j + 1] : r;
            const b = channels > 2 ? source[j + 2] : r;
            const a = channels > 3 ? source[j + 3] : 255;
            const out = i * 4;
            rgba[out] = r;
            rgba[out + 1] = g;
            rgba[out + 2] = b;
            rgba[out + 3] = a;
        }

        const texture = new THREE.DataTexture(rgba, width, height, THREE.RGBAFormat);
        texture.colorSpace = THREE.LinearSRGBColorSpace;
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.flipY = true;
        const repeatOffset = matId * 2;
        const repeatS = mjModel.mat_texrepeat?.[repeatOffset] ?? 1;
        const repeatT = mjModel.mat_texrepeat?.[repeatOffset + 1] ?? 1;
        texture.repeat.set(repeatS || 1, repeatT || 1);
        texture.needsUpdate = true;
        this.textureCache.set(texId, texture);
        return texture;
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
        const map = this.getMaterialTexture(mjModel, matId);
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

        // The '.value ?? MG.XYZ' pattern handles slightly different MuJoCo WASM binding versions.
        const getVal = (v: unknown) => (v as { value: number })?.value ?? v;

        if (type === getVal(MG.mjGEOM_PLANE)) {
            // Planes are infinite in MuJoCo, but Three needs finite UVs for textured captures.
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
            const isPlane = type === getVal(MG.mjGEOM_PLANE);
            const materialMap = isPlane && map ? map.clone() : map;
            if (isPlane && materialMap) {
                materialMap.repeat.multiplyScalar(2.5);
                materialMap.needsUpdate = true;
            }
            const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
                color,
                map: materialMap,
                transparent: opacity < 1,
                opacity,
                roughness: 0.6,
                metalness: 0
            }));
            mesh.castShadow = type !== getVal(MG.mjGEOM_PLANE);
            mesh.receiveShadow = true;

            // Apply the local position offset and rotation specified in the MJCF XML
            mesh.position.set(pos[0], pos[1], pos[2]);
            // MuJoCo quaternions are [w, x, y, z], Three.js are [x, y, z, w]
            mesh.quaternion.set(quat[1], quat[2], quat[3], quat[0]);

            // Tag the mesh with its MuJoCo body and geom IDs for interaction (picking/dragging)
            mesh.userData.bodyID = mjModel.geom_bodyid[g];
            mesh.userData.geomID = g;
            mesh.userData.geomGroup = mjModel.geom_group[g];
            mesh.userData.geomName = getName(mjModel, mjModel.name_geomadr[g]);

            return mesh;
        }

        return null;
    }
}
