// SPDX-License-Identifier: Apache-2.0

"use client";

/** The page's single scroll conductor.
 *
 *  Every scroll-linked effect on the marketing pages used to own a scroll
 *  listener and a requestAnimationFrame loop of its own, so five-odd loops each
 *  read `scrollY` at their own phase and wrote styles whenever they happened to
 *  run. This module replaces all of them with one listener, one loop and one
 *  clock, and hands each frame to subscribers in two ordered passes: every
 *  `read` runs before every `write`, so layout reads are never interleaved with
 *  style writes.
 *
 *  Two copies of the scroll position leave here and the difference between them
 *  is the point. `y` / `prog` are exact — interface chrome reads those, so a
 *  chapter label is never late. `ySmooth` / `smooth` are damped — scenery reads
 *  those, and the lag is what gives the page weight.
 *
 *  Chapters are the sections carrying `data-chapter`, in document order. Scroll
 *  is expressed against them as a fractional chapter (`prog`) and, normalised
 *  across the whole run, as `tau`: 0 at the top of the document, 1 at the
 *  bottom. `tau` is the site's one piece of shared state — time toward
 *  maturity — and is published as a CSS variable so effects can read it
 *  without subscribing.
 */

export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Frame-rate-independent damping. `rate` is how fast `cur` chases `to`, in
 *  e-folds per second, so a value settles over the same wall-clock time at
 *  60Hz and at 144Hz — which the usual `cur += (to - cur) * 0.1` does not. */
export const damp = (cur: number, to: number, rate: number, dt: number) =>
  lerp(cur, to, 1 - Math.exp(-rate * dt));

/** Hermite ease between two edges, flat at both ends. Scroll-driven fades want
 *  this rather than a raw ramp: a linear fade visibly starts and stops, and the
 *  eye reads those corners as the page snapping rather than letting go. */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge1 <= edge0) return x < edge0 ? 0 : 1;
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Turn a scroll position into a fractional chapter: 2.35 is chapter 2, 35% of
 *  the way to chapter 3. Pure, so the mapping is testable without a DOM. */
export function progressFor(anchors: number[], y: number): number {
  const first = anchors[0];
  if (first === undefined) return 0;
  if (y <= first) return 0;
  let lo = first;
  for (let i = 1; i < anchors.length; i++) {
    const hi = anchors[i];
    if (hi === undefined) break;
    // Coincident anchors would divide by zero; a floor of one pixel costs
    // nothing and keeps the ramp finite.
    if (y <= hi) return i - 1 + (y - lo) / Math.max(1, hi - lo);
    lo = hi;
  }
  return anchors.length - 1;
}

/** Where each chapter counts as arrived at: the first at the top of the
 *  document, and every other at the scroll position that centres it in the
 *  viewport.
 *
 *  The last chapter is centred like the rest rather than pinned to the bottom of
 *  the document, so the run completes on the last section of content. The page
 *  ends with a footer that is revealed from under the content, and pinning the
 *  final anchor to the document floor spent the last of the run inside that
 *  reveal — where an opaque footer is covering the very thing the run was
 *  building to. Scrolling past the last anchor simply holds at 1.
 *
 *  The running floor keeps the list strictly increasing: a short section between
 *  two tall ones can otherwise hand back an anchor behind its predecessor, which
 *  would make `progressFor` run backwards through it. */
export function chapterAnchors(
  sections: Array<{ top: number; height: number }>,
  viewport: number,
  max: number,
): number[] {
  if (sections.length < 2) return [0, max];
  let floor = -1;
  const out = sections.map((s, i) => {
    const raw = i === 0 ? 0 : clamp(s.top + s.height / 2 - viewport / 2, 0, max);
    floor = Math.max(raw, floor + 1);
    return floor;
  });

  // A short document or a tall viewport can pile several sections onto the same
  // clamped position, and the running floor then walks the tail past the end of
  // the run. An anchor beyond `max` is a scroll position nobody can reach, which
  // would mean tau never arrives at 1 — so walk back down and fit the tail.
  let ceiling = max;
  for (let i = out.length - 1; i >= 0; i--) {
    const current = out[i];
    if (current === undefined) continue;
    const fitted = Math.max(0, Math.min(current, ceiling));
    out[i] = fitted;
    ceiling = fitted - 1;
  }
  return out;
}

