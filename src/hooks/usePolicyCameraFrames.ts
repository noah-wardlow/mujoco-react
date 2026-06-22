/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * React wrapper for capturing policy image payloads from Three/MuJoCo cameras.
 */

import { useCallback, useState } from 'react';
import { useMujoco } from '../core/MujocoSimProvider';
import {
  capturePolicyCameraFrames,
  capturePolicyCameraFramesFromMountedStreams,
} from '../policyCameraFrames';
import type {
  CreatePolicyCameraFrameCapturePlanOptions,
  PolicyCameraFrameCapturePlan,
} from '../policyCameraFrames';
import type {
  FrameCaptureStatus,
  PolicyCameraFrameCaptureAPI,
  PolicyCameraFrameCaptureOptions,
  PolicyCameraFrameCaptureResult,
} from '../types';

export type MountedPolicyCameraFrameCaptureOptions = Omit<
  CreatePolicyCameraFrameCapturePlanOptions,
  'cameras' | 'sites' | 'bodies'
>;

export interface MountedPolicyCameraFrameCaptureAPI {
  status: FrameCaptureStatus;
  error: Error | null;
  isCapturing: boolean;
  capture: (
    options?: Partial<MountedPolicyCameraFrameCaptureOptions>
  ) => Promise<PolicyCameraFrameCaptureResult & { plan: PolicyCameraFrameCapturePlan }>;
  reset: () => void;
}

function mergePolicyCameraFrameCaptureOptions(
  defaultOptions: MountedPolicyCameraFrameCaptureOptions,
  options: Partial<MountedPolicyCameraFrameCaptureOptions>
): MountedPolicyCameraFrameCaptureOptions {
  return {
    ...defaultOptions,
    ...options,
    cameraKeys: options.cameraKeys ?? defaultOptions.cameraKeys,
    aliases: {
      ...defaultOptions.aliases,
      ...options.aliases,
    },
    defaults: {
      ...defaultOptions.defaults,
      ...options.defaults,
    },
    streamOptions: {
      ...defaultOptions.streamOptions,
      ...options.streamOptions,
    },
  };
}

export function usePolicyCameraFrames(
  defaultOptions: PolicyCameraFrameCaptureOptions
): PolicyCameraFrameCaptureAPI {
  const mujoco = useMujoco();
  const [status, setStatus] = useState<FrameCaptureStatus>('idle');
  const [error, setError] = useState<Error | null>(null);

  const reset = useCallback(() => {
    setStatus('idle');
    setError(null);
  }, []);

  const capture = useCallback(
    async (options: Partial<PolicyCameraFrameCaptureOptions> = {}) => {
      if (!mujoco.api) {
        throw new Error('MuJoCo scene is not ready for policy camera capture.');
      }

      setStatus('capturing');
      setError(null);

      try {
        const result = await capturePolicyCameraFrames(mujoco.api, {
          ...defaultOptions,
          ...options,
          streams: options.streams ?? defaultOptions.streams,
        });
        setStatus('captured');
        return result;
      } catch (nextError) {
        const error =
          nextError instanceof Error
            ? nextError
            : new Error('Unable to capture policy camera frames.');
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
    reset,
  };
}

export function usePolicyCameraFramesFromMountedStreams(
  defaultOptions: MountedPolicyCameraFrameCaptureOptions
): MountedPolicyCameraFrameCaptureAPI {
  const mujoco = useMujoco();
  const [status, setStatus] = useState<FrameCaptureStatus>('idle');
  const [error, setError] = useState<Error | null>(null);

  const reset = useCallback(() => {
    setStatus('idle');
    setError(null);
  }, []);

  const capture = useCallback(
    async (options: Partial<MountedPolicyCameraFrameCaptureOptions> = {}) => {
      if (!mujoco.api) {
        throw new Error('MuJoCo scene is not ready for mounted policy camera capture.');
      }

      setStatus('capturing');
      setError(null);

      try {
        const result = await capturePolicyCameraFramesFromMountedStreams(
          mujoco.api,
          mergePolicyCameraFrameCaptureOptions(defaultOptions, options)
        );
        setStatus('captured');
        return result;
      } catch (nextError) {
        const error =
          nextError instanceof Error
            ? nextError
            : new Error('Unable to capture mounted policy camera frames.');
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
    reset,
  };
}
