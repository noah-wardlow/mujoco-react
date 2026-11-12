import type { ContactInfo, PolicyCameraFrameCaptureOptions, PolicyCameraFrameCaptureResult } from '../types';

export interface RuntimeMetrics {
  steps: number;
  physicsMs: number;
  elapsedMs: number;
  realTimeFactor: number;
  captureMs: number;
  busy: boolean;
}
export interface RuntimeState {
  time: number;
  qpos: Float64Array;
  qvel: Float64Array;
  ctrl: Float64Array;
  sensors: Float64Array;
  contacts: ContactInfo[];
}
export interface RuntimeSnapshot {
  readonly modelId: string;
  readonly signature: number;
  readonly values: Float64Array;
}
export interface AdvanceOptions {
  steps: number;
  controls?: ArrayLike<number>;
  signal?: AbortSignal;
}
/** One operation at a time. Await advance/observe rather than queueing work. */
export interface SimulationRuntime {
  readonly state: RuntimeState;
  readonly metrics: Readonly<RuntimeMetrics>;
  advance(options: AdvanceOptions): Promise<RuntimeState>;
  observe(cameras?: PolicyCameraFrameCaptureOptions): Promise<RuntimeState & { cameras?: PolicyCameraFrameCaptureResult }>;
  saveState(): Promise<RuntimeSnapshot>;
  restoreState(snapshot: RuntimeSnapshot): Promise<RuntimeState>;
  cancel(): Promise<void>;
  reset(): Promise<RuntimeState>;
  dispose(): Promise<void>;
}
export interface WorkerPort {
  postMessage(message: unknown): void;
  terminate(): void;
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent) => void) | null;
}
export interface RuntimeOptions {
  /** Override worker construction for custom bundlers or runtime tests. */
  createWorker?: () => WorkerPort;
}
