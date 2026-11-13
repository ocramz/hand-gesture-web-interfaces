//! Pre- and post-processing for the YOLO26 hand-pose model: letterboxing, the input tensor and the
//! end-to-end output (`[1, 300, 69]`, already NMS-free). A port of `src/pose/decode.ts`: keep the two in step.

/// The model's square input side.
pub const MODEL_SIZE: usize = 640;
/// Keypoints per hand (MediaPipe's 21-point layout).
pub const NUM_KP: usize = 21;
/// One output row: x1, y1, x2, y2, conf, class, then (x, y, visibility) per keypoint.
pub const ROW_STRIDE: usize = 6 + NUM_KP * 3;
/// Detections the model's end-to-end output keeps.
pub const MAX_DETECTIONS: usize = 300;

/// Where a frame sits inside the model's square input.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Letterbox {
    pub size: f64,
    pub scale: f64,
    pub pad_x: f64,
    pub pad_y: f64,
    /// The scaled frame's size inside the square.
    pub w: f64,
    pub h: f64,
}

/// Fits a `src_w × src_h` frame into the `size²` square, centred.
pub fn letterbox(src_w: f64, src_h: f64, size: f64) -> Letterbox {
    let scale = (size / src_w).min(size / src_h);
    let w = (src_w * scale).round();
    let h = (src_h * scale).round();
    Letterbox { size, scale, pad_x: ((size - w) / 2.0).floor(), pad_y: ((size - h) / 2.0).floor(), w, h }
}

impl Letterbox {
    pub fn to_model(&self, x: f64, y: f64) -> (f64, f64) {
        (x * self.scale + self.pad_x, y * self.scale + self.pad_y)
    }

    pub fn from_model(&self, x: f64, y: f64) -> (f64, f64) {
        ((x - self.pad_x) / self.scale, (y - self.pad_y) / self.scale)
    }
}

/// RGBA bytes (`size × size`) → planar RGB floats in 0..1, the model's NCHW input.
pub fn rgba_to_chw(rgba: &[u8], size: usize, out: &mut [f32]) {
    let n = size * size;
    let (r, rest) = out.split_at_mut(n);
    let (g, b) = rest.split_at_mut(n);
    let k = 1.0 / 255.0;
    for (i, px) in rgba.as_chunks::<4>().0.iter().take(n).enumerate() {
        r[i] = f32::from(px[0]) * k;
        g[i] = f32::from(px[1]) * k;
        b[i] = f32::from(px[2]) * k;
    }
}

/// The head's per-anchor predictions, anchor-major, boxes and keypoints already in model pixels: the
/// inputs of the graph's end-to-end selection.
#[derive(Debug, Clone, Default)]
pub struct RawHead {
    /// `anchors × (x1, y1, x2, y2)`.
    pub boxes: Vec<f32>,
    /// `anchors` scores, 0..1.
    pub scores: Vec<f32>,
    /// `anchors × NUM_KP × (x, y, visibility)`.
    pub kpts: Vec<f32>,
}

/// The model's end-to-end selection, done here instead of in the graph: the anchors scoring at least
/// `min_conf`, best first (at most `MAX_DETECTIONS`), as `output0` rows (`ROW_STRIDE` floats, class 0).
/// The graph takes the top 300 and the caller thresholds; thresholding first gives the same rows.
pub fn top_detections(raw: &RawHead, min_conf: f32) -> Vec<f32> {
    let mut picked: Vec<usize> = (0..raw.scores.len()).filter(|&a| raw.scores[a] >= min_conf).collect();
    // Stable: equal scores keep the anchor order.
    picked.sort_by(|&a, &b| raw.scores[b].total_cmp(&raw.scores[a]));
    picked.truncate(MAX_DETECTIONS);
    let kp_len = 3 * NUM_KP;
    let mut out = Vec::with_capacity(picked.len() * ROW_STRIDE);
    for a in picked {
        out.extend_from_slice(&raw.boxes[4 * a..4 * a + 4]);
        out.extend_from_slice(&[raw.scores[a], 0.0]);
        out.extend_from_slice(&raw.kpts[kp_len * a..kp_len * (a + 1)]);
    }
    out
}

