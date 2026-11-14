## Independent camera appearance by default

- MuJoCo camera captures and live viewports now default to classic model rendering while the viewer stays standard PBR. No extra appearance arguments are needed.
- Exported `MujocoAppearance.Standard` and `.Classic` provide named constants backed by a derived union type. Per-camera overrides work with RGB-D, PNG/canvas, sessions, streams and viewports.
- Classic captures use native display-code RGB by default. Geometry/material alternatives are cached and scoped to synchronous rendering, with viewer restoration on errors and before async GPU readback yields. Physics and the official MuJoCo4.0.1 bindings are unchanged.
- Migration: select `appearance: MujocoAppearance.Standard` for prior default PBR/sRGB camera output. Generic Three scenes keep their prior behavior. Infinite planes retain the viewer's existing finite visualization proxy; native infinite-horizon, shadow and reflection parity are excluded.
- Verified with27 runtime tests, type checks, builds and14 real-browser GPU checks, including unchanged viewer pixels and physics, and PNG/RGB-D color agreement. LIBERO verification is recorded separately.
