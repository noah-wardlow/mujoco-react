/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/


import * as THREE from 'three';

/**
 * Options for configuring the Reflector.
 */
export interface ReflectorOptions {
    color?: THREE.ColorRepresentation;
    textureWidth?: number;
    textureHeight?: number;
    clipBias?: number;
    multisample?: number;
    texture?: THREE.Texture;
    mixStrength?: number; // How strong the reflection is (0.0 - 1.0)
}

interface ReflectorMesh extends THREE.Mesh {
    type: string;
    material: THREE.MeshPhysicalMaterial;
    // tslint:disable-next-line:no-any
    onBeforeRender: (renderer: any, scene: any, camera: any) => void;
}

/**
 * Reflector
 * Creates a reflective surface.
 */
export class Reflector extends THREE.Mesh {
    isReflector = true;
    camera: THREE.PerspectiveCamera;
    private reflectorPlane = new THREE.Plane();
    private normal = new THREE.Vector3();
    private reflectorWorldPosition = new THREE.Vector3();
    private cameraWorldPosition = new THREE.Vector3();
    private rotationMatrix = new THREE.Matrix4();
    private lookAtPosition = new THREE.Vector3(0, 0, -1);
    private clipPlane = new THREE.Vector4();
    private view = new THREE.Vector3();
    private target = new THREE.Vector3();
    private q = new THREE.Vector4();
    private textureMatrix = new THREE.Matrix4();
    private virtualCamera: THREE.PerspectiveCamera;
    private renderTarget: THREE.WebGLRenderTarget;

