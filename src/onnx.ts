/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Optional ONNX Runtime Web helpers for browser policy demos.
 *
 * This entry point is exported as `mujoco-react/onnx` so the main package does
 * not import or bundle `onnxruntime-web`.
 */

import type * as ort from 'onnxruntime-web';
import type { PolicyActionChunk } from './types';

export type OnnxPolicyDtype = 'float32' | 'float64' | 'int32' | 'int64' | 'bool' | string;

export interface OnnxPolicyTensorSpec {
  name: string;
  shape: number[];
  dtype: OnnxPolicyDtype;
}

export interface OnnxPolicyImageSpec {
  width: number;
  height: number;
  channels?: number;
  layout?: 'CHW' | 'HWC' | string;
  range?: readonly [number, number];
}

export interface OnnxPolicyManifest {
  model: string;
  variants?: Record<string, string>;
  fps?: number;
  joints?: string[];
  cameras?: string[];
  image?: OnnxPolicyImageSpec;
  chunk_size?: number;
  n_action_steps?: number;
  inputs: OnnxPolicyTensorSpec[];
  output: OnnxPolicyTensorSpec & {
    units?: string;
  };
  [key: string]: unknown;
}

export interface LoadOnnxPolicyManifestResult<TManifest extends OnnxPolicyManifest = OnnxPolicyManifest> {
  manifest: TManifest;
  manifestUrl: URL;
  modelUrl: URL;
}

export interface CreateOnnxPolicySessionOptions<TManifest extends OnnxPolicyManifest = OnnxPolicyManifest> {
  manifestUrl: string | URL;
  variant?: string;
  runtime: typeof ort;
  sessionOptions?: ort.InferenceSession.SessionOptions;
  fetcher?: typeof fetch;
  readManifest?: (response: Response) => Promise<TManifest>;
}

export interface OnnxPolicySession<TManifest extends OnnxPolicyManifest = OnnxPolicyManifest>
  extends LoadOnnxPolicyManifestResult<TManifest> {
  session: ort.InferenceSession;
}

function asUrl(value: string | URL, base = globalThis.location?.href) {
  return value instanceof URL ? value : new URL(value, base);
}

function resolveModelPath(manifest: OnnxPolicyManifest, variant: string | undefined) {
  if (variant && manifest.variants?.[variant]) return manifest.variants[variant];
  return manifest.model;
}

export async function loadOnnxPolicyManifest<TManifest extends OnnxPolicyManifest = OnnxPolicyManifest>(
  manifestUrlInput: string | URL,
  options: Pick<CreateOnnxPolicySessionOptions<TManifest>, 'variant' | 'fetcher' | 'readManifest'> = {}
): Promise<LoadOnnxPolicyManifestResult<TManifest>> {
  const fetcher = options.fetcher ?? fetch;
  const manifestUrl = asUrl(manifestUrlInput);
  const response = await fetcher(manifestUrl);
  if (!response.ok) {
    throw new Error(`Unable to load ONNX policy manifest from ${manifestUrl.href} (${response.status}).`);
  }
  const manifest = options.readManifest
    ? await options.readManifest(response)
    : await response.json() as TManifest;
  const modelPath = resolveModelPath(manifest, options.variant);
  const modelUrl = asUrl(modelPath, manifestUrl.href);
  return { manifest, manifestUrl, modelUrl };
}

export async function createOnnxPolicySession<TManifest extends OnnxPolicyManifest = OnnxPolicyManifest>(
  options: CreateOnnxPolicySessionOptions<TManifest>
): Promise<OnnxPolicySession<TManifest>> {
  const fetcher = options.fetcher ?? fetch;
  const resolved = await loadOnnxPolicyManifest(options.manifestUrl, options);
  const response = await fetcher(resolved.modelUrl);
  if (!response.ok) {
    throw new Error(`Unable to load ONNX policy model from ${resolved.modelUrl.href} (${response.status}).`);
  }
  const modelBytes = await response.arrayBuffer();
  const session = await options.runtime.InferenceSession.create(modelBytes, options.sessionOptions);
  return {
    ...resolved,
    session,
  };
}

export function onnxTensorToPolicyActionChunk(
  tensor: ort.Tensor,
  actionSize = tensor.dims.at(-1) ?? 1,
  maxActions?: number
): PolicyActionChunk {
  const rawData = Array.from(tensor.data as ArrayLike<number>, (value) => Number(value));
  const actionCount = Math.floor(rawData.length / actionSize);
  const cappedActionCount = maxActions === undefined
    ? actionCount
    : Math.max(0, Math.min(actionCount, Math.floor(maxActions)));
  const actions: number[][] = [];
  for (let actionIndex = 0; actionIndex < cappedActionCount; actionIndex += 1) {
    const start = actionIndex * actionSize;
    actions.push(rawData.slice(start, start + actionSize));
  }
  return actions;
}
