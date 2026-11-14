# Hand gesture web interfaces

Browser experiments driven by webcam hand tracking. An npm workspace: a shared hand-pose library and one
directory per project.

| | |
|---|---|
| [`packages/handpose`](packages/handpose) | `@ocramz/handpose` ([npm](https://www.npmjs.com/package/@ocramz/handpose)): YOLO26 hand pose in onnxruntime-web or tract (wasm), in a worker; tracking, 2D → 3D lifting. Prebuilt, weights included, no three.js or Vite |
| [`packages/handpose-three`](packages/handpose-three) | `@ocramz/handpose-three` (private): the three.js camera stage and the Vite plugin the apps share, with a [demo](https://ocramz.github.io/hand-gesture-web-interfaces/) that builds to a static site |
| [`apps/soap-hands`](apps/soap-hands) | Soap Hands: hold a soap film between your hands |
| [`apps/tract-hands`](apps/tract-hands) | The hand keypoints as a 3D skeleton, from the tract (wasm) pipeline |

```sh
npm install
npm run fetch-model   # hand-pose weights into packages/handpose/assets/models (skipped if present)
npm run dev           # builds @ocramz/handpose, then Soap Hands at http://localhost:5173 — allow the camera
npm run demo          # builds @ocramz/handpose, then the handpose-three demo at http://localhost:5173
npm run watch         # (second terminal) recompile @ocramz/handpose on change; the apps use its dist/
npm test              # every workspace
npm run typecheck
npm run build
```

Run a script in one workspace with `-w`, e.g. `npm run dev -w @ocramz/soap-hands`.

## Adding a project

1. Create `apps/<name>/` with a `package.json` (`"name": "@ocramz/<name>"`, `"private": true`,
   dependencies `"@ocramz/handpose": "*"`, `"@ocramz/handpose-three": "*"` and whatever else it needs, scripts `dev`/`build`/`preview`/
   `test`/`typecheck`), a `tsconfig.json` that extends `../../tsconfig.base.json`, and an `index.html`.
   `apps/soap-hands` is the template.
2. `vite.config.ts`: `plugins: [handpose()]` from `@ocramz/handpose-three/vite`.
3. In `main.ts`: open a source (`openWebcam` / `openImage`), make a `Stage` (`@ocramz/handpose-three`) and
   a `HandPose`, and each frame call `pose.pump(...)`, `pose.updateViews(...)` and `stage.render()`. See
   [`packages/handpose-three/README.md`](packages/handpose-three/README.md).
4. `npm install` at the root to link it.

Code that more than one project needs belongs in `packages/handpose` if it is framework-free, else in
`packages/handpose-three` (or a new package under `packages/`).

## CI, the demo site, and releasing `@ocramz/handpose`

`.github/workflows/ci.yml` runs on pushes to `main` and on PRs: builds the tract wasm and the package,
type-checks and tests everything (including `cargo test` on the real model), packs the npm tarball, checks
its contents, and smoke-tests it in a fresh Vite app in headless Chromium with both engines
(`packages/handpose/test-consumer/run-smoke.sh`).

`.github/workflows/pages.yml` runs on pushes to `main`. It builds the handpose-three demo
(`packages/handpose-three/demo`) and publishes it on GitHub Pages. One-time setup: Settings → Pages →
Source: GitHub Actions. While the repo is private, Pages needs a paid plan, and the site is public anyway.

`.github/workflows/release.yml` runs on tags `handpose-vX.Y.Z`: the same CI, then it publishes that exact
tarball to npm (trusted publishing over OIDC, with provenance; prerelease versions go to the `next`
dist-tag) and attaches it to a GitHub release.

```sh
# bump packages/handpose/package.json "version", commit, then:
git tag handpose-v0.1.1 && git push origin handpose-v0.1.1
```

One-time setup:

1. First publish by hand (npm can only add a trusted publisher to an existing package):
   `npm run build && npm pack -w @ocramz/handpose && npm publish ocramz-handpose-0.1.0.tgz --access public`.
2. On npmjs.com → `@ocramz/handpose` → Settings → Trusted Publisher: GitHub Actions, repository
   `ocramz/hand-gesture-web-interfaces`, workflow `release.yml`, environment `npm`.
3. In the GitHub repo settings, create the `npm` environment (optionally with required reviewers).
4. Back on npm, set publishing access to "Require two-factor authentication and disallow tokens".

## License

AGPL-3.0-only (`LICENSE`). The hand-pose weights are AGPL-3.0 + CC BY-NC-SA 4.0: non-commercial use only
(`packages/handpose/NOTICE.md`).
