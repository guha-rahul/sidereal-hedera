// SPDX-License-Identifier: Apache-2.0

import { Orrery } from "@/components/Orrery";
import { World } from "@/components/World";

// Sparse star speckle for the page body: the footer starfield's language at a
// fraction of its density, so the mid-page void reads as sky, not as gap.
const BODY_STARS = [
  "radial-gradient(1.2px 1.2px at 40px 60px, rgba(255,255,255,0.5), transparent)",
  "radial-gradient(1px 1px at 200px 220px, rgba(255,255,255,0.35), transparent)",
  "radial-gradient(1.4px 1.4px at 340px 120px, rgba(255,255,255,0.45), transparent)",
  "radial-gradient(1px 1px at 460px 320px, rgba(255,255,255,0.3), transparent)",
  "radial-gradient(1.2px 1.2px at 120px 420px, rgba(255,255,255,0.4), transparent)",
].join(",");

export function Atmosphere() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      <div className="absolute inset-0 bg-[linear-gradient(180deg,#000000_0%,#05070d_52%,#080a10_100%)]" />
      <div
        className="absolute inset-0 opacity-70"
        style={{ backgroundImage: BODY_STARS, backgroundRepeat: "repeat", backgroundSize: "520px 520px" }}
      />
      {/* The 2D chart draws first and is the permanent fallback; the world
          fades in over it and it stands down. */}
      <Orrery />
      <World />
      <div className="atmosphere-nebula atmosphere-nebula-white hidden lg:block" />
      <div className="atmosphere-nebula atmosphere-nebula-blue hidden lg:block" />
      {/* Vignette: seats the corners so content reads against a stage. */}
      <div className="absolute inset-0 bg-[radial-gradient(120%_100%_at_50%_40%,transparent_55%,rgba(0,0,0,0.5)_100%)]" />
    </div>
  );
}
