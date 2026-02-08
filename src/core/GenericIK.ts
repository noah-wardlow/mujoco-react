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
    epsilon: number;
    posWeight: number;
    rotWeight: number;
}

const DEFAULTS: GenericIKOptions = {
    maxIterations: 50,
    damping: 0.01,
    tolerance: 1e-3,
    epsilon: 1e-6,
    posWeight: 1.0,
    rotWeight: 0.3,
};

/**
 * Generic Damped Least-Squares IK solver.
 * Uses finite-difference Jacobian via MuJoCo's mj_forward.
 * Works for any MuJoCo model — no robot-specific parameters.
 */
export class GenericIK {
    private mujoco: MujocoModule;

    constructor(mujoco: MujocoModule) {
        this.mujoco = mujoco;
    }

    /**
     * Solve IK for a target 6-DOF pose.
     * @param model       MuJoCo model
     * @param data        MuJoCo data (qpos will be temporarily modified, then restored)
     * @param siteId      Index of the end-effector site to control
     * @param numJoints   Number of arm joints (assumes qpos[0..numJoints-1])
     * @param targetPos   Target position in world frame
     * @param targetQuat  Target orientation in world frame
     * @param currentQ    Current joint angles (length = numJoints)
     * @param opts        Optional solver parameters
     * @returns Joint angles array, or null if solver diverged
     */
    solve(
        model: MujocoModel,
        data: MujocoData,
        siteId: number,
        numJoints: number,
        targetPos: THREE.Vector3,
        targetQuat: THREE.Quaternion,
        currentQ: number[],
        opts?: Partial<GenericIKOptions>
    ): number[] | null {
        const o = { ...DEFAULTS, ...opts };
        const n = numJoints;

        // Save full qpos so we can restore after solving
        const savedQpos = new Float64Array(data.qpos.length);
        savedQpos.set(data.qpos);

        // Build target rotation matrix (3x3 row-major)
        const R_target = quatToMat3(targetQuat);

        // Working joint angles — start from current configuration
        const q = new Float64Array(n);
        for (let i = 0; i < n; i++) q[i] = currentQ[i];

        // Pre-allocate work arrays
        const J = new Float64Array(6 * n);       // 6×n Jacobian (row-major)
        const JJt = new Float64Array(36);         // 6×6
        const rhs = new Float64Array(6);          // right-hand side
        const x = new Float64Array(6);            // solve result
        const dq = new Float64Array(n);           // joint update
        const baseSitePos = new Float64Array(3);
        const baseSiteMat = new Float64Array(9);
        const pertSitePos = new Float64Array(3);
        const pertSiteMat = new Float64Array(9);

        let bestQ: number[] | null = null;
        let bestErr = Infinity;

        for (let iter = 0; iter < o.maxIterations; iter++) {
            // Set joints and run FK
            for (let i = 0; i < n; i++) data.qpos[i] = q[i];
            this.mujoco.mj_forward(model, data);

            // Read current site pose
            const sp = data.site_xpos;
            const sm = data.site_xmat;
            const off3 = siteId * 3;
            const off9 = siteId * 9;
            for (let i = 0; i < 3; i++) baseSitePos[i] = sp[off3 + i];
            for (let i = 0; i < 9; i++) baseSiteMat[i] = sm[off9 + i];

            // Compute 6D error
            const posErr0 = targetPos.x - baseSitePos[0];
            const posErr1 = targetPos.y - baseSitePos[1];
            const posErr2 = targetPos.z - baseSitePos[2];
            const rotErr = orientationError(baseSiteMat, R_target);

            const error = [
                posErr0 * o.posWeight,
                posErr1 * o.posWeight,
                posErr2 * o.posWeight,
                rotErr[0] * o.rotWeight,
                rotErr[1] * o.rotWeight,
                rotErr[2] * o.rotWeight,
            ];

            const errNorm = Math.sqrt(
                error[0] * error[0] + error[1] * error[1] + error[2] * error[2] +
                error[3] * error[3] + error[4] * error[4] + error[5] * error[5]
            );

            // Track best solution
            if (errNorm < bestErr) {
                bestErr = errNorm;
                bestQ = Array.from(q);
            }

            // Converged
            if (errNorm < o.tolerance) break;

            // Compute Jacobian via finite differences
            for (let j = 0; j < n; j++) {
                const saved = data.qpos[j];
                data.qpos[j] = q[j] + o.epsilon;
                this.mujoco.mj_forward(model, data);

                for (let i = 0; i < 3; i++) pertSitePos[i] = sp[off3 + i];
                for (let i = 0; i < 9; i++) pertSiteMat[i] = sm[off9 + i];

                // Position Jacobian columns (rows 0-2)
                J[0 * n + j] = ((pertSitePos[0] - baseSitePos[0]) / o.epsilon) * o.posWeight;
                J[1 * n + j] = ((pertSitePos[1] - baseSitePos[1]) / o.epsilon) * o.posWeight;
                J[2 * n + j] = ((pertSitePos[2] - baseSitePos[2]) / o.epsilon) * o.posWeight;

                // Orientation Jacobian columns (rows 3-5)
                // δR = R_perturbed * R_base^T, then extract angular velocity
                const dRot = angularDelta(baseSiteMat, pertSiteMat);
                J[3 * n + j] = (dRot[0] / o.epsilon) * o.rotWeight;
                J[4 * n + j] = (dRot[1] / o.epsilon) * o.rotWeight;
                J[5 * n + j] = (dRot[2] / o.epsilon) * o.rotWeight;

                // Restore joint
                data.qpos[j] = saved;
            }

            // Restore base FK state for next iteration
            for (let i = 0; i < n; i++) data.qpos[i] = q[i];

            // Damped least squares: Δq = Jᵀ (J Jᵀ + λI)⁻¹ error
            // 1. Compute JJᵀ (6×6)
            for (let r = 0; r < 6; r++) {
                for (let c = 0; c < 6; c++) {
                    let sum = 0;
                    for (let k = 0; k < n; k++) {
                        sum += J[r * n + k] * J[c * n + k];
                    }
                    JJt[r * 6 + c] = sum + (r === c ? o.damping : 0);
                }
            }

            // 2. Solve (JJᵀ + λI) x = error
            for (let i = 0; i < 6; i++) rhs[i] = error[i];
            solve6x6(JJt, rhs, x);

            // 3. Δq = Jᵀ x
            for (let j = 0; j < n; j++) {
                let sum = 0;
                for (let r = 0; r < 6; r++) {
                    sum += J[r * n + j] * x[r];
                }
                dq[j] = sum;
            }

            // Update joints
            for (let i = 0; i < n; i++) q[i] += dq[i];
        }

        // Restore original qpos
        data.qpos.set(savedQpos);
        this.mujoco.mj_forward(model, data);

        return bestQ;
    }
}

