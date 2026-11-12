/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Readback stream for DOM compositing/encoding. For interactive camera previews,
 * use CameraView/useCameraViewport: they render on the GPU with no readback.
 * This path defaults to 10 FPS and permits only one capture in flight.
 */

import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import { useMujoco } from '../core/MujocoSimProvider';
import type { CameraFrameCaptureSession } from '../rendering/cameraFrameCapture';
import type { CameraFrameCaptureOptions } from '../types';

export interface CameraStreamOptions extends CameraFrameCaptureOptions {
  /**
   * Readback rate, default 10 FPS. Must be positive and finite.
   */
  fps?: number;
  /** Pause updates without unmounting. */
  paused?: boolean;
  onError?: (error: Error) => void;
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

    const fps = opts.fps ?? 10;
    if (!Number.isFinite(fps) || fps <= 0) throw new Error('Camera stream fps must be positive and finite');
    elapsedRef.current += delta;
    if (elapsedRef.current < 1 / fps) return;
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
      .catch(error => {
        const failure = error instanceof Error ? error : new Error(String(error));
        if (optionsRef.current.onError) optionsRef.current.onError(failure);
        else console.error('Camera stream capture failed', failure);
      })
      .finally(() => {
        inFlightRef.current = false;
      });
  });
}
