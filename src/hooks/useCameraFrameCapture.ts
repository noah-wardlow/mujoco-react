/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * React state wrapper around MuJoCo/R3F offscreen camera-frame capture.
 */

import { useCallback, useState } from 'react';
import { useMujoco } from '../core/MujocoSimProvider';
import type {
  CameraFrameCaptureAPI,
  CameraFrameCaptureOptions,
  FrameCaptureStatus,
} from '../types';

export function useCameraFrameCapture(
  defaultOptions: CameraFrameCaptureOptions = {}
): CameraFrameCaptureAPI {
  const mujoco = useMujoco();
  const [status, setStatus] = useState<FrameCaptureStatus>('idle');
  const [error, setError] = useState<Error | null>(null);

  const reset = useCallback(() => {
    setStatus('idle');
    setError(null);
  }, []);

  const capture = useCallback(
    async (options: CameraFrameCaptureOptions = {}) => {
      if (!mujoco.api) {
        throw new Error('MuJoCo scene is not ready for camera frame capture.');
      }

      setStatus('capturing');
      setError(null);

      try {
        const result = await mujoco.api.captureCameraFrame({
          ...defaultOptions,
          ...options,
        });
        setStatus('captured');
        return result;
      } catch (nextError) {
        const error =
          nextError instanceof Error
            ? nextError
            : new Error('Unable to capture the requested camera frame.');
        setError(error);
        setStatus('error');
        throw error;
      }
    },
    [defaultOptions, mujoco.api]
  );

  const captureBlob = useCallback(
    async (options: CameraFrameCaptureOptions = {}) => {
      if (!mujoco.api) {
        throw new Error('MuJoCo scene is not ready for camera frame capture.');
      }

      setStatus('capturing');
      setError(null);

      try {
        const result = await mujoco.api.captureCameraFrameBlob({
          ...defaultOptions,
          ...options,
        });
        setStatus('captured');
        return result;
      } catch (nextError) {
        const error =
          nextError instanceof Error
            ? nextError
            : new Error('Unable to capture the requested camera frame.');
        setError(error);
        setStatus('error');
        throw error;
      }
    },
    [defaultOptions, mujoco.api]
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