    constructor(geometry: THREE.BufferGeometry, options: ReflectorOptions = {}) {
        super(geometry);

        (this as unknown as ReflectorMesh).type = 'Reflector';
        this.camera = new THREE.PerspectiveCamera();

        const color = (options.color !== undefined) ? new THREE.Color(options.color) : new THREE.Color(0x7F7F7F);
        const textureWidth = options.textureWidth || 512;
        const textureHeight = options.textureHeight || 512;
        const clipBias = options.clipBias || 0;
        const multisample = (options.multisample !== undefined) ? options.multisample : 4;
        const blendTexture = options.texture || undefined;
        const mixStrength = (options.mixStrength !== undefined) ? options.mixStrength : 0.25; 

        this.virtualCamera = this.camera;

        this.renderTarget = new THREE.WebGLRenderTarget(textureWidth, textureHeight, { 
            samples: multisample, 
            type: THREE.HalfFloatType 
        });

        (this as unknown as ReflectorMesh).material = new THREE.MeshPhysicalMaterial({
            map: blendTexture,
            color,
            roughness: 0.5, 
            metalness: 0.1, 
        });

        (this as unknown as ReflectorMesh).material.onBeforeCompile = (shader) => {
            shader.uniforms.tDiffuse = { value: this.renderTarget.texture };
            shader.uniforms.textureMatrix = { value: this.textureMatrix };
            shader.uniforms.mixStrength = { value: mixStrength };

            // Vertex Shader: Set Vertex Positions to the Unwrapped UV Positions
            const bodyStart = shader.vertexShader.indexOf('void main() {');
            shader.vertexShader =
                'uniform mat4 textureMatrix;\n' +
                'varying vec4 vUvReflection;\n' +
                shader.vertexShader.slice(0, bodyStart) +
                shader.vertexShader.slice(bodyStart, -1) +
                '   vUvReflection = textureMatrix * vec4( position, 1.0 );\n' +
                '}';

            // Fragment Shader: Mix reflection with base material
            const fragmentBodyStart = shader.fragmentShader.indexOf('void main() {');
            shader.fragmentShader =
                'uniform sampler2D tDiffuse;\n' +
                'uniform float mixStrength;\n' +
                'varying vec4 vUvReflection;\n' +
                shader.fragmentShader.slice(0, fragmentBodyStart) +
                shader.fragmentShader.slice(fragmentBodyStart, -1) +
                '   vec4 reflectionColor = texture2DProj( tDiffuse, vUvReflection );\n' +
                '   gl_FragColor = vec4( mix( gl_FragColor.rgb, reflectionColor.rgb, mixStrength ), gl_FragColor.a );\n' +
                '}';
        };

        (this as THREE.Object3D).receiveShadow = true;

        (this as unknown as ReflectorMesh).onBeforeRender = (renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) => {
            this.reflectorWorldPosition.setFromMatrixPosition((this as THREE.Object3D).matrixWorld);
            this.cameraWorldPosition.setFromMatrixPosition(camera.matrixWorld);

            this.rotationMatrix.extractRotation((this as THREE.Object3D).matrixWorld);

            this.normal.set(0, 0, 1);
            this.normal.applyMatrix4(this.rotationMatrix);

            this.view.subVectors(this.reflectorWorldPosition, this.cameraWorldPosition);

            // Avoid rendering when reflector is facing away
            if (this.view.dot(this.normal) > 0) return;

            this.view.reflect(this.normal).negate();
            this.view.add(this.reflectorWorldPosition);

            this.rotationMatrix.extractRotation(camera.matrixWorld);

            this.lookAtPosition.set(0, 0, -1);
            this.lookAtPosition.applyMatrix4(this.rotationMatrix);
            this.lookAtPosition.add(this.cameraWorldPosition);

            this.target.subVectors(this.reflectorWorldPosition, this.lookAtPosition);
            this.target.reflect(this.normal).negate();
            this.target.add(this.reflectorWorldPosition);

            this.virtualCamera.position.copy(this.view);
            this.virtualCamera.up.set(0, 1, 0);
            this.virtualCamera.up.applyMatrix4(this.rotationMatrix);
            this.virtualCamera.up.reflect(this.normal);
            this.virtualCamera.lookAt(this.target);

            this.virtualCamera.far = (camera as THREE.PerspectiveCamera).far; 

            this.virtualCamera.updateMatrixWorld();
            this.virtualCamera.projectionMatrix.copy((camera as THREE.PerspectiveCamera).projectionMatrix);

            // Update the texture matrix
            this.textureMatrix.set(
                0.5, 0.0, 0.0, 0.5,
                0.0, 0.5, 0.0, 0.5,
                0.0, 0.0, 0.5, 0.5,
                0.0, 0.0, 0.0, 1.0
            );
            this.textureMatrix.multiply(this.virtualCamera.projectionMatrix);
            this.textureMatrix.multiply(this.virtualCamera.matrixWorldInverse);
            this.textureMatrix.multiply((this as THREE.Object3D).matrixWorld);

            // Now update projection matrix with new clip plane
            this.reflectorPlane.setFromNormalAndCoplanarPoint(this.normal, this.reflectorWorldPosition);
            this.reflectorPlane.applyMatrix4(this.virtualCamera.matrixWorldInverse);

            this.clipPlane.set(this.reflectorPlane.normal.x, this.reflectorPlane.normal.y, this.reflectorPlane.normal.z, this.reflectorPlane.constant);

            const projectionMatrix = this.virtualCamera.projectionMatrix;

            this.q.x = (Math.sign(this.clipPlane.x) + projectionMatrix.elements[8]) / projectionMatrix.elements[0];
            this.q.y = (Math.sign(this.clipPlane.y) + projectionMatrix.elements[9]) / projectionMatrix.elements[5];
            this.q.z = -1.0;
            this.q.w = (1.0 + projectionMatrix.elements[10]) / projectionMatrix.elements[14];

            // Calculate the scaled plane vector
            this.clipPlane.multiplyScalar(2.0 / this.clipPlane.dot(this.q));

            // Replacing the third row of the projection matrix
            projectionMatrix.elements[2] = this.clipPlane.x;
            projectionMatrix.elements[6] = this.clipPlane.y;
            projectionMatrix.elements[10] = this.clipPlane.z + 1.0 - clipBias;
            projectionMatrix.elements[14] = this.clipPlane.w;

            // Render
            (this as THREE.Object3D).visible = false;

            const currentRenderTarget = renderer.getRenderTarget();
            const currentXrEnabled = renderer.xr.enabled;
            const currentShadowAutoUpdate = renderer.shadowMap.autoUpdate;

            renderer.xr.enabled = false; 
            renderer.shadowMap.autoUpdate = false; 

            renderer.setRenderTarget(this.renderTarget);

            renderer.state.buffers.depth.setMask(true); 

            if (renderer.autoClear === false) renderer.clear();
            renderer.render(scene, this.virtualCamera);

            renderer.xr.enabled = currentXrEnabled;
            renderer.shadowMap.autoUpdate = currentShadowAutoUpdate;

            renderer.setRenderTarget(currentRenderTarget);

            // Restore viewport
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const viewport = (camera as any).viewport;
            if (viewport !== undefined) {
                renderer.state.viewport(viewport);
            }

            (this as THREE.Object3D).visible = true;
        };
    }

    getRenderTarget() {
        return this.renderTarget;
    }

    dispose() {
        this.renderTarget.dispose();
        const mesh = this as THREE.Mesh;
        if (Array.isArray(mesh.material)) {
            mesh.material.forEach((m) => m.dispose());
        } else {
            mesh.material.dispose();
        }
    }
}