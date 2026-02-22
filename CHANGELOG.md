# [4.0.0](https://github.com/noah-wardlow/mujoco-react/compare/v3.0.0...v4.0.0) (2026-02-22)


### Features

* rename robotId to modelId in SceneConfig ([5452189](https://github.com/noah-wardlow/mujoco-react/commit/545218937c3678552c2af7044ad89a252d2a1e7d))


### BREAKING CHANGES

* SceneConfig.robotId is now SceneConfig.modelId.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>

# [3.0.0](https://github.com/noah-wardlow/mujoco-react/compare/v2.0.0...v3.0.0) (2026-02-22)


### Features

* rename useMujocoSim() to useMujoco() and useMujoco() to useMujocoWasm() ([3399402](https://github.com/noah-wardlow/mujoco-react/commit/33994022d1b5130fe3da1155d27796f29c29ad7e))


### BREAKING CHANGES

* useMujocoSim() is now useMujoco() (sim API hook).
The old useMujoco() (WASM lifecycle) is now useMujocoWasm().
Updated README, docs, and all internal references.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>

# [2.0.0](https://github.com/noah-wardlow/mujoco-react/compare/v1.0.0...v2.0.0) (2026-02-22)


### Features

* render SceneRenderer automatically inside MujocoSimProvider ([cda052e](https://github.com/noah-wardlow/mujoco-react/commit/cda052ed7de05ba1f735a389519156addbec03fd))


### BREAKING CHANGES

* SceneRenderer is no longer exported. Remove <SceneRenderer /> from your JSX and its import.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>

# 1.0.0 (2026-02-22)


### Features

* add MujocoPhysics component and modernize R3F patterns ([0679c27](https://github.com/noah-wardlow/mujoco-react/commit/0679c272d24f29d70331026ce05f3b57f9c14bef))


### BREAKING CHANGES

* removed interpolate, gravityCompensation, mjcfLights
props from MujocoCanvas. Removed tcpSiteName, gripperActuatorName,
numArmJoints from SceneConfig. Use useGravityCompensation() hook and
IkController config instead.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>

# 1.0.0 (2026-02-22)


### Features

* add MujocoPhysics component and modernize R3F patterns ([0679c27](https://github.com/noah-wardlow/mujoco-react/commit/0679c272d24f29d70331026ce05f3b57f9c14bef))


### BREAKING CHANGES

* removed interpolate, gravityCompensation, mjcfLights
props from MujocoCanvas. Removed tcpSiteName, gripperActuatorName,
numArmJoints from SceneConfig. Use useGravityCompensation() hook and
IkController config instead.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
