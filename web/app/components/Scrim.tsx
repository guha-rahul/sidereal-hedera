// SPDX-License-Identifier: Apache-2.0

// A chapter's scrim: what holds its copy off the world.
//
// The instrument is behind every section now, and a bright ring sweeping under
// a paragraph makes the paragraph unreadable. The wrong fix is a full-width
// wash, which just hides the scene and gives back the flat page the world
// replaced. The right one is local — darken the side the copy is on and leave
// the rest of the frame open, which is also why the camera ledger targets a
// point left of the instrument's centre: the machine reads on the right, the
// words on the left, and neither is fighting the other.
//
// Sits at -z-10, so it is above the world and below the section's own content.

type Side = "left" | "bottom" | "full";

const GRADIENTS: Record<Side, string> = {
  // Desktop copy sits in the left half; the gradient is angled so the falloff
  // follows the diagonal the rings tend to travel on.
  left: "linear-gradient(100deg, rgba(0,0,0,0.92) 0%, rgba(0,0,0,0.82) 26%, rgba(0,0,0,0.5) 50%, rgba(0,0,0,0.12) 72%, rgba(0,0,0,0) 88%)",
  // For bands whose copy runs the full width, so the frame has to be held from
  // the floor instead of from one side.
  bottom:
    "linear-gradient(to top, rgba(0,0,0,0.92) 0%, rgba(0,0,0,0.72) 34%, rgba(0,0,0,0.3) 64%, rgba(0,0,0,0) 100%)",
  full: "linear-gradient(180deg, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0.82) 50%, rgba(0,0,0,0.7) 100%)",
};

export function Scrim({ side = "left", className = "" }: { side?: Side; className?: string }) {
  return (
    <div
      aria-hidden
      className={`pointer-events-none absolute inset-0 -z-10 ${className}`}
      style={{ backgroundImage: GRADIENTS[side] }}
    />
  );
}
