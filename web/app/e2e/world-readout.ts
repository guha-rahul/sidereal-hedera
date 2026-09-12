// SPDX-License-Identifier: Apache-2.0

/** The world's debug surface, declared once.
 *
 *  Both the camera and the bodies specs read it, and a `declare global` in each
 *  of them would be two different shapes for one window property. */
export type WorldReadout = {
  px: number;
  py: number;
  pz: number;
  tx: number;
  ty: number;
  tz: number;
  fov: number;
  calls: number;
  w: number;
  h: number;
  tau: number;
  separation: number;
  ytLife: number;
  near: number;
  renders: number;
};

declare global {
  interface Window {
    __siderealWorld?: () => WorldReadout | null;
  }
}

/** Below this the yield body is not drawn at all — see `bodies.ts`. Asserting
 *  against it says "the accent is gone", not "the accent is dim". */
export const YIELD_INVISIBLE = 0.002;