export type Frame = {
  /** Exact window scroll position, in px. */
  y: number;
  /** Damped copy of `y`. Scenery reads this. */
  ySmooth: number;
  /** Seconds since the previous frame, clamped so a backgrounded tab cannot
   *  hand the next frame a huge step. */
  dt: number;
  /** Exact fractional chapter. */
  prog: number;
  /** Damped copy of `prog`. */
  smooth: number;
  /** `prog` normalised to 0..1 across every chapter: time toward maturity. */
  tau: number;
  /** Damped copy of `tau`. */
  tauSmooth: number;
  /** Nearest whole chapter. Interface chrome reads this, never `smooth`, or it
   *  updates a beat after the reader has arrived. */
  chapter: number;
  /** How many chapters the document declared. */
  chapters: number;
  /** True when the visitor asked the OS to reduce motion. Subscribers that
   *  exist only to animate should return early on it. */
  reduced: boolean;
};

type Handler = { write: (f: Frame) => void; read?: (f: Frame) => void };

// Damping rates, in e-folds per second. Chapter progress is heavier than the
// parallax layers: the composition should settle after the page has, not with
// it. Lenis has already smoothed the raw scroll, so these are deliberately
// brisk — enough to give weight, not enough to read as lag.
const PROG_RATE = 6.5;
const Y_RATE = 9;

// Below these the damped value is snapped to its target and the loop is
// allowed to stop; sub-pixel chasing is invisible and would idle at 60fps.
const SETTLE_PX = 0.05;
const SETTLE_PROG = 0.0005;

const MAX_DT = 1 / 20;
const CHAPTER_SELECTOR = "[data-chapter]";
const REDUCE_QUERY = "(prefers-reduced-motion: reduce)";

const subs = new Set<Handler>();
const frame: Frame = {
  y: 0,
  ySmooth: 0,
  dt: 0,
  prog: 0,
  smooth: 0,
  tau: 0,
  tauSmooth: 0,
  chapter: 0,
  chapters: 1,
  reduced: false,
};

let anchors: number[] = [0, 1];
let raf = 0;
let last = 0;
let holds = 0;
let running = false;
let published = "";
let reduceMq: MediaQueryList | null = null;
let bodyRo: ResizeObserver | null = null;

function measure() {
  const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
  const boxes = Array.from(document.querySelectorAll<HTMLElement>(CHAPTER_SELECTOR)).map((el) => {
    const rect = el.getBoundingClientRect();
    return { top: rect.top + window.scrollY, height: rect.height };
  });
  anchors = chapterAnchors(boxes, window.innerHeight, max);
}

/** Publish the shared state on the root element so CSS-only consumers can read
 *  it. Written at most once per frame and skipped when nothing rounded moved,
 *  because a variable write on `<html>` invalidates style for the whole tree.
 *  The attribute is `data-active-chapter`, not `data-chapter`, so the root does
 *  not match the selector the conductor measures chapters with. */
function publish() {
  const stamp = `${frame.tau.toFixed(4)}|${frame.tauSmooth.toFixed(4)}|${frame.chapter}`;
  if (stamp === published) return;
  published = stamp;
  const root = document.documentElement;
  root.style.setProperty("--tau", frame.tau.toFixed(4));
  root.style.setProperty("--tau-smooth", frame.tauSmooth.toFixed(4));
  root.style.setProperty("--chapter", String(frame.chapter));
  root.dataset.activeChapter = String(frame.chapter);
}

function tick(now: number) {
  raf = 0;
  const dt = last ? Math.min(MAX_DT, (now - last) / 1000) : 1 / 60;
  last = now;

  const y = window.scrollY;
  const prog = progressFor(anchors, y);
  const span = Math.max(1, anchors.length - 1);

  frame.dt = dt;
  frame.y = y;
  frame.prog = prog;
  frame.tau = prog / span;
  frame.chapter = Math.round(prog);
  frame.chapters = anchors.length;

  if (frame.reduced) {
    frame.ySmooth = y;
    frame.smooth = prog;
  } else {
    frame.ySmooth = damp(frame.ySmooth, y, Y_RATE, dt);
    frame.smooth = damp(frame.smooth, prog, PROG_RATE, dt);
    if (Math.abs(frame.ySmooth - y) < SETTLE_PX) frame.ySmooth = y;
    if (Math.abs(frame.smooth - prog) < SETTLE_PROG) frame.smooth = prog;
  }
  frame.tauSmooth = frame.smooth / span;

  publish();
  subs.forEach((s) => s.read?.(frame));
  subs.forEach((s) => s.write(frame));

  // A held loop runs on regardless; an unheld one stops the moment the damped
  // values have caught their targets, and `last` is cleared so the frame that
  // wakes it does not inherit a dt measured across the idle gap.
  if (holds > 0 || frame.ySmooth !== y || frame.smooth !== prog) schedule();
  else last = 0;
}

