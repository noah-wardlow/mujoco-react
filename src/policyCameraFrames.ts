/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Helpers for turning Three/MuJoCo camera captures into policy image payloads.
 */

import type {
  CameraFrameCaptureResult,
  MujocoSimAPI,
  PolicyCameraFrameCaptureOptions,
  PolicyCameraFrameCaptureResult,
  PolicyCameraFrameStream,
} from './types';
import {
  createMountedCameraFrameSequencePlan,
  type MountedCameraFrameSequenceCameraOptions,
  type MountedCameraFrameSequenceDefaults,
  type MountedCameraFrameSequencePlan,
  type ResolveMountedCameraFrameSourceOptions,
} from './rendering/cameraFrameSource';

export type PolicyCameraFrameCaptureTarget = Pick<MujocoSimAPI, 'captureCameraFrame'>;
export type PolicyCameraFramePlanTarget = Pick<MujocoSimAPI, 'getCameras' | 'getSites' | 'getBodies'>;

export type PolicyCameraFrameStreamOptions =
  Partial<Omit<PolicyCameraFrameStream, 'key'>> &
  MountedCameraFrameSequenceCameraOptions & {
  /** Additional policy payload keys that should receive this stream's data URL. */
  aliases?: readonly string[];
};

export interface CreatePolicyCameraFrameCapturePlanOptions
  extends Omit<
    ResolveMountedCameraFrameSourceOptions,
    'cameras' | 'sites' | 'bodies'
  > {
  cameraKeys: readonly string[];
  cameras?: ResolveMountedCameraFrameSourceOptions['cameras'];
  sites?: ResolveMountedCameraFrameSourceOptions['sites'];
  bodies?: ResolveMountedCameraFrameSourceOptions['bodies'];
  defaults?: MountedCameraFrameSequenceDefaults;
  streamOptions?: Record<string, PolicyCameraFrameStreamOptions>;
  includeObservationImageAliases?: boolean;
  requireAll?: boolean;
}

export interface PolicyCameraFrameCapturePlan
  extends PolicyCameraFrameCaptureOptions {
  cameraKeys: string[];
  streams: PolicyCameraFrameStream[];
  mountedPlan: MountedCameraFrameSequencePlan;
  missingKeys: string[];
}

function addPolicyImageAliases(
  images: Record<string, string>,
  stream: PolicyCameraFrameStream,
  frame: CameraFrameCaptureResult,
  includeObservationImageAliases: boolean
) {
  const keys = new Set<string>();
  keys.add(stream.key);
  for (const alias of stream.aliases ?? []) keys.add(alias);
  if (includeObservationImageAliases) {
    keys.add(`observation.images.${stream.key}`);
    for (const alias of stream.aliases ?? []) {
      keys.add(`observation.images.${alias}`);
    }
  }
  for (const key of keys) {
    images[key] = frame.dataUrl;
  }
}

function describeFrameSource(key: string, frame: CameraFrameCaptureResult) {
  return `${key}:${frame.source.kind}`;
}

function hasExplicitPolicyCameraSource(
  options: PolicyCameraFrameStreamOptions | undefined
) {
  return Boolean(
    options?.camera ||
    options?.position ||
    options?.quaternion ||
    options?.source
  );
}

export function createPolicyCameraFrameCapturePlan(
  options: CreatePolicyCameraFrameCapturePlanOptions
): PolicyCameraFrameCapturePlan {
  const {
    cameraKeys,
    defaults,
    streamOptions,
    includeObservationImageAliases,
    requireAll,
    ...sourceOptions
  } = options;
  const mountedPlan = createMountedCameraFrameSequencePlan(cameraKeys, {
    ...sourceOptions,
    defaults,
    cameraOptions: streamOptions as
      | Record<string, MountedCameraFrameSequenceCameraOptions>
      | undefined,
  });
  const streams: PolicyCameraFrameStream[] = [];
  const missingKeys = new Set(mountedPlan.missingKeys);

  for (const key of cameraKeys) {
    const perStreamOptions = streamOptions?.[key];
    if (hasExplicitPolicyCameraSource(perStreamOptions)) {
      missingKeys.delete(key);
      streams.push({
        ...defaults,
        ...perStreamOptions,
        key,
        aliases: perStreamOptions?.aliases,
      });
      continue;
    }

    const mountedCamera = mountedPlan.cameras.find((camera) => camera.key === key);
    if (!mountedCamera) continue;
    const { key: _mountedKey, ...captureOptions } = mountedCamera;
    streams.push({
      ...captureOptions,
      key,
      aliases: perStreamOptions?.aliases,
    });
  }

  const result: PolicyCameraFrameCapturePlan = {
    cameraKeys: [...cameraKeys],
    streams,
    includeObservationImageAliases,
    mountedPlan,
    missingKeys: [...missingKeys],
  };

  if (requireAll && result.missingKeys.length > 0) {
    throw new Error(
      `Unable to resolve policy camera stream${
        result.missingKeys.length === 1 ? '' : 's'
      } for ${result.missingKeys.join(', ')}.`
    );
  }

  return result;
}

export function createPolicyCameraFrameCapturePlanFromApi(
  api: PolicyCameraFramePlanTarget,
  options: Omit<CreatePolicyCameraFrameCapturePlanOptions, 'cameras' | 'sites' | 'bodies'>
): PolicyCameraFrameCapturePlan {
  return createPolicyCameraFrameCapturePlan({
    ...options,
    cameras: api.getCameras(),
    sites: api.getSites(),
    bodies: api.getBodies(),
  });
}

export async function capturePolicyCameraFrames(
  target: PolicyCameraFrameCaptureTarget,
  options: PolicyCameraFrameCaptureOptions
): Promise<PolicyCameraFrameCaptureResult> {
  const includeObservationImageAliases =
    options.includeObservationImageAliases ?? true;

  const entries = await Promise.all(
    options.streams.map(async ({ key, aliases, ...captureOptions }) => {
      const frame = await target.captureCameraFrame(captureOptions);
      return [key, { frame, aliases }] as const;
    })
  );

  const frames: Record<string, CameraFrameCaptureResult> = {};
  const images: Record<string, string> = {};
  const sourceParts: string[] = [];

  for (const [key, { frame, aliases }] of entries) {
    const stream = { key, aliases };
    frames[key] = frame;
    addPolicyImageAliases(
      images,
      stream,
      frame,
      includeObservationImageAliases
    );
    sourceParts.push(describeFrameSource(key, frame));
  }

  return {
    frames,
    images,
    sourceSummary: sourceParts.length > 0
      ? sourceParts.join(' + ')
      : 'not used by policy',
    capturedAt: Date.now(),
  };
}

export async function capturePolicyCameraFramesFromMountedStreams(
  target: PolicyCameraFrameCaptureTarget & PolicyCameraFramePlanTarget,
  options: Omit<CreatePolicyCameraFrameCapturePlanOptions, 'cameras' | 'sites' | 'bodies'>
): Promise<PolicyCameraFrameCaptureResult & { plan: PolicyCameraFrameCapturePlan }> {
  const plan = createPolicyCameraFrameCapturePlanFromApi(target, options);
  const result = await capturePolicyCameraFrames(target, plan);
  return { ...result, plan };
}
