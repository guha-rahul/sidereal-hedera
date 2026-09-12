// SPDX-License-Identifier: Apache-2.0

import * as THREE from "three";
import { RIG } from "@/lib/world/chapters";
import { brushedRoughness, graduations, graphiteRoughness } from "@/lib/world/textures";

/** The machine the camera travels through: an armillary instrument, built from
 *  turned rings on a polar axle. See WORLD.md.
 *
 *  What is fixed and what turns is the whole point. The outer graduated ring is
 *  the frame — it is the scale a reading is taken against, so it never moves,
 *  and the par detent is cut into it. The ecliptic ring and the gimbal are the
 *  moving parts. A pointer turning against a fixed scale is how an instrument
 *  works; both turning would be decoration. */

/** The real obliquity of the ecliptic. The inner ring is tilted off the outer
 *  one by the same angle the Earth's is, because an instrument that measures
 *  sidereal time has no business inventing its own geometry. */
const OBLIQUITY = THREE.MathUtils.degToRad(23.44);

export type Instrument = {
  group: THREE.Group;
  /** Parts that idle, each on its own rate so nothing beats in sync. */
  spinners: Array<{ node: THREE.Object3D; rate: number }>;
  dispose(): void;
};

/** A flat annulus in the XZ plane with the UVs a graduation strip needs: u runs
 *  once around the ring, v runs across the band. RingGeometry maps its UVs over
 *  the bounding square instead, which smears a tick strip into a starburst. */
function bandGeometry(inner: number, outer: number, segments: number) {
  const geometry = new THREE.BufferGeometry();
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const angle = t * Math.PI * 2;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    positions.push(cos * inner, 0, sin * inner);
    positions.push(cos * outer, 0, sin * outer);
    uvs.push(t, 0, t, 1);
  }
  for (let i = 0; i < segments; i++) {
    const a = i * 2;
    indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }

  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