/// A detected hand, in source-frame pixels (not mirrored).
#[derive(Debug, Clone, PartialEq)]
pub struct Hand {
    pub bbox: [f64; 4],
    pub conf: f64,
    /// `NUM_KP × (x, y, visibility)`.
    pub kp: [f32; NUM_KP * 3],
}

fn iou(a: &[f64; 4], b: &[f64; 4]) -> f64 {
    let ix = (a[2].min(b[2]) - a[0].max(b[0])).max(0.0);
    let iy = (a[3].min(b[3]) - a[1].max(b[1])).max(0.0);
    let inter = ix * iy;
    let union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter;
    if union > 0.0 { inter / union } else { 0.0 }
}

#[derive(Debug, Clone, Copy)]
pub struct DecodeOptions {
    pub conf_threshold: f64,
    pub max_hands: usize,
    /// Duplicates are rare in end-to-end output; this is a cheap guard.
    pub iou_threshold: f64,
    /// Multiplies the un-letterboxed coordinates (a frame downscaled before inference → source pixels).
    pub src_scale: f64,
}

/// Hands above the threshold, most confident first, in source pixels.
pub fn decode_hands(out: &[f32], lb: &Letterbox, opts: &DecodeOptions) -> Vec<Hand> {
    let conf = |r: usize| f64::from(out[r * ROW_STRIDE + 4]);
    let mut picked: Vec<usize> = (0..out.len() / ROW_STRIDE).filter(|&r| conf(r) >= opts.conf_threshold).collect();
    // Stable, like Array.prototype.sort: equal confidences keep the model's order.
    picked.sort_by(|&a, &b| conf(b).total_cmp(&conf(a)));
    let s = opts.src_scale;
    let mut hands: Vec<Hand> = Vec::new();
    for r in picked {
        let o = r * ROW_STRIDE;
        let at = |i: usize| f64::from(out[o + i]);
        let (x1, y1) = lb.from_model(at(0), at(1));
        let (x2, y2) = lb.from_model(at(2), at(3));
        let bbox = [x1 * s, y1 * s, x2 * s, y2 * s];
        if hands.iter().any(|h| iou(&h.bbox, &bbox) > opts.iou_threshold) {
            continue;
        }
        let mut kp = [0f32; NUM_KP * 3];
        for k in 0..NUM_KP {
            let (x, y) = lb.from_model(at(6 + 3 * k), at(7 + 3 * k));
            kp[3 * k] = (x * s) as f32;
            kp[3 * k + 1] = (y * s) as f32;
            kp[3 * k + 2] = out[o + 8 + 3 * k];
        }
        hands.push(Hand { bbox, conf: conf(r), kp: canonicalize(&kp).kp });
        if hands.len() >= opts.max_hands {
            break;
        }
    }
    hands
}

/// The model doesn't always use one keypoint order: depending on the image it emits either MediaPipe's
/// order or this permutation of it (thumb IP ↔ tip, and index MCP..tip + middle MCP ↔ middle PIP..tip +
/// ring MCP, PIP), which looks like a training-time flip_idx. It is its own inverse.
pub const SWAPPED_ORDER: [usize; NUM_KP] = [0, 1, 2, 4, 3, 10, 11, 12, 13, 14, 5, 6, 7, 8, 9, 15, 16, 17, 18, 19, 20];
const IDENTITY_ORDER: [usize; NUM_KP] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
const THUMB_BONES: [(usize, usize); 3] = [(1, 2), (2, 3), (3, 4)];
const FINGER_BONES: [(usize, usize); 14] = [
    (0, 5),
    (5, 6),
    (6, 7),
    (7, 8),
    (0, 9),
    (9, 10),
    (10, 11),
    (11, 12),
    (0, 13),
    (13, 14),
    (14, 15),
    (15, 16),
    (5, 9),
    (9, 13),
];

fn bones_length(kp: &[f32; NUM_KP * 3], bones: &[(usize, usize)], order: &[usize; NUM_KP]) -> f64 {
    bones
        .iter()
        .map(|&(a, b)| {
            let (i, j) = (order[a] * 3, order[b] * 3);
            f64::from(kp[i] - kp[j]).hypot(f64::from(kp[i + 1] - kp[j + 1]))
        })
        .sum()
}

