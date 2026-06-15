import {
  createMountedCameraFrameSequenceReadiness,
  createMountedCameraFrameSequencePlan,
  type CameraFrameSequenceCamera,
  type MountedCameraFrameSequencePlan,
  type MountedCameraFrameSequenceReadiness,
} from '../src';

const plan = createMountedCameraFrameSequencePlan(['head', 'left_wrist', 'wrist'], {
  cameras: [{ name: 'overhead' }],
  sites: [
    { name: 'head_camera_rgb_optical_frame' },
    { name: 'left_wrist_camera_optical_frame' },
    { name: 'tcp' },
  ],
  bodies: [{ name: 'base_link' }],
  aliases: {
    head: [{ siteName: 'head_camera_rgb_optical_frame' }],
    left_wrist: [{ siteName: 'left_wrist_camera_optical_frame' }],
    wrist: [{ cameraName: 'missing_camera' }, { siteName: 'tcp' }],
  },
  defaults: {
    width: 640,
    height: 480,
    type: 'image/png',
    fov: 45,
    near: 0.01,
    far: 100,
  },
  cameraOptions: {
    wrist: {
      width: 320,
      height: 240,
    },
  },
});

const mountedCamera: CameraFrameSequenceCamera | undefined = plan.cameras[0];
const mountedPlan: MountedCameraFrameSequencePlan = plan;
const readiness: MountedCameraFrameSequenceReadiness =
  createMountedCameraFrameSequenceReadiness(plan);
const missingPlan = createMountedCameraFrameSequencePlan(['missing'], {
  cameras: [],
  sites: [],
  bodies: [],
});
const fallbackPlan = createMountedCameraFrameSequencePlan(['head'], {
  cameras: [],
  sites: [],
  bodies: [],
  aliases: {
    head: [{ cameraName: 'head' }],
  },
  allowAliasFallback: true,
});

if (mountedCamera?.source?.kind === 'mujoco-site') {
  mountedCamera.source.siteName.toUpperCase();
}

mountedPlan.resolved.head?.selector.siteName?.toUpperCase();
readiness.cameras.head?.source?.kind.toUpperCase();
readiness.resolvedKeys.includes('head');
missingPlan.missingKeys.includes('missing');
fallbackPlan.resolved.head?.selector.cameraName?.toUpperCase();
