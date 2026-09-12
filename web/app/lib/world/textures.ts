// SPDX-License-Identifier: Apache-2.0

import * as THREE from "three";

/** Every surface in the world is generated here at runtime. Nothing is
 *  downloaded: the transfer budget for this scene is three.js and nothing else,
 *  so the instrument's character has to come out of a 2D context rather than out
 *  of a texture pack. See WORLD.md, material ledger. */

/** Deterministic RNG so a rebuild produces the same instrument. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function surface(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d context unavailable");
  return { canvas, ctx };
}

/** Linear data, not colour: roughness and metalness maps must not be decoded
 *  as sRGB or the surface response is wrong. */
function dataTexture(canvas: HTMLCanvasElement, repeatX = 1, repeatY = 1) {
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeatX, repeatY);
  texture.colorSpace = THREE.NoColorSpace;
  texture.anisotropy = 8;
  return texture;
}

function colorTexture(canvas: HTMLCanvasElement, repeatX = 1, repeatY = 1) {
  const texture = dataTexture(canvas, repeatX, repeatY);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Brushed metal: fine circumferential streaks with a slow wide variation over
 *  the top, so the highlight breaks up along the ring rather than reading as
 *  one continuous chrome band. */
export function brushedRoughness(seed = 11): THREE.Texture {
  const W = 512;
  const H = 128;
  const { canvas, ctx } = surface(W, H);
  const rnd = mulberry32(seed);

  ctx.fillStyle = "#6b6b6b";
  ctx.fillRect(0, 0, W, H);

  // Broad tonal drift: the parts of the ring that have been handled more.
  for (let i = 0; i < 26; i++) {
    const x = rnd() * W;
    const w = 40 + rnd() * 150;
    const shade = 92 + Math.floor(rnd() * 46);
    ctx.fillStyle = `rgba(${shade},${shade},${shade},0.16)`;
    ctx.fillRect(x, 0, w, H);
  }

  // The brush itself.
  for (let i = 0; i < 1400; i++) {
    const y = rnd() * H;
    const x = rnd() * W;
    const len = 12 + rnd() * 120;
    const shade = 70 + Math.floor(rnd() * 90);
    ctx.strokeStyle = `rgba(${shade},${shade},${shade},${0.05 + rnd() * 0.16})`;
    ctx.lineWidth = rnd() < 0.85 ? 1 : 2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + len, y + (rnd() - 0.5) * 1.2);
    ctx.stroke();
  }

  return dataTexture(canvas, 1, 1);
}

/** Cast graphite: no specular character, just enough tooth that a flat face
 *  does not read as a solid fill. */
export function graphiteRoughness(seed = 23): THREE.Texture {
  const S = 256;
  const { canvas, ctx } = surface(S, S);
  const rnd = mulberry32(seed);

  ctx.fillStyle = "#c4c4c4";
  ctx.fillRect(0, 0, S, S);
  const image = ctx.getImageData(0, 0, S, S);
  for (let i = 0; i < image.data.length; i += 4) {
    const n = (rnd() - 0.5) * 34;
    image.data[i] = Math.max(0, Math.min(255, (image.data[i] ?? 0) + n));
    image.data[i + 1] = image.data[i]!;
    image.data[i + 2] = image.data[i]!;
  }
  ctx.putImageData(image, 0, 0);
  return dataTexture(canvas, 3, 3);
}

/** The graduation band. Ticks run along the strip's length, which is wrapped
 *  around a ring, so `major` ticks land at readable intervals and the rest
 *  subdivide. Alpha elsewhere, so the band is only its engraving. */
export function graduations(minor = 240, majorEvery = 10): THREE.Texture {
  const W = 4096;
  const H = 64;
  const { canvas, ctx } = surface(W, H);
  ctx.clearRect(0, 0, W, H);

  const step = W / minor;
  for (let i = 0; i < minor; i++) {
    const x = i * step;
    const major = i % majorEvery === 0;
    const half = i % (majorEvery / 2) === 0;
    const length = major ? H * 0.74 : half ? H * 0.44 : H * 0.24;
    ctx.fillStyle = major ? "rgba(255,255,255,0.92)" : "rgba(255,255,255,0.5)";
    ctx.fillRect(Math.round(x), H - length, major ? 2 : 1, length);
  }

  // A continuous hairline along the inner edge ties the ticks together.
  ctx.fillStyle = "rgba(255,255,255,0.28)";
  ctx.fillRect(0, H - 1, W, 1);

  return colorTexture(canvas, 1, 1);
}

/** The environment the metal reflects.
 *
 *  A PBR metal takes almost all of its colour from its surroundings — a
 *  directional light only gives it a specular glint. Brushed steel at metalness
 *  0.85 with no environment renders as a near-black silhouette however hard the
 *  lights are pushed. This is a sky in the only sense this scene needs one:
 *  something for the rings to catch.
 *
 *  Equirectangular, so it maps straight onto a sphere: x is azimuth, y runs
 *  from zenith to nadir. */
export function environmentPanorama(): HTMLCanvasElement {
  const W = 512;
  const H = 256;
  const { canvas, ctx } = surface(W, H);

  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, "#2f3c4c");
  sky.addColorStop(0.42, "#131a23");
  sky.addColorStop(1, "#04060a");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);

  // The key, placed where the directional light is, so the streak the brushed
  // finish catches agrees with where the scene is actually lit from.
  const key = ctx.createRadialGradient(W * 0.3, H * 0.2, 0, W * 0.3, H * 0.2, W * 0.3);
  key.addColorStop(0, "rgba(226,238,255,0.95)");
  key.addColorStop(0.5, "rgba(180,200,230,0.25)");
  key.addColorStop(1, "rgba(180,200,230,0)");
  ctx.fillStyle = key;
  ctx.fillRect(0, 0, W, H);

  // A colder, weaker source behind, so the far side of a ring is not dead.
  const rim = ctx.createRadialGradient(W * 0.82, H * 0.44, 0, W * 0.82, H * 0.44, W * 0.24);
  rim.addColorStop(0, "rgba(150,178,214,0.42)");
  rim.addColorStop(1, "rgba(150,178,214,0)");
  ctx.fillStyle = rim;
  ctx.fillRect(0, 0, W, H);

  return canvas;
}

/** A body's glow, as a sprite rather than as post-processing.
 *
 *  The reference's own lesson: coordinate a visible emitter, a glow and a
 *  nearby light, rather than asking a bloom pass to invent the lamp. A radial
 *  sprite costs one additive quad and no render targets, which is why this
 *  scene needs no postprocessing library at all. */
export function glowSprite(core: string, edge: string): HTMLCanvasElement {
  const S = 128;
  const { canvas, ctx } = surface(S, S);
  const gradient = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  gradient.addColorStop(0, core);
  gradient.addColorStop(0.28, edge);
  gradient.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, S, S);
  return canvas;
}

/** Disposes every texture a build handed out. The world can be torn down and
 *  rebuilt on a context loss, and GPU memory does not survive being forgotten. */
export function disposeAll(textures: THREE.Texture[]) {
  for (const texture of textures) texture.dispose();
}