export function buildInstrument(low: boolean): Instrument {
  const group = new THREE.Group();
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const textures: THREE.Texture[] = [];

  const track = <T extends THREE.BufferGeometry>(g: T) => {
    geometries.push(g);
    return g;
  };

  const brushed = brushedRoughness();
  const graphiteMap = graphiteRoughness();
  const gradMap = graduations(low ? 120 : 240);
  textures.push(brushed, graphiteMap, gradMap);

  const steel = new THREE.MeshStandardMaterial({
    color: 0x4a515b,
    roughness: 0.33,
    metalness: 0.9,
    roughnessMap: brushed,
  });
  const graphite = new THREE.MeshStandardMaterial({
    color: 0x24262a,
    roughness: 0.72,
    metalness: 0.35,
    roughnessMap: graphiteMap,
  });
  // The engraving is light caught in a cut, not a lamp: unlit, additive, and
  // never writing depth so it cannot z-fight the band it sits on.
  const engraved = new THREE.MeshBasicMaterial({
    map: gradMap,
    transparent: true,
    opacity: 0.75,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const engravedPlain = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.55,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  materials.push(steel, graphite, engraved, engravedPlain);

  const radial = low ? 8 : 14;
  const around = low ? 120 : 220;

  // ---- the fixed frame -----------------------------------------------------

  const outerRim = new THREE.Mesh(
    track(new THREE.TorusGeometry(RIG.outerRadius, 0.16, radial, around)),
    steel,
  );
  outerRim.rotation.x = -Math.PI / 2;
  group.add(outerRim);

  const outerBand = new THREE.Mesh(
    track(bandGeometry(RIG.outerRadius - 0.62, RIG.outerRadius - 0.06, around)),
    engraved,
  );
  group.add(outerBand);

  // The meridian stands in the ZY plane so it crosses the outer ring on the Z
  // axis, leaving the par detent on +X clear of its bearings.
  const meridian = new THREE.Mesh(
    track(new THREE.TorusGeometry(RIG.outerRadius + 0.6, 0.14, radial, around)),
    steel,
  );
  meridian.rotation.y = Math.PI / 2;
  group.add(meridian);

  const bearingGeo = track(new THREE.CylinderGeometry(0.52, 0.62, 1.05, low ? 8 : 18));
  for (const z of [-1, 1]) {
    const bearing = new THREE.Mesh(bearingGeo, graphite);
    bearing.position.set(0, 0, z * (RIG.outerRadius + 0.3));
    bearing.rotation.x = Math.PI / 2;
    group.add(bearing);
  }

  // ---- the par detent ------------------------------------------------------
  // Cut into the fixed scale on +X, which is where the principal seats.

  const detent = new THREE.Group();
  detent.position.set(RIG.outerRadius, 0, 0);
  const detentBlock = new THREE.Mesh(track(new THREE.BoxGeometry(0.9, 0.46, 1.5)), graphite);
  detent.add(detentBlock);
  const detentMark = new THREE.Mesh(track(new THREE.PlaneGeometry(0.07, 1.15)), engravedPlain);
  detentMark.rotation.x = -Math.PI / 2;
  detentMark.position.y = 0.24;
  detent.add(detentMark);
  group.add(detent);

  // The entry mark, half a turn away, where a position joins the machine.
  const entryMark = new THREE.Mesh(track(new THREE.PlaneGeometry(0.05, 0.8)), engravedPlain);
  entryMark.rotation.x = -Math.PI / 2;
  entryMark.position.set(Math.cos(RIG.entryAngle) * RIG.outerRadius, 0.2, 0);
  group.add(entryMark);

  // ---- the moving parts ----------------------------------------------------

  const ecliptic = new THREE.Group();
  ecliptic.rotation.z = OBLIQUITY;
  group.add(ecliptic);

  const eclipticSpin = new THREE.Group();
  ecliptic.add(eclipticSpin);

  const innerRim = new THREE.Mesh(
    track(new THREE.TorusGeometry(RIG.innerRadius, 0.12, radial, around)),
    steel,
  );
  innerRim.rotation.x = -Math.PI / 2;
  eclipticSpin.add(innerRim);

  const innerBand = new THREE.Mesh(
    track(bandGeometry(RIG.innerRadius - 0.44, RIG.innerRadius - 0.04, around)),
    engraved,
  );
  eclipticSpin.add(innerBand);

  // Spokes carrying the ecliptic ring off the hub. They turn with it.
  const spokeGeo = track(
    new THREE.CylinderGeometry(0.045, 0.06, RIG.innerRadius - RIG.gimbalRadius, low ? 5 : 9),
  );
  const spokeCount = low ? 4 : 6;
  for (let i = 0; i < spokeCount; i++) {
    const angle = (i / spokeCount) * Math.PI * 2;
    const spoke = new THREE.Mesh(spokeGeo, graphite);
    const mid = (RIG.gimbalRadius + RIG.innerRadius) / 2;
    spoke.position.set(Math.cos(angle) * mid, 0, Math.sin(angle) * mid);
    spoke.rotation.z = Math.PI / 2;
    spoke.rotation.y = -angle;
    eclipticSpin.add(spoke);
  }

  // The polar axle the whole thing is hung on.
  const axle = new THREE.Mesh(
    track(new THREE.CylinderGeometry(0.09, 0.09, RIG.outerRadius * 2.2, low ? 8 : 16)),
    steel,
  );
  axle.rotation.z = OBLIQUITY;
  group.add(axle);

  // ---- the gimbal ----------------------------------------------------------

  const gimbal = new THREE.Group();
  group.add(gimbal);

  const cage: Array<[number, "x" | "y" | "z"]> = [
    [RIG.gimbalRadius, "x"],
    [RIG.gimbalRadius * 0.9, "y"],
    [RIG.gimbalRadius * 0.8, "z"],
  ];
  for (const [radius, axis] of cage) {
    const ring = new THREE.Mesh(
      track(new THREE.TorusGeometry(radius, 0.035, low ? 6 : 10, low ? 40 : 90)),
      steel,
    );
    if (axis === "x") ring.rotation.x = Math.PI / 2;
    if (axis === "y") ring.rotation.y = Math.PI / 2;
    gimbal.add(ring);
  }
  const hub = new THREE.Mesh(
    track(new THREE.SphereGeometry(0.3, low ? 10 : 20, low ? 8 : 14)),
    graphite,
  );
  gimbal.add(hub);

  return {
    group,
    // Rates are deliberately not multiples of each other: two rings that beat
    // in sync stop reading as a mechanism and start reading as one object.
    spinners: [
      { node: eclipticSpin, rate: 0.019 },
      { node: gimbal, rate: -0.047 },
    ],
    dispose() {
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
      for (const texture of textures) texture.dispose();
      group.clear();
    },
  };
}
