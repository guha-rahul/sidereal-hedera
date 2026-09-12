// SPDX-License-Identifier: Apache-2.0

import { clamp, smoothstep } from "@/lib/conductor";

/** One piece of the hero and the window it leaves in.
 *
 *  A hero that fades out as a block reads as the page moving. Giving each piece
 *  its own window empties the frame one element at a time instead, which reads
 *  as the hero standing down — the scroll cue has been read, the action has been
 *  offered, and the statement is the last thing to go. */
export type ExitStep = {
  /** Where in the exit this piece starts leaving, in 0..1 exit progress. */
  at: number;
  /** How long it takes to go, in the same units. `at + span` may exceed 1, in
   *  which case the piece is still on its way out when the hero is spent. */
  span: number;
  /** Travel down with the fade, in px at full exit. Small — this is a hand-off,
   *  not a slide. */
  shift?: number;
  /** Dissolve instead of fading: blur in px at full exit. Reserve it for large
   *  flat elements; on text it reads as a rendering fault rather than depth. */
  blur?: number;
};

/** The hero's pieces, keyed by their `data-exit` name. */
export type ExitSequence = Record<string, ExitStep>;

/** How far through the exit the page is. `distance` is the fraction of a
 *  viewport the whole hand-off takes: at 0.58 the hero is spent a little over
 *  half a screen in, which is roughly when the invariant band arrives. */
export function exitProgress(y: number, viewport: number, distance: number): number {
  return clamp(y / Math.max(1, viewport * distance), 0, 1);
}

/** A piece's remaining presence: 1 while it still holds the frame, 0 once it is
 *  gone. Eased, so pieces do not visibly click on and off at their edges. */
export function exitAlpha(step: ExitStep, t: number): number {
  return 1 - smoothstep(step.at, step.at + step.span, t);
}
