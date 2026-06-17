/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Helpers for resolving dataset camera streams to mounted MuJoCo resources.
 */

import type {
  Bodies,
  CameraFrameCaptureOptions,
  CameraFrameCaptureSource,
  CameraFrameSequenceCamera,
  CameraFrameSequenceOptions,
  CameraFrameSequenceResult,
  Cameras,
  MujocoSimAPI,
  Sites,
} from '../types';

export type MountedCameraFrameCaptureSource = Extract<
  CameraFrameCaptureSource,
  | { kind: 'mujoco-camera' }
  | { kind: 'mujoco-site' }
  | { kind: 'mujoco-body' }
>;

export type CameraFrameMountSelector =
  | { cameraName: Cameras; siteName?: never; bodyName?: never }
  | { siteName: Sites; cameraName?: never; bodyName?: never }
  | { bodyName: Bodies; cameraName?: never; siteName?: never };

export interface NamedCameraFrameResource {
  name: string | null | undefined;
}

export interface ResolveMountedCameraFrameSourceOptions {
  cameras?: readonly (Cameras | NamedCameraFrameResource | null | undefined)[];
  sites?: readonly (Sites | NamedCameraFrameResource | null | undefined)[];
  bodies?: readonly (Bodies | NamedCameraFrameResource | null | undefined)[];
  aliases?: Record<
    string,
    CameraFrameMountSelector | readonly CameraFrameMountSelector[]
  >;
  /**
   * Accept the first valid alias selector even when the current resource
   * inventory cannot verify it. This is useful when aliases come from a
   * previously validated model inventory and the actual provider will validate
   * again during capture.
   */
  allowAliasFallback?: boolean;
}

export interface ResolvedMountedCameraFrameSource {
  key: string;
  selector: CameraFrameMountSelector;
  source: MountedCameraFrameCaptureSource;
}

export const MountedCameraFrameSourceSuggestionMatch = {
  Direct: 'direct',
  Alias: 'alias',
  Normalized: 'normalized',
  Prefix: 'prefix',
  Suffix: 'suffix',
} as const;

export type MountedCameraFrameSourceSuggestionMatch =
  (typeof MountedCameraFrameSourceSuggestionMatch)[keyof typeof MountedCameraFrameSourceSuggestionMatch];

export interface MountedCameraFrameSourceSuggestion {
  key: string;
  selector: CameraFrameMountSelector;
  source: MountedCameraFrameCaptureSource;
  resourceName: string;
  resourceKind: MountedCameraFrameCaptureSource['kind'];
  match: MountedCameraFrameSourceSuggestionMatch;
}

export type MountedCameraFrameSequenceDefaults = Omit<
  CameraFrameSequenceCamera,
  'key' | 'cameraName' | 'siteName' | 'bodyName' | 'source'
>;

export type MountedCameraFrameSequenceCameraOptions = Partial<
  MountedCameraFrameSequenceDefaults
>;

export interface CreateMountedCameraFrameSequencePlanOptions
  extends ResolveMountedCameraFrameSourceOptions {
  defaults?: MountedCameraFrameSequenceDefaults;
  cameraOptions?: Record<string, MountedCameraFrameSequenceCameraOptions>;
  requireAll?: boolean;
}

export interface MountedCameraFrameSequencePlan {
  cameraKeys: string[];
  cameras: CameraFrameSequenceCamera[];
  resolved: Record<string, ResolvedMountedCameraFrameSource>;
  missingKeys: string[];
}

export const MountedCameraFrameSequenceReadinessStatus = {
  Ready: 'ready',
  Partial: 'partial',
  Missing: 'missing',
} as const;

export type MountedCameraFrameSequenceReadinessStatus =
  (typeof MountedCameraFrameSequenceReadinessStatus)[keyof typeof MountedCameraFrameSequenceReadinessStatus];

export interface MountedCameraFrameSequenceSourceReadiness {
  key: string;
  ready: boolean;
  selector?: CameraFrameMountSelector;
  source?: MountedCameraFrameCaptureSource;
  message: string;
}

export interface MountedCameraFrameSequenceReadiness {
  ready: boolean;
  status: MountedCameraFrameSequenceReadinessStatus;
  cameraKeys: string[];
  resolvedKeys: string[];
  missingKeys: string[];
  cameras: Record<string, MountedCameraFrameSequenceSourceReadiness>;
  message: string;
}

export type MountedCameraFrameSequencePlanOptions = Omit<
  CreateMountedCameraFrameSequencePlanOptions,
  'cameras' | 'sites' | 'bodies'
