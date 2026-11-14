/** @license SPDX-License-Identifier: Apache-2.0 */

// GPU readback supplies bytes: compute the exact existing transfer function
// once per possible input, instead of exponentiating every captured channel.
const linearToSrgb = Uint8Array.from({ length: 256 }, (_, value) => {
  const normalized = value / 255;
  const encoded = normalized <= 0.0031308
    ? normalized * 12.92
    : 1.055 * Math.pow(normalized, 1 / 2.4) - 0.055;
  return Math.min(255, Math.max(0, Math.round(encoded * 255)));
});

export function linearByteToSrgbByte(value: number): number {
  return linearToSrgb[value];
}
