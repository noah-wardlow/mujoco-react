/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as THREE from 'three';
import { MujocoModule, MujocoModel, MujocoData } from '../types';

export interface GenericIKOptions {
    maxIterations: number;
    damping: number;
    tolerance: number;
    /** @deprecated Analytic Jacobians do not require perturbations. */
    epsilon: number;
    posWeight: number;
    rotWeight: number;
    /** Per-iteration |Δq| cap in radians; bounds near-singular DLS steps. */
    maxStepRad: number;
    jointLimits?: ReadonlyArray<readonly [number, number] | null | undefined>;
}

type ResolvedGenericIKOptions = Required<Omit<GenericIKOptions, 'jointLimits'>> &
    Pick<GenericIKOptions, 'jointLimits'>;

const DEFAULTS: Required<Omit<GenericIKOptions, 'jointLimits'>> = {
    maxIterations: 50,
    damping: 0.01,
    tolerance: 1e-3,
    epsilon: 1e-6,
    posWeight: 1.0,
    rotWeight: 0.3,
    maxStepRad: 0.5,
};

function resolveOptions(opts?: Partial<GenericIKOptions>): ResolvedGenericIKOptions {
    return {
        maxIterations: opts?.maxIterations ?? DEFAULTS.maxIterations,
        damping: opts?.damping ?? DEFAULTS.damping,
        tolerance: opts?.tolerance ?? DEFAULTS.tolerance,
        epsilon: opts?.epsilon ?? DEFAULTS.epsilon,
        posWeight: opts?.posWeight ?? DEFAULTS.posWeight,
        rotWeight: opts?.rotWeight ?? DEFAULTS.rotWeight,
        maxStepRad: opts?.maxStepRad ?? DEFAULTS.maxStepRad,
        jointLimits: opts?.jointLimits,
    };
}

/** Analytic damped least-squares IK in MuJoCo velocity coordinates. */
export class GenericIK {
    constructor(private mujoco: MujocoModule) {}

    /** Scalar hinge/slide interface. Returns values in qposAdr order. */
    solve(
        model: MujocoModel,
        data: MujocoData,
        siteId: number,
        qposAdr: ArrayLike<number>,
        targetPos: Pick<THREE.Vector3, 'x' | 'y' | 'z'>,
        targetQuat: Pick<THREE.Quaternion, 'x' | 'y' | 'z' | 'w'>,
        currentQ: ArrayLike<number>,
        opts?: Partial<GenericIKOptions>,
    ): number[] | null {
        if (currentQ.length !== qposAdr.length) throw new Error('IK currentQ must match qposAdr length');
        const jointIds = Array.from(qposAdr, (adr) => {
            const id = Array.from({ length: model.njnt }, (_, i) => i).find(
                (i) => model.jnt_qposadr[i] === adr,
            );
            if (id === undefined || model.jnt_type[id] < 2) {
                throw new Error(
                    'Scalar IK requires hinge/slide qpos addresses; use solveJoints for ball/free joints',
                );
            }
            return id;
        });
        const initial = new Float64Array(data.qpos);
        for (let i = 0; i < qposAdr.length; i++) initial[qposAdr[i]] = currentQ[i];
        const result = this.solveJoints(model, data, siteId, jointIds, targetPos, targetQuat, initial, opts);
        return result ? Array.from(qposAdr, (adr) => result[adr]) : null;
    }

