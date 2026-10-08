# batchmotion-engine

The render brain of Batchmotion, edited as an independent package. The host app
(Electron UI + packaging) consumes it as a dependency and never forks its files.

## What lives here

- **Director**: `blueprint.ts` (schema, normalize, quality gate), `prompt-dictionary.ts`,
  `scene-craft.ts`, `concept-prompt.ts`, `structured-prompt.ts`, `prompt-assembler.ts`
- **Coder contracts**: `ai.ts` (GSAP + HyperFrames composer contracts, repair steering)
- **Pipeline**: `queue.ts` (`QueueService`), `render.ts` (GSAP capture loop),
  `hyperframes.ts` (HyperFrames CLI engine), `preflight.ts` (shared visual analyzers)
- **Measurement**: `quality.ts`, `geometry.ts`, `scene-coverage.ts`, `output-format.ts`
- **Assets/IO**: `icon-source.ts`, `txt.ts`, `html-import.ts`, `insight.ts`, `gsap-runtime.ts`,
  `virtual-clock.ts`, `streaming.ts`, `runtime-repair.ts`, `seed.ts`
- **Shared**: `types.ts` (single source of truth, incl. `EngineStore`/`EnginePaths`),
  `store-utils.ts` (pure persistence helpers), `errors.ts`
- **Vendored runtime**: `resources/gsap.min.js` (host-injected, license banner intact)

## Host contract (do not break)

`QueueService` takes injected collaborators and never touches app storage or paths:

```ts
import { QueueService } from "batchmotion-engine";
const queue = new QueueService(
  (channel, data) => { /* forward log/update to UI */ },
  store,   // { history(), queue(), saveQueue(), saveHistory() }
  { userData: "<app userData dir>" },
);
```

- Settings validation (`validSettings`), window/IPC/preload/storage paths, ffmpeg
  binaries, and packaging stay in the host app.
- `resources/gsap.min.js` ships inside this package (`files: [dist, resources]`)
  and is resolved relative to the module (`../resources`).
- The `hyperframes` npm dependency must be installed wherever this package runs;
  the CLI is spawned via the bundled bin under plain node
  (`ELECTRON_RUN_AS_NODE=1` when the host is Electron).

## Develop

```bash
npm install
npm run typecheck
npm test
```

`npm test` rebuilds `dist/` then runs every `dist/*.test.js`. The output-format
encode test shells a real ffmpeg: point `BATCHMOTION_FFMPEG_DIR` at a directory
containing `ffmpeg.exe`/`ffprobe.exe` (the Batchmotion app vendors one at
`vendor/ffmpeg`).

`npm test` rebuilds `dist/` then runs every `dist/*.test.js`. The text probe
(`TEXT_LEGIBILITY_PROBE`) and color parsing are covered by stub-DOM unit tests in
`quality.test.ts`; prompt contracts by `blueprint-pipeline.test.ts`; gates and
pipeline steering by `blueprint.test.ts`, `validation.test.ts`, and the rest.

## Versioning

Conventional bump per change (`0.1.x` fixes, `0.x.0` gate/contract changes — the
host re-verifies with typecheck + tests + smoke + a live review round on every
bump, because prompt wording is behavior).

## Consuming updates (host app checklist)

After pushing engine changes and tagging (`git tag vX.Y.Z && git push origin vX.Y.Z`):

1. In the app: `npm install "github:irfanbm/batchmotion-engine#vX.Y.Z"`
   (private repo: git needs read access, same credentials as `gh`).
2. Validate in the app, in order, stopping at the first red:
   - `npm run typecheck`
   - `npm test` (app shell tests)
   - `npm run build` (vite + electron)
   - `npm run test:render` (smoke; known flake: the second-in-process render lags
     ~1 frame, while first renders stay identical across processes — only the
     latter is enforced)
   - one live review round when contracts, gates, or steering changed:
     `BM_REVIEW_MODE=hyperframes node scripts/review-pipeline.cjs live "<prompt>"`
     (or `split` for the GSAP path).
3. Breaking changes (QueueService signature, `RenderReport` fields, prompt
   contracts, `EngineStore`) must update `electron/main.ts`, `electron/storage.ts`,
   or `scripts/` in the same step — typecheck catches most of it.

## Contributor loop (for editing agents)

When the owner hands you this repo with a revision request, the loop is fixed:

1. Work in a checkout of this repo (same machine: the existing folder; elsewhere:
   clone with an account that has read access — the repo is private).
2. Make the change, then verify inside this repo before anything else:
   `npm run typecheck`, then `npm test` (set `BATCHMOTION_FFMPEG_DIR` if ffmpeg
   lives elsewhere).
3. Bump `package.json` version in the SAME commit as the change (`0.1.x` fixes,
   `0.x.0` gate/contract/API changes), commit, push, and tag that exact version
   (`git tag vX.Y.Z && git push origin vX.Y.Z`). The version field and the tag
   must agree, or the host installs stale code. No tag, no pickup: the host app
   pins exact tags.
4. Report back the new tag number plus what changed and what the checks said.
   Do not build installers or bump the app version — the host side does that on
   explicit owner request only.