// --- Math utilities ---

/** Convert THREE.Quaternion to 3x3 rotation matrix (row-major Float64Array) */
function quatToMat3(q: THREE.Quaternion): Float64Array {
    const m = new Float64Array(9);
    const x = q.x, y = q.y, z = q.z, w = q.w;
    const xx = x * x, yy = y * y, zz = z * z;
    const xy = x * y, xz = x * z, yz = y * z;
    const wx = w * x, wy = w * y, wz = w * z;
    m[0] = 1 - 2 * (yy + zz); m[1] = 2 * (xy - wz);     m[2] = 2 * (xz + wy);
    m[3] = 2 * (xy + wz);     m[4] = 1 - 2 * (xx + zz); m[5] = 2 * (yz - wx);
    m[6] = 2 * (xz - wy);     m[7] = 2 * (yz + wx);     m[8] = 1 - 2 * (xx + yy);
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

    // Near π — degenerate, use small-angle approx of the skew-symmetric part
    if (angle > Math.PI - 1e-6) {
        return [
            0.5 * (Re[7] - Re[5]),
            0.5 * (Re[2] - Re[6]),
            0.5 * (Re[3] - Re[1]),
        ];
    }

    // General case: axis = skew(R_err) / (2 sin(angle)), scaled by angle
    const s = angle / (2 * Math.sin(angle));
    return [
        s * (Re[7] - Re[5]),
        s * (Re[2] - Re[6]),
        s * (Re[3] - Re[1]),
    ];
}

/**
 * Compute angular velocity vector from R_base to R_perturbed.
 * Returns the axis-angle of R_perturbed * R_base^T.
 * (Small angle: the rotation caused by the perturbation.)
 */
function angularDelta(R_base: Float64Array, R_pert: Float64Array): [number, number, number] {
    // δR = R_pert * R_base^T
    // Small angle approx: ω ≈ 0.5 * [δR[7]-δR[5], δR[2]-δR[6], δR[3]-δR[1]]
    // This is fine because the perturbation epsilon is tiny.
    const dR = new Float64Array(9);
    for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
            let s = 0;
            for (let k = 0; k < 3; k++) {
                s += R_pert[i * 3 + k] * R_base[j * 3 + k];
            }
            dR[i * 3 + j] = s;
        }
    }
    return [
        0.5 * (dR[7] - dR[5]),
        0.5 * (dR[2] - dR[6]),
        0.5 * (dR[3] - dR[1]),
    ];
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
            if (val > maxVal) { maxVal = val; maxRow = row; }
        }

        // Swap rows
        if (maxRow !== col) {
            for (let k = 0; k < N; k++) {
                const tmp = a[col * N + k]; a[col * N + k] = a[maxRow * N + k]; a[maxRow * N + k] = tmp;
            }
            const tmp = r[col]; r[col] = r[maxRow]; r[maxRow] = tmp;
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
