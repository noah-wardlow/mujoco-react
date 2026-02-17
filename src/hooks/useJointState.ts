/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * useJointState — per-joint position/velocity access (spec 2.3)
 */

import { useEffect, useRef } from 'react';
import { useMujocoSim, useAfterPhysicsStep } from '../core/MujocoSimProvider';
import { getName } from '../core/SceneLoader';
import type { JointStateResult } from '../types';

/**
 * Track a MuJoCo joint's position and velocity by name.
 * Values are updated every physics frame via refs (no re-renders).
 *
 * For hinge/slide joints, position/velocity are scalar (stored as Float64Array of length 1).
 * For ball joints, position is quat (4), velocity is angular vel (3).
 * For free joints, position is pos+quat (7), velocity is lin+ang vel (6).
 */
export function useJointState(name: string): JointStateResult {
  const { mjModelRef, mjDataRef, status } = useMujocoSim();
  const jointIdRef = useRef(-1);
  const qposAdrRef = useRef(0);
  const dofAdrRef = useRef(0);
  const qposDimRef = useRef(1);
  const dofDimRef = useRef(1);
  const positionRef = useRef<number | Float64Array>(0);
  const velocityRef = useRef<number | Float64Array>(0);
  // Preallocated typed arrays for multi-DOF joints
  const posBufferRef = useRef<Float64Array | null>(null);
  const velBufferRef = useRef<Float64Array | null>(null);

  useEffect(() => {
    const model = mjModelRef.current;
    if (!model || status !== 'ready') return;
    for (let i = 0; i < model.njnt; i++) {
      if (getName(model, model.name_jntadr[i]) === name) {
        jointIdRef.current = i;
        qposAdrRef.current = model.jnt_qposadr[i];
        dofAdrRef.current = model.jnt_dofadr[i];
        const type = model.jnt_type[i];
        // Type 0=free (7 qpos, 6 dof), 1=ball (4 qpos, 3 dof), 2=slide (1,1), 3=hinge (1,1)
        if (type === 0) { qposDimRef.current = 7; dofDimRef.current = 6; }
        else if (type === 1) { qposDimRef.current = 4; dofDimRef.current = 3; }
        else { qposDimRef.current = 1; dofDimRef.current = 1; }

        // Preallocate buffers for multi-DOF joints
        if (qposDimRef.current > 1) {
          posBufferRef.current = new Float64Array(qposDimRef.current);
          velBufferRef.current = new Float64Array(dofDimRef.current);
        } else {
          posBufferRef.current = null;
          velBufferRef.current = null;
        }
        return;
      }
    }
    jointIdRef.current = -1;
  }, [name, status, mjModelRef]);

  useAfterPhysicsStep((_model, data) => {
    if (jointIdRef.current < 0) return;
    const qa = qposAdrRef.current;
    const da = dofAdrRef.current;
    if (qposDimRef.current === 1) {
      positionRef.current = data.qpos[qa];
      velocityRef.current = data.qvel[da];
    } else {
      const posBuf = posBufferRef.current!;
      const velBuf = velBufferRef.current!;
      posBuf.set(data.qpos.subarray(qa, qa + qposDimRef.current));
      velBuf.set(data.qvel.subarray(da, da + dofDimRef.current));
      positionRef.current = posBuf;
      velocityRef.current = velBuf;
    }
  });

  return { position: positionRef, velocity: velocityRef };
}
