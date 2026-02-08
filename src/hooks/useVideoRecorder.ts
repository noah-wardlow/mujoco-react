/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * useVideoRecorder — canvas video recording hook (spec 13.3)
 */

import { useCallback, useRef } from 'react';
import { useThree } from '@react-three/fiber';

interface VideoRecorderOptions {
  fps?: number;
  mimeType?: string;
}

/**
 * Record the R3F canvas to a video file using MediaRecorder.
 */
export function useVideoRecorder(options: VideoRecorderOptions = {}) {
  const { gl } = useThree();
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordingRef = useRef(false);

  const start = useCallback(() => {
    const canvas = gl.domElement;
    const fps = options.fps ?? 30;
    const mimeType = options.mimeType ?? 'video/webm';

    const stream = canvas.captureStream(fps);
    const recorder = new MediaRecorder(stream, {
      mimeType: MediaRecorder.isTypeSupported(mimeType) ? mimeType : 'video/webm',
    });

    chunksRef.current = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };

    recorder.start();
    recorderRef.current = recorder;
    recordingRef.current = true;
  }, [gl, options.fps, options.mimeType]);

  const stop = useCallback((): Promise<Blob> => {
    return new Promise((resolve) => {
      const recorder = recorderRef.current;
      if (!recorder || recorder.state === 'inactive') {
        resolve(new Blob([]));
        return;
      }

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType });
        chunksRef.current = [];
        recordingRef.current = false;
        recorderRef.current = null;
        resolve(blob);
      };

      recorder.stop();
    });
  }, []);

  const download = useCallback(async (filename = 'recording.webm') => {
    const blob = await stop();
    if (blob.size === 0) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }, [stop]);

  return {
    start,
    stop,
    download,
    get recording() { return recordingRef.current; },
  };
}
