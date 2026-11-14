import type {CameraFrameCaptureOptions,CameraRGBDResult,MujocoRenderOptions} from '../src';
const render:MujocoRenderOptions={appearance:'mujoco-classic'};
const capture:CameraFrameCaptureOptions={cameraName:'agentview',rgbColorSpace:'linear-srgb'};
declare const result:CameraRGBDResult;
const transfer:'srgb'|'linear-srgb'|undefined=result.rgbColorSpace;
// @ts-expect-error Unsupported material model.
const bad:MujocoRenderOptions={appearance:'native-perfect'};
// @ts-expect-error Arbitrary transfer functions cannot be supplied.
const badCapture:CameraFrameCaptureOptions={rgbColorSpace:'gamma22'};
void [render,capture,transfer,bad,badCapture];
