# Repository Guidelines

## Project Structure & Module Organization

This is a TypeScript ESM library for React Three Fiber MuJoCo simulations. Source lives in `src/`: `core/` contains providers, loaders, and simulation APIs; `components/` contains reusable R3F components; `hooks/` contains React hooks; `rendering/` contains camera, geometry, and capture helpers. Public exports are centralized in `src/index.ts`, with secondary entrypoints in `src/vite.ts` and `src/spark.tsx`. CLI entrypoints live in `bin/`. Type-level regression checks live in `type-tests/`. `docs/` and `README.md` document public APIs. `dist/` is generated build output.

## Build, Test, and Development Commands

- `npm ci`: install locked dependencies.
- `npm run dev`: run `tsup --watch` for library development.
- `npm run build`: build ESM outputs, declarations, and sourcemaps into `dist/`.
- `npm run typecheck`: run `tsc --noEmit` over `src` and `type-tests`.

There is no separate unit-test script in this package; treat `npm run typecheck` and focused type tests as the required verification baseline. Release CI on Node 22 runs `npm ci`, `npm run build`, `npm run typecheck`, then semantic-release.

## Coding Style & Naming Conventions

Use strict TypeScript and React JSX. Match the existing style: 2-space indentation in JSON, single quotes in TypeScript, semicolons, and named exports. Hooks use `useX` names and return small, stable APIs with explicit `status`, `error`, and action methods for async behavior. Prefer discriminated unions and `as const` objects plus derived union types over TypeScript enums. Components should accept normal R3F props and compose inside `<MujocoCanvas>`.

Use `code_guidelines.md` as the detailed reference for API ergonomics, MuJoCo/WASM packaging rules, documentation expectations, and release hygiene.

## Testing Guidelines

Add or update files in `type-tests/` when changing public types, generated register behavior, resource-name unions, or secondary entrypoints. Keep test files named after the API or workflow they protect, for example `type-tests/mounted-camera-sequence-recorder.tsx`. For visual, capture, or interaction changes, run a browser smoke test in the consuming example app when practical and document the result in the PR.

## Commit & Pull Request Guidelines

Prefer Conventional Commits because releases are driven by semantic-release: `feat: ...`, `fix: ...`, `docs: ...`, `chore: ...`. Recent history includes imperative subjects; keep messages concise and user-facing. Do not run `npm version` or `npm publish` manually.

Pull requests should explain the behavioral change, list verification commands, link related issues, and include screenshots or recordings for rendering/UI changes. Public API changes should update `README.md`, relevant docs, exports, and type tests together.

## Release Notes

Keep semantic-release for versioning, tags, npm publishing, and release commits. Do not replace it with manual `npm version` or `npm publish`.

For every release, add a human-written release summary instead of relying only on semantic-release's generated notes. The summary should cover, when relevant:

- Official MuJoCo bindings / WASM packaging impact
- IK and control API changes
- New hooks, components, or secondary entrypoints
- Docs and example app updates
- Migration or compatibility notes
- What was intentionally excluded from the release
- Verification commands and deployment checks

If semantic-release creates a thin GitHub release body, supplement or replace it with the human-written summary after the release completes.
