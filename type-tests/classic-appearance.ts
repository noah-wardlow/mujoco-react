import { MujocoAppearance } from '../src';
import type {CameraFrameCaptureOptions,CameraRGBDResult,MujocoRenderOptions} from '../src';
const render:MujocoRenderOptions={appearance:MujocoAppearance.Classic};
const standard:MujocoRenderOptions={appearance:MujocoAppearance.Standard};
const serialized:MujocoRenderOptions={appearance:'mujoco-classic'};
const appearance:MujocoAppearance=MujocoAppearance.Classic;
// @ts-expect-error Appearance constants are readonly.
MujocoAppearance.Classic='standard';
// @ts-expect-error Only supported profiles belong to the derived union.
const badAppearance:MujocoAppearance='native-perfect';
const capture:CameraFrameCaptureOptions={cameraName:'agentview',appearance:MujocoAppearance.Classic};
const viewerCapture:CameraFrameCaptureOptions={appearance:MujocoAppearance.Standard};
declare const result:CameraRGBDResult;
const transfer:'srgb'|'linear-srgb'|undefined=result.rgbColorSpace;
// @ts-expect-error Unsupported material model.
const bad:MujocoRenderOptions={appearance:'native-perfect'};
// @ts-expect-error Arbitrary transfer functions cannot be supplied.
const badCapture:CameraFrameCaptureOptions={rgbColorSpace:'gamma22'};
void [viewerCapture,standard,serialized,appearance,badAppearance,render,capture,transfer,bad,badCapture];
