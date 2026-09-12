// SPDX-License-Identifier: Apache-2.0

import * as THREE from "three";
import { clamp, damp, lerp } from "@/lib/conductor";
import { orreryModel } from "@/lib/orrery";
import { WORLD_CHAPTERS, stateAt, type WorldState } from "@/lib/world/chapters";
import { buildBodies, type Bodies } from "@/lib/world/bodies";
import { buildForeground, FOREGROUND_LAYER, type Foreground } from "@/lib/world/foreground";
import { buildInstrument, type Instrument } from "@/lib/world/instrument";
import { environmentPanorama } from "@/lib/world/textures";

/** The world's runtime. Everything three.js touches lives behind this module so
 *  the library lands in one dynamically imported chunk and a visitor who gets
 *  the 2D fallback never downloads it. */

export type WorldFrame = {
  /** The conductor's damped chapter progress. Scenery reads this, never the
   *  exact channel — the lag is the weight. */
  smooth: number;
  /** The damped run position, 0 at issuance and 1 at maturity. The bodies read
   *  this rather than `smooth`, because what they express is time toward
   *  maturity, not which composition the camera is in. */
  tau: number;
  /** Seconds since the previous frame. */
  dt: number;
  /** Pointer position, -1..1, already damped by the caller. */
  mx: number;
  my: number;
};

/** What the rig did on the last frame. A debug surface, per the architecture
 *  reference: the camera's route is the one thing about this scene that cannot
 *  be checked from a screenshot, so it has to be readable from outside. */
export type WorldReadout = {
  px: number;
  py: number;
  pz: number;
  tx: number;
  ty: number;
  tz: number;
  fov: number;
  calls: number;
  /** The frame the rig composed for, so a resize can be waited on. */
  w: number;
  h: number;
  /** The run position the bodies were last placed at. */
  tau: number;
  /** How far apart the two legs are, 0 whole and 1 fully resolved. */
  separation: number;
  /** What is left of the yield leg. Exactly 0 at maturity. */
  ytLife: number;
  /** The near plane's appetite for this chapter, as the renderer received it. */
  near: number;
  /** Frames actually drawn since the world started. The idle throttle is only
   *  observable by counting them. */
  renders: number;
};

export type World = {
  setSize(width: number, height: number, dpr: number): void;
  update(frame: WorldFrame): void;
  dispose(): void;
  readout(): WorldReadout;
};

/** Is there a WebGL2 context to be had at all? Asked before the library is
 *  fetched, so a machine that cannot run the world does not pay for it. */
export function supportsWebGL(): boolean {
  try {
    const probe = document.createElement("canvas");
    return Boolean(probe.getContext("webgl2"));
  } catch {
    return false;
  }
}

/** The device tier. LOW halves the geometry and drops the finish; it is a
 *  coarse guess made once, not a frame-rate governor (that lands in gate 7). */
export function isLowTier(): boolean {
  const cores = navigator.hardwareConcurrency ?? 4;
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  return coarse || cores <= 4 || window.innerWidth < 900;
}

const FOG_COLOR = 0x05070d;

