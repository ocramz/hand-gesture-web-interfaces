//! The hand-pose vision pipeline of `@ocramz/handpose` in tract: a letterboxed frame → YOLO26 →
//! decoded, canonicalized hands → two tracked, One-Euro-smoothed slots. Built to wasm (see
//! `scripts/build-wasm.sh`), where it runs on WebGPU (tract's `wgpu` runtime) or the CPU (simd128).

pub mod decode;
pub mod pipeline;
pub mod tracker;

#[cfg(target_arch = "wasm32")]
mod web;
