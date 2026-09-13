# Landing-page 3D scene

The scene uses an astronomical instrument to illustrate deposit, principal/yield
splitting and maturity. Chapter thresholds live in `chapters.ts`.

Scroll sets camera position and token state. Pointer motion adds bounded
parallax. Geometry, lighting and motion constraints follow below.

## 2. Geometry and lighting

### Scale and shape

| decision | value | reason |
| --- | --- | --- |
| world units | 1 unit = 1 metre | keeps fog, lights and camera predictable |
| instrument outer ring | radius 12 | monumental; the camera flies inside it |
| gimbal core | radius 1.4 | the split happens at a graspable scale |
| human reference | 1.7 | sanity-checks ring thickness and engraving size |
| bevel language | 0.5–2% of part width | no razor edges, no toy inflation |
| curve language | rings and armature are turned; housings are squared | controlled contrast |
| detail hierarchy | silhouette, then structure, then engraving | prevents noise-first modelling |

### Palette

Use the site palette. Amber identifies the yield token.

| role | value | use |
| --- | --- | --- |
| world dark | `#000000` | deep space, negative space |
| deep field | `#05070D` | fog colour, far structure |
| structural mid | `#2A2E33` | brushed steel rings, armature |
| housing | `#181818` | matte graphite castings |
| readable light | `#FFFFFF` | the principal body, engraved graduations, DOM type |
| story accent | `#FFAC2E` | the yield leg, and nothing else, ever |

The colour arc is the whole story: amber is present from the split, and goes out
at maturity. It must never appear on a ring, a light, or a UI element in this
scene. If the frame has no live yield in it, the frame has no amber in it.

### Lens and composition

- FOV range 34–50. Long at the establishing shot, wider inside the armature.
- Horizon: none. The instrument floats; the frame is composed on the rings.
- Dominant axis: the ecliptic plane, held slightly below centre so DOM copy has
  the upper-left third clear at desktop.
- Safe copy zones: left half at desktop, lower two-thirds at phone.
- Camera roll: none. Pointer parallax only, and small.
- Depth of field: absent. Fog carries depth; DoF costs more than it returns here.

### Motion

| layer | range | timing |
| --- | ---: | ---: |
| camera damping | 6.5 | already the conductor's `PROG_RATE` |
| pointer parallax | ≤ 0.5 world units, ≤ 0.3° | immediate target, damped render |
| ring rotation | 0.004–0.03 rad/s per ring | never synchronised between rings |
| body travel | driven by tau only | never by elapsed time |
| word reveal | 72 ms per word | one entrance per chapter |
| foreground retirement | 820 ms | opacity plus restrained blur |

Rings turn on their own clock; the position rides on tau. That separation is
what makes the machine feel alive while staying a truthful readout — the
instrument idles, the reading does not drift.

## 3. Chapter ledger

Five chapters, matching the `data-chapter` sections the conductor already
measures. The footer is deliberately not a chapter: it is revealed from under
the content by an opaque panel, so a sixth chapter would spend the end of the
run behind it. The run completes on the last section of content.

See `chapters.ts` for the machine-readable ledger. In prose:

| id | beat | landmark | change from previous |
| --- | --- | --- | --- |
| `issuance` | One position, whole, entering the machine | outer graduation ring | — establishing; near the rim, rings cropping out of frame for scale |
| `split` | It resolves into principal and yield | central gimbal | camera pushes inside the outer ring |
| `mechanism` | The two legs ride at different rates | armature spine | camera travels along the armature; near-plane structure crosses the frame |
| `market` | The spread between them is the market | counter-rotating ring pair | camera pulls back and orbits to the far side |
| `maturity` | Yield spent, principal at par | the par detent | camera settles, amber goes out, rings still |

## 4. Camera ledger

Endpoints composed first, curves second. Positions and targets in world units.
On a tall frame the rig steps back along its own view axis and opens up rather
than letting the sides crop — the aspect pullback already proven in Kage.

| # | id | position | target | fov | follow | near |
| --- | --- | --- | --- | --- | ---: | ---: |
| 0 | issuance | `[-6.0, 10.0, -28.0]` | `[ 0.0, 1.0, 0.0]` | 34 | 0.45 | 0.00 |
| 1 | split | `[ 5.5, 3.4, -15.0]` | `[ 0.0, 1.0, -2.0]` | 44 | 0.50 | 0.35 |
| 2 | mechanism | `[ 9.5, 3.0, -1.0]` | `[-2.0, 1.6, -9.0]` | 48 | 0.45 | 1.00 |
| 3 | market | `[-4.0, 6.5, -14.0]` | `[ 2.0, 1.2, -3.0]` | 42 | 0.60 | 0.50 |
| 4 | maturity | `[ 0.0, 2.0, 15.0]` | `[ 0.0, 1.0, -2.0]` | 44 | 0.50 | 0.15 |

