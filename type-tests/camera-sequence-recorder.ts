import type {
  CameraFrameSequenceOptions,
  CameraFrameSequenceResult,
  CameraFrameSequenceSampleInput,
  CameraFrameSequenceStepInput,
  MujocoData,
  MujocoModel,
} from '../src';

function readModelData(model: MujocoModel, data: MujocoData) {
  return {
    nq: model.nq,
    nu: model.nu,
    time: data.time,
    qpos: new Float64Array(data.qpos),
    ctrl: new Float64Array(data.ctrl),
  };
}

const rows: Array<{
  frameIndex: number;
  timestamp: number;
  state: number[];
  action: number[];
}> = [];

const sequenceOptions = {
  frames: 2,
  stepsPerFrame: 1,
  retainFrames: false,
  requireMountedSources: true,
  cameras: [
    {
      key: 'head',
      cameraName: 'head_camera',
      width: 640,
      height: 480,
    },
  ],
  onBeforeStep: ({ frameIndex, stepIndex, time, model, data }) => {
    const sample = readModelData(model, data);
    data.ctrl[0] = frameIndex + stepIndex + time + sample.nu;
  },
  onAfterStep: async ({ frameIndex, stepIndex, time, model, data }) => {
    void frameIndex;
    void stepIndex;
    void time;
    readModelData(model, data);
  },
  onSample: ({ frameIndex, time, model, data }) => {
    const sample = readModelData(model, data);
    rows.push({
      frameIndex,
      timestamp: time,
      state: Array.from(sample.qpos),
      action: Array.from(sample.ctrl),
    });
  },
} satisfies CameraFrameSequenceOptions;

const sampleCallback: CameraFrameSequenceOptions['onSample'] = (
  input: CameraFrameSequenceSampleInput
) => {
  readModelData(input.model, input.data);
};

const stepCallback: CameraFrameSequenceOptions['onBeforeStep'] = (
  input: CameraFrameSequenceStepInput
) => {
  readModelData(input.model, input.data);
};

function readSequenceResult(result: CameraFrameSequenceResult) {
  const head = result.cameraSummaries.head;
  if (!head) return null;
  return {
    key: head.key,
    dimensions: [head.width, head.height] as const,
    sourceKind: head.source.kind,
    frameCount: head.frameCount,
    firstFrameIndex: head.firstFrameIndex,
    lastFrameIndex: head.lastFrameIndex,
    firstTimestamp: head.firstTimestamp,
    lastTimestamp: head.lastTimestamp,
  };
}

void sequenceOptions;
void sampleCallback;
void stepCallback;
void readSequenceResult;
void rows;
