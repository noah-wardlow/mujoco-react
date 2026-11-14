## Classic MuJoCo appearance for camera comparisons

- Added the opt-in `renderOptions.appearance: "mujoco-classic"` profile, using MJCF materials, texture color spaces, imported mesh normals, model lights and headlight.
- Added `rgbColorSpace: "linear-srgb"` to metric RGB-D capture for native display-code readback. Existing standard rendering and sRGB capture defaults are unchanged.
- Documented current finite-plane, texture and lighting limits. Shadow and planar-reflection parity remain outside this profile.
