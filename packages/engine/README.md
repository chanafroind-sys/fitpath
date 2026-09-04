# @fitpath/engine

Can a piece of furniture be maneuvered through a doorway into a room — and if
so, how? And when it cannot, what specifically is in the way?

Pure TypeScript. No DOM, no canvas, no framework, no physics engine, and zero
runtime dependencies. Everything here runs in Node.

```ts
import { buildEnvironment, plan, SOFA_3_SEAT } from '@fitpath/engine';

const environment = buildEnvironment({
  openingWidth: 110, openingHeight: 210, wallThickness: 15,
  hallwayWidth: 100, hallwayDepth: 320,
  roomDepth: 400, roomWidth: 400, ceilingHeight: 220,
});

const result = plan(SOFA_3_SEAT, environment);
if (result.feasible) {
  for (const step of result.steps) console.log(step.en, '/', step.he);
} else {
  console.log(result.message);
  for (const s of result.suggestions) console.log(s.helps ? 'FIX:' : 'no:', s.en);
}
```

---

## The model

**Units** are centimetres and radians internally; degrees appear only in option
names ending `Deg` and in the human-readable step text.

**World frame.** X and Y are the floor plane, Z is up. The wall lies in the
plane `y = 0` and occupies `y ∈ [0, wallThickness]`. The hallway is the free
slab in front of it, `y ∈ [-hallwayWidth, 0]`, running along ±X for
`hallwayDepth`. The room is behind it. The opening is centred on `x = 0` and
sits on the floor.

**Items** are a union of oriented boxes in the item's own local frame. A sofa is
eight boxes: a seat block, a backrest pitched 12° (a sofa back leans; modelling
it upright understates the depth at the top, which is exactly where a lintel
meets it), two armrests, and four legs. Legs are declared as a *removable part*.

The item's local origin sits at the centre of its footprint on the underside of
the body. For the sofa this is the top of the legs, which is what makes "remove
the legs" meaningful: the legs hang below `z = 0`, so taking them off leaves a
body that still rests correctly when the placement's `z` drops, instead of one
floating 15 cm in the air.

**Environment** is built from eight measurements, not hand-authored:

```
openingWidth, openingHeight, wallThickness,
hallwayWidth, hallwayDepth, roomDepth, roomWidth, ceilingHeight
```

`buildEnvironment` turns those into world-axis-aligned solids: the wall in four
pieces around the opening, the hallway's far wall and two end caps, the room's
side and back walls, floor and ceiling. Parameterising the scene is what lets
the diagnostics ask counterfactual questions — "what if the opening were 6 cm
wider?" — by rebuilding from changed numbers instead of guessing.

**Placement** — the configuration — is `{ x, y, z, yaw, pitch }`. Roll is fixed
at 0.

### Why roll is fixed at zero

Yaw covers turning the item in plan; pitch covers tilting the leading edge up.
Those two are the maneuvers people actually perform and describe, and together
they cover the cases that decide most real deliveries. Roll — rolling an item
onto its side — is a genuine maneuver, and excluding it is a real loss, not a
technicality. It is excluded because admitting it makes the lattice
six-dimensional, which is the difference between a search that terminates and
one that does not.

A rolled variant can still be studied by authoring the item pre-rolled and
planning again. Roll is listed under *Not supported yet* below.

**This makes the item's local frame load-bearing, not a formality.** Pitch turns
about the item's local Y, so whatever an author puts on local Y is the axis the
item tips over — and with roll fixed at zero, an item can tip one way or the
other, never both. Put a wardrobe's 180 cm width on local Y and pitch tips it
sideways, sweeping the diagonal of its 180 × 220 face: 284 cm, which no normal
room clears, so the engine confidently reports that an ordinary wardrobe cannot
be tilted at all. Put its 60 cm depth there, as the fixture does, and pitch tips
it backward onto its back, sweeping 228 cm, which fits under a 250 cm ceiling.
Backward is also what a person actually does.

