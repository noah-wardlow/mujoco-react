import {
  useMountedCameraSequenceRecorder,
  type MountedCameraSequenceRecordOptions,
} from '../src';

function MountedCameraRecorderHarness() {
  const recorder = useMountedCameraSequenceRecorder({
    aliases: {
      head: [{ siteName: 'head_camera_rgb_optical_frame' }],
      left_wrist: [{ siteName: 'left_wrist_camera_optical_frame' }],
    },
    defaults: {
      width: 640,
      height: 480,
      type: 'image/png',
      fov: 45,
      near: 0.01,
      far: 100,
    },
    allowAliasFallback: true,
  });

  const options: MountedCameraSequenceRecordOptions = {
    cameraKeys: ['head', 'left_wrist'],
    frames: 16,
    stepsPerFrame: 1,
    captureInitialFrame: true,
    retainFrames: false,
    requireAll: true,
    requireMountedSources: true,
    onSample: ({ frameIndex, model, data }) => {
      frameIndex.toFixed();
      model.nq.toFixed();
      data.time.toFixed();
    },
    onFrame: ({ cameras }) => {
      cameras.head?.source.kind.toUpperCase();
    },
  };

  void recorder.createPlan(options.cameraKeys, options);
  void recorder.record(options).then((result) => {
    result.plan.resolved.head?.source.kind.toUpperCase();
    result.readiness.status.toUpperCase();
    result.readiness.cameras.head?.message.toUpperCase();
    result.cameraSummaries.head?.frameCount.toFixed();
    result.cameraSummaries.head?.firstFrameIndex?.toFixed();
    result.cameraSummaries.head?.lastTimestamp?.toFixed();
  });

  recorder.isRecording.valueOf();
  recorder.reset();
  return null;
}

void MountedCameraRecorderHarness;
