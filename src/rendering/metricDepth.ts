/** @license SPDX-License-Identifier: Apache-2.0 */
import * as THREE from 'three';

/** Internal GPU readback adapter. Read the real depth attachment, preserving
 * alpha tests, displacement, skinning, and depthWrite from the RGB render. */
export function createMetricDepthReader(width: number, height: number, texture: THREE.DepthTexture) {
  const target = new THREE.WebGLRenderTarget(width, height, { depthBuffer: false });
  const material = new THREE.ShaderMaterial({
    uniforms: { depthTexture: { value: texture } },
    vertexShader: `varying vec2 vUv;
      void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: `#include <packing>
      uniform sampler2D depthTexture;
      varying vec2 vUv;
      void main() { gl_FragColor = packDepthToRGBA(texture2D(depthTexture, vUv).r); }`,
    depthTest: false, depthWrite: false, blending: THREE.NoBlending,
    toneMapped: false,
  });
  const geometry = new THREE.PlaneGeometry(2, 2);
  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(geometry, material));
  const screenCamera = new THREE.Camera();
  const packed = new Uint8Array(width * height * 4);
  return {
    read(renderer: THREE.WebGLRenderer, camera: THREE.Camera, flipX: boolean) {
      renderer.setRenderTarget(target);
      renderer.clear();
      renderer.render(scene, screenCamera);
      renderer.readRenderTargetPixels(target, 0, 0, width, height, packed);
      const result = new Float32Array(width * height);
      const inverse = camera.projectionMatrixInverse.elements;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const sx = flipX ? width - x - 1 : x;
          const sy = height - y - 1;
          const offset = (sy * width + sx) * 4;
          const r = packed[offset], g = packed[offset + 1], b = packed[offset + 2], a = packed[offset + 3];
          if (r === 255 && g === 255 && b === 255 && a === 255) {
            result[y * width + x] = Infinity;
            continue;
          }
          // Mirrors Three's unpackRGBAToDepth (packing.glsl.js).
          const d = r / 256 + g / 65536 + b / 16777216 + a / (255 * 16777216);
          const nx = (sx + 0.5) / width * 2 - 1;
          const ny = (sy + 0.5) / height * 2 - 1;
          const nz = d * 2 - 1;
          const z = inverse[2] * nx + inverse[6] * ny + inverse[10] * nz + inverse[14];
          const w = inverse[3] * nx + inverse[7] * ny + inverse[11] * nz + inverse[15];
          result[y * width + x] = -z / w;
        }
      }
      return result;
    },
    dispose() { target.dispose(); material.dispose(); geometry.dispose(); },
  };
}
