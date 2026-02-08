/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/


import * as THREE from 'three';

interface InternalBufferGeometry extends THREE.BufferGeometry {
  type: string;
}

/**
 * CapsuleGeometry
 * Custom geometry for capsule shape.
 */
export class CapsuleGeometry extends THREE.BufferGeometry {
  parameters: { radius: number; length: number; capSegments: number; radialSegments: number; };

  constructor(radius = 1, length = 1, capSegments = 4, radialSegments = 8) {
    super();
    (this as unknown as InternalBufferGeometry).type = 'CapsuleGeometry';
    this.parameters = { radius, length, capSegments, radialSegments };
    const path = new THREE.Path();
    path.absarc(0, -length / 2, radius, Math.PI * 1.5, 0, false);
    path.absarc(0, length / 2, radius, 0, Math.PI * 0.5, false);
    const latheGeometry = new THREE.LatheGeometry(path.getPoints(capSegments), radialSegments);
    
    const self = this as THREE.BufferGeometry;
    self.setIndex(latheGeometry.getIndex());
    self.setAttribute('position', latheGeometry.getAttribute('position'));
    self.setAttribute('normal', latheGeometry.getAttribute('normal'));
    self.setAttribute('uv', latheGeometry.getAttribute('uv'));
  }
}