#!/bin/sh
# Builds the tract pipeline (tract/) to wasm and generates its JS bindings into tract/pkg/, which
# src/pose/tractWorker.ts imports. Needs the wasm32-unknown-unknown target and the wasm-bindgen CLI of the
# version tract/Cargo.lock pins.
set -e
cd "$(dirname "$0")/../tract"

if ! rustup target list --installed 2>/dev/null | grep -qx wasm32-unknown-unknown; then
    echo "The wasm32 target is missing: rustup target add wasm32-unknown-unknown" >&2
    exit 1
fi
want=$(grep -A1 '^name = "wasm-bindgen"$' Cargo.lock | sed -n 's/^version = "\(.*\)"/\1/p' | head -n 1)
have=$(wasm-bindgen --version 2>/dev/null | cut -d' ' -f2)
if [ "$want" != "$have" ]; then
    echo "wasm-bindgen ${have:-not found}, Cargo.lock wants $want: cargo install wasm-bindgen-cli --version $want --locked" >&2
    exit 1
fi

cargo build --release --lib --target wasm32-unknown-unknown
# The name section (function names for stack traces) is 4 MB of the wasm; panics still log their message.
wasm-bindgen --target web --remove-name-section --out-dir pkg "${CARGO_TARGET_DIR:-target}/wasm32-unknown-unknown/release/handpose_tract.wasm"
echo "tract/pkg ready: $(du -h pkg/handpose_tract_bg.wasm | cut -f1) wasm"
