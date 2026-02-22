# 1.0.0 (2026-02-22)


### Features

* add MujocoPhysics component and modernize R3F patterns ([0679c27](https://github.com/noah-wardlow/mujoco-react/commit/0679c272d24f29d70331026ce05f3b57f9c14bef))


### BREAKING CHANGES

* removed interpolate, gravityCompensation, mjcfLights
props from MujocoCanvas. Removed tcpSiteName, gripperActuatorName,
numArmJoints from SceneConfig. Use useGravityCompensation() hook and
IkController config instead.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