Getting this wrong does not produce a slightly worse answer. It produces a
confident and wrong "no path found".

Rotations compose as `Rz(yaw) · Ry(pitch) · Rx(roll)`. Yaw is outermost on
purpose: it swings the *already tilted* item about the world vertical, which is
the order in which the maneuver is described out loud ("tilt it up, then swing
it round").

---

## Collision

`satOverlap(a, b)` is the separating axis theorem for two oriented boxes:
fifteen candidate axes — three face normals of A, three of B, and the nine cross
products of one edge direction from each. Face normals catch face-vertex
separations; the cross products catch edge-edge separations, which no face
normal sees.

**One shared `EPSILON`, 1e-9 cm.** The reasoning: coordinates are room-sized, so
magnitudes reach ~1e3, and the projections are sums of a handful of products of
such numbers, putting accumulated double-precision error around 1e-13 cm.
EPSILON sits four orders above that noise floor, so it never mistakes rounding
for contact, and eight orders below a millimetre, so it never hides a gap any
tape measure could find.

**Contact convention: exact touching counts as a fit.** A sofa that grazes the
jamb goes through, and a wall built flush against the floor does not report that
it collides with it. Concretely, an axis separates when the projected gap
exceeds `-EPSILON`, so up to EPSILON of interpenetration is forgiven.

`collides(item, placement, environment)` rejects in four tiers, cheapest first,
because the planner asks this question tens of millions of times and the answer
is nearly always "not even close": the item's whole bounding sphere against each
solid's AABB, then per-box spheres, then AABB against AABB, then the separating
axes that the earlier tiers have not already discharged. Because every solid is
axis-aligned, three of the fifteen axes *are* the AABB test and three more come
free from the box's own axes matrix. `collidesReference` keeps the plain version
around, and a test asserts the two agree over a fixed sweep of placements for
every fixture.

---

## The planner

### Lattice

Positions on a configurable grid (default 2 cm), yaw and pitch in configurable
steps (default 15°), pitch clamped to ±90°.

Bounds are computed per orientation rather than by padding the free space with
the item's radius: for every orientation the lattice admits, work out where the
item's bounding box would have to sit for the item to be inside the free space
at all, and take the union. For a tall wardrobe that removes most of the
vertical range outright, because a wardrobe standing upright cannot have its
base 150 cm off the floor.

Every coordinate is `index × step` with the origin at world zero. Nothing is
accumulated by repeated addition, so a node is bit-identical no matter which
path reached it.

### The ladder

The search runs at three resolutions, coarsest first: 16 cm / 45°, 8 cm / 30°,
then the reference 2 cm / 15°.

**A coarse success is a real success.** Each level's steps are exact integer
multiples of the reference level's and all levels share the origin, so every
coarse node is also a reference node and every coarse edge decomposes into
consecutive reference edges along the same straight line — and edge validity is
inherited, because the coarse edge is only valid if the whole swept motion is
clear. `assertNested` checks that multiple-of relation at runtime rather than
trusting it.

**A coarse failure proves nothing**, so a failed level falls through to the next.

The ladder is not only a speed trick. Edge cost is uniform and the heuristic
only measures progress toward the room, so any manoeuvre that has to be spelled
out as a long run of small moves looks to A* like a dozen moves that make no
progress at all, and the number of ways to spend a dozen such moves is
astronomical. Coarser steps turn those dozen moves into four, which is a search
the heuristic can actually get through. Pivot moves below attack the same
problem from the other side, by making the run short in the first place.

### Pivot moves

A person tipping a wardrobe does not lift it and then rotate it. They set an
edge on the floor and turn the body about that edge, so it rotates and rises
together and the contact never leaves the ground.

Ten single-axis neighbours cannot express that. Forced to separate the two, the
planner must raise the item first and turn it afterwards, which walks it through
a raised pose the real maneuver never occupies and demands ceiling height the
real maneuver never needs. For the wardrobe fixture that inflated the
requirement from 228 cm to 236 cm.

So the neighbourhood also contains **pivot moves**: rotate by one angular step
about a point on the item's bottom face, and *derive* the translation that keeps
that point where it was. The rotation is searched; the translation is not. That
is what keeps the branching factor additive — twelve more neighbours — rather
than multiplying it the way arbitrary coupled translate-and-rotate steps would.

The anchors, in fixed order:

- **Two bottom edges for pitch**, the ones parallel to the item's local Y, which
  is the axis pitch turns about. Those are genuine pivot lines with every point
  fixed. The other two bottom edges are skipped: turning about them would be
  roll, and offering a "pivot" that silently did nothing of the kind is worse
  than not offering one. Only the midpoints are needed — a pitch rotation leaves
  the local Y coordinate untouched, so every anchor along such an edge gives the
  same move.
- **Four bottom corners for yaw**, a point contact: swivelling a wardrobe on one
  corner to walk it round.

The derived position is snapped onto the lattice like any other node, so the
anchor shifts by up to half a step. That is fine, because a pivot only *proposes*
a destination — the motion actually validated is the straight interpolation to
it, under exactly the same anti-tunnelling sampling as every other edge, and
that interpolation is itself a motion a person can perform.

Set `pivotMoves: false` to recover the strictly single-axis neighbourhood.

One honest consequence: a pivot can change the y index by more than one step, so
the heuristic below is no longer provably admissible when pivots are enabled.
Completeness, termination and determinism are unaffected — every reachable node
is still reached, so an exhausted search is still exhaustive — but the path is
even less of a shortest path than before. It was never claimed to be one.

### A*

Neighbours are one step along a single dimension, in a fixed declared order,
plus the twelve pivot moves above. Yaw wraps; a full turn is a loop in the
lattice, not a wall.

Edge cost is a uniform 1. That is deliberately crude — a 2 cm slide and a 15°
turn are not equally hard to perform — but it makes the heuristic admissible
with no tuning, and the path is smoothed and re-segmented afterwards anyway, so
the cost function's job is to terminate, not to be beautiful.

The heuristic is the number of y-steps still needed before the item could
possibly be clear of the wall. Weak, but unimpeachably admissible and
consistent: every move changes exactly one index by one, so no move can reduce
the y-shortfall by more than one.

**Determinism.** A binary heap over parallel typed arrays with a strict total
order on `(f, then h, then the packed node key)`, so no two entries ever compare
equal and heap order cannot depend on insertion history. A fixed neighbour
order. No `Math.random` anywhere — there is a test that greps the sources for
it. No reliance on hash iteration order for any decision.

### Anti-tunnelling

Every edge is validated by sampling intermediate placements. The count comes
from a swept-distance bound: translating by `d` moves every point by `d`;
rotating by `θ` moves a point at distance `R` from the rotation centre along an
arc of `R·θ`, and the item's `reach` is the largest such `R`. Summing the three
contributions over-estimates the true displacement, so dividing by the allowed
per-sample distance always gives a sufficient count.

The allowed distance is **a third of the thinnest solid in the scene**. The
soundness argument only needs the step to be strictly smaller than the
obstacle's thickness — a point moving less than the wall is thick cannot get
from one side to the other without some sample landing inside — but a third
leaves margin for the bound above being an estimate rather than an exact arc
length.

This is a **sampling bound, not a proof**; see *Not supported yet*.

### Path post-processing

1. **Shortcut smoothing.** Repeatedly try to connect two placements on the path
   directly and keep the connection if the edge validates. The raw A* path is a
   staircase — it can only move one axis at a time — so a diagonal slide comes
   out as dozens of alternating steps. Smoothing turns that back into the few
   motions a person would actually make.
2. **Segmentation** wherever the dominant axis of motion changes. Rotations are
   converted into the distance the item's furthest point sweeps before being
   compared against translations; comparing radians to centimetres directly
   would rank a 15° turn of a 220 cm sofa, which drags a corner through 30 cm of
   corridor, as less significant than a 2 cm nudge.
3. **Description** of each segment in English and Hebrew.

Hebrew instructions use the infinitive (שם פועל) — "להטות את הקצה הקדמי כלפי
מעלה בערך 35°". It is the register Hebrew uses for instructions, and it carries
no grammatical gender, so the engine never has to guess something about its
reader that it has no way of knowing.

---

## Diagnostics

When no path is found, the engine computes — never guesses — what would change
the answer. Every number reported was produced by a search that succeeded.

- **A wider opening**: the smallest extra width, to the centimetre, up to +20 cm.
- **Removing a part**: which removable part, on its own, is enough.
- **A wider hallway**: the smallest extra clearance in front of the door, and
  whether the hallway rather than the opening is the binding constraint.

### Monotonicity is proved, not assumed

Widening the opening, widening the hallway, and removing a part all *delete*
obstacle volume or shrink the item. The free configuration space therefore only
grows: any path valid at value `v` is still valid at `v+1`, because nothing was
added that could block it.

So the predicate "a path exists at `v`" is monotone in `v`, and a binary search
over the candidates is **exact**, not a heuristic.

### Bracket coarse, settle fine

The coarse lattice is the only approximation in the engine and it is one-sided:
it can miss a path, never invent one. So a coarse success is a real success and
needs no confirmation, while a coarse failure has to be re-asked at full
resolution before it can be believed.

That asymmetry is what makes the diagnostics affordable. The coarse binary
search finds a value that certainly works; the only open question is whether
something smaller also works, so full resolution is asked exactly that — does
one centimetre less also work? — and usually stops there. Twenty full-resolution
runs become two. `exhaustive: true` runs the literal linear 1 cm scan at full
resolution instead; it is exact either way, and far slower.

The closed-form proof below also short-circuits counterfactuals for free: asking
"would a wider hallway help?" about an item that cannot fit the opening at all
is answered by a single rectangle comparison rather than by exhausting an
enormous corridor.

---

## "No path found" is not the same as "does not fit"

A* exhausting a bounded lattice proves there is no path **on that lattice**. It
does not prove that no path exists in continuous space: a real maneuver might
thread between the lattice's samples, or need two axes to move at once, or need
roll.

So the engine never says "does not fit". The value is `feasible: false`, the
wording is "no path found", and `proven` is `false`. `reason` distinguishes:

| `reason` | meaning | `proven` |
| --- | --- | --- |
| `proven-too-large` | geometrically impossible, established in closed form | `true` |
| `no-path-found` | the reachable lattice was exhausted without success | `false` |
| `search-budget-exhausted` | the node budget stopped the search; it concluded nothing | `false` |

### The one provable hard no

There is a closed-form check that *can* prove impossibility, with no search:

1. To reach the room, every box of the item must cross the wall. Pick any plane
   strictly inside the wall slab. The box's centre starts on the hallway side of
   that plane and ends on the room side, so at some instant it lies exactly on
   it.
2. At that instant the box's intersection with the plane is a **central
   section** of the box, and it must lie inside the opening rectangle, because
   everything else in that plane is solid wall.
3. The smallest rectangle that can contain a central section of a box is its
   smallest face — its two smallest dimensions. (Verified numerically over a
   hemisphere of section normals for each fixture shape.)
4. The item's section contains that box's section. So if any one box's smallest
   face cannot fit the opening at any angle, the item provably cannot pass.

The argument never fixes an orientation, so it holds over all of SO(3) — it is
not limited to the roll-free model the planner searches. It treats the wall as a
single plane, which is the sound direction: failing a zero-thickness hole
implies failing a hole with depth. It assumes the item is one connected rigid
piece, which is what "a piece of furniture" means here.

The rectangle-in-rectangle criterion it rests on (a rectangle too long to lie
flat can still fit corner to corner) is cross-checked against a brute-force
angular sweep over a grid of shapes, because a transcription slip in that
algebra would quietly widen every doorway in the engine.

---

## Complexity

Let the lattice be `Nx · Ny · Nz · Nyaw · Npitch` nodes. Branching factor is 22:
ten single-axis moves (two directions along each of five dimensions) plus twelve
pivot moves. Validating one edge costs
`S · B · E` collision work, where `S` is the sample count from the swept-distance
bound, `B` the item's box count and `E` the solids in range after the broad
phase.

A* is therefore `O(|C| · log|C| · S · B · E)` in the worst case — and the worst
case is exactly what an infeasible scene costs, because proving that no path
exists means expanding every reachable node.

That is the asymmetry worth internalising: **finding a path is fast, proving
there is none is not.** A feasible answer usually comes off a coarse rung in
tens of milliseconds. An infeasible one costs time in proportion to how much
space there was to rule out, which is why the scenario fixtures use corridors
sized to the question being asked rather than sprawling ones.

Concretely, for the fixtures here: `S` is 1 for a 2 cm translation and about 8
for a 15° rotation of the sofa (whose reach is 137 cm, so 15° sweeps 36 cm at 5
cm per sample); `B` is 8 for the sofa; `E` is at most 11.

### Measured runtimes

`npm --workspace @fitpath/engine run bench`, Node 24, Windows 11:

| scenario | result | planner | with diagnostics | nodes |
| --- | --- | ---: | ---: | ---: |
| trivially fits | feasible | 184 ms | 165 ms | 53,891 |
| fits only when tilted | feasible | 732 ms | 602 ms | 275,399 |
| cannot fit in any orientation | proven-too-large | 0 ms | 64 ms | 0 |
| hallway too narrow to turn in | no path found | 346 ms | 65,451 ms | 341,506 |
| fits only after removing the legs | no path found | 2,215 ms | 34,539 ms | 825,087 |

Every planner time is under the 2-second target except the legless-sofa proof at
2.2 s, which is a proof of absence rather than a search for a path.

Pivot moves cut the easy cases sharply — "trivially fits" went from 1022 ms to
184 ms, because a pivot reaches in one move what used to take a staircase of
them — and made the infeasible cases dearer, because a richer neighbourhood
means a larger reachable set to rule out. That trade is worth taking: the cost
falls on proving absence, and the benefit lands on every case that has an
answer.

Diagnostics on the two search-based infeasible cases take 35–65 s, and that is
not hidden. Each re-plans counterfactuals, and the negative answers among them
are themselves proofs of absence at full resolution. Under Vitest the same work
runs roughly 2–3× slower because of the transform layer.

---

## Degenerate cases, and how each is handled

Every one of these has a named test.

| case | handling |
| --- | --- |
| Faces exactly touching | Not an overlap. Contact is a fit. |
| A vertex exactly on a face | Not an overlap; one centimetre further in, it is. |
| Parallel boxes | All nine cross products degenerate at once; the six face normals decide it. |
| Boxes sharing an edge direction | The vanishing cross axes are skipped, not normalised. Sound: with a shared edge direction the configuration is effectively 2-D in the perpendicular plane, where face normals are complete. Normalising instead would divide signal by noise and report contact between boxes metres apart. |
| A zero-size box | Behaves as the point it is: inside overlaps, outside does not, exactly on the face does not. |
| Two coincident zero-size boxes | Touching, therefore not overlapping. |
| A box flattened in one dimension | Behaves as a plane, not as nothing. |
| Threshold piece under a floor-level opening | Zero height. Constructed, then dropped, so `thinnestSolid` never becomes 0 and the sample count never becomes zero. |
| Lintel over a full-height opening | Same: dropped when its height is zero. |
| Yaw wrapping | Periodic in the lattice; 350° and −10° are one node. Descriptions take the short way round, so nothing ever reads "rotate 340° counter-clockwise". |
| Item cannot be placed in the hallway at all | Reported specifically, rather than as a planning failure that looks like the doorway's fault. |
| Item too large for the opening in every orientation | Closed-form proof, no search. |
| A path that would tunnel a thin wall | Rejected by swept-distance sampling; a 2 cm wall is tested explicitly. |
| Smoothing collapsing a segment to nothing | Zero-length segments are dropped before they become instructions. |
| Rotation and lift needed simultaneously | Handled by pivot moves: the item turns about a bottom edge, so it rises and rotates together and the contact stays on the floor. |
| A ceiling too low for any rigid tilt | Reported as no path found, correctly. An AABB's height is translation-invariant, so a face of `w x h` cannot be turned a quarter turn under a ceiling below `sqrt(w^2 + h^2)` by any motion whatsoever. |

---

## Not supported yet

Named honestly, because each is a real limit rather than an oversight.

- **Roll.** Two angles, not three. Rolling an item onto its side is a real
  maneuver this engine will not find, and because pitch turns about the item's
  local Y, an item can be authored to tip one way or the other but not both. A
  wardrobe that must go sideways through one door and backward through another
  needs two fixtures.
- **Arbitrary coupled motion.** Pivot moves cover rotating about a bottom edge
  or corner, which is the coupling that matters for furniture. Motions that
  couple two axes in some other way — sliding along a wall while turning, say —
  still have to be approximated by single-axis steps.
- **Swept-volume collision detection.** Edge validation samples densely enough
  that nothing can pass clean through a solid, but it is a sampling bound, not a
  proof. It does not rule out a swept volume clipping a corner between two
  samples that both sit clear. A real guarantee needs continuous collision
  detection.
- **Stairs and lifts.** The scene is one floor: a corridor, a wall, a room.
- **Multi-turn hallways.** One corridor, one opening, one room. An L-shaped
  approach with two corners is not modelled.
- **Non-box shapes.** Everything is a union of oriented boxes. Curved sofa arms,
  round tables and anything with a genuinely non-convex silhouette are
  approximated by their boxes, which is conservative — the engine will call some
  things impossible that would actually squeeze through.
- **Deformable items.** Cushions compress and mattresses bend. Nothing here does.
- **Doors, handles and skirting.** The opening is a clean rectangular aperture.
  A door leaf standing open in the corridor is not modelled.
- **Optimality.** The returned path is a valid path, not the shortest or the
  easiest to perform. Uniform edge cost plus smoothing produces something
  reasonable, not something optimal.

---

## API

```
plan(item, environment, options?) -> PlanResult
buildEnvironment(params) -> Environment
withParams(environment, overrides) -> Environment

satOverlap(a, b) -> boolean
collides(item, placement, environment) -> boolean
provableNoFit(boxes, openingWidth, openingHeight) -> NoFitProof
rectangleFitsInRectangle(p, q, a, b) -> boolean
```

`PlanOptions` covers lattice resolution (`positionStep`, `yawStepDeg`,
`pitchStepDeg`, `maxPitchDeg`, and per-axis position overrides), the coarse
ladder (`coarsePositionFactor`, `coarseAngleFactor`, `useCoarsePass`), pivot moves (`pivotMoves`), the start
placement, `maxNodes`, `smooth`, `diagnostics` and `exhaustive`.

Fixtures — `SOFA_3_SEAT`, `WARDROBE`, `REFRIGERATOR` and the five scenarios —
are exported from the package rather than living in the test folder, so a
consumer showing these scenes uses the same numbers the tests cover.

## Development

```bash
npm install
npm --workspace @fitpath/engine run typecheck
npm --workspace @fitpath/engine test
npm --workspace @fitpath/engine run bench
```

No build step: relative imports carry explicit `.ts` extensions, so the sources
run under Node's native type stripping, under Vitest, and typecheck with `tsc`.