    /**
     * Solve selected joint IDs, including ball/free joints. Initial and returned
     * configurations have model.nq entries, with MuJoCo wxyz quaternions.
     * Jacobian columns use nv/dof addresses; mj_integratePos updates quaternions.
     * The caller's qpos is restored even if the solve throws.
     */
    solveJoints(
        model: MujocoModel,
        data: MujocoData,
        siteId: number,
        jointIds: ArrayLike<number>,
        targetPos: Pick<THREE.Vector3, 'x' | 'y' | 'z'>,
        targetQuat: Pick<THREE.Quaternion, 'x' | 'y' | 'z' | 'w'>,
        currentQpos: ArrayLike<number> = data.qpos,
        opts?: Partial<GenericIKOptions>,
    ): number[] | null {
        const o = resolveOptions(opts);
        const targetRotation = new THREE.Quaternion(targetQuat.x, targetQuat.y, targetQuat.z, targetQuat.w);
        if (!Number.isInteger(siteId) || siteId < 0 || siteId >= model.nsite)
            throw new Error('Invalid IK site ID');
        if (currentQpos.length !== model.nq || !Array.from(currentQpos).every(Number.isFinite))
            throw new Error('IK configuration must contain nq finite values');
        if (
            ![
                targetPos.x,
                targetPos.y,
                targetPos.z,
                targetQuat.x,
                targetQuat.y,
                targetQuat.z,
                targetQuat.w,
            ].every(Number.isFinite) ||
            targetRotation.lengthSq() === 0
        )
            throw new Error('IK target must be finite with a nonzero quaternion');
        if (
            !(o.damping > 0) ||
            !(o.maxStepRad > 0) ||
            !Number.isFinite(o.maxStepRad) ||
            !Number.isInteger(o.maxIterations) ||
            o.maxIterations < 1
        )
            throw new Error('Invalid IK solver options');
        const ids = Array.from(jointIds);
        if (
            new Set(ids).size !== ids.length ||
            ids.some((id) => !Number.isInteger(id) || id < 0 || id >= model.njnt)
        )
            throw new Error('IK joint IDs must be unique and valid');
        const dofs = ids.flatMap((id) =>
            Array.from(
                { length: model.jnt_type[id] === 0 ? 6 : model.jnt_type[id] === 1 ? 3 : 1 },
                (_, i) => model.jnt_dofadr[id] + i,
            ),
        );
        const n = dofs.length;
        if (!n) return null;
        const savedQpos = new Float64Array(data.qpos);
        const buffers: { delete(): void }[] = [];
        try {
            const alloc = (size: number) => {
                const b = new this.mujoco.DoubleBuffer(size);
                buffers.push(b);
                return b;
            };
            const jacp = alloc(3 * model.nv),
                jacr = alloc(3 * model.nv),
                qbuffer = alloc(model.nq);
            qbuffer.GetView().set(currentQpos);
            const target = quatToMat3(targetRotation.normalize());
            const J = new Float64Array(6 * n),
                JJt = new Float64Array(36),
                rhs = new Float64Array(6),
                x = new Float64Array(6);
            const velocity = new Array<number>(model.nv).fill(0);
            let best: number[] | null = null,
                bestErr = Infinity,
                noImprove = 0;
            const clamp = () => {
                const q = qbuffer.GetView();
                ids.forEach((id, i) => {
                    const adr = model.jnt_qposadr[id],
                        type = model.jnt_type[id];
                    if (type >= 2) {
                        const limits =
                            o.jointLimits?.[i] ??
                            (model.jnt_limited[id]
                                ? [model.jnt_range[2 * id], model.jnt_range[2 * id + 1]]
                                : null);
                        if (limits)
                            q[adr] = Math.max(Math.min(...limits), Math.min(Math.max(...limits), q[adr]));
                    } else {
                        const offset = adr + (type === 0 ? 3 : 0);
                        const quat = new THREE.Quaternion(
                            q[offset + 1],
                            q[offset + 2],
                            q[offset + 3],
                            q[offset],
                        ).normalize();
                        if (type === 1 && model.jnt_limited[id]) {
                            if (quat.w < 0) {
                                quat.x *= -1;
                                quat.y *= -1;
                                quat.z *= -1;
                                quat.w *= -1;
                            }
                            const angle = 2 * Math.acos(Math.min(1, Math.max(-1, quat.w)));
                            const limit = model.jnt_range[2 * id + 1];
                            if (angle > limit)
                                quat.identity().slerp(
                                    new THREE.Quaternion(
                                        q[offset + 1],
                                        q[offset + 2],
                                        q[offset + 3],
                                        q[offset],
                                    ).normalize(),
                                    limit / angle,
                                );
                        }
                        q.set([quat.w, quat.x, quat.y, quat.z], offset);
                    }
                });
            };
            clamp();
            for (let iter = 0; iter < o.maxIterations; iter++) {
                data.qpos.set(qbuffer.GetView());
                this.mujoco.mj_forward(model, data);
                const pos = data.site_xpos.subarray(3 * siteId, 3 * siteId + 3);
                const rot = orientationError(data.site_xmat.subarray(9 * siteId, 9 * siteId + 9), target);
                const error = [
                    (targetPos.x - pos[0]) * o.posWeight,
                    (targetPos.y - pos[1]) * o.posWeight,
                    (targetPos.z - pos[2]) * o.posWeight,
                    ...rot.map((v) => v * o.rotWeight),
                ];
                const norm = Math.hypot(...error);
                if (!Number.isFinite(norm)) break;
                if (norm < bestErr - 1e-9) {
                    bestErr = norm;
                    best = Array.from(qbuffer.GetView());
                    noImprove = 0;
                } else noImprove++;
                if (norm < o.tolerance || noImprove >= 4) break;
                this.mujoco.mj_jacSite(model, data, jacp, jacr, siteId);
                const jp = jacp.GetView(),
                    jr = jacr.GetView();
                for (let r = 0; r < 3; r++)
                    for (let j = 0; j < n; j++) {
                        J[r * n + j] = jp[r * model.nv + dofs[j]] * o.posWeight;
                        J[(r + 3) * n + j] = jr[r * model.nv + dofs[j]] * o.rotWeight;
                    }
                for (let r = 0; r < 6; r++)
                    for (let c = 0; c < 6; c++) {
                        let sum = 0;
                        for (let k = 0; k < n; k++) sum += J[r * n + k] * J[c * n + k];
                        JJt[r * 6 + c] = sum + (r === c ? o.damping : 0);
                    }
                rhs.set(error);
                solve6x6(JJt, rhs, x);
                velocity.fill(0);
                for (let j = 0; j < n; j++) {
                    let step = 0;
                    for (let r = 0; r < 6; r++) step += J[r * n + j] * x[r];
                    velocity[dofs[j]] = Math.max(-o.maxStepRad, Math.min(o.maxStepRad, step));
                }
                this.mujoco.mj_integratePos(model, qbuffer, velocity, 1);
                clamp();
            }
            return best;
        } finally {
            for (const buffer of buffers) buffer.delete();
            data.qpos.set(savedQpos);
            this.mujoco.mj_forward(model, data);
        }
    }
}

