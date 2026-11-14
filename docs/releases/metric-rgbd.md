## Metric RGB-D camera observations

- Official MuJoCo bindings remain on 4.0.1; this release does not change engine or WASM loader selection.
- Added `captureCameraRGBD()` to the standalone helpers and `MujocoSimAPI`, `session.captureRGBD()` to reusable capture sessions, and `useCameraFrameCapture().captureRGBD()`.
- Each observation owns aligned, top-left sRGB RGB bytes, float32 camera-axis depth in meters, source provenance, and projection/world matrix snapshots. Background is `Infinity`; scene units must be meters. Camera-axis depth is distinct from Euclidean range.
- Reads the actual RGB render's depth attachment, retaining material alpha tests, depth-write rules, occlusion and capture filters. Custom capture renderers, logarithmic/reversed depth buffers and invalid projection matrices fail explicitly.
- Fixed double application of device-pixel ratio in offscreen capture. Retina viewer renderers now use the render target's pixel viewport correctly.
- Moved Gaussian splat documentation below the core usage guides and documented metric conventions and moving-camera session usage.
- The example app adds `?demo=rgbd`, with 2 m / 3 m reference boxes, aligned RGB/depth previews, mirrored capture, and ten real-GPU regression checks.

Validation: library typecheck, build, and 21 runtime tests; real-browser GPU checks; a separate LIBERO Web integration diagnostic with two 640×480 cameras, moving-wrist calibration, synchronized robot state/time, and preserved lease/watchdog/reset behavior. These are capture/compatibility checks, not browser/native benchmark score parity.

The natsuku-specific BPO adapter and loading-spinner change belong to LIBERO Web and are excluded from this package release.
