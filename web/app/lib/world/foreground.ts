// SPDX-License-Identifier: Apache-2.0

import * as THREE from "three";
import { graphiteRoughness } from "@/lib/world/textures";

/** The near plane: pieces of the instrument close enough to the lens that the
 *  page's own copy passes behind them.
 *
 *  This is the move that separates a world from a backdrop. Everything else
 *  here sits behind the text, which reads as a picture hung behind a page; one
 *  strut crossing in front of a paragraph puts the reader inside the machine
 *  instead. Kage does it with alpha cut-outs re-parented into a fixed host above
 *  the content — the same idea, in geometry.
 *
 *  The pieces are children of the camera, so they are anchored to the frame
 *  rather than to the world: a near-plane element that drifts with the rig stops
 *  reading as "close to you" and starts reading as "small and far away".
 *
 *  They live on layer 1 and are drawn by a second renderer whose canvas sits
 *  above the DOM. That is the only way geometry can occlude text.
 */

export const FOREGROUND_LAYER = 1;

export type Foreground = {
  group: THREE.Group;
  /** `near` is the chapter's appetite for foreground, 0..1. */
  update(near: number, mx: number, my: number): void;
  dispose(): void;
};

export function buildForeground(low: boolean): Foreground {
  const group = new THREE.Group();
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];

  const roughness = graphiteRoughness(41);

  // Near-plane pieces are read as silhouette, not as surface — they are inches
  // from the lens and mostly outside the light. Dark, slightly metallic so an
  // edge catches, and never so bright that they compete with the copy in front
  // of which they are, by design, sitting.
  const material = new THREE.MeshStandardMaterial({
    color: 0x1b1e23,
    roughness: 0.62,
    metalness: 0.55,
    roughnessMap: roughness,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  materials.push(material);

  const radial = low ? 6 : 12;
  const arcSegments = low ? 24 : 64;

  type Piece = {
    node: THREE.Mesh;
    base: THREE.Vector3;
    /** Where in the chapter's foreground budget this piece starts appearing. */
    at: number;
    /** How far it leans with the pointer. */
    sway: number;
  };
  const pieces: Piece[] = [];

  const add = (
    geometry: THREE.BufferGeometry,
    position: [number, number, number],
    rotation: [number, number, number],
    at: number,
    sway: number,
  ) => {
    geometries.push(geometry);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(...position);
    mesh.rotation.set(...rotation);
    mesh.layers.set(FOREGROUND_LAYER);
    mesh.renderOrder = 10;
    group.add(mesh);
    pieces.push({ node: mesh, base: mesh.position.clone(), at, sway });
  };

  // Where these are allowed to be is the whole design of them.
  //
  // A near-plane piece over a heading or an oversized numeral reads as depth;
  // the same piece over a line of body text reads as a rendering fault, because
  // the reader is mid-sentence and a word has gone. So the plane crosses the top
  // of the frame — where the chapter numeral and the display heading live, both
  // of which survive being partly hidden — and the right side, where the
  // instrument is and no copy ever goes. The lower left, which is the reading
  // column at every breakpoint, is left alone.

  // An arc across the top, passing over the chapter numeral.
  add(
    new THREE.TorusGeometry(2.2, 0.08, radial, arcSegments, Math.PI * 0.6),
    [-0.6, 1.85, -3.2],
    [0.35, 0.25, -0.35],
    0.0,
    0.12,
  );

  // An armature strut down the right edge, angled against the arc's curve.
  add(
    new THREE.CylinderGeometry(0.05, 0.07, 5.6, low ? 6 : 10),
    [2.45, 0.5, -3.6],
    [0.12, 0.0, 0.42],
    0.35,
    0.2,
  );

  // A further arc off the bottom-right — depth inside the near plane itself, so
  // the foreground is not one flat cut-out.
  add(
    new THREE.TorusGeometry(2.9, 0.065, radial, arcSegments, Math.PI * 0.45),
    [2.3, -1.7, -4.4],
    [-0.25, -0.45, 1.9],
    0.6,
    0.08,
  );

  const settled = { x: 0, y: 0 };

  return {
    group,

    update(near, mx, my) {
      // The whole plane fades with the chapter's appetite for it, and each
      // piece has its own threshold so they arrive one at a time rather than
      // as a block.
      material.opacity = Math.min(1, near) * 0.95;
      group.visible = material.opacity > 0.004;
      if (!group.visible) return;

      settled.x = mx;
      settled.y = my;

      for (const piece of pieces) {
        const share = Math.max(0, Math.min(1, (near - piece.at) / 0.35));
        piece.node.visible = share > 0.01;
        // Pieces slide in from the edge they are anchored to rather than
        // fading in place; a near-plane element that materialises reads as a
        // glitch, one that moves reads as parallax.
        const offset = (1 - share) * 1.4;
        piece.node.position.set(
          piece.base.x + Math.sign(piece.base.x) * offset + settled.x * piece.sway,
          piece.base.y + Math.sign(piece.base.y) * offset * 0.5 + settled.y * piece.sway * 0.6,
          piece.base.z,
        );
      }
    },

    dispose() {
      for (const geometry of geometries) geometry.dispose();
      for (const item of materials) item.dispose();
      roughness.dispose();
      group.clear();
    },
  };
}
