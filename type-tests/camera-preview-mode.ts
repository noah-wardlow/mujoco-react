import type { CameraFrameCaptureOptions, CameraStreamOptions } from '../src';
const preview: CameraStreamOptions = { renderMode: 'preview', fps: 30 };
const snapshot: CameraFrameCaptureOptions = { renderMode: 'snapshot' };
// @ts-expect-error Modes must describe preview or snapshot behavior.
const invalid: CameraFrameCaptureOptions = { renderMode: 'fast' };
void [preview, snapshot, invalid];
