/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * useFrameCapture — still-frame capture for canvas-backed MuJoCo/R3F scenes.
 */

import { useCallback, useState } from 'react';
import type React from 'react';

export type FrameCaptureStatus = 'idle' | 'capturing' | 'captured' | 'error';

export type FrameCaptureTarget =
  | HTMLCanvasElement
  | HTMLElement
  | null
  | undefined;

export type FrameCaptureTargetRef =
  React.RefObject<HTMLCanvasElement | HTMLElement | null>;

export interface FrameCaptureOptions {
  target?: FrameCaptureTarget | FrameCaptureTargetRef;
  type?: string;
  quality?: number;
  waitForAnimationFrame?: boolean;
}

export interface FrameCaptureResult {
  canvas: HTMLCanvasElement;
  dataUrl: string;
  type: string;
}

export interface FrameCaptureBlobResult {
  canvas: HTMLCanvasElement;
  blob: Blob;
  type: string;
}

export interface FrameCaptureAPI {
  status: FrameCaptureStatus;
  error: Error | null;
  isCapturing: boolean;
  capture: (options?: FrameCaptureOptions) => Promise<FrameCaptureResult>;
  captureBlob: (
    options?: FrameCaptureOptions
  ) => Promise<FrameCaptureBlobResult>;
  reset: () => void;
}

function isTargetRef(
  target: FrameCaptureOptions['target']
): target is FrameCaptureTargetRef {
  return Boolean(target && typeof target === 'object' && 'current' in target);
}

function resolveCanvasTarget(
  target: FrameCaptureOptions['target']
): HTMLCanvasElement {
  const resolvedTarget = isTargetRef(target) ? target.current : target;

  if (!resolvedTarget) {
    throw new Error('No frame capture target is available.');
  }

  if (resolvedTarget instanceof HTMLCanvasElement) {
    return resolvedTarget;
  }

  const canvas = resolvedTarget.querySelector('canvas');
  if (!canvas) {
    throw new Error('Frame capture target does not contain a canvas.');
  }
  return canvas;
}

function waitForNextAnimationFrame() {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

/**
 * Capture the current canvas frame as a data URL.
 *
 * For WebGL scenes, create the renderer with `preserveDrawingBuffer: true`
 * when you need deterministic captures after the frame has presented.
 */
export async function captureFrame(
  options: FrameCaptureOptions
): Promise<FrameCaptureResult> {
  const type = options.type ?? 'image/png';
  const canvas = resolveCanvasTarget(options.target);

  if (options.waitForAnimationFrame ?? true) {
    await waitForNextAnimationFrame();
  }

  return {
    canvas,
    dataUrl: canvas.toDataURL(type, options.quality),
    type,
  };
}

/**
 * Capture the current canvas frame as a Blob.
 */
export async function captureFrameBlob(
  options: FrameCaptureOptions
): Promise<FrameCaptureBlobResult> {
  const type = options.type ?? 'image/png';
  const canvas = resolveCanvasTarget(options.target);

  if (options.waitForAnimationFrame ?? true) {
    await waitForNextAnimationFrame();
  }

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (nextBlob) => {
        if (nextBlob) {
          resolve(nextBlob);
        } else {
          reject(new Error('Canvas frame capture did not produce a Blob.'));
        }
      },
      type,
      options.quality
    );
  });

  return { canvas, blob, type };
}

/**
 * React state wrapper around `captureFrame` and `captureFrameBlob`.
 */
export function useFrameCapture(
  defaultOptions: FrameCaptureOptions = {}
): FrameCaptureAPI {
  const [status, setStatus] = useState<FrameCaptureStatus>('idle');
  const [error, setError] = useState<Error | null>(null);

  const reset = useCallback(() => {
    setStatus('idle');
    setError(null);
  }, []);

  const capture = useCallback(
    async (options: FrameCaptureOptions = {}) => {
      setStatus('capturing');
      setError(null);

      try {
        const result = await captureFrame({ ...defaultOptions, ...options });
        setStatus('captured');
        return result;
      } catch (nextError) {
        const error =
          nextError instanceof Error
            ? nextError
            : new Error('Unable to capture the current canvas frame.');
        setError(error);
        setStatus('error');
        throw error;
      }
    },
    [defaultOptions]
  );

  const captureBlob = useCallback(
    async (options: FrameCaptureOptions = {}) => {
      setStatus('capturing');
      setError(null);

      try {
        const result = await captureFrameBlob({
          ...defaultOptions,
          ...options,
        });
        setStatus('captured');
        return result;
      } catch (nextError) {
        const error =
          nextError instanceof Error
            ? nextError
            : new Error('Unable to capture the current canvas frame.');
        setError(error);
        setStatus('error');
        throw error;
      }
    },
    [defaultOptions]
  );

  return {
    status,
    error,
    isCapturing: status === 'capturing',
    capture,
    captureBlob,
    reset,
  };
}
