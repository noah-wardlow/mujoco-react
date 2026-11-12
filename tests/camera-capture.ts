import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  createCameraFrameCaptureSession,
  CAPTURE_EXCLUDE_KEY,
  CAMERA_FRAME_CAPTURE_RENDER_USER_DATA_KEY,
  type CameraFrameCaptureRenderInput,
} from '../src/rendering/cameraFrameCapture';

// GPU work is deliberately deferred so the test can observe the same shared
// scene that the interactive viewport renders between capture frames.
test('async camera adapters restore viewer state during preparation and readback', async () => {
  const previousDocument = globalThis.document;
  globalThis.document = {
    createElement: () => ({
      getContext: () => ({
        createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
        putImageData() {},
      }),
    }),
  } as unknown as Document;
  const scene = new THREE.Scene();
  const background = new THREE.Color('blue');
  scene.background = background;
  const gizmo = new THREE.Group();
  gizmo.userData[CAPTURE_EXCLUDE_KEY] = true;
  scene.add(gizmo);
  let target: THREE.WebGLRenderTarget | null = null;
  const renderer = {
    xr: { enabled: true }, shadowMap: { enabled: true },
    autoClear: true, toneMapping: THREE.NoToneMapping, outputColorSpace: THREE.SRGBColorSpace,
    getViewport: (v: THREE.Vector4) => v.set(0, 0, 100, 100),
    getScissor: (v: THREE.Vector4) => v.set(0, 0, 100, 100),
    getClearColor: (c: THREE.Color) => c.set('blue'),
    getClearAlpha: () => 1, getScissorTest: () => false,
    getRenderTarget: () => target,
    setRenderTarget: (value: THREE.WebGLRenderTarget | null) => { target = value; },
    setViewport() {}, setScissor() {}, setScissorTest() {}, setClearColor() {},
  } as unknown as THREE.WebGLRenderer;
  const session = createCameraFrameCaptureSession(renderer, scene, new THREE.PerspectiveCamera(), {
    width: 1, height: 1, visualOverrides: { sceneBackground: 'red', shadows: false },
  });
  function assertViewerState() {
    assert.equal(gizmo.visible, true);
    assert.equal(scene.background, background);
    assert.equal(renderer.xr.enabled, true);
    assert.equal(renderer.shadowMap.enabled, true);
    assert.equal(target, null);
  }
  try {
    for (const fail of [false, true]) {
      let finishReadback!: () => void;
      const readback = new Promise<void>((resolve) => { finishReadback = resolve; });
      scene.userData[CAMERA_FRAME_CAPTURE_RENDER_USER_DATA_KEY] = async (input: CameraFrameCaptureRenderInput) => {
        assert.equal(input.renderMode, fail ? 'preview' : 'snapshot');
        await Promise.resolve(); // Spark preparation yields before rendering.
        assertViewerState();
        input.withCaptureState(() => {
          assert.equal(gizmo.visible, false);
          assert.equal((scene.background as THREE.Color).getHexString(), 'ff0000');
          assert.equal(renderer.xr.enabled, false);
          assert.equal(renderer.shadowMap.enabled, false);
          renderer.setRenderTarget(input.target);
        });
        assertViewerState();
        await readback;
        if (fail) throw new Error('readback failed');
        return { pixels: new Uint8Array([255, 0, 0, 255]) };
      };
      const pending = session.captureAsync(fail ? { renderMode: 'preview' } : {});
      assertViewerState();
      await Promise.resolve();
      assertViewerState();
      // A viewer change during the pending read must not be overwritten later.
      gizmo.visible = false;
      finishReadback();
      if (fail) await assert.rejects(pending, /readback failed/);
      else await pending;
      assert.equal(gizmo.visible, false);
      gizmo.visible = true;
      assertViewerState();
    }
    scene.userData[CAMERA_FRAME_CAPTURE_RENDER_USER_DATA_KEY] = (input: CameraFrameCaptureRenderInput) => {
      input.withCaptureState(() => { throw new Error('render failed'); });
    };
    await assert.rejects(session.captureAsync(), /render failed/);
    assertViewerState();
  } finally {
    session.dispose();
    globalThis.document = previousDocument;
  }
});