export function createWorld(
  canvas: HTMLCanvasElement,
  /** The near-plane surface, mounted above the page's copy. Optional: without
   *  it the world simply has no foreground, which is a degradation rather than
   *  a failure. */
  nearCanvas: HTMLCanvasElement | null,
  low: boolean,
): World {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: !low,
    alpha: true,
    powerPreference: "high-performance",
  });
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.55;
  renderer.info.autoReset = false;

  const scene = new THREE.Scene();
  const first = WORLD_CHAPTERS[0];
  if (!first) throw new Error("world ledger is empty");
  const fog = new THREE.FogExp2(FOG_COLOR, first.state.fog);
  scene.fog = fog;

  // Give the metal something to reflect before giving it anything to be lit by.
  const panorama = new THREE.CanvasTexture(environmentPanorama());
  panorama.mapping = THREE.EquirectangularReflectionMapping;
  panorama.colorSpace = THREE.SRGBColorSpace;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const environment = pmrem.fromEquirectangular(panorama).texture;
  scene.environment = environment;
  scene.environmentIntensity = 1.9;
  panorama.dispose();
  pmrem.dispose();

  // Key from high camera-left, cold. Rim from behind to lift the rings off the
  // void — without it the far side of the instrument disappears into the fog
  // and the silhouette stops reading.
  const key = new THREE.DirectionalLight(0xdfe8ff, first.state.key);
  key.position.set(-14, 18, 11);
  scene.add(key);

  const rim = new THREE.DirectionalLight(0xaebfd6, 1.1);
  rim.position.set(7, -5, -20);
  scene.add(rim);

  const fill = new THREE.HemisphereLight(0x2c3b4e, FOG_COLOR, 0.5);
  scene.add(fill);

  const instrument: Instrument = buildInstrument(low);
  scene.add(instrument.group);

  const bodies: Bodies = buildBodies(low);
  scene.add(bodies.group);

  const foreground: Foreground = buildForeground(low);

  const camera = new THREE.PerspectiveCamera(first.camera.fov, 1, 0.5, 90);
  // The near plane is parented to the camera so it stays anchored to the frame,
  // and the camera therefore has to be in the graph for its children to render.
  camera.add(foreground.group);
  scene.add(camera);

  // A second context, drawing nothing but layer 1. Sharing the scene means the
  // geometry is authored once; the layer mask means this context only ever
  // uploads the three near-plane pieces, not the whole instrument.
  // Not on the low tier. A second context is a real cost on a phone, and the
  // near plane's pieces are composed for a wide frame — on a narrow one they
  // are mostly outside it anyway, so the tier that can least afford them is
  // also the one that would see them least.
  const nearRenderer = nearCanvas && !low
    ? new THREE.WebGLRenderer({
        canvas: nearCanvas,
        antialias: !low,
        alpha: true,
        powerPreference: "low-power",
      })
    : null;
  if (nearRenderer) {
    nearRenderer.setClearColor(0x000000, 0);
    nearRenderer.outputColorSpace = THREE.SRGBColorSpace;
    nearRenderer.toneMapping = THREE.ACESFilmicToneMapping;
    nearRenderer.toneMappingExposure = 1.55;
  }

  // Two curves, not one: the rig's path and what it is looking at move
  // independently, which is what lets the camera swing around the instrument
  // while keeping the gimbal in frame. A single curve with a fixed look-ahead
  // would whip through the corners.
  //
  // Tension 0.42 rather than the 0.5 default. Catmull-Rom overshoots on tight
  // direction changes, and an overshoot here flies the camera through a ring.
  const LAST = WORLD_CHAPTERS.length - 1;
  const curveP = new THREE.CatmullRomCurve3(
    WORLD_CHAPTERS.map((c) => new THREE.Vector3(...c.camera.p)),
    false,
    "catmullrom",
    0.42,
  );
  const curveT = new THREE.CatmullRomCurve3(
    WORLD_CHAPTERS.map((c) => new THREE.Vector3(...c.camera.t)),
    false,
    "catmullrom",
    0.42,
  );

  const position = new THREE.Vector3();
  const target = new THREE.Vector3();
  const axis = new THREE.Vector3();

  let width = 1;
  let height = 1;
  let calls = 0;
  let lastTau = 0;
  let lastNear = 0;

  // Reused every frame rather than reallocated. See `stateAt`'s out-param.
  const state: WorldState = stateAt(0);

  // Idle throttling. The only thing moving in a settled frame is the ring
  // system's own slow idle — about a degree a second — and that does not need
  // sixty frames to express. Full rate while the page or the pointer is
  // actually moving; a fifth of it otherwise. Both contexts are governed by
  // this, which is most of what the world costs when nobody is scrolling.
  const IDLE_FRAME = 1 / 20;
  let sinceRender = Infinity;
  let lastSmooth = Number.NaN;
  let lastMx = Number.NaN;
  let lastMy = Number.NaN;
  let renders = 0;
  // The opening dolly: the rig eases in from further back on a longer lens, so
  // the world arrives rather than appearing.
  let intro = 0;

  /** Every waypoint is composed for a wide frame. On a tall one the same
   *  numbers crop the instrument in half, so the rig steps back along its own
   *  view axis and opens up a little rather than letting the sides fall away. */
  function fitAspect(p: THREE.Vector3, t: THREE.Vector3, fov: number): number {
    const shape = width / height;
    const narrow = Math.min(Math.max((1.62 - shape) / 1.05, 0), 1);
    if (narrow <= 0) return fov;
    axis.subVectors(p, t).normalize();
    p.addScaledVector(axis, narrow * 9.5);
    p.y += narrow * 1.2;
    return fov * (1 + narrow * 0.4);
  }

  function applyState(state: WorldState) {
    fog.density = state.fog;
    key.intensity = state.key;
  }

  return {
    readout() {
      return {
        px: camera.position.x,
        py: camera.position.y,
        pz: camera.position.z,
        tx: target.x,
        ty: target.y,
        tz: target.z,
        fov: camera.fov,
        calls,
        w: width,
        h: height,
        tau: lastTau,
        separation: orreryModel(lastTau).separation,
        ytLife: orreryModel(lastTau).ytLife,
        near: lastNear,
        renders,
      };
    },

    setSize(nextWidth, nextHeight, dpr) {
      width = Math.max(1, nextWidth);
      height = Math.max(1, nextHeight);
      renderer.setPixelRatio(dpr);
      renderer.setSize(width, height, false);
      // A resize changes the frame, so the next update has to draw whatever the
      // idle throttle would otherwise have skipped.
      sinceRender = Infinity;
      nearRenderer?.setPixelRatio(dpr);
      nearRenderer?.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    },

    update(frame) {
      stateAt(frame.smooth, state);
      applyState(state);

      // The machine keeps turning whether or not this frame is drawn, so the
      // idle rotation is advanced before any decision about rendering. Skipping
      // the accumulation instead would make the rings slow down whenever the
      // page went quiet.
      for (const spinner of instrument.spinners) {
        spinner.node.rotation.y += spinner.rate * state.spin * frame.dt;
      }
      intro = damp(intro, 1, 2.6, frame.dt);
      sinceRender += frame.dt;

      const moving =
        Math.abs(frame.smooth - lastSmooth) > 1e-4 ||
        Math.abs(frame.mx - lastMx) > 1e-3 ||
        Math.abs(frame.my - lastMy) > 1e-3 ||
        intro < 0.999;
      lastSmooth = frame.smooth;
      lastMx = frame.mx;
      lastMy = frame.my;
      if (!moving && sinceRender < IDLE_FRAME) return;
      sinceRender = 0;
      renders += 1;

      bodies.update(frame.tau, state.bloom);
      lastTau = frame.tau;

      // Where the rig is on its route. `smooth` is the conductor's damped
      // chapter progress, so the camera trails the page and settles after it.
      const progress = clamp(frame.smooth, 0, LAST);
      curveP.getPoint(progress / LAST, position);
      curveT.getPoint(progress / LAST, target);

      // Compose the subject, not only the instrument: pull the look-at onto the
      // principal by the chapter's follow weight. Without it the position
      // sweeps out of frame between waypoints — at maturity it sat just outside
      // the frustum, which is to say the payoff was not in the shot.
      target.lerp(bodies.principal, state.follow);

      // FOV is interpolated per segment rather than along the curve: a lens
      // change belongs to the cut between two compositions, not to arc length.
      const index = Math.min(Math.floor(progress), LAST - 1);
      const blend = clamp(progress - index, 0, 1);
      const from = WORLD_CHAPTERS[index];
      const to = WORLD_CHAPTERS[index + 1];
      let fov = from && to ? lerp(from.camera.fov, to.camera.fov, blend) : first.camera.fov;

      fov = fitAspect(position, target, fov);

      // The opening dolly, spent in about a second and a half and never seen
      // again. Advanced above, with the rest of the world's own clock.
      const opening = 1 - intro;
      axis.subVectors(position, target).normalize();
      position.addScaledVector(axis, opening * 7.5);
      fov += opening * 7;

      // A hand-held drift, never enough to break the frame. It is damped out
      // as the rig moves inside the instrument, where a small nudge in world
      // units is a large one on screen.
      const inside = 1 - Math.min(progress, 1.6) / 1.6;
      const hand = 0.45 + inside * 0.55;
      position.x += frame.mx * 0.42 * hand;
      position.y += frame.my * 0.24 * hand;
      target.x -= frame.mx * 0.14 * hand;
      target.y -= frame.my * 0.08 * hand;

      camera.position.copy(position);
      camera.lookAt(target);
      if (Math.abs(camera.fov - fov) > 1e-4) {
        camera.fov = fov;
        camera.updateProjectionMatrix();
      }

      foreground.update(state.near, frame.mx, frame.my);
      lastNear = state.near;

      renderer.info.reset();
      // The world, without its near plane.
      camera.layers.set(0);
      renderer.render(scene, camera);
      calls = renderer.info.render.calls;

      // The near plane, onto the surface that sits above the page's copy. When
      // the chapter has no appetite for it there is nothing to draw, and a
      // clear-and-present-nothing is still a full-screen pass.
      if (nearRenderer && state.near > 0.004) {
        camera.layers.set(FOREGROUND_LAYER);
        nearRenderer.render(scene, camera);
        calls += nearRenderer.info.render.calls;
      }
      camera.layers.set(0);
    },

    dispose() {
      foreground.dispose();
      camera.clear();
      bodies.dispose();
      instrument.dispose();
      environment.dispose();
      scene.environment = null;
      scene.clear();
      renderer.dispose();
      renderer.forceContextLoss();
      nearRenderer?.dispose();
      nearRenderer?.forceContextLoss();
    },
  };
}
