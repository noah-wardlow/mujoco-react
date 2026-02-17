/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * SelectionHighlight — highlight a selected body with emissive color (spec 6.5)
 */

import { useSelectionHighlight } from '../hooks/useSelectionHighlight';
import type { SelectionHighlightProps } from '../types';

/**
 * Applies emissive highlight to all meshes belonging to a body.
 * Restores original emissive when bodyId changes or component unmounts.
 */
export function SelectionHighlight({
  bodyId,
  color = '#ff4444',
  emissiveIntensity = 0.3,
}: SelectionHighlightProps) {
  useSelectionHighlight(bodyId, { color, emissiveIntensity });
  return null;
}
