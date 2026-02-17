/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * SceneLights — auto-create Three.js lights from MJCF <light> elements (spec 6.3)
 *
 * WASM fields used: model.nlight, light_pos, light_dir, light_diffuse,
 * light_specular, light_active, light_type, light_castshadow,
 * light_attenuation, light_cutoff, light_exponent, light_intensity
 *
 * light_type: 0 = directional, 1 = spot (maps to mjLIGHT_DIRECTIONAL/mjLIGHT_SPOT)
 * Note: light_directional does NOT exist in WASM — use light_type instead.
 */

import { useSceneLights } from '../hooks/useSceneLights';
import type { SceneLightsProps } from '../types';

export function SceneLights({ intensity = 1.0 }: SceneLightsProps) {
  useSceneLights(intensity);
  return null;
}