>;

export interface MountedCameraFrameSequenceRecordOptions
  extends Omit<CameraFrameSequenceOptions, 'cameras'>,
    MountedCameraFrameSequencePlanOptions {
  cameraKeys: readonly string[];
}

export interface MountedCameraFrameSequenceRecordResult
  extends CameraFrameSequenceResult {
  plan: MountedCameraFrameSequencePlan;
  readiness: MountedCameraFrameSequenceReadiness;
}

export type MountedCameraFrameSequenceRecorderTarget = Pick<
  MujocoSimAPI,
  'getCameras' | 'getSites' | 'getBodies' | 'recordCameraSequence'
>;

function getResourceName(
  resource: string | NamedCameraFrameResource | null | undefined
) {
  if (!resource) return null;
  return typeof resource === 'string' ? resource : resource.name ?? null;
}

function createNameSet(
  resources:
    | readonly (string | NamedCameraFrameResource | null | undefined)[]
    | undefined
) {
  return new Set(
    (resources ?? [])
      .map((resource) => getResourceName(resource))
      .filter((name): name is string => Boolean(name))
  );
}

function createResourceNames(
  resources:
    | readonly (string | NamedCameraFrameResource | null | undefined)[]
    | undefined
) {
  return (resources ?? [])
    .map((resource) => getResourceName(resource))
    .filter((name): name is string => Boolean(name));
}

function normalizeAliasCandidates(
  value: CameraFrameMountSelector | readonly CameraFrameMountSelector[] | undefined
) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function countMountedSelectors(selector: CameraFrameMountSelector) {
  return Number(Boolean(selector.cameraName)) +
    Number(Boolean(selector.siteName)) +
    Number(Boolean(selector.bodyName));
}

