/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * React state wrapper for named MuJoCo camera/site/body sequence recording.
 */

import { useCallback, useState } from 'react';
import { useMujoco } from '../core/MujocoSimProvider';
import {
  createMountedCameraFrameSequencePlanFromApi,
  recordMountedCameraFrameSequence,
  type MountedCameraFrameSequencePlan,
  type MountedCameraFrameSequencePlanOptions,
  type MountedCameraFrameSequenceRecordOptions,
  type MountedCameraFrameSequenceRecordResult,
} from '../rendering/cameraFrameSource';
import type {
  CameraFrameSequenceRecorderAPI,
  FrameCaptureStatus,
} from '../types';

export type MountedCameraSequencePlanOptions =
  MountedCameraFrameSequencePlanOptions;
export type MountedCameraSequenceRecordOptions =
  MountedCameraFrameSequenceRecordOptions;
export type MountedCameraSequenceRecordResult =
  MountedCameraFrameSequenceRecordResult;

export interface MountedCameraSequenceRecorderAPI
  extends Omit<CameraFrameSequenceRecorderAPI, 'record'> {
  createPlan: (
    cameraKeys: readonly string[],
    options?: MountedCameraSequencePlanOptions
  ) => MountedCameraFrameSequencePlan;
  record: (
    options: MountedCameraSequenceRecordOptions
  ) => Promise<MountedCameraSequenceRecordResult>;
}

export function useMountedCameraSequenceRecorder(
  defaultOptions: MountedCameraSequencePlanOptions = {}
): MountedCameraSequenceRecorderAPI {
  const mujoco = useMujoco();
  const [status, setStatus] = useState<FrameCaptureStatus>('idle');
  const [error, setError] = useState<Error | null>(null);

  const reset = useCallback(() => {
    setStatus('idle');
    setError(null);
  }, []);

  const createPlan = useCallback(
    (
      cameraKeys: readonly string[],
      options: MountedCameraSequencePlanOptions = {}
    ) => {
      if (!mujoco.api) {
        throw new Error('MuJoCo scene is not ready for mounted camera sequence planning.');
      }

      return createMountedCameraFrameSequencePlanFromApi(mujoco.api, cameraKeys, {
        ...defaultOptions,
        ...options,
      });
    },
    [defaultOptions, mujoco.api]
  );

  const record = useCallback(
    async (options: MountedCameraSequenceRecordOptions) => {
      if (!mujoco.api) {
        throw new Error('MuJoCo scene is not ready for mounted camera sequence recording.');
      }

      setStatus('capturing');
      setError(null);

      try {
        const result = await recordMountedCameraFrameSequence(mujoco.api, {
          ...defaultOptions,
          ...options,
        });
        setStatus('captured');
        return result;
      } catch (nextError) {
        const error =
          nextError instanceof Error
            ? nextError
            : new Error('Unable to record the requested mounted camera sequence.');
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
    isRecording: status === 'capturing',
    createPlan,
    record,
    reset,
  };
}
