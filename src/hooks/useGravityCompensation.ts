/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useBeforePhysicsStep } from '../core/MujocoSimProvider';

/**
 * Applies gravity compensation each physics frame by adding qfrc_bias
 * (gravity + Coriolis forces) to qfrc_applied for each DOF.
 *
 * The provider zeros qfrc_applied at the start of each frame, so this
 * hook (and DragInteraction) compose correctly — both add to a clean slate.
 */
export function useGravityCompensation(enabled = true): void {
  useBeforePhysicsStep((model, data) => {
    if (!enabled) return;
    for (let i = 0; i < model.nv; i++) {
      data.qfrc_applied[i] += data.qfrc_bias[i];
    }
  });
}
