import {
  createMountedCameraFrameSequenceReadiness,
  createMountedCameraFrameSequencePlan,
  resolveMountedCameraFrameSource,
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
const inferredImportedPlan = createMountedCameraFrameSequencePlan(
  ['head', 'left_wrist', 'right_wrist'],
  {
    cameras: [{ name: 'overhead_camera' }],
    sites: [
      { name: 'head_camera_rgb_optical_frame' },
      { name: 'left_wrist_camera_optical_frame' },
      { name: 'right_wrist_camera_optical_frame' },
    ],
    bodies: [{ name: 'camera_mount_right_wrist' }],
  }
);
const normalizedCameraSource = resolveMountedCameraFrameSource('overhead camera', {
  cameras: [{ name: 'overhead_camera' }],
});
const lerobotFeatureCameraSource = resolveMountedCameraFrameSource(
  'observation.images.head',
  {
    cameras: [{ name: 'robot_head_camera' }],
  }
);
const namespacedWristCameraSource = resolveMountedCameraFrameSource(
  'observation.images.left_wrist',
  {
    cameras: [{ name: 'camera_left_wrist_rgb' }],
  }
);
const inferredBeforeFallbackSource = resolveMountedCameraFrameSource('left_wrist', {
  cameras: [],
  sites: [{ name: 'left_wrist_camera_optical_frame' }],
  bodies: [],
  aliases: {
    left_wrist: [{ cameraName: 'left_wrist' }],
  },
  allowAliasFallback: true,
});
const aliasBeatsDirectBodyPlan = createMountedCameraFrameSequencePlan(['wrist'], {
  cameras: [{ name: 'wrist_cam' }],
  sites: [],
  bodies: [{ name: 'wrist' }],
  aliases: {
    wrist: { cameraName: 'wrist_cam' },
  },
});

if (mountedCamera?.source?.kind === 'mujoco-site') {
  mountedCamera.source.siteName.toUpperCase();
}

mountedPlan.resolved.head?.selector.siteName?.toUpperCase();
readiness.cameras.head?.source?.kind.toUpperCase();
readiness.resolvedKeys.includes('head');
missingPlan.missingKeys.includes('missing');
fallbackPlan.resolved.head?.selector.cameraName?.toUpperCase();
inferredImportedPlan.resolved.left_wrist?.selector.siteName?.toUpperCase();
inferredImportedPlan.resolved.right_wrist?.source.kind.toUpperCase();
normalizedCameraSource?.selector.cameraName?.toUpperCase();
lerobotFeatureCameraSource?.selector.cameraName?.toUpperCase();
namespacedWristCameraSource?.selector.cameraName?.toUpperCase();
inferredBeforeFallbackSource?.selector.siteName?.toUpperCase();
aliasBeatsDirectBodyPlan.resolved.wrist?.selector.cameraName?.toUpperCase();
