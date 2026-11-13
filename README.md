# Hand gesture web interfaces

Browser experiments driven by webcam hand tracking. An npm workspace: a shared hand-pose library and one
directory per project.

| | |
|---|---|
| [`packages/handpose`](packages/handpose) | `@ocramz/handpose`: YOLO26 hand pose in onnxruntime-web (worker), tracking, 2D → 3D lifting, a three.js camera stage, and a Vite plugin |
| [`apps/soap-hands`](apps/soap-hands) | Soap Hands: hold a soap film between your hands |

```sh
npm install
npm run fetch-model   # hand-pose weights into packages/handpose/assets/models (skipped if present)
npm run dev           # Soap Hands at http://localhost:5173 — allow the camera
npm test              # every workspace
npm run typecheck
npm run build
```

Run a script in one workspace with `-w`, e.g. `npm run dev -w @ocramz/soap-hands`.

## Adding a project

1. Create `apps/<name>/` with a `package.json` (`"name": "@ocramz/<name>"`, `"private": true`,
   dependencies `"@ocramz/handpose": "*"` and whatever else it needs, scripts `dev`/`build`/`preview`/
   `test`/`typecheck`), a `tsconfig.json` that extends `../../tsconfig.base.json`, and an `index.html`.
   `apps/soap-hands` is the template.
2. `vite.config.ts`: `plugins: [handpose()]` from `@ocramz/handpose/vite`.
3. In `main.ts`: open a source (`openWebcam` / `openImage`), make a `Stage` and a `HandPose`, and each
   frame call `pose.pump(...)`, `pose.updateViews(...)` and `stage.render()`. See
   [`packages/handpose/README.md`](packages/handpose/README.md).
4. `npm install` at the root to link it.

Code that more than one project needs belongs in `packages/handpose` (or a new package under `packages/`).
