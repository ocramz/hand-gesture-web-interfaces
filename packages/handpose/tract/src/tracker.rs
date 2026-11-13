//! Turns per-frame detections into two stable hand slots (0 = left of the screen, 1 = right) with
//! appear/disappear hysteresis and One-Euro smoothing of every keypoint. A port of `src/pose/tracker.ts`
//! (which the ORT engine still uses): keep the two in step.

use std::f64::consts::PI;

use crate::decode::{Hand, NUM_KP};

/// One-Euro filter (Casiez et al. 2012): little lag when moving fast, little jitter when still.
#[derive(Debug, Clone)]
pub struct OneEuro {
    pub min_cutoff: f64,
    pub beta: f64,
    pub d_cutoff: f64,
    x: f64,
    dx: f64,
    t: f64,
}

impl OneEuro {
    pub fn new(min_cutoff: f64, beta: f64) -> Self {
        Self { min_cutoff, beta, d_cutoff: 1.0, x: 0.0, dx: 0.0, t: -1.0 }
    }

    pub fn reset(&mut self) {
        self.t = -1.0;
    }

    pub fn filter(&mut self, x: f64, t: f64) -> f64 {
        if self.t < 0.0 || t <= self.t {
            if self.t < 0.0 {
                self.x = x;
                self.dx = 0.0;
            }
            self.t = t;
            return self.x;
        }
        let dt = t - self.t;
        self.t = t;
        self.dx += alpha(self.d_cutoff, dt) * ((x - self.x) / dt - self.dx);
        self.x += alpha(self.min_cutoff + self.beta * self.dx.abs(), dt) * (x - self.x);
        self.x
    }
}

fn alpha(cutoff: f64, dt: f64) -> f64 {
    let tau = 1.0 / (2.0 * PI * cutoff);
    1.0 / (1.0 + tau / dt)
}

#[derive(Debug, Clone)]
pub struct Slot {
    /// Shown: seen in `min_hits` frames running, and not yet missed `max_misses` times running.
    pub active: bool,
    /// Smoothed keypoints, source pixels, `NUM_KP × (x, y, visibility)`. Held while the hand is briefly lost.
    pub kp: [f32; NUM_KP * 3],
    pub conf: f64,
    pub hits: u32,
    pub misses: u32,
    filters: Vec<OneEuro>,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct TrackerOptions {
    pub min_hits: u32,
    pub max_misses: u32,
    pub min_cutoff: f64,
    pub beta: f64,
}

impl Default for TrackerOptions {
    fn default() -> Self {
        Self { min_hits: 2, max_misses: 5, min_cutoff: 1.2, beta: 0.015 }
    }
}

#[derive(Debug, Clone)]
pub struct HandTracker {
    pub slots: [Slot; 2],
    opts: TrackerOptions,
}

fn box_center_x(h: &Hand) -> f64 {
    (h.bbox[0] + h.bbox[2]) / 2.0
}

/// The screen x of a source x: the selfie view mirrors it.
fn screen_x(x: f64, width: f64, mirror: bool) -> f64 {
    if mirror { width - x } else { x }
}

impl HandTracker {
    pub fn new(opts: TrackerOptions) -> Self {
        let slot = || Slot {
            active: false,
            kp: [0.0; NUM_KP * 3],
            conf: 0.0,
            hits: 0,
            misses: 0,
            filters: vec![OneEuro::new(opts.min_cutoff, opts.beta); NUM_KP * 2],
        };
        Self { slots: [slot(), slot()], opts }
    }

    pub fn options(&self) -> TrackerOptions {
        self.opts
    }

    /// New options; the smoothing parameters apply from the next frame on.
    pub fn set_options(&mut self, opts: TrackerOptions) {
        self.opts = opts;
        for f in self.slots.iter_mut().flat_map(|s| s.filters.iter_mut()) {
            f.min_cutoff = opts.min_cutoff;
            f.beta = opts.beta;
        }
    }