#[derive(Debug, Clone, PartialEq)]
pub struct Canonical {
    pub kp: [f32; NUM_KP * 3],
    pub thumb_swapped: bool,
    pub fingers_swapped: bool,
}

/// Puts a detection's keypoints in MediaPipe order. The thumb and the fingers are decided separately: the
/// reading whose bones are shorter wins (the wrong one zig-zags between fingers).
pub fn canonicalize(kp: &[f32; NUM_KP * 3]) -> Canonical {
    let thumb_swapped =
        bones_length(kp, &THUMB_BONES, &SWAPPED_ORDER) < bones_length(kp, &THUMB_BONES, &IDENTITY_ORDER);
    let fingers_swapped =
        bones_length(kp, &FINGER_BONES, &SWAPPED_ORDER) < bones_length(kp, &FINGER_BONES, &IDENTITY_ORDER);
    let mut out = [0f32; NUM_KP * 3];
    for m in 0..NUM_KP {
        let swap = match m {
            3 | 4 => thumb_swapped,
            5..=14 => fingers_swapped,
            _ => false,
        };
        let src = if swap { SWAPPED_ORDER[m] } else { m } * 3;
        out[3 * m..3 * m + 3].copy_from_slice(&kp[src..src + 3]);
    }
    Canonical { kp: out, thumb_swapped, fingers_swapped }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    /// A plausible open hand (MediaPipe order), fingers up, in model pixels around (cx, cy).
    pub(crate) fn hand_kp(cx: f32, cy: f32, s: f32) -> [f32; NUM_KP * 3] {
        let pts: [(f32, f32); NUM_KP] = [
            (0., 90.),
            (-30., 70.),
            (-50., 45.),
            (-62., 22.),
            (-72., 2.),
            (-25., 0.),
            (-28., -35.),
            (-30., -58.),
            (-32., -78.),
            (0., -5.),
            (0., -45.),
            (0., -70.),
            (0., -92.),
            (22., 0.),
            (25., -35.),
            (27., -58.),
            (28., -76.),
            (42., 10.),
            (48., -15.),
            (52., -32.),
            (55., -48.),
        ];
        let mut kp = [0f32; NUM_KP * 3];
        for (k, (x, y)) in pts.iter().enumerate() {
            kp[3 * k..3 * k + 3].copy_from_slice(&[cx + x * s, cy + y * s, 0.9]);
        }
        kp
    }

    fn row(out: &mut [f32], r: usize, conf: f32, kp: &[f32; NUM_KP * 3]) {
        let xs = || kp.chunks(3).map(|p| p[0]);
        let ys = || kp.chunks(3).map(|p| p[1]);
        let o = r * ROW_STRIDE;
        out[o..o + 6].copy_from_slice(&[
            xs().fold(f32::INFINITY, f32::min),
            ys().fold(f32::INFINITY, f32::min),
            xs().fold(f32::NEG_INFINITY, f32::max),
            ys().fold(f32::NEG_INFINITY, f32::max),
            conf,
            0.,
        ]);
        out[o + 6..o + ROW_STRIDE].copy_from_slice(kp);
    }

    fn permute(kp: &[f32; NUM_KP * 3]) -> [f32; NUM_KP * 3] {
        let mut out = [0f32; NUM_KP * 3];
        for m in 0..NUM_KP {
            let s = SWAPPED_ORDER[m] * 3;
            out[3 * m..3 * m + 3].copy_from_slice(&kp[s..s + 3]);
        }
        out
    }

    #[test]
    fn letterbox_centres_the_frame_and_round_trips() {
        let lb = letterbox(1280., 720., 640.);
        assert_eq!((lb.scale, lb.w, lb.h, lb.pad_x, lb.pad_y), (0.5, 640., 360., 0., 140.));
        for (x, y) in [(0., 0.), (1279., 719.), (640., 360.), (17.5, 600.25)] {
            let (mx, my) = lb.to_model(x, y);
            let (sx, sy) = lb.from_model(mx, my);
            assert!((sx - x).abs() < 1e-9 && (sy - y).abs() < 1e-9, "({x}, {y}) came back as ({sx}, {sy})");
        }
        let tall = letterbox(224., 400., 640.);
        assert_eq!(tall.h, 640.);
        assert_eq!(tall.pad_y, 0.);
        assert_eq!(tall.pad_x, ((640. - tall.w) / 2.).floor());
    }

    #[test]
    fn rgba_to_chw_makes_planar_rgb_in_unit_range() {
        let mut out = [0f32; 3];
        rgba_to_chw(&[255, 0, 51, 255], 1, &mut out);
        assert_eq!(out.map(|v| (v * 1000.).round() / 1000.), [1., 0., 0.2]);
        let mut two = [0f32; 12];
        rgba_to_chw(&[255; 16], 2, &mut two);
        assert!(two.iter().all(|&v| v == 1.), "{two:?}");
    }

    #[test]
    fn decode_hands_thresholds_sorts_unletterboxes_and_drops_duplicates() {
        let lb = letterbox(1280., 720., 640.);
        let mut out = vec![0f32; 300 * ROW_STRIDE];
        row(&mut out, 0, 0.5, &hand_kp(200., 300., 1.));
        row(&mut out, 1, 0.9, &hand_kp(450., 320., 1.));
        row(&mut out, 2, 0.85, &hand_kp(451., 321., 1.)); // duplicate of row 1
        row(&mut out, 3, 0.2, &hand_kp(320., 320., 1.)); // below threshold
        let opts = DecodeOptions { conf_threshold: 0.4, max_hands: 4, iou_threshold: 0.6, src_scale: 1. };
        let hands = decode_hands(&out, &lb, &opts);
        assert_eq!(hands.len(), 2);
        assert_eq!(hands[0].conf, f64::from(out[ROW_STRIDE + 4]));
        // Wrist of row 1 at model (450, 410) → source ((450 − 0)/0.5, (410 − 140)/0.5).
        assert!(
            (hands[0].kp[0] - 900.).abs() < 1e-3 && (hands[0].kp[1] - 540.).abs() < 1e-3,
            "{:?}",
            &hands[0].kp[..2]
        );
        let scaled = decode_hands(&out, &lb, &DecodeOptions { max_hands: 1, src_scale: 2., ..opts });
        assert_eq!(scaled.len(), 1);
        assert!((scaled[0].kp[0] - 1800.).abs() < 1e-3, "{}", scaled[0].kp[0]);
    }

    #[test]
    fn top_detections_thresholds_sorts_and_inserts_the_class() {
        let scores = vec![0.2f32, 0.9, 0.05, 0.6];
        let n = scores.len();
        let raw = RawHead {
            boxes: (0..4 * n).map(|i| i as f32).collect(),
            kpts: (0..3 * NUM_KP * n).map(|i| 1000.0 + i as f32).collect(),
            scores,
        };
        let rows = top_detections(&raw, 0.1);
        assert_eq!(rows.len(), 3 * ROW_STRIDE);
        let scores: Vec<f32> = rows.chunks(ROW_STRIDE).map(|r| r[4]).collect();
        assert_eq!(scores, [0.9, 0.6, 0.2]);
        let first = &rows[..ROW_STRIDE];
        assert_eq!(&first[..4], &[4., 5., 6., 7.], "anchor 1's box");
        assert_eq!(first[5], 0.0, "class");
        assert_eq!(first[6], 1000.0 + 63.0, "anchor 1's first keypoint x");
        assert_eq!(first[ROW_STRIDE - 1], 1000.0 + 125.0, "anchor 1's last keypoint visibility");
    }

    #[test]
    fn canonicalize_undoes_the_swapped_order_per_group() {
        for s in [1., 0.5, 2.] {
            let k = hand_kp(300., 300., s);
            assert_eq!(canonicalize(&k), Canonical { kp: k, thumb_swapped: false, fingers_swapped: false });
            assert_eq!(canonicalize(&permute(&k)), Canonical { kp: k, thumb_swapped: true, fingers_swapped: true });
        }
        let kp = hand_kp(300., 300., 1.);
        let mut thumb_only = kp;
        thumb_only[9..12].copy_from_slice(&kp[12..15]);
        thumb_only[12..15].copy_from_slice(&kp[9..12]);
        assert_eq!(canonicalize(&thumb_only), Canonical { kp, thumb_swapped: true, fingers_swapped: false });
    }
}
