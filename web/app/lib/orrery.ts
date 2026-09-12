// SPDX-License-Identifier: Apache-2.0

import { clamp, smoothstep } from "@/lib/conductor";

/** The page's chart, expressed as numbers.
 *
 *  The site is one run of time toward maturity, and this is what that run looks
 *  like: a position travels the orbit from issuance on the left to the par mark
 *  on the right. A quarter of the way along it resolves into two legs — the
 *  principal stays on the route and converges on par, the yield leg drifts off
 *  it and spends itself. At maturity the amber is out and only the outline of
 *  where it was remains.
 *
 *  Everything here is unitless so it can be tested without a canvas: angles in
 *  radians, radii in units of the orbit, sizes in units of the base body. */

/** The split. Chapter 1 — the invariant band, where SY resolves into PT and
 *  YT — sits at tau 0.25, so the fission is centred on it. */
export const SPLIT_FROM = 0.2;
export const SPLIT_TO = 0.38;

/** Where the yield leg starts visibly spending itself, and where the principal
 *  starts converging back onto the mark it redeems at. */
export const DECAY_FROM = 0.55;
export const CONVERGE_FROM = 0.7;

export type OrreryModel = {
  /** 0 while the position is whole, 1 once the two legs are fully apart. */
  separation: number;
  /** Angle along the orbit. pi at issuance (far left), 0 at maturity (the par
   *  mark, far right), so the run reads left to right over the top. */
  theta: number;
  /** Distance from the orbit centre, in units of the orbit radius. */
  ptRadius: number;
  ytRadius: number;
  /** Body size, in units of the base body radius. */
  ptSize: number;
  ytSize: number;
  /** Ink of the amber leg: 1 while the yield is live, exactly 0 at maturity.
   *  The accent has one job on this site, and this is it going out. */
  ytLife: number;
  /** Ink of the par mark the principal is converging on. */
  parMark: number;
};

export function orreryModel(tau: number, out?: OrreryModel): OrreryModel {
  const t = clamp(tau, 0, 1);
  const separation = smoothstep(SPLIT_FROM, SPLIT_TO, t);
  const converge = smoothstep(CONVERGE_FROM, 1, t);

  // `out` lets a render loop reuse one object instead of allocating a model
  // every frame. Callers that do not care keep the plain pure form.
  if (out) {
    out.separation = separation;
    out.theta = Math.PI * (1 - t);
    out.ptRadius = 1 - 0.07 * separation * (1 - converge);
    out.ytRadius = 1 + 0.24 * separation;
    out.ptSize = 1 - 0.2 * separation;
    out.ytSize = 0.66 * separation;
    out.ytLife = 1 - smoothstep(DECAY_FROM, 1, t);
    out.parMark = smoothstep(0.6, 1, t);
    return out;
  }

  return {
    separation,
    theta: Math.PI * (1 - t),
    // The principal rides a little inside the orbit while the legs are apart,
    // then comes back onto it exactly at maturity — it has to land on the mark
    // it redeems at, not near it.
    ptRadius: 1 - 0.07 * separation * (1 - converge),
    // The yield leg drifts outward, away from the thing that redeems.
    ytRadius: 1 + 0.24 * separation,
    // One body becomes two: the principal gives up some of its mass to the leg
    // that leaves it.
    ptSize: 1 - 0.2 * separation,
    ytSize: 0.66 * separation,
    ytLife: 1 - smoothstep(DECAY_FROM, 1, t),
    parMark: smoothstep(0.6, 1, t),
  };
}