    /// Assigns up to two detections (most confident first; `t` in seconds) to the slots and smooths them.
    pub fn update(&mut self, hands: &[Hand], t: f64, width: f64, mirror: bool) {
        let sx = |h: &Hand| screen_x(box_center_x(h), width, mirror);
        let mut assigned: [Option<&Hand>; 2] = [None, None];
        match hands {
            [] => {}
            [h] => {
                let x = sx(h);
                let live = self.slots.each_ref().map(|s| s.active || s.hits > 0);
                let slot_x = self.slots.each_ref().map(|s| screen_x(f64::from(s.kp[0]), width, mirror));
                let i = match live {
                    [true, true] => usize::from((slot_x[0] - x).abs() > (slot_x[1] - x).abs()),
                    [true, false] | [false, true] => {
                        let j = usize::from(!live[0]);
                        if (slot_x[j] - x).abs() < 0.25 * width { j } else { 1 - j }
                    }
                    [false, false] => usize::from(x >= width / 2.0),
                };
                assigned[i] = Some(h);
            }
            [a, b, ..] => {
                // Stable, like the TS sort: equal screen x keeps the confidence order.
                let (l, r) = if sx(b) < sx(a) { (b, a) } else { (a, b) };
                assigned = [Some(l), Some(r)];
            }
        }
        let opts = self.opts;
        for (slot, h) in self.slots.iter_mut().zip(assigned) {
            update_slot(slot, h, t, &opts);
        }
    }
}

fn update_slot(s: &mut Slot, h: Option<&Hand>, t: f64, opts: &TrackerOptions) {
    let Some(h) = h else {
        s.hits = 0;
        s.misses += 1;
        if s.misses >= opts.max_misses {
            s.active = false;
        }
        return;
    };
    let fresh = !s.active && s.hits == 0;
    if fresh {
        s.filters.iter_mut().for_each(OneEuro::reset);
    }
    s.misses = 0;
    s.hits += 1;
    if s.hits >= opts.min_hits {
        s.active = true;
    }
    s.conf = h.conf;
    for k in 0..NUM_KP {
        s.kp[3 * k] = s.filters[2 * k].filter(f64::from(h.kp[3 * k]), t) as f32;
        s.kp[3 * k + 1] = s.filters[2 * k + 1].filter(f64::from(h.kp[3 * k + 1]), t) as f32;
        let v = h.kp[3 * k + 2];
        s.kp[3 * k + 2] = if fresh { v } else { s.kp[3 * k + 2] + 0.5 * (v - s.kp[3 * k + 2]) };
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hand(x: f64) -> Hand {
        let y = 300.0;
        let mut kp = [0f32; NUM_KP * 3];
        for k in 0..NUM_KP {
            kp[3 * k..3 * k + 3].copy_from_slice(&[(x + k as f64) as f32, (y - k as f64) as f32, 1.0]);
        }
        Hand { bbox: [x - 50.0, y - 100.0, x + 50.0, y + 100.0], conf: 0.9, kp }
    }

    #[test]
    fn two_hands_go_to_screen_left_and_right_slots_mirrored() {
        let mut tr = HandTracker::new(TrackerOptions::default());
        // Mirror: source x = 1000 is screen-left on a 1280-wide frame.
        for f in 0..3 {
            tr.update(&[hand(200.0), hand(1000.0)], f64::from(f) / 30.0, 1280.0, true);
        }
        assert!(tr.slots[0].active && tr.slots[1].active, "both slots should be active");
        assert!((tr.slots[0].kp[0] - 1000.0).abs() < 1.0, "slot 0 wrist x {}", tr.slots[0].kp[0]);
        assert!((tr.slots[1].kp[0] - 200.0).abs() < 1.0, "slot 1 wrist x {}", tr.slots[1].kp[0]);
        // Input order doesn't matter.
        tr.update(&[hand(1000.0), hand(200.0)], 3.0 / 30.0, 1280.0, true);
        assert!((tr.slots[0].kp[0] - 1000.0).abs() < 1.0, "slot 0 wrist x {}", tr.slots[0].kp[0]);
    }

    #[test]
    fn appears_after_min_hits_disappears_after_max_misses_and_keeps_a_lone_hand_in_its_slot() {
        let mut tr = HandTracker::new(TrackerOptions { min_hits: 2, max_misses: 3, ..Default::default() });
        tr.update(&[hand(300.0)], 0.0, 1280.0, false);
        assert!(!tr.slots[0].active);
        tr.update(&[hand(300.0)], 0.033, 1280.0, false);
        assert!(tr.slots[0].active);
        // The lone hand drifts right past the middle: it stays in slot 0.
        for f in 2..10 {
            tr.update(&[hand(300.0 + f64::from(f) * 50.0)], f64::from(f) * 0.033, 1280.0, false);
        }
        assert!(tr.slots[0].active && !tr.slots[1].active, "the hand should stay in slot 0");
        tr.update(&[], 0.4, 1280.0, false);
        tr.update(&[], 0.43, 1280.0, false);
        assert!(tr.slots[0].active, "two misses are below max_misses");
        tr.update(&[], 0.46, 1280.0, false);
        assert!(!tr.slots[0].active, "three misses deactivate");
    }

    #[test]
    fn one_euro_smooths_jitter_and_follows_a_step() {
        let mut f = OneEuro::new(1.0, 0.0);
        let mut y = 0.0;
        for i in 0..60 {
            y = f.filter(if i % 2 == 1 { 1.0 } else { -1.0 }, f64::from(i) / 30.0);
        }
        assert!(y.abs() < 0.5, "jitter left {y}");
        for i in 60..150 {
            y = f.filter(100.0, f64::from(i) / 30.0);
        }
        assert!((y - 100.0).abs() < 1.0, "step reached {y}");
    }
}