function schedule() {
  if (!raf && running) raf = requestAnimationFrame(tick);
}

function onResize() {
  measure();
  schedule();
}

function onVisibility() {
  if (document.hidden) {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    last = 0;
  } else {
    schedule();
  }
}

function onReduce(e: MediaQueryListEvent) {
  frame.reduced = e.matches;
  schedule();
}

function start() {
  if (running) return;
  running = true;

  reduceMq = window.matchMedia(REDUCE_QUERY);
  frame.reduced = reduceMq.matches;
  reduceMq.addEventListener("change", onReduce);

  measure();
  frame.ySmooth = window.scrollY;
  frame.smooth = progressFor(anchors, window.scrollY);

  window.addEventListener("scroll", schedule, { passive: true });
  window.addEventListener("resize", onResize, { passive: true });
  document.addEventListener("visibilitychange", onVisibility);

  // Fonts loading, images settling and route transitions all change the
  // document height without a resize event; re-measuring on any body box
  // change is cheaper than getting the anchors wrong.
  bodyRo = new ResizeObserver(onResize);
  bodyRo.observe(document.body);

  schedule();
}

function stop() {
  if (!running) return;
  running = false;
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
  last = 0;
  published = "";
  const root = document.documentElement;
  root.style.removeProperty("--tau");
  root.style.removeProperty("--tau-smooth");
  root.style.removeProperty("--chapter");
  delete root.dataset.activeChapter;
  reduceMq?.removeEventListener("change", onReduce);
  reduceMq = null;
  bodyRo?.disconnect();
  bodyRo = null;
  window.removeEventListener("scroll", schedule);
  window.removeEventListener("resize", onResize);
  document.removeEventListener("visibilitychange", onVisibility);
}

/** Attach to the conductor. `read` runs in the layout-reading pass and `write`
 *  in the style-writing pass; a subscriber that only needs the frame's numbers
 *  can supply `write` alone. Returns the detach function. */
export function subscribe(write: (f: Frame) => void, read?: (f: Frame) => void): () => void {
  const handler: Handler = { write, read };
  subs.add(handler);
  start();
  schedule();
  return () => {
    subs.delete(handler);
    if (subs.size === 0 && holds === 0) stop();
  };
}

/** Keep the loop running past settle, for consumers that animate continuously
 *  rather than only while the page is moving. Returns the release function. */
export function hold(): () => void {
  holds += 1;
  start();
  schedule();
  return () => {
    holds = Math.max(0, holds - 1);
    if (subs.size === 0 && holds === 0) stop();
  };
}

/** Re-measure the chapter anchors. Call after anything that changes document
 *  height which the body observer would not see. */
export function refresh() {
  if (running) onResize();
}

/** The measured anchor of each chapter, in document order. */
export function getAnchors(): readonly number[] {
  return anchors;
}

let scrollDelegate: ((y: number) => void) | null = null;

/** Hand the conductor a smoother way to travel. SmoothScroll registers Lenis
 *  here so a chapter jump glides like every other scroll on the page; without
 *  one, the jump is native. */
export function setScrollDelegate(fn: ((y: number) => void) | null) {
  scrollDelegate = fn;
}

/** Travel to a chapter's measured anchor — the exact position that reads as
 *  that chapter, not the top of its section. Landing anywhere else is how a
 *  rail ends up pointing at a chapter the reader is not actually in. */
export function scrollToChapter(index: number) {
  const y = anchors[index];
  if (y === undefined) return;
  if (scrollDelegate) scrollDelegate(y);
  else window.scrollTo({ top: y, behavior: frame.reduced ? "auto" : "smooth" });
}

/** The live frame. Read-only by convention: the conductor mutates one object
 *  rather than allocating per frame. */
export function getFrame(): Readonly<Frame> {
  return frame;
}
