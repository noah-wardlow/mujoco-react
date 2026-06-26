/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Helpers for turning browser camera captures into policy image tensors.
 */

export type PolicyImageTensorLayout = 'CHW' | 'HWC';
export type PolicyImageTensorRange = readonly [number, number];
/**
 * Row order of a raw pixel buffer. WebGL `readRenderTargetPixels` returns rows
 * bottom-to-top (`'bottom-left'`); `ImageData` is top-to-bottom (`'top-left'`).
 */
export type PolicyImageTensorSourceOrigin = 'top-left' | 'bottom-left';

export interface PolicyImageTensorOptions {
  width: number;
  height: number;
  channels?: 3 | 4;
  layout?: PolicyImageTensorLayout;
  range?: PolicyImageTensorRange;
}

export interface PolicyImageTensorPixelOptions extends PolicyImageTensorOptions {
  /** Row order of the source buffer. Defaults to `'top-left'`. */
  sourceOrigin?: PolicyImageTensorSourceOrigin;
  /** Mirror horizontally while reading. */
  flipX?: boolean;
}

export interface PolicyImageTensorResult {
  data: Float32Array;
  shape: [number, number, number];
  width: number;
  height: number;
  channels: 3 | 4;
  layout: PolicyImageTensorLayout;
  range: PolicyImageTensorRange;
}

function resolveTensorOptions(options: PolicyImageTensorOptions): Required<PolicyImageTensorOptions> {
  return {
    channels: 3,
    layout: 'CHW',
    range: [0, 1],
    ...options,
  };
}

function normalizeChannel(value: number, range: PolicyImageTensorRange) {
  const [min, max] = range;
  if (min === 0 && max === 255) return value;
  return min + (value / 255) * (max - min);
}

/**
 * Convert a raw RGBA pixel buffer (4 bytes per pixel) directly into a policy
 * image tensor. This is the fast path that skips canvas encoding entirely —
 * feed it the `Uint8Array` returned by `readRenderTargetPixels` (which is
 * bottom-left origin, so pass `sourceOrigin: 'bottom-left'`).
 */
export function pixelsToPolicyImageTensor(
  pixels: Uint8Array | Uint8ClampedArray,
  options: PolicyImageTensorPixelOptions
): PolicyImageTensorResult {
  const resolved = resolveTensorOptions(options);
  const { width, height, channels, layout, range } = resolved;
  const expected = width * height * 4;
  if (pixels.length < expected) {
    throw new Error(
      `Pixel buffer of length ${pixels.length} is too small for ${width}x${height} RGBA data (${expected} bytes).`
    );
  }

  const flipY = options.sourceOrigin === 'bottom-left';
  const flipX = options.flipX ?? false;
  const pixelCount = width * height;
  const data = new Float32Array(pixelCount * channels);

  for (let y = 0; y < height; y += 1) {
    const sourceY = flipY ? height - y - 1 : y;
    for (let x = 0; x < width; x += 1) {
      const sourceX = flipX ? width - x - 1 : x;
      const source = (sourceY * width + sourceX) * 4;
      const target = y * width + x;
      for (let channel = 0; channel < channels; channel += 1) {
        const value = normalizeChannel(pixels[source + channel], range);
        if (layout === 'CHW') {
          data[channel * pixelCount + target] = value;
        } else {
          data[target * channels + channel] = value;
        }
      }
    }
  }

  return {
    data,
    shape: layout === 'CHW' ? [channels, height, width] : [height, width, channels],
    width,
    height,
    channels,
    layout,
    range,
  };
}

export function imageDataToPolicyImageTensor(
  imageData: ImageData,
  options: PolicyImageTensorOptions
): PolicyImageTensorResult {
  const resolved = resolveTensorOptions(options);
  if (imageData.width !== resolved.width || imageData.height !== resolved.height) {
    throw new Error(
      `ImageData size ${imageData.width}x${imageData.height} does not match tensor size ${resolved.width}x${resolved.height}.`
    );
  }
  return pixelsToPolicyImageTensor(imageData.data, {
    ...resolved,
    sourceOrigin: 'top-left',
  });
}

async function decodeImageSource(dataUrl: string) {
  const image = new Image();
  image.decoding = 'async';
  image.src = dataUrl;
  await image.decode();
  return image;
}

export async function dataUrlToPolicyImageTensor(
  dataUrl: string,
  options: PolicyImageTensorOptions
): Promise<PolicyImageTensorResult> {
  const resolved = resolveTensorOptions(options);
  const image = await decodeImageSource(dataUrl);
  const canvas = document.createElement('canvas');
  canvas.width = resolved.width;
  canvas.height = resolved.height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) {
    throw new Error('Unable to create a 2D canvas context for policy image tensor conversion.');
  }
  context.drawImage(image, 0, 0, resolved.width, resolved.height);
  return imageDataToPolicyImageTensor(
    context.getImageData(0, 0, resolved.width, resolved.height),
    resolved
  );
}
