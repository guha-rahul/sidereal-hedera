// SPDX-License-Identifier: Apache-2.0

"use client";

import { useEffect, useRef } from "react";
import { hold, subscribe, type Frame } from "@/lib/conductor";

/** React binding for the page conductor. The callbacks are held in refs and
 *  re-read every frame, so a consumer can close over fresh props without
 *  re-subscribing — the subscription itself lasts as long as the component.
 *
 *  `read` runs in the conductor's layout-reading pass, `write` in its
 *  style-writing pass. Put every `getBoundingClientRect` / `offsetHeight` in
 *  `read` and every style mutation in `write`, or the split buys nothing.
 *
 *  `continuous` keeps the loop alive after the damped values settle, for
 *  consumers that animate on their own clock rather than on scroll. */
export function useConductor(
  write: (f: Frame) => void,
  opts: { read?: (f: Frame) => void; continuous?: boolean } = {},
) {
  const writeRef = useRef(write);
  const readRef = useRef(opts.read);
  const continuous = opts.continuous ?? false;

  useEffect(() => {
    writeRef.current = write;
    readRef.current = opts.read;
  });

  useEffect(() => {
    const detach = subscribe(
      (f) => writeRef.current(f),
      (f) => readRef.current?.(f),
    );
    const release = continuous ? hold() : undefined;
    return () => {
      release?.();
      detach();
    };
  }, [continuous]);
}