`target` is where the shot is *composed*; `follow` is how much of it is then given
up to the principal body's actual position. The waypoints compose the instrument,
the follow weight composes the subject. Without it the position sweeps a
quarter-turn between chapters and leaves frame — at maturity it sat outside the
frustum entirely, which is to say the payoff was not in the shot.

`near` is the chapter's appetite for near-plane structure. Only chapter 2 goes to
full, because only chapter 2's authored change is about passing through the
armature.

Out, in, through, around, settle. Every waypoint is a different composition; a
chapter whose camera cannot be named does not exist.

Chapter 0 was authored as a distant shot holding the whole silhouette. Rendered,
that reads as a small object in a large empty frame. The waypoints above are the
ones that survived contact — close enough that the outer ring crops, which is
what gives the instrument its scale, and arranged so the run sweeps across the
right of frame while the copy holds the left.

They were not arrived at by eye. Whether a body is in shot is a projection, so it
is computed: the positions and follow weights were chosen by sampling the whole
run through the real camera maths and checking the principal's screen coordinates
at every step. That also caught something no single frame would have shown — on
the first pass the rig flew *through* the body between chapters 2 and 3, because
the camera path crossed the ring at the same angle the position occupied.

## 5. Material and texture ledger

No downloaded assets. Every surface is procedural, generated into a canvas at
runtime the way the reference does it — the transfer budget is three.js and
nothing else.

| family | base | treatment |
| --- | --- | --- |
| brushed steel | `#2A2E33`, rough 0.42, metal 0.85 | anisotropic streak map, faint radial wear |
| engraved graduation | steel base | white etched ticks, emissive 0.15, unlit at distance |
| matte graphite | `#181818`, rough 0.78, metal 0.2 | subtle noise, no specular character |
| principal body | unlit white | emissive 1.0, the only pure white in the scene |
| yield body | unlit amber | emissive scaled by remaining life, out at maturity |

## 6. Lighting and atmosphere

- Key: one cold directional from high camera-left, intensity 0.9.
- Fill: hemisphere, deep-field colour below, 0.25.
- Rim: one cold directional from behind the instrument, 0.6, to separate rings
  from the void.
- Practicals: the two bodies are the only emissive surfaces; each carries a
  small point light so it lights the ring it rides on.
- Fog: exponential, `#05070D`, density tuned so the far side of the outer ring
  is half lost. This is the depth cue that flat canvas could not give.
- Bloom: none, in the postprocessing sense. Each body is an emitter, an additive
  glow sprite and a point light — the reference's own lesson, that a lamp should
  be built rather than asked of a bloom pass. It is also why this scene needs no
  postprocessing library and no render targets.
- Grain: the existing DOM `Grain` layer stays on top and unifies the composite.

## 7. Interaction matrix

| input | effect | may it change the route |
| --- | --- | --- |
| scroll | camera along the curve, tau | yes — it is the route |
| pointer (fine) | parallax nudge, warms nearest ring | no |
| rail stop | travels to that chapter's anchor | yes, via the conductor |
| keyboard | rail stops are buttons and focusable | yes, same path as the rail |
| touch | native scroll only, no pointer effects | no |

## 8. Loading and failure

The Canvas 2D orrery already built is not thrown away — it becomes the poster
and the fallback. It renders first, stays until the world has drawn its first
frame, and is the permanent answer for:

- `prefers-reduced-motion: reduce`
- WebGL unavailable or context lost
- the LOW device tier declining the world

three.js is dynamically imported, so a visitor who gets the fallback never
downloads it and the marketing route's initial JS is unchanged.

## 9. Performance budget

| gate | target |
| --- | --- |
| initial route JS | keep 3D dependencies in the dynamically imported world chunk |
| world chunk | three.js core only; no examples, no postprocessing library |
| device pixel ratio | capped at 1.75 |
| draw calls | ≤ 60 desktop, ≤ 30 LOW |
| frame time | 16 ms desktop, 33 ms LOW |
| per-frame allocation | none in the render loop |
| hidden tab | render loop stops with the conductor |

## 10. Verification checklist

1. Check chapter thresholds and camera positions against this specification.
2. Instrument builds and holds a single static composition.
3. Camera travels all five chapters, forward and reverse, no seams.
4. Bodies, split, and amber decay driven by tau and correct at both ends.
5. Fallback, reduced motion, context loss, teardown.
6. Performance gates met on desktop and a throttled mobile profile.
