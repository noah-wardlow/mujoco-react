/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * useTrajectoryRecorder — trajectory recording hook (spec 13.1)
 */

import { useCallback, useRef } from 'react';
import { useMujocoSim, useAfterPhysicsStep } from '../core/MujocoSimProvider';
import type { TrajectoryFrame } from '../types';

interface RecorderOptions {
  fields?: ('qpos' | 'qvel' | 'ctrl' | 'sensordata')[];
}

/**
 * Record simulation trajectories for analysis, replay, or training data.
 */
export function useTrajectoryRecorder(options: RecorderOptions = {}) {
  const { mjModelRef } = useMujocoSim();
  const recordingRef = useRef(false);
  const framesRef = useRef<TrajectoryFrame[]>([]);
  const fields = options.fields ?? ['qpos'];

  useAfterPhysicsStep((_model, data) => {
    if (!recordingRef.current) return;

    const frame: TrajectoryFrame = {
      time: data.time,
      qpos: new Float64Array(data.qpos),
    };

    if (fields.includes('qvel')) frame.qvel = new Float64Array(data.qvel);
    if (fields.includes('ctrl')) frame.ctrl = new Float64Array(data.ctrl);
    if (fields.includes('sensordata') && data.sensordata) {
      frame.sensordata = new Float64Array(data.sensordata);
    }

    framesRef.current.push(frame);
  });

  const start = useCallback(() => {
    framesRef.current = [];
    recordingRef.current = true;
  }, []);

  const stop = useCallback(() => {
    recordingRef.current = false;
    return framesRef.current;
  }, []);

  const downloadJSON = useCallback(() => {
    const frames = framesRef.current;
    const data = frames.map(f => ({
      time: f.time,
      qpos: Array.from(f.qpos),
      ...(f.qvel ? { qvel: Array.from(f.qvel) } : {}),
      ...(f.ctrl ? { ctrl: Array.from(f.ctrl) } : {}),
      ...(f.sensordata ? { sensordata: Array.from(f.sensordata) } : {}),
    }));
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'trajectory.json';
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const downloadCSV = useCallback(() => {
    const frames = framesRef.current;
    if (frames.length === 0) return;
    const nq = frames[0].qpos.length;
    const headers = ['time', ...Array.from({ length: nq }, (_, i) => `qpos_${i}`)];
    const rows = frames.map(f =>
      [f.time, ...Array.from(f.qpos)].join(',')
    );
    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'trajectory.csv';
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  return {
    start,
    stop,
    downloadJSON,
    downloadCSV,
    get recording() { return recordingRef.current; },
    get frameCount() { return framesRef.current.length; },
    get frames() { return framesRef.current; },
  };
}
