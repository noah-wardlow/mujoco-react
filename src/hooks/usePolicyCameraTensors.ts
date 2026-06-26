/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Capture policy observation tensors directly from Three/MuJoCo cameras,
 * skipping the data-URL/PNG round-trip. Sessions are created once per camera
 * and reused every step, so live inference and dataset recording read straight
 * from the GPU into Float32 tensors.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMujoco } from '../core/MujocoSimProvider';
import { createPolicyCameraFrameCapturePlanFromApi } from '../policyCameraFrames';
import type { MountedPolicyCameraFrameCaptureOptions } from './usePolicyCameraFrames';
import type {
  CameraFrameCaptureSession,
  CameraFrameCaptureTensorOptions,
  CameraFrameTensorResult,
} from '../rendering/cameraFrameCapture';
import type { FrameCaptureStatus } from '../types';

export interface PolicyCameraTensorStream extends CameraFrameCaptureTensorOptions {
  /** Payload key this stream's tensor is stored under. */
  key: string;
  /** Additional payload keys that should reference the same tensor. */
  aliases?: readonly string[];
}

export interface PolicyCameraTensorsOptions {
  streams: PolicyCameraTensorStream[];
  /** Also expose tensors under `observation.images.<key>` aliases. Defaults to `false`. */
  includeObservationImageAliases?: boolean;
}

export interface PolicyCameraTensorsResult {
  tensors: Record<string, CameraFrameTensorResult>;
  sourceSummary: string;
  capturedAt: number;
}

export interface PolicyCameraTensorsAPI {
  status: FrameCaptureStatus;
  error: Error | null;
  isCapturing: boolean;
  /** Synchronously render and convert every stream into a policy image tensor. */
  capture: () => PolicyCameraTensorsResult;
  reset: () => void;
}

export type MountedPolicyCameraTensorOptions = MountedPolicyCameraFrameCaptureOptions & {
  tensor?: Pick<
    CameraFrameCaptureTensorOptions,
    'width' | 'height' | 'channels' | 'layout' | 'range'
  >;
};

type SessionEntry = {
  session: CameraFrameCaptureSession;
  signature: string;
};

function sessionSignature(stream: PolicyCameraTensorStream): string {
  return JSON.stringify({
    width: stream.width,
    height: stream.height,
    channels: stream.channels,
    renderIsolation: stream.renderIsolation ?? false,
    cameraName: stream.cameraName,
    siteName: stream.siteName,
    bodyName: stream.bodyName,
  });
}

function addTensorAliases(
  tensors: Record<string, CameraFrameTensorResult>,
  stream: PolicyCameraTensorStream,
  tensor: CameraFrameTensorResult,
  includeObservationImageAliases: boolean
) {
  const keys = new Set<string>([stream.key, ...(stream.aliases ?? [])]);
  if (includeObservationImageAliases) {
    for (const base of [stream.key, ...(stream.aliases ?? [])]) {
      keys.add(`observation.images.${base}`);
    }
  }
  for (const key of keys) tensors[key] = tensor;
}

export function usePolicyCameraTensors(
  options: PolicyCameraTensorsOptions
): PolicyCameraTensorsAPI {
  const mujoco = useMujoco();
  const [status, setStatus] = useState<FrameCaptureStatus>('idle');
  const [error, setError] = useState<Error | null>(null);
  const sessionsRef = useRef<Map<string, SessionEntry>>(new Map());

  const disposeSessions = useCallback(() => {
    for (const { session } of sessionsRef.current.values()) session.dispose();
    sessionsRef.current.clear();
  }, []);

  useEffect(() => disposeSessions, [disposeSessions]);

  const reset = useCallback(() => {
    setStatus('idle');
    setError(null);
  }, []);

  const capture = useCallback((): PolicyCameraTensorsResult => {
    const api = mujoco.api;
    if (!api) {
      throw new Error('MuJoCo scene is not ready for policy camera tensor capture.');
    }

    setStatus('capturing');
    setError(null);

    try {
      const sessions = sessionsRef.current;
      const seen = new Set<string>();
      const tensors: Record<string, CameraFrameTensorResult> = {};
      const sourceParts: string[] = [];

      for (const stream of options.streams) {
        seen.add(stream.key);
        const resolved: CameraFrameCaptureTensorOptions = {
          ...api.resolveCameraCaptureOptions(stream),
          channels: stream.channels,
          layout: stream.layout,
          range: stream.range,
        };

        const signature = sessionSignature(stream);
        let entry = sessions.get(stream.key);
        if (!entry || entry.signature !== signature) {
          entry?.session.dispose();
          entry = {
            session: api.createCameraFrameCaptureSession(resolved),
            signature,
          };
          sessions.set(stream.key, entry);
        }

        const tensor = entry.session.captureTensor(resolved);
        addTensorAliases(
          tensors,
          stream,
          tensor,
          options.includeObservationImageAliases ?? false
        );
        sourceParts.push(`${stream.key}:${tensor.source.kind}`);
      }

      // Drop sessions for streams that are no longer requested.
      for (const key of [...sessions.keys()]) {
        if (!seen.has(key)) {
          sessions.get(key)?.session.dispose();
          sessions.delete(key);
        }
      }

      setStatus('captured');
      return {
        tensors,
        sourceSummary: sourceParts.join(' + ') || 'not used by policy',
        capturedAt: Date.now(),
      };
    } catch (nextError) {
      const captureError =
        nextError instanceof Error
          ? nextError
          : new Error('Unable to capture policy camera tensors.');
      setError(captureError);
      setStatus('error');
      throw captureError;
    }
  }, [mujoco.api, options.includeObservationImageAliases, options.streams]);

  return {
    status,
    error,
    isCapturing: status === 'capturing',
    capture,
    reset,
  };
}

export function usePolicyCameraTensorsFromMountedStreams(
  options: MountedPolicyCameraTensorOptions
): PolicyCameraTensorsAPI {
  const mujoco = useMujoco();
  const tensorOptions = options.tensor;
  const mountedOptions = useMemo<PolicyCameraTensorsOptions>(() => {
    const api = mujoco.api;
    if (!api) {
      return {
        streams: [],
        includeObservationImageAliases: options.includeObservationImageAliases ?? false,
      };
    }

    const plan = createPolicyCameraFrameCapturePlanFromApi(api, options);
    return {
      streams: plan.streams.map(({ key, aliases, ...stream }) => ({
        ...stream,
        ...tensorOptions,
        key,
        aliases,
      })),
      includeObservationImageAliases: plan.includeObservationImageAliases ?? false,
    };
  }, [mujoco.api, options, tensorOptions]);

  return usePolicyCameraTensors(mountedOptions);
}
