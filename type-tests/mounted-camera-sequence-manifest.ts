import {
  createMountedCameraFrameSequenceManifest,
  MountedCameraFrameSequenceManifestStatus,
  MountedCameraFrameSequenceReadinessStatus,
  type MountedCameraFrameSequenceManifest,
  type MountedCameraFrameSequenceRecordResult,
  type MountedCameraFrameSequenceStreamSummary,
} from '../src';

const result: MountedCameraFrameSequenceRecordResult = {
  frames: [],
  cameraKeys: ['head', 'wrist'],
  frameCount: 16,
  cameraSummaries: {
    head: {
      key: 'head',
      width: 640,
      height: 480,
      source: { kind: 'mujoco-site', siteName: 'head_camera_rgb_optical_frame' },
      frameCount: 16,
      firstFrameIndex: 0,
      lastFrameIndex: 15,
      firstTimestamp: 0,
      lastTimestamp: 0.5,
    },
    wrist: {
      key: 'wrist',
      width: 320,
      height: 240,
      source: { kind: 'mujoco-camera', cameraName: 'wrist_camera' },
      frameCount: 8,
      firstFrameIndex: 0,
      lastFrameIndex: 7,
      firstTimestamp: 0,
      lastTimestamp: 0.25,
    },
  },
  plan: {
    cameraKeys: ['head', 'wrist', 'missing'],
    cameras: [
      {
        key: 'head',
        source: { kind: 'mujoco-site', siteName: 'head_camera_rgb_optical_frame' },
        siteName: 'head_camera_rgb_optical_frame',
      },
      {
        key: 'wrist',
        source: { kind: 'mujoco-camera', cameraName: 'wrist_camera' },
        cameraName: 'wrist_camera',
      },
    ],
    resolved: {
      head: {
        key: 'head',
        selector: { siteName: 'head_camera_rgb_optical_frame' },
        source: { kind: 'mujoco-site', siteName: 'head_camera_rgb_optical_frame' },
      },
      wrist: {
        key: 'wrist',
        selector: { cameraName: 'wrist_camera' },
        source: { kind: 'mujoco-camera', cameraName: 'wrist_camera' },
      },
    },
    missingKeys: ['missing'],
  },
  readiness: {
    ready: false,
    status: MountedCameraFrameSequenceReadinessStatus.Partial,
    cameraKeys: ['head', 'wrist', 'missing'],
    resolvedKeys: ['head', 'wrist'],
    missingKeys: ['missing'],
    cameras: {
      head: {
        key: 'head',
        ready: true,
        selector: { siteName: 'head_camera_rgb_optical_frame' },
        source: { kind: 'mujoco-site', siteName: 'head_camera_rgb_optical_frame' },
        message: 'ready',
      },
      wrist: {
        key: 'wrist',
        ready: true,
        selector: { cameraName: 'wrist_camera' },
        source: { kind: 'mujoco-camera', cameraName: 'wrist_camera' },
        message: 'ready',
      },
      missing: {
        key: 'missing',
        ready: false,
        message: 'missing',
      },
    },
    message: 'partial',
  },
};

const manifest: MountedCameraFrameSequenceManifest =
  createMountedCameraFrameSequenceManifest(result);
const head: MountedCameraFrameSequenceStreamSummary =
  manifest.streamSummaries.head;
const wrist = manifest.streams.find((stream) => stream.key === 'wrist');
const missing = manifest.streamSummaries.missing;

manifest.schema.toUpperCase();
manifest.status satisfies (typeof MountedCameraFrameSequenceManifestStatus)[keyof typeof MountedCameraFrameSequenceManifestStatus];
head.complete.valueOf();
head.target?.toUpperCase();
wrist?.missingFrameCount.toFixed();
missing.status === MountedCameraFrameSequenceManifestStatus.Missing;
