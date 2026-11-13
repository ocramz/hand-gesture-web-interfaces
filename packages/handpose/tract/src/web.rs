//! The browser API: one `HandPipeline` per worker. See `src/pose/tractWorker.ts`.

use wasm_bindgen::prelude::*;

use crate::pipeline::{Frame, Pipeline, prepare};
use crate::tracker::TrackerOptions;

fn js_error(error: anyhow::Error) -> JsValue {
    JsValue::from_str(&format!("{error:#}"))
}

#[wasm_bindgen]
pub struct HandPipeline {
    inner: Pipeline,
    gpu: bool,
}

#[wasm_bindgen]
impl HandPipeline {
    /// Prepares `model` (ONNX bytes) on `runtime`: `"wgpu"` (WebGPU) or `"cpu"`.
    pub async fn create(runtime: String, model: Vec<u8>, conf_threshold: f64) -> Result<HandPipeline, JsValue> {
        console_error_panic_hook::set_once();
        let gpu = match runtime.as_str() {
            // On wasm the device must exist before the runtime is looked up: requesting it is async.
            "wgpu" => {
                tract::wgpu::init().await.map_err(js_error)?;
                true
            }
            "cpu" => false,
            other => return Err(JsValue::from_str(&format!("Unknown runtime {other}"))),
        };
        let runnable = prepare(&model, &runtime).map_err(js_error)?;
        Ok(HandPipeline { inner: Pipeline::new(runnable, conf_threshold), gpu })
    }

    /// The GPUDevice the wgpu runtime runs on (after a `"wgpu"` pipeline was created), else null.
    pub fn device() -> JsValue {
        tract::wgpu_device().unwrap_or(JsValue::NULL)
    }

    /// Where a `width × height` bitmap goes in the 640² input: `[scale, padX, padY, w, h]`.
    pub fn letterbox(width: f64, height: f64) -> Vec<f64> {
        let lb = Pipeline::letterbox(width, height);
        vec![lb.scale, lb.pad_x, lb.pad_y, lb.w, lb.h]
    }

    /// Runs the model on zeros and returns the time it took (ms), the first run included.
    pub async fn warm_up(&mut self) -> Result<f64, JsValue> {
        let t0 = js_sys::Date::now();
        self.inner.run_zeros().await.map_err(js_error)?;
        Ok(js_sys::Date::now() - t0)
    }

    /// The letterboxed 640² frame in an OffscreenCanvas → packed hands and slots (see `Pipeline::pack`).
    /// The canvas is uploaded and normalized on the GPU, with no pixel readback. WebGPU only.
    #[expect(clippy::too_many_arguments, reason = "wasm-bindgen exports take flat arguments")]
    pub async fn run_canvas(
        &mut self,
        canvas: web_sys::OffscreenCanvas,
        width: f64,
        height: f64,
        src_scale: f64,
        src_width: f64,
        mirror: bool,
        t: f64,
    ) -> Result<Vec<f32>, JsValue> {
        if !self.gpu {
            return Err(JsValue::from_str("run_canvas needs the wgpu runtime: use run_rgba"));
        }
        let frame = Frame { width, height, src_scale, src_width, mirror, t };
        let input = tract::Tensor::from_canvas_normalized(canvas, [0.0; 3], [1.0; 3]).map_err(js_error)?;
        let hands = self.inner.run_tensor(input, &frame).await.map_err(js_error)?;
        Ok(self.inner.pack(&hands))
    }

    /// The letterboxed 640² frame as RGBA bytes → packed hands and slots (see `Pipeline::pack`).
    #[expect(clippy::too_many_arguments, reason = "wasm-bindgen exports take flat arguments")]
    pub async fn run_rgba(
        &mut self,
        rgba: Vec<u8>,
        width: f64,
        height: f64,
        src_scale: f64,
        src_width: f64,
        mirror: bool,
        t: f64,
    ) -> Result<Vec<f32>, JsValue> {
        let frame = Frame { width, height, src_scale, src_width, mirror, t };
        let hands = self.inner.run_rgba(&rgba, &frame).await.map_err(js_error)?;
        Ok(self.inner.pack(&hands))
    }

    pub fn set_confidence(&mut self, conf_threshold: f64) {
        self.inner.set_conf_threshold(conf_threshold);
    }

    pub fn set_tracker(&mut self, min_hits: u32, max_misses: u32, min_cutoff: f64, beta: f64) {
        self.inner.set_tracker_options(TrackerOptions { min_hits, max_misses, min_cutoff, beta });
    }
}
