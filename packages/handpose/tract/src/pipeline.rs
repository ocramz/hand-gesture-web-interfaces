//! The hand-pose pipeline on one tract runtime: a 640² model input → YOLO26 → decoded, canonicalized
//! hands → two tracked, smoothed slots. Platform-independent; `web.rs` wraps it for the browser.

use anyhow::{Context, Result, ensure};
use tract::prelude::*;

use crate::decode::{
    DecodeOptions, Hand, Letterbox, MODEL_SIZE, NUM_KP, RawHead, decode_hands, letterbox, rgba_to_chw, top_detections,
};
use crate::tracker::{HandTracker, TrackerOptions};

/// Model input shape, NCHW.
const INPUT_SHAPE: [usize; 4] = [1, 3, MODEL_SIZE, MODEL_SIZE];
const MAX_HANDS: usize = 2;
const IOU_THRESHOLD: f64 = 0.6;

/// The head's per-anchor boxes `[1, 8400, 4]`, scores `[1, 8400, 1]` and keypoints `[1, 8400, 63]`: the
/// inputs of the graph's end-to-end selection (TopK, GatherElements). tract's WebGPU runtime has no kernels
/// for those, and in a browser it cannot hand them to the CPU mid-graph, so the graph is cut here and
/// `top_detections` does the selection. These are the ONNX graph's tensor names, which tract keeps as labels.
pub const HEAD_OUTPUTS: [&str; 3] =
    ["/model.23/Split_output_0", "/model.23/Split_output_1", "/model.23/Split_output_2"];

