//! The real model on the sample photos, natively, on tract's CPU runtime: the graph loads, its ops are
//! supported, and the pipeline finds the hands. Needs `npm run fetch-model`; skipped without the weights.

use std::path::{Path, PathBuf};

use handpose_tract::decode::{Hand, MODEL_SIZE, ROW_STRIDE, top_detections};
use handpose_tract::pipeline::{Frame, Pipeline, prepare};
use image::imageops::{FilterType, overlay, resize};
use image::{Rgba, RgbaImage};

fn assets() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../assets")
}

fn model(precision: &str) -> Option<Vec<u8>> {
    let path = assets().join(format!("models/yolo26_hand_pose_{precision}.onnx"));
    match std::fs::read(&path) {
        Ok(bytes) if bytes.len() > 1 << 20 => Some(bytes),
        _ => {
            eprintln!("skipped: {} missing (npm run fetch-model)", path.display());
            None
        }
    }
}

/// The photo letterboxed onto the grey 640² input, as the worker draws it, and its frame.
fn letterboxed(sample: &str) -> (RgbaImage, Frame) {
    let img = image::open(assets().join("samples").join(sample)).expect("sample image").to_rgba8();
    let (w, h) = (f64::from(img.width()), f64::from(img.height()));
    let lb = Pipeline::letterbox(w, h);
    let scaled = resize(&img, lb.w as u32, lb.h as u32, FilterType::Triangle);
    let mut canvas = RgbaImage::from_pixel(MODEL_SIZE as u32, MODEL_SIZE as u32, Rgba([114, 114, 114, 255]));
    overlay(&mut canvas, &scaled, lb.pad_x as i64, lb.pad_y as i64);
    (canvas, Frame { width: w, height: h, src_scale: 1.0, src_width: w, mirror: false, t: 0.0 })
}

fn assert_plausible(hands: &[Hand], frame: &Frame) {
    for h in hands {
        let [x1, y1, x2, y2] = h.bbox;
        assert!(h.conf > 0.5, "confidence {}", h.conf);
        assert!(x1 < x2 && y1 < y2, "box {:?}", h.bbox);
        assert!(
            x1 > -10.0 && y1 > -10.0 && x2 < frame.width + 10.0 && y2 < frame.height + 10.0,
            "box {:?} outside the photo",
            h.bbox
        );
        // Wrist → middle MCP: a palm, not a point.
        let palm = (h.kp[0] - h.kp[27]).hypot(h.kp[1] - h.kp[28]);
        assert!(palm > 10.0, "palm length {palm}");
    }
}

fn detect(precision: &str, sample: &str, frames: usize) -> Option<(Pipeline, Vec<Hand>)> {
    let bytes = model(precision)?;
    let mut pipeline = Pipeline::new(prepare(&bytes, "cpu").expect("prepare"), 0.4);
    let (rgba, mut frame) = letterboxed(sample);
    let mut hands = Vec::new();
    for f in 0..frames {
        frame.t = f as f64 / 30.0;
        hands = pollster::block_on(pipeline.run_rgba(rgba.as_raw(), &frame)).expect("run");
    }
    assert_plausible(&hands, &frame);
    Some((pipeline, hands))
}

/// The graph's own end-to-end output: the uncut model.
fn full_graph_output(bytes: &[u8], rgba: &RgbaImage) -> Vec<f32> {
    use tract::prelude::*;
    let mut m = tract::onnx().unwrap().load_buffer(bytes).unwrap();
    m.set_input_fact(0, "1,3,640,640,f32").unwrap();
    let runnable = tract::runtime_for_name("cpu").unwrap().prepare(m.into_model().unwrap()).unwrap();
    let mut chw = vec![0f32; 3 * MODEL_SIZE * MODEL_SIZE];
    handpose_tract::decode::rgba_to_chw(rgba.as_raw(), MODEL_SIZE, &mut chw);
    let out = runnable.run([Tensor::from_slice(&[1, 3, MODEL_SIZE, MODEL_SIZE], &chw).unwrap()]).unwrap();
    out[0].as_slice::<f32>().unwrap().to_vec()
}

