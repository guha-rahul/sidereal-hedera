// SPDX-License-Identifier: Apache-2.0

/** The scene ledger for the landing page's world. See WORLD.md beside this file
 *  for the prose bible this data implements.
 *
 *  Everything the world does per chapter lives here rather than being scattered
 *  through the render loop: the camera endpoints, what the machine is doing, and
 *  which parts of it the frame is about. A chapter whose camera and change
 *  cannot be named does not belong in the list. */

export type Vec3 = readonly [number, number, number];

/** How the machine is set at a chapter. Values interpolate between chapters, so
 *  every field has to be meaningful at any point in between, not only at the
 *  waypoints. */
export type WorldState = {
  /** Key light intensity. */
  key: number;
  /** Exponential fog density. Higher buries the far side of the instrument. */
  fog: number;
  /** How fast the ring system idles, as a multiple of its base rate. */
  spin: number;
  /** Bloom strength on the two bodies. */
  bloom: number;
  /** How much the rig's look-at is pulled onto the principal body, 0..1.
   *
   *  The waypoints compose the *instrument*; this composes the *subject*. The
   *  position sweeps a quarter-turn between chapters, so a look-at authored as
   *  a fixed point either loses the body or has to swing so far between
   *  waypoints that the camera whips. Blending the authored target toward the
   *  body keeps the composition's character and keeps the thing the chapter is
   *  about in frame — verified by sampling the whole run, not by eye. */
  follow: number;
  /** How much near-plane structure crosses the frame, 0..1. Chapter 2 is the
   *  one whose authored change is "structure passes the near plane on both
   *  sides", so it is the only one that goes to full. */
  near: number;
};

export type WorldChapter = {
  /** Must match the `data-chapter` slug on the section, in document order. */
  id: string;
  /** What the visitor understands here. */
  beat: string;
  /** The dominant spatial subject of the frame. */
  landmark: string;
  /** How this frame differs from the previous one beyond copy. */
  change: string;
  camera: { p: Vec3; t: Vec3; fov: number };
  state: WorldState;
};

export const WORLD_CHAPTERS: readonly WorldChapter[] = [
  {
    id: "issuance",
    beat: "One position, whole, entering the machine.",
    landmark: "outer graduation ring",
    change: "Establishing. Outside the instrument, long lens, the whole silhouette in frame.",
    camera: { p: [-6.0, 10.0, -28.0], t: [ 0.0, 1.0, 0.0], fov: 34 },
    state: { key: 1.5, fog: 0.016, spin: 0.6, bloom: 0.35, follow: 0.45, near: 0.0 },
  },
  {
    id: "split",
    beat: "The position resolves into a principal leg and a yield leg.",
    landmark: "central gimbal",
    change: "The camera crosses inside the outer ring; the gimbal fills the right of frame.",
    camera: { p: [ 5.5, 3.4, -15.0], t: [ 0.0, 1.0, -2.0], fov: 44 },
    state: { key: 0.95, fog: 0.026, spin: 1.0, bloom: 0.6, follow: 0.5, near: 0.35 },
  },
  {
    id: "mechanism",
    beat: "The two legs ride the machine at different rates.",
    landmark: "armature spine",
    change: "Close travel along the armature. Structure passes the near plane on both sides.",
    camera: { p: [ 9.5, 3.0, -1.0], t: [-2.0, 1.6, -9.0], fov: 48 },
    state: { key: 1.0, fog: 0.032, spin: 1.25, bloom: 0.7, follow: 0.45, near: 1.0 },
  },
  {
    id: "market",
    beat: "The distance between the legs is the spread, and it is traded.",
    landmark: "counter-rotating ring pair",
    change: "Pull back and orbit to the far side; the two rings are seen opposing each other.",
    camera: { p: [-4.0, 6.5, -14.0], t: [ 2.0, 1.2, -3.0], fov: 42 },
    state: { key: 0.85, fog: 0.027, spin: 1.4, bloom: 0.55, follow: 0.6, near: 0.5 },
  },
  {
    id: "maturity",
    beat: "The yield is spent and the principal seats at par.",
    landmark: "the par detent",
    change: "The rig settles square to the detent. The rings slow, and the amber goes out.",
    camera: { p: [ 0.0, 2.0, 15.0], t: [ 0.0, 1.0, -2.0], fov: 44 },
    state: { key: 0.6, fog: 0.019, spin: 0.25, bloom: 0.25, follow: 0.5, near: 0.15 },
  },
] as const;

/** The instrument's fixed dimensions, in world units (1 = 1 metre). */
export const RIG = {
  outerRadius: 12,
  innerRadius: 7.4,
  gimbalRadius: 1.4,
  /** Where the principal seats at maturity, on the outer ring. */
  parAngle: 0,
  /** Where a position enters, half a turn away from par. */
  entryAngle: Math.PI,
} as const;

/** Linear blend between two world states. The render loop reads a chapter
 *  fraction, never a chapter index, so every field has to interpolate. */
export function blendState(a: WorldState, b: WorldState, t: number, out?: WorldState): WorldState {
  const mix = (x: number, y: number) => x + (y - x) * t;
  if (out) {
    out.key = mix(a.key, b.key);
    out.fog = mix(a.fog, b.fog);
    out.spin = mix(a.spin, b.spin);
    out.bloom = mix(a.bloom, b.bloom);
    out.follow = mix(a.follow, b.follow);
    out.near = mix(a.near, b.near);
    return out;
  }
  return {
    key: mix(a.key, b.key),
    fog: mix(a.fog, b.fog),
    spin: mix(a.spin, b.spin),
    bloom: mix(a.bloom, b.bloom),
    follow: mix(a.follow, b.follow),
    near: mix(a.near, b.near),
  };
}

/** The world state at a fractional chapter, e.g. 2.35. Clamped at both ends. */
export function stateAt(progress: number, out?: WorldState): WorldState {
  const last = WORLD_CHAPTERS.length - 1;
  const clamped = progress < 0 ? 0 : progress > last ? last : progress;
  const index = Math.min(Math.floor(clamped), last - 1);
  const a = WORLD_CHAPTERS[index];
  const b = WORLD_CHAPTERS[index + 1];
  if (!a || !b) {
    const only = WORLD_CHAPTERS[0];
    if (!only) throw new Error("world ledger is empty");
    return out ? blendState(only.state, only.state, 0, out) : only.state;
  }
  return blendState(a.state, b.state, clamped - index, out);
}
