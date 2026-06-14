/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * React state wrapper around fixed-camera simulation sequence recording.
 */

import { useCallback, useState } from 'react';
import { useMujoco } from '../core/MujocoSimProvider';
import type {
  CameraFrameSequenceOptions,
  CameraFrameSequenceRecorderAPI,
  FrameCaptureStatus,
} from '../types';

export function useCameraSequenceRecorder(): CameraFrameSequenceRecorderAPI {
  const mujoco = useMujoco();
  const [status, setStatus] = useState<FrameCaptureStatus>('idle');
  const [error, setError] = useState<Error | null>(null);

  const reset = useCallback(() => {
    setStatus('idle');
    setError(null);
  }, []);

  const record = useCallback(
    async (options: CameraFrameSequenceOptions) => {
      if (!mujoco.api) {
        throw new Error('MuJoCo scene is not ready for camera sequence recording.');
      }

      setStatus('capturing');
      setError(null);

      try {
        const result = await mujoco.api.recordCameraSequence(options);
        setStatus('captured');
        return result;
      } catch (nextError) {
        const error =
          nextError instanceof Error
            ? nextError
            : new Error('Unable to record the requested camera sequence.');
        setError(error);
        setStatus('error');
        throw error;
      }
    },
    [mujoco.api]
  );

  return {
    status,
    error,
    isRecording: status === 'capturing',
    record,
    reset,
  };
}
