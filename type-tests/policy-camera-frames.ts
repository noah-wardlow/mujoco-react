import {
  capturePolicyCameraFramesFromMountedStreams,
  createPolicyCameraFrameCapturePlan,
  type PolicyCameraFrameCapturePlan,
} from '../src';
import * as THREE from 'three';

const plan: PolicyCameraFrameCapturePlan = createPolicyCameraFrameCapturePlan({
  cameraKeys: ['front', 'wrist'],
  cameras: [{ name: 'realsense_d435i' }, { name: 'wrist_cam' }],
  aliases: {
    front: [{ cameraName: 'realsense_d435i' }],
    wrist: [{ cameraName: 'wrist_cam' }],
  },
  defaults: {
    width: 640,
    height: 480,
    type: 'image/jpeg',
    fov: 48.5,
  },
  streamOptions: {
    front: {
      aliases: ['realsense'],
      position: [1.1, 0.2, 0.8],
      lookAt: [0.4, 0, 0.2],
    },
    wrist: {
      aliases: ['wrist_cam'],
    },
  },
});

const stream = plan.streams[0];
stream?.key.toUpperCase();
stream?.aliases?.[0]?.toUpperCase();
plan.mountedPlan.resolved.front?.source.kind.toUpperCase();

async function captureFromApi() {
  await capturePolicyCameraFramesFromMountedStreams({
    getCameras: () => [
      {
        id: 0,
        name: 'front_camera',
        bodyId: 0,
        fov: 48.5,
        position: [0, 0, 0],
        quaternion: [1, 0, 0, 0],
      },
      {
        id: 1,
        name: 'wrist_camera',
        bodyId: 1,
        fov: 48.5,
        position: [0, 0, 0],
        quaternion: [1, 0, 0, 0],
      },
    ],
    getSites: () => [],
    getBodies: () => [],
    captureCameraFrame: async (options) => ({
      canvas: document.createElement('canvas'),
      camera: options?.camera ?? new THREE.PerspectiveCamera(),
      width: options?.width ?? 640,
      height: options?.height ?? 480,
      source: options?.source ?? { kind: 'fallback-camera' },
      dataUrl: 'data:image/png;base64,',
      type: options?.type ?? 'image/png',
    }),
  }, {
    cameraKeys: ['front', 'wrist'],
    aliases: {
      front: [{ cameraName: 'front_camera' }],
      wrist: [{ cameraName: 'wrist_camera' }],
    },
  });
}

void captureFromApi;