// --- Math utilities ---

/** Convert THREE.Quaternion to 3x3 rotation matrix (row-major Float64Array) */
function quatToMat3(q: THREE.Quaternion): Float64Array {
    const m = new Float64Array(9);
    const x = q.x,
        y = q.y,
        z = q.z,
        w = q.w;
    const xx = x * x,
        yy = y * y,
        zz = z * z;
    const xy = x * y,
        xz = x * z,
        yz = y * z;
    const wx = w * x,
        wy = w * y,
        wz = w * z;
    m[0] = 1 - 2 * (yy + zz);
    m[1] = 2 * (xy - wz);
    m[2] = 2 * (xz + wy);
    m[3] = 2 * (xy + wz);
    m[4] = 1 - 2 * (xx + zz);
    m[5] = 2 * (yz - wx);
    m[6] = 2 * (xz - wy);
    m[7] = 2 * (yz + wx);
    m[8] = 1 - 2 * (xx + yy);
    return m;
}

/**
 * Compute orientation error between current and target rotation matrices.
 * Returns the axis-angle vector (log map of R_target * R_current^T).
 * Uses the small-angle approximation: error ≈ 0.5 * [R32-R23, R13-R31, R21-R12]
 * where R = R_target * R_current^T.
 */
function orientationError(R_cur: Float64Array, R_tgt: Float64Array): [number, number, number] {
    // R_err = R_tgt * R_cur^T  (both row-major 3x3)
    // R_err[i][j] = sum_k R_tgt[i][k] * R_cur[j][k]  (note: transposing R_cur)
    const Re = new Float64Array(9);
    for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
            let s = 0;
            for (let k = 0; k < 3; k++) {
                s += R_tgt[i * 3 + k] * R_cur[j * 3 + k];
            }
            Re[i * 3 + j] = s;
        }
    }

    // Extract axis-angle from rotation matrix
    // For better accuracy than small-angle approx, use full log map
    const trace = Re[0] + Re[4] + Re[8];
    const cosAngle = Math.max(-1, Math.min(1, (trace - 1) * 0.5));
    const angle = Math.acos(cosAngle);

    // Near zero rotation — use small-angle approximation
    if (angle < 1e-6) {
        return [0, 0, 0];
    }

    // Quaternion extraction is well-conditioned at pi, where the skew vanishes.
    if (angle > Math.PI - 1e-4) {
        const matrix = new THREE.Matrix4().set(
            Re[0],
            Re[1],
            Re[2],
            0,
            Re[3],
            Re[4],
            Re[5],
            0,
            Re[6],
            Re[7],
            Re[8],
            0,
            0,
            0,
            0,
            1,
        );
        const q = new THREE.Quaternion().setFromRotationMatrix(matrix).normalize();
        const scale = (angle / Math.hypot(q.x, q.y, q.z)) * (q.w < 0 ? -1 : 1);
        return [q.x * scale, q.y * scale, q.z * scale];
    }

    // General case: axis = skew(R_err) / (2 sin(angle)), scaled by angle
    const s = angle / (2 * Math.sin(angle));
    return [s * (Re[7] - Re[5]), s * (Re[2] - Re[6]), s * (Re[3] - Re[1])];
}

