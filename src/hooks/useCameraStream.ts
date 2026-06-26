/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Stream a live MuJoCo camera into a DOM `<canvas>`. Each frame the scene is
 * rendered offscreen from the selected camera and blitted into the canvas, so
 * it composites normally in the DOM (works inside opaque panels) and does NOT
 * take over the render loop. Prefer this over `useCameraViewport` for camera
 * tiles embedded in HTML UI; use `useCameraViewport` for transparent overlays
 * on a full-bleed canvas.
 *
 * Uses the async capture path so Gaussian-splat environments render through
 * their dedicated capture renderer — streaming a splat scene at full rate does
 * not disturb the main view's splat sort.
 */

import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import { useMujoco } from '../core/MujocoSimProvider';
import type { CameraFrameCaptureSession } from '../rendering/cameraFrameCapture';
import type { CameraFrameCaptureOptions } from '../types';

export interface CameraStreamOptions extends CameraFrameCaptureOptions {
  /**
   * Optional cap on updates per second. Omit to stream as fast as captures
   * complete (one capture is in flight at a time regardless).
   */
  fps?: number;
  /** Pause updates without unmounting. */
  paused?: boolean;
}

function streamSignature(options: CameraStreamOptions): string {
  return JSON.stringify({
    cameraName: options.cameraName,
    siteName: options.siteName,
    bodyName: options.bodyName,
    width: options.width,
    height: options.height,
    renderIsolation: options.renderIsolation ?? false,
  });
}

/**
 * Render the live scene from a MuJoCo camera/site/body into `canvasRef`'s
 * `<canvas>` every frame (throttled to `fps`). Call inside `<MujocoCanvas>`;
 * the canvas itself can live anywhere in the DOM.
 */
export function useCameraStream(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  options: CameraStreamOptions
) {
  const mujoco = useMujoco();
  const sessionRef = useRef<CameraFrameCaptureSession | null>(null);
  const signatureRef = useRef<string>('');
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const elapsedRef = useRef(0);
  const inFlightRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      sessionRef.current?.dispose();
      sessionRef.current = null;
      signatureRef.current = '';
    };
  }, []);

  useFrame((_state, delta) => {
    const api = mujoco.api;
    if (!api || !canvasRef.current) return;

    const opts = optionsRef.current;
    if (opts.paused) return;

    if (opts.fps && opts.fps > 0) {
      elapsedRef.current += delta;
      if (elapsedRef.current < 1 / opts.fps) return;
    }
    // One capture in flight at a time — naturally rate-limits to capture speed.
    if (inFlightRef.current) return;
    elapsedRef.current = 0;

    const signature = streamSignature(opts);
    if (!sessionRef.current || signatureRef.current !== signature) {
      sessionRef.current?.dispose();
      sessionRef.current = api.createCameraFrameCaptureSession(opts);
      signatureRef.current = signature;
    }
    const session = sessionRef.current;

    inFlightRef.current = true;
    session
      .captureAsync(api.resolveCameraCaptureOptions(opts))
      .then((frame) => {
        const canvas = canvasRef.current;
        if (!mountedRef.current || !canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        if (canvas.width !== frame.width || canvas.height !== frame.height) {
          canvas.width = frame.width;
          canvas.height = frame.height;
        }
        ctx.drawImage(frame.canvas, 0, 0);
      })
      .catch(() => {})
      .finally(() => {
        inFlightRef.current = false;
      });
  });
}