/// Loads the ONNX model (bytes), cut at [`HEAD_OUTPUTS`], and prepares it for `runtime` (`"cpu"` or
/// `"wgpu"`) at a 640² input.
pub fn prepare(model: &[u8], runtime: &str) -> Result<Runnable> {
    let mut m = tract::onnx()?.load_buffer(model).context("Loading the ONNX graph")?;
    m.set_input_fact(0, format!("1,3,{MODEL_SIZE},{MODEL_SIZE},f32").as_str())?;
    let mut typed = m.into_model().context("Typing the graph")?;
    let outputs = HEAD_OUTPUTS.map(|o| format!("\"{o}\"")).join(",");
    typed
        .transform(format!(r#"{{"name":"select_outputs","outputs":[{outputs}]}}"#))
        .context("Cutting the graph before its end-to-end selection")?;
    tract::runtime_for_name(runtime)?.prepare(typed).with_context(|| format!("Preparing the model on {runtime}"))
}

/// The frame a model input was made from.
#[derive(Debug, Clone, Copy)]
pub struct Frame {
    /// Size of the bitmap that was letterboxed into the model input.
    pub width: f64,
    pub height: f64,
    /// Source pixels per bitmap pixel (the bitmap may be a downscaled source frame).
    pub src_scale: f64,
    /// Source frame width, for the tracker's screen-left/right ordering.
    pub src_width: f64,
    pub mirror: bool,
    /// Capture time, seconds.
    pub t: f64,
}

pub struct Pipeline {
    runnable: Runnable,
    tracker: HandTracker,
    conf_threshold: f64,
    chw: Vec<f32>,
}

impl Pipeline {
    pub fn new(runnable: Runnable, conf_threshold: f64) -> Self {
        Self {
            runnable,
            tracker: HandTracker::new(TrackerOptions::default()),
            conf_threshold,
            chw: vec![0.0; INPUT_SHAPE.iter().product()],
        }
    }

    pub fn tracker(&self) -> &HandTracker {
        &self.tracker
    }

    pub fn set_conf_threshold(&mut self, c: f64) {
        self.conf_threshold = c;
    }

    pub fn set_tracker_options(&mut self, opts: TrackerOptions) {
        self.tracker.set_options(opts);
    }

    pub fn letterbox(width: f64, height: f64) -> Letterbox {
        letterbox(width, height, MODEL_SIZE as f64)
    }

    /// Runs the model on zeros. The first run compiles and allocates.
    pub async fn run_zeros(&mut self) -> Result<RawHead> {
        self.chw.fill(0.0);
        let input = Tensor::from_slice(&INPUT_SHAPE, &self.chw)?;
        self.infer(input).await
    }

    /// A letterboxed 640² RGBA frame → the head's raw predictions, not selected, decoded or tracked.
    pub async fn raw_rgba(&mut self, rgba: &[u8]) -> Result<RawHead> {
        self.load_rgba(rgba)?;
        let input = Tensor::from_slice(&INPUT_SHAPE, &self.chw)?;
        self.infer(input).await
    }

    fn load_rgba(&mut self, rgba: &[u8]) -> Result<()> {
        ensure!(
            rgba.len() == 4 * MODEL_SIZE * MODEL_SIZE,
            "RGBA input has {} bytes, expected {}",
            rgba.len(),
            4 * MODEL_SIZE * MODEL_SIZE
        );
        rgba_to_chw(rgba, MODEL_SIZE, &mut self.chw);
        Ok(())
    }

    /// A letterboxed 640² RGBA frame → tracked hands.
    pub async fn run_rgba(&mut self, rgba: &[u8], frame: &Frame) -> Result<Vec<Hand>> {
        self.load_rgba(rgba)?;
        let input = Tensor::from_slice(&INPUT_SHAPE, &self.chw)?;
        self.run_tensor(input, frame).await
    }

    /// A model input tensor (`[1, 3, 640, 640]` f32 in 0..1, on the host or the runtime's device) → tracked hands.
    pub async fn run_tensor(&mut self, input: Tensor, frame: &Frame) -> Result<Vec<Hand>> {
        let raw = self.infer(input).await?;
        let out = top_detections(&raw, self.conf_threshold as f32);
        let lb = Self::letterbox(frame.width, frame.height);
        let opts = DecodeOptions {
            conf_threshold: self.conf_threshold,
            max_hands: MAX_HANDS,
            iou_threshold: IOU_THRESHOLD,
            src_scale: frame.src_scale,
        };
        let hands = decode_hands(&out, &lb, &opts);
        self.tracker.update(&hands, frame.t, frame.src_width, frame.mirror);
        Ok(hands)
    }

    async fn infer(&self, input: Tensor) -> Result<RawHead> {
        let outputs = self.runnable.run([input])?;
        let [boxes, scores, kpts] = outputs.as_slice() else {
            anyhow::bail!("The cut model has {} outputs, expected 3", outputs.len());
        };
        // wgpu outputs stay on the GPU until downloaded, and a browser cannot block on that. The three
        // downloads run at once: each waits for the GPU to finish, and on Firefox that wait ends on a timer
        // tick (see firefoxPoll.ts), so in turn they would cost three ticks.
        let (boxes, scores, kpts) =
            futures_util::future::try_join3(host_f32(boxes), host_f32(scores), host_f32(kpts)).await?;
        let anchors = scores.len();
        ensure!(
            boxes.len() == 4 * anchors && kpts.len() == 3 * NUM_KP * anchors,
            "Head outputs of {} / {anchors} / {} values do not match",
            boxes.len(),
            kpts.len()
        );
        Ok(RawHead { boxes, scores, kpts })
    }

    /// Detections and slots in one flat array, for the worker to post:
    /// `[n, (x1, y1, x2, y2, conf, kp × 63) × n, (active, conf, kp × 63) × 2]`.
    pub fn pack(&self, hands: &[Hand]) -> Vec<f32> {
        let mut v = Vec::with_capacity(1 + hands.len() * (5 + 3 * NUM_KP) + 2 * (2 + 3 * NUM_KP));
        v.push(hands.len() as f32);
        for h in hands {
            v.extend(h.bbox.iter().map(|&x| x as f32));
            v.push(h.conf as f32);
            v.extend_from_slice(&h.kp);
        }
        for s in &self.tracker.slots {
            v.push(if s.active { 1.0 } else { 0.0 });
            v.push(s.conf as f32);
            v.extend_from_slice(&s.kp);
        }
        v
    }
}

/// A tensor's values on the host as f32, downloaded from the GPU if needed. The fp16 model's head is f16.
async fn host_f32(t: &Tensor) -> Result<Vec<f32>> {
    let host = t.to_host_async().await?.convert_to(DatumType::F32)?;
    Ok(host.as_slice::<f32>()?.to_vec())
}