/**
 * Solve 6×6 linear system Ax = b via Gaussian elimination with partial pivoting.
 * Modifies A and b in place. Result written to x.
 */
function solve6x6(A: Float64Array, b: Float64Array, x: Float64Array): void {
    const N = 6;
    // Work on copies to avoid destroying originals needed elsewhere
    const a = new Float64Array(A);
    const r = new Float64Array(b);

    // Forward elimination with partial pivoting
    for (let col = 0; col < N; col++) {
        // Find pivot
        let maxVal = Math.abs(a[col * N + col]);
        let maxRow = col;
        for (let row = col + 1; row < N; row++) {
            const val = Math.abs(a[row * N + col]);
            if (val > maxVal) {
                maxVal = val;
                maxRow = row;
            }
        }

        // Swap rows
        if (maxRow !== col) {
            for (let k = 0; k < N; k++) {
                const tmp = a[col * N + k];
                a[col * N + k] = a[maxRow * N + k];
                a[maxRow * N + k] = tmp;
            }
            const tmp = r[col];
            r[col] = r[maxRow];
            r[maxRow] = tmp;
        }

        const pivot = a[col * N + col];
        if (Math.abs(pivot) < 1e-12) {
            // Singular — return zeros
            x.fill(0);
            return;
        }

        // Eliminate below
        for (let row = col + 1; row < N; row++) {
            const factor = a[row * N + col] / pivot;
            for (let k = col; k < N; k++) {
                a[row * N + k] -= factor * a[col * N + k];
            }
            r[row] -= factor * r[col];
        }
    }

    // Back substitution
    for (let row = N - 1; row >= 0; row--) {
        let sum = r[row];
        for (let k = row + 1; k < N; k++) {
            sum -= a[row * N + k] * x[k];
        }
        x[row] = sum / a[row * N + row];
    }
}
