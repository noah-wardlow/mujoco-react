/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * React state wrapper for named MuJoCo camera/site/body sequence recording.
 */

import { useCallback, useState } from 'react';
import { useMujoco } from '../core/MujocoSimProvider';
import {
  createMountedCameraFrameSequenceReadiness,
  createMountedCameraFrameSequencePlanFromApi,
  recordMountedCameraFrameSequence,
  type MountedCameraFrameSequencePlan,
  type MountedCameraFrameSequencePlanOptions,
  type MountedCameraFrameSequenceReadiness,
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
export type MountedCameraSequenceReadiness =
  MountedCameraFrameSequenceReadiness;

export interface MountedCameraSequenceRecorderAPI
  extends Omit<CameraFrameSequenceRecorderAPI, 'record'> {
  plan: MountedCameraFrameSequencePlan | null;
  readiness: MountedCameraSequenceReadiness | null;
  result: MountedCameraSequenceRecordResult | null;
  createPlan: (
    cameraKeys: readonly string[],
    options?: MountedCameraSequencePlanOptions
  ) => MountedCameraFrameSequencePlan;
  checkReadiness: (
    cameraKeys: readonly string[],
    options?: MountedCameraSequencePlanOptions
  ) => MountedCameraSequenceReadiness;
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
  const [plan, setPlan] = useState<MountedCameraFrameSequencePlan | null>(null);
  const [readiness, setReadiness] =
    useState<MountedCameraSequenceReadiness | null>(null);
  const [result, setResult] = useState<MountedCameraSequenceRecordResult | null>(
    null
  );

  const reset = useCallback(() => {
    setStatus('idle');
    setError(null);
    setPlan(null);
    setReadiness(null);
    setResult(null);
  }, []);

  const createPlan = useCallback(
    (
      cameraKeys: readonly string[],
      options: MountedCameraSequencePlanOptions = {}
    ) => {
      if (!mujoco.api) {
        throw new Error('MuJoCo scene is not ready for mounted camera sequence planning.');
      }

      const nextPlan = createMountedCameraFrameSequencePlanFromApi(
        mujoco.api,
        cameraKeys,
        {
          ...defaultOptions,
          ...options,
        }
      );
      setPlan(nextPlan);
      setReadiness(null);
      return nextPlan;
    },
    [defaultOptions, mujoco.api]
  );

  const checkReadiness = useCallback(
    (
      cameraKeys: readonly string[],
      options: MountedCameraSequencePlanOptions = {}
    ) => {
      const nextPlan = createPlan(cameraKeys, options);
      const nextReadiness = createMountedCameraFrameSequenceReadiness(nextPlan);
      setReadiness(nextReadiness);
      return nextReadiness;
    },
    [createPlan]
  );

  const record = useCallback(
    async (options: MountedCameraSequenceRecordOptions) => {
      if (!mujoco.api) {
        throw new Error('MuJoCo scene is not ready for mounted camera sequence recording.');
      }

      setStatus('capturing');
      setError(null);
      setResult(null);

      try {
        const nextResult = await recordMountedCameraFrameSequence(mujoco.api, {
          ...defaultOptions,
          ...options,
        });
        setPlan(nextResult.plan);
        setReadiness(nextResult.readiness);
        setResult(nextResult);
        setStatus('captured');
        return nextResult;
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
    plan,
    readiness,
    result,
    isRecording: status === 'capturing',
    createPlan,
    checkReadiness,
    record,
    reset,
  };
}
