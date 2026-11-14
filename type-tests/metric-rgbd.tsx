import type * as THREE from 'three';
import { captureCameraRGBD, createCameraFrameCaptureSession, useCameraFrameCapture } from '../src';
import type { CameraRGBDResult, MujocoSimAPI } from '../src';

declare const renderer: THREE.WebGLRenderer;
declare const scene: THREE.Scene;
declare const camera: THREE.Camera;
declare const api: MujocoSimAPI;
const frame: CameraRGBDResult = captureCameraRGBD(renderer, scene, camera, { width: 640, height: 480 });
const rgb: Uint8Array = frame.rgb;
const depth: Float32Array = frame.depth;
const origin: 'top-left' = frame.origin;
const units: 'meters' = frame.depthUnits;
const convention: 'camera-z' = frame.depthConvention;
const session = createCameraFrameCaptureSession(renderer, scene, camera);
const repeated: CameraRGBDResult = session.captureRGBD({ flipX: true });
const observation: CameraRGBDResult = api.captureCameraRGBD();
function Capture() {
  const capture = useCameraFrameCapture({ width: 640, height: 480 });
  const take = async () => {
    const result: CameraRGBDResult = await capture.captureRGBD();
    return result.depth;
  };
  return <button onClick={take}>Capture RGB-D</button>;
}
void [rgb, depth, origin, units, convention, repeated, observation, Capture];
