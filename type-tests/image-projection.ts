import * as THREE from 'three';
import {
  imagePointToNdc,
  projectImagePointTo3D,
  type ImagePointProjectionOptions,
  type MujocoSimAPI,
} from '../src';

const normalized = imagePointToNdc(0.5, 0.5);
const detectorPoint = imagePointToNdc(500, 250, 'normalized-1000');
const pixelPoint = imagePointToNdc(320, 240, 'pixel', 640, 480);
const ndcPoint = imagePointToNdc(0, 0, 'ndc');

const options: ImagePointProjectionOptions = {
  x: 500,
  y: 500,
  coordinateSpace: 'normalized-1000',
  cameraName: 'overhead',
  width: 640,
  height: 480,
  hiddenGeomGroups: [3],
};

function useProjection(api: MujocoSimAPI) {
  const hit = api.projectImagePointTo3D({
    x: 120,
    y: 80,
    coordinateSpace: 'pixel',
    imageWidth: 640,
    imageHeight: 480,
    siteName: 'camera_site',
    positionOffset: [0, 0, 0.02],
  });
  hit?.point.toArray();
  hit?.source.kind.toUpperCase();
}

declare const renderer: THREE.WebGLRenderer;
declare const scene: THREE.Scene;
declare const camera: THREE.Camera;

const hit = projectImagePointTo3D(renderer, scene, camera, options);
hit?.imageSize[0].toFixed();
hit?.ndc[1].toFixed();

void normalized;
void detectorPoint;
void pixelPoint;
void ndcPoint;
void useProjection;