#[test]
fn rust_selection_on_the_cut_graph_matches_the_graphs_end_to_end_output() {
    let Some(bytes) = model("fp32") else { return };
    let (rgba, _) = letterboxed("two_hands.jpg");
    let full = full_graph_output(&bytes, &rgba);
    let mut pipeline = Pipeline::new(prepare(&bytes, "cpu").expect("prepare"), 0.1);
    let raw = pollster::block_on(pipeline.raw_rgba(rgba.as_raw())).expect("run");
    let ours = top_detections(&raw, 0.1);
    eprintln!("{} rows above 0.1, best {}", ours.len() / ROW_STRIDE, ours[4]);
    assert!(!ours.is_empty(), "no detection above 0.1");
    assert_eq!(ours[..], full[..ours.len()], "the first {} rows differ", ours.len() / ROW_STRIDE);
    assert!(full[ours.len() + 4] < 0.1, "the graph's next row scores {}", full[ours.len() + 4]);
}

#[test]
fn finds_and_tracks_both_hands_in_two_hands_jpg() {
    let Some((pipeline, hands)) = detect("fp32", "two_hands.jpg", 2) else { return };
    assert_eq!(hands.len(), 2, "hands: {hands:?}");
    let slots = &pipeline.tracker().slots;
    assert!(slots[0].active && slots[1].active, "both slots active after two frames");
    assert!(slots[0].kp[0] < slots[1].kp[0], "slot 0 is the left hand (unmirrored)");
}

#[test]
fn finds_both_hands_in_hands_apart_jpg() {
    let Some((_, hands)) = detect("fp32", "hands_apart.jpg", 1) else { return };
    assert_eq!(hands.len(), 2, "hands: {hands:?}");
}

#[test]
fn packs_hands_then_two_slots() {
    let Some((pipeline, hands)) = detect("fp32", "two_hands.jpg", 2) else { return };
    let packed = pipeline.pack(&hands);
    assert_eq!(packed[0] as usize, hands.len());
    assert_eq!(packed.len(), 1 + hands.len() * 68 + 2 * 65);
}

/// The same detections on tract's wgpu runtime (Metal/Vulkan natively, WebGPU in the browser), in both
/// precisions, as on the CPU. Skipped on a host with no GPU adapter.
#[test]
fn wgpu_runtime_agrees_with_the_cpu() {
    let Some((_, cpu)) = detect("fp32", "two_hands.jpg", 1) else { return };
    for precision in ["fp32", "fp16"] {
        let Some(bytes) = model(precision) else { return };
        let runnable = match prepare(&bytes, "wgpu") {
            Ok(r) => r,
            Err(e) => {
                eprintln!("skipped wgpu/{precision}: {e:#}");
                continue;
            }
        };
        let mut pipeline = Pipeline::new(runnable, 0.4);
        let (rgba, frame) = letterboxed("two_hands.jpg");
        let gpu = pollster::block_on(pipeline.run_rgba(rgba.as_raw(), &frame)).expect("run on wgpu");
        assert_eq!(gpu.len(), cpu.len(), "wgpu/{precision} hands: {gpu:?}");
        let worst_kp = |g: &Hand, c: &Hand| {
            (0..21).map(|k| (g.kp[3 * k] - c.kp[3 * k]).hypot(g.kp[3 * k + 1] - c.kp[3 * k + 1])).fold(0f32, f32::max)
        };
        for g in &gpu {
            // Near-equal confidences may come out in either order: compare with the closest CPU hand.
            let (c, worst) =
                cpu.iter().map(|c| (c, worst_kp(g, c))).min_by(|a, b| a.1.total_cmp(&b.1)).expect("cpu hands");
            eprintln!("wgpu/{precision}: conf {:.3} vs {:.3}, worst keypoint {worst:.2} px", g.conf, c.conf);
            assert!(worst < 3.0, "wgpu/{precision} keypoints {worst} px off the CPU's");
        }
    }
}
