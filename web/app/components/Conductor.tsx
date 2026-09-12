// SPDX-License-Identifier: Apache-2.0

"use client";

import { useConductor } from "@/lib/useConductor";

// Nothing to do per frame — this subscriber exists so the conductor is running,
// and therefore publishing --tau / --tau-smooth / --chapter on the root element,
// on any page that mounts it. Effects that read those variables from CSS alone
// need no subscription of their own.
const NOOP = () => {};

export function Conductor() {
  useConductor(NOOP);
  return null;
}
