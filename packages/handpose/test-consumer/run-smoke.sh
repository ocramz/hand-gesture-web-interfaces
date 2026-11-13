#!/usr/bin/env bash
# Smoke-tests a packed @ocramz/handpose tarball the way an npm user gets it: installs it into a copy of this
# fixture outside the workspace, bundles it with plain Vite, checks the build emitted every runtime file,
# then runs both engines in headless Chromium (smoke.mjs), against the build and against the dev server.
#   bash run-smoke.sh path/to/ocramz-handpose-X.Y.Z.tgz [workdir]
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
tarball="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
work="${2:-$(mktemp -d)}"
VITE_VERSION=8.3.4
PLAYWRIGHT_VERSION=1.64.1

mkdir -p "$work/public"
cp "$here"/{package.json,vite.config.ts,index.html,main.ts,smoke.mjs} "$work/"
cp "$here/../assets/samples/two_hands.jpg" "$work/public/"
cd "$work"
npm install --no-audit --no-fund "$tarball" "vite@$VITE_VERSION" "playwright@$PLAYWRIGHT_VERSION"

# The installed package must not drag in three or vite.
if node -e 'const d = require("@ocramz/handpose/package.json"); process.exit(Object.keys({ ...d.dependencies, ...d.peerDependencies }).some(k => /^(three|vite)$/.test(k)) ? 1 : 0)'; then :; else
  echo "packed package.json depends on three or vite" >&2; exit 1
fi

npx vite build
missing=0
for pattern in 'yolo26_hand_pose_fp16-*.onnx' 'yolo26_hand_pose_fp32-*.onnx' 'handpose_tract_bg-*.wasm' 'ort-wasm-*.wasm' 'worker-*.js' 'tractWorker-*.js'; do
  if compgen -G "dist/assets/$pattern" > /dev/null; then echo "emitted $pattern"; else echo "missing $pattern" >&2; missing=1; fi
done
[ "$missing" = 0 ]

npx playwright install chromium ${PLAYWRIGHT_DEPS:+--with-deps}
node smoke.mjs
SERVE=dev node smoke.mjs
