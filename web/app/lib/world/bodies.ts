// SPDX-License-Identifier: Apache-2.0

import * as THREE from "three";
import { orreryModel, type OrreryModel } from "@/lib/orrery";
import { RIG } from "@/lib/world/chapters";
import { glowSprite } from "@/lib/world/textures";

/** The position riding the machine, and what becomes of it.
 *
 *  The semantics are not re-authored here. `orreryModel` is the same pure
 *  function the 2D fallback chart draws from, so the world and the poster are
 *  two renderings of one definition of what the protocol does — and the unit
 *  tests that pin the model's ends pin this too. If they ever disagree, one of
 *  them is drawing a fiction.
 *
 *  The bodies ride the *fixed* graduated ring, not the turning ecliptic one. A
 *  reading is taken against a scale that does not move; hanging them off the
 *  spinning ring would make the position drift with the machine's idle, which
 *  would be a lie about what time it is. */

export type Bodies = {
  group: THREE.Group;
  /** Where the principal is, in world space, after the last update. The rig
   *  reads it to pull its look-at onto the subject. */
  principal: THREE.Vector3;
  update(tau: number, bloom: number): void;
  dispose(): void;
};

const PAPER = 0xffffff;
const AMBER = 0xffac2e;

/** How far above the ring plane the bodies ride, so they never z-fight the
 *  graduation band they are being read against. */
const RIDE_HEIGHT = 0.34;
const BODY_RADIUS = 0.5;

export function buildBodies(low: boolean): Bodies {
  const group = new THREE.Group();
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const textures: THREE.Texture[] = [];

  const segments = low ? 12 : 24;

  const makeGlow = (core: string, edge: string) => {
    const texture = new THREE.CanvasTexture(glowSprite(core, edge));
    texture.colorSpace = THREE.SRGBColorSpace;
    textures.push(texture);
    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    materials.push(material);
    return new THREE.Sprite(material);
  };

  // ---- the principal -------------------------------------------------------
  // Unlit, because it is a source rather than a surface, but still fogged so it
  // recedes with everything else.
  const ptGeo = new THREE.SphereGeometry(BODY_RADIUS, segments, segments);
  const ptMat = new THREE.MeshBasicMaterial({ color: PAPER });
  geometries.push(ptGeo);
  materials.push(ptMat);
  const pt = new THREE.Mesh(ptGeo, ptMat);
  group.add(pt);

  const ptGlow = makeGlow("rgba(255,255,255,0.95)", "rgba(214,228,255,0.30)");
  group.add(ptGlow);

  const ptLight = new THREE.PointLight(0xdfe8ff, 0, 9, 2);
  group.add(ptLight);

  // ---- the yield -----------------------------------------------------------

  const ytGeo = new THREE.SphereGeometry(BODY_RADIUS, segments, segments);
  const ytMat = new THREE.MeshBasicMaterial({ color: AMBER, transparent: true });
  geometries.push(ytGeo);
  materials.push(ytMat);
  const yt = new THREE.Mesh(ytGeo, ytMat);
  group.add(yt);

  const ytGlow = makeGlow("rgba(255,172,46,0.95)", "rgba(255,120,30,0.28)");
  group.add(ytGlow);

  const ytLight = new THREE.PointLight(AMBER, 0, 8, 2);
  group.add(ytLight);

  // The socket the amber was in. It does not leave the machine at maturity —
  // the yield is spent, which is a different thing from never having been.
  const spentGeo = new THREE.TorusGeometry(BODY_RADIUS * 1.25, 0.035, 6, low ? 20 : 40);
  const spentMat = new THREE.MeshBasicMaterial({
    color: PAPER,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  geometries.push(spentGeo);
  materials.push(spentMat);
  const spent = new THREE.Mesh(spentGeo, spentMat);
  spent.rotation.x = Math.PI / 2;
  group.add(spent);

  // ---- the spread ----------------------------------------------------------
  // The gap between the legs is the thing that gets traded, so it is drawn.

  const spreadPoints = new Float32Array(6);
  const spreadGeo = new THREE.BufferGeometry();
  spreadGeo.setAttribute("position", new THREE.BufferAttribute(spreadPoints, 3));
  const spreadMat = new THREE.LineBasicMaterial({
    color: PAPER,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  geometries.push(spreadGeo);
  materials.push(spreadMat);
  const spread = new THREE.Line(spreadGeo, spreadMat);
  group.add(spread);

  const principal = new THREE.Vector3();
  // One model object, rewritten each frame. The render loop has no business
  // handing the collector a fresh object sixty times a second.
  const m: OrreryModel = orreryModel(0);

  return {
    group,
    principal,

    update(tau, bloom) {
      orreryModel(tau, m);

      // theta runs pi at the entry mark to 0 at the par detent, matching the
      // marks cut into the fixed ring. The run goes round the far side so the
      // camera, which spends the middle chapters inside the instrument looking
      // outward, has the position in front of it rather than behind.
      const cos = Math.cos(m.theta);
      const sin = -Math.sin(m.theta);

      const ptR = RIG.outerRadius * m.ptRadius;
      pt.position.set(cos * ptR, RIDE_HEIGHT, sin * ptR);
      pt.scale.setScalar(m.ptSize);
      principal.copy(pt.position);

      // The yield leg drifts outward and lifts off the plane of the machine:
      // it is leaving, and leaving is easier to read as a departure from the
      // ecliptic than as a slightly larger radius.
      const ytR = RIG.outerRadius * m.ytRadius;
      yt.position.set(cos * ytR, RIDE_HEIGHT + m.separation * 1.5, sin * ytR);
      yt.scale.setScalar(Math.max(0.0001, m.ytSize));
      ytMat.opacity = m.ytLife;
      yt.visible = m.ytLife > 0.002 && m.ytSize > 0.002;

      ptGlow.position.copy(pt.position);
      ptGlow.scale.setScalar(BODY_RADIUS * m.ptSize * (5.5 + bloom * 4));
      ptLight.position.copy(pt.position);
      ptLight.intensity = 6 + bloom * 6;

      ytGlow.position.copy(yt.position);
      ytGlow.scale.setScalar(BODY_RADIUS * Math.max(0.0001, m.ytSize) * (5.5 + bloom * 4));
      (ytGlow.material as THREE.SpriteMaterial).opacity = m.ytLife;
      ytGlow.visible = yt.visible;
      ytLight.position.copy(yt.position);
      ytLight.intensity = (5 + bloom * 5) * m.ytLife;

      spent.position.copy(yt.position);
      spent.scale.setScalar(Math.max(0.0001, m.ytSize));
      spentMat.opacity = 0.34 * m.separation;
      spent.visible = m.separation > 0.002;

      spreadPoints[0] = pt.position.x;
      spreadPoints[1] = pt.position.y;
      spreadPoints[2] = pt.position.z;
      spreadPoints[3] = yt.position.x;
      spreadPoints[4] = yt.position.y;
      spreadPoints[5] = yt.position.z;
      spreadGeo.attributes.position!.needsUpdate = true;
      spreadMat.opacity = 0.3 * m.separation * m.ytLife;
      spread.visible = spreadMat.opacity > 0.002;
    },

    dispose() {
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
      for (const texture of textures) texture.dispose();
      group.clear();
    },
  };
}