function normalizeCameraSourceName(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function getSelectorKey(selector: CameraFrameMountSelector) {
  if (selector.cameraName) return `camera:${selector.cameraName}`;
  if (selector.siteName) return `site:${selector.siteName}`;
  if (selector.bodyName) return `body:${selector.bodyName}`;
  return null;
}

export function getMountedCameraFrameCaptureSource(
  selector: CameraFrameMountSelector
): MountedCameraFrameCaptureSource | null {
  if (countMountedSelectors(selector) !== 1) return null;
  if (selector.cameraName) {
    return { kind: 'mujoco-camera', cameraName: selector.cameraName };
  }
  if (selector.siteName) {
    return { kind: 'mujoco-site', siteName: selector.siteName };
  }
  if (selector.bodyName) {
    return { kind: 'mujoco-body', bodyName: selector.bodyName };
  }
  return null;
}

export function isMountedCameraFrameCaptureSource(
  source: CameraFrameCaptureSource
): source is MountedCameraFrameCaptureSource {
  return (
    source.kind === 'mujoco-camera' ||
    source.kind === 'mujoco-site' ||
    source.kind === 'mujoco-body'
  );
}

export function getCameraFrameCaptureSourceTarget(
  source: CameraFrameCaptureSource
) {
  if (source.kind === 'mujoco-camera') return source.cameraName;
  if (source.kind === 'mujoco-site') return source.siteName;
  if (source.kind === 'mujoco-body') return source.bodyName;
  if (source.kind === 'custom-camera') return 'custom camera';
  if (source.kind === 'explicit-pose') return 'explicit pose';
  return 'fallback camera';
}

function createMountedCameraFrameSourceSuggestion(
  key: string,
  selector: CameraFrameMountSelector,
  resourceName: string,
  match: MountedCameraFrameSourceSuggestionMatch
): MountedCameraFrameSourceSuggestion | null {
  const source = getMountedCameraFrameCaptureSource(selector);
  if (!source) return null;
  return {
    key,
    selector,
    source,
    resourceName,
    resourceKind: source.kind,
    match,
  };
}

function addMountedCameraFrameSourceSuggestion(
  suggestions: MountedCameraFrameSourceSuggestion[],
  seen: Set<string>,
  suggestion: MountedCameraFrameSourceSuggestion | null
) {
  if (!suggestion) return;
  const selectorKey = getSelectorKey(suggestion.selector);
  if (!selectorKey || seen.has(selectorKey)) return;
  seen.add(selectorKey);
  suggestions.push(suggestion);
}

function getCameraFrameResourceMatch(
  key: string,
  resourceName: string
): MountedCameraFrameSourceSuggestionMatch | null {
  if (resourceName === key) return MountedCameraFrameSourceSuggestionMatch.Direct;

  const normalizedKey = normalizeCameraSourceName(key);
  const normalizedResource = normalizeCameraSourceName(resourceName);
  if (!normalizedKey || !normalizedResource) return null;
  if (normalizedResource === normalizedKey) {
    return MountedCameraFrameSourceSuggestionMatch.Normalized;
  }
  if (normalizedResource.startsWith(`${normalizedKey}_`)) {
    return MountedCameraFrameSourceSuggestionMatch.Prefix;
  }
  if (normalizedResource.endsWith(`_${normalizedKey}`)) {
    return MountedCameraFrameSourceSuggestionMatch.Suffix;
  }
  return null;
}

function isSelectorMounted(
  selector: CameraFrameMountSelector,
  cameraNames: Set<string>,
  siteNames: Set<string>,
  bodyNames: Set<string>
) {
  if (countMountedSelectors(selector) !== 1) return false;
  return (
    (selector.cameraName ? cameraNames.has(selector.cameraName) : false) ||
    (selector.siteName ? siteNames.has(selector.siteName) : false) ||
    (selector.bodyName ? bodyNames.has(selector.bodyName) : false)
  );
}

export function createMountedCameraFrameSourceSuggestions(
  key: string,
  options: ResolveMountedCameraFrameSourceOptions
): MountedCameraFrameSourceSuggestion[] {
  const cameraNames = createNameSet(options.cameras);
  const siteNames = createNameSet(options.sites);
  const bodyNames = createNameSet(options.bodies);
  const suggestions: MountedCameraFrameSourceSuggestion[] = [];
  const seen = new Set<string>();

  for (const selector of normalizeAliasCandidates(options.aliases?.[key])) {
    if (!isSelectorMounted(selector, cameraNames, siteNames, bodyNames)) {
      continue;
    }
    const source = getMountedCameraFrameCaptureSource(selector);
    if (!source) continue;
    addMountedCameraFrameSourceSuggestion(
      suggestions,
      seen,
      createMountedCameraFrameSourceSuggestion(
        key,
        selector,
        getCameraFrameCaptureSourceTarget(source),
        MountedCameraFrameSourceSuggestionMatch.Alias
      )
    );
  }

  for (const cameraName of createResourceNames(options.cameras)) {
    const match = getCameraFrameResourceMatch(key, cameraName);
    if (!match) continue;
    addMountedCameraFrameSourceSuggestion(
      suggestions,
      seen,
      createMountedCameraFrameSourceSuggestion(
        key,
        { cameraName },
        cameraName,
        match
      )
    );
  }

  for (const siteName of createResourceNames(options.sites)) {
    const match = getCameraFrameResourceMatch(key, siteName);
    if (!match) continue;
    addMountedCameraFrameSourceSuggestion(
      suggestions,
      seen,
      createMountedCameraFrameSourceSuggestion(
        key,
        { siteName },
        siteName,
        match
      )
    );
  }

  for (const bodyName of createResourceNames(options.bodies)) {
    const match = getCameraFrameResourceMatch(key, bodyName);
    if (!match) continue;
    addMountedCameraFrameSourceSuggestion(
      suggestions,
      seen,
      createMountedCameraFrameSourceSuggestion(
        key,
        { bodyName },
        bodyName,
        match
      )
    );
  }

  return suggestions;
}

export function resolveMountedCameraFrameSource(
  key: string,
  options: ResolveMountedCameraFrameSourceOptions
): ResolvedMountedCameraFrameSource | null {
  const cameraNames = createNameSet(options.cameras);
  const siteNames = createNameSet(options.sites);
  const bodyNames = createNameSet(options.bodies);
  const directCandidates: CameraFrameMountSelector[] = [
    { cameraName: key },
    { siteName: key },
    { bodyName: key },
  ];
  const aliasCandidates = normalizeAliasCandidates(options.aliases?.[key]);
  const candidates = [...directCandidates, ...aliasCandidates];

  for (const selector of candidates) {
    if (!isSelectorMounted(selector, cameraNames, siteNames, bodyNames)) {
      continue;
    }
    const source = getMountedCameraFrameCaptureSource(selector);
    if (!source) continue;
    return { key, selector, source };
  }

  const [suggestion] = createMountedCameraFrameSourceSuggestions(key, options);
  if (suggestion) {
    return {
      key,
      selector: suggestion.selector,
      source: suggestion.source,
    };
  }

  if (options.allowAliasFallback) {
    for (const selector of aliasCandidates) {
      const source = getMountedCameraFrameCaptureSource(selector);
      if (!source) continue;
      return { key, selector, source };
    }
  }

  return null;
}

export function createMountedCameraFrameSequencePlan(
  cameraKeys: readonly string[],
  options: CreateMountedCameraFrameSequencePlanOptions
): MountedCameraFrameSequencePlan {
  const cameras: CameraFrameSequenceCamera[] = [];
  const resolved: Record<string, ResolvedMountedCameraFrameSource> = {};
  const missingKeys: string[] = [];

  for (const key of cameraKeys) {
    const mountedSource = resolveMountedCameraFrameSource(key, options);
    if (!mountedSource) {
      missingKeys.push(key);
      continue;
    }

    resolved[key] = mountedSource;
    cameras.push({
      key,
      ...options.defaults,
      ...options.cameraOptions?.[key],
      ...mountedSource.selector,
      source: mountedSource.source,
    });
  }

  if (options.requireAll && missingKeys.length > 0) {
    throw new Error(
      `Unable to resolve mounted MuJoCo camera source${
        missingKeys.length === 1 ? '' : 's'
      } for ${missingKeys.join(', ')}.`
    );
  }

  return {
    cameraKeys: [...cameraKeys],
    cameras,
    resolved,
    missingKeys,
  };
}

export function createMountedCameraFrameSequenceReadiness(
  plan: MountedCameraFrameSequencePlan
): MountedCameraFrameSequenceReadiness {
  const cameras: Record<string, MountedCameraFrameSequenceSourceReadiness> = {};
  const resolvedKeys = plan.cameraKeys.filter((key) => Boolean(plan.resolved[key]));

  for (const key of plan.cameraKeys) {
    const resolved = plan.resolved[key];
    cameras[key] = resolved
      ? {
          key,
          ready: true,
          selector: resolved.selector,
          source: resolved.source,
          message: `Camera stream "${key}" resolves to ${resolved.source.kind}:${getCameraFrameCaptureSourceTarget(resolved.source)}.`,
        }
      : {
          key,
          ready: false,
          message: `Camera stream "${key}" does not resolve to a mounted MuJoCo camera, site, or body.`,
        };
  }

  const missingKeys = [...plan.missingKeys];
  const ready = missingKeys.length === 0;
  const status: MountedCameraFrameSequenceReadinessStatus = ready
    ? MountedCameraFrameSequenceReadinessStatus.Ready
    : resolvedKeys.length > 0
      ? MountedCameraFrameSequenceReadinessStatus.Partial
      : MountedCameraFrameSequenceReadinessStatus.Missing;

  return {
    ready,
    status,
    cameraKeys: [...plan.cameraKeys],
    resolvedKeys,
    missingKeys,
    cameras,
    message: ready
      ? `All ${plan.cameraKeys.length} requested camera stream${
          plan.cameraKeys.length === 1 ? '' : 's'
        } resolve to mounted MuJoCo sources.`
      : `Missing mounted MuJoCo source${
          missingKeys.length === 1 ? '' : 's'
        } for ${missingKeys.join(', ')}.`,
  };
}

export function createMountedCameraFrameSequencePlanFromApi(
  api: MountedCameraFrameSequenceRecorderTarget,
  cameraKeys: readonly string[],
  options: MountedCameraFrameSequencePlanOptions = {}
): MountedCameraFrameSequencePlan {
  return createMountedCameraFrameSequencePlan(cameraKeys, {
    ...options,
    cameras: api.getCameras(),
    sites: api.getSites(),
    bodies: api.getBodies(),
  });
}

export async function recordMountedCameraFrameSequence(
  api: MountedCameraFrameSequenceRecorderTarget,
  options: MountedCameraFrameSequenceRecordOptions
): Promise<MountedCameraFrameSequenceRecordResult> {
  const { cameraKeys, ...restOptions } = options;
  const requireAll =
    restOptions.requireAll ?? restOptions.requireMountedSources ?? true;
  const plan = createMountedCameraFrameSequencePlanFromApi(
    api,
    cameraKeys,
    { ...restOptions, requireAll }
  );
  const readiness = createMountedCameraFrameSequenceReadiness(plan);
  const result = await api.recordCameraSequence({
    ...restOptions,
    cameras: plan.cameras,
    requireMountedSources: restOptions.requireMountedSources ?? true,
  });

  return {
    ...result,
    plan,
    readiness,
  };
}
