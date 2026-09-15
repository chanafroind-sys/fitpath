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

### Finding a path and proving there is none are different jobs

They used to cost the same, and that is the wrong shape for the problem. A
search only has to stumble on **one** working sequence to answer yes; it has to
exhaust the whole reachable set to answer no. So each rung is asked the cheap
question before the expensive one.

**A greedy pass** runs first: the same A\*, with the heuristic weighted by fifty,
which is best-first in all but name. It rushes at the goal, ignores how long the
route is, and gives up after 20,000 nodes. Optimality is not wanted here — the
path is smoothed, settled and relaxed afterwards anyway — and a path is a path.

**Then a bidirectional pass** — implemented, kept, and **off by default.** One
tree from the start, one grown backwards from settled poses inside the room,
strictly alternating, meeting in the middle. At a branching factor of 22,
halving the depth each tree must reach is not a percentage. It is capped at
60,000 nodes.

The reason it is off is structural rather than a matter of tuning. A fast pass
can only pre-empt a rung's *complete* full search — so on a scene the ladder
already solves on a coarse rung, the only thing bidirectional can do is replace
a good answer with its own. On the 96 cm doorway that meant 44,271 nodes and a
longer route in place of 32,344 nodes and two steps. It stays available behind
`bidirectional: true` because the reasoning that motivated it is sound and a
harder scene may yet want it; it is not on because on the scenes that exist it
has nothing to pre-empt.

Both are **allowed to conclude only yes**. Every edge is validated by the same
`EdgeValidator` the ladder uses, so a path either returns is a real path; but
the backward tree grows from a fixed handful of seeds rather than the whole goal
region, and greedy abandons the space it has not looked at, so failing means
nothing whatever. The full search still runs behind them.

Three deliberate restrictions, each of them measured rather than assumed:

- **Coarse rungs only.** On the reference lattice the fast passes are at their
  most expensive and least likely to pay, and by the time a scene reaches that
  rung the coarse ones have already failed. Left on, they cost the two
  proof-of-absence scenarios seconds and found nothing.
- **Not inside diagnostics** (`fastPasses: false`). A user-facing plan wants one
  answer soon, so a bounded bet that usually pays is straightforwardly good. The
  diagnostics phase wants many answers inside a fixed node budget, and there the
  bet that does not pay is taken dozens of times over.
- **Shared budget.** `maxNodes` is the allowance for the whole call, not one
  each pass gets afresh, and the reported node count includes what the fast
  passes spent. A count that hid it would understate what the engine cost.

Measured, in nodes, which is the figure that is the same on every machine:

| scenario | before | after |
| --- | ---: | ---: |
| trivially fits | 53,891 | 46,486 |
| **fits only when tilted** | **275,399** | **17,604** |
| cannot fit in any orientation | 0 | 0 |
| hallway too narrow to turn in | 341,506 | 352,845 |
| fits only after removing the legs | 825,087 | 825,087 |
| sofa, 110 cm door | 28,903 | 27,044 |
| sofa, 100 cm door | 25,615 | 32,518 |
| sofa, 96 cm door | 22,935 | 44,271 |
| sofa, 96 cm door, 250 cm hallway | 74,717 | 40,390 |

One large win, several small ones, and two cases where trying the cheap question
first costs about 20,000 nodes because the ladder would have answered anyway.
That is the trade: a bounded tax on scenes that were already easy, against a
fifteenfold saving on one that was not. Every feasible scene finishes well
inside a second.

The honest caveat is on the clock rather than the count. The bidirectional pass
keeps its own tables and revalidates every edge from scratch, so it costs
several times as much per node as the ladder, and on easy scenes its wall-clock
saving is smaller than its node saving suggests — sometimes negative. The node
figures above are exact and reproducible; timings on the development machine
varied by a factor of three between identical runs.

### The second tilt family

Roll is still fixed at zero, but `pitch` may now turn about the item's local X
as well as its local Y — two alternative tilt *families* rather than a third
continuous angle. It is **on by default**.

It shipped off, on the argument that it changed no answer on the fixtures to
hand and cost nodes. That argument was wrong in a way worth recording: the
fixtures to hand are not the items a user brings, and what the option decides is
whether an item's author picking one local axis over another can make the engine
report a doorway impassable that a person walks through. An option that removes
correct answers silently is not a speed setting.

**What it does.** With one family, which pair of faces an item can tip over is
decided by nothing more principled than how its author assigned its local axes.
The sofa tips onto its back and never onto its side, so its narrowest
presentation is 95 cm however it is turned. With both, it can be laid on its
side and presents 85 cm. That is the difference between "no path found" and a
door a person walks the sofa through, and it removes the silent dependence on an
authoring convention that the *Not supported yet* section calls out as this
engine's most dangerous limitation.

The cost is as advertised: the state space grows by a factor of 2.27, not the
roughly twelvefold that arbitrary roll would cost. (Slightly over two because
lattice bounds are computed per orientation and the sideways poses reach further
across and higher, so the position ranges widen a little too.)

Both families get pivot moves on the same terms — rotation about a bottom edge
or corner, translation derived rather than searched, fixed candidate order, the
same edge validation. Family Y pivots on the bottom edges parallel to local Y;
family X on those parallel to local X. Using one family's edges for the other
would offer a "pivot" that was nothing of the kind, which is the objection that
kept roll's edges out to begin with.

The two families meet at `pitch === 0`, where they describe the same
orientation, and that is the only place a path may cross between them. Both
spellings of a level pose pack to one key, so the search never sees one
orientation as two nodes. Crossing is therefore something a path does by setting
the item down first, which is also what a person does.

**What it does not do, yet.** It changes no answer. Measured on the sofa against
a 90 cm doorway, with the family on:

| rung | step | nodes in the space | searched |
| --- | --- | ---: | --- |
| 0 | 16 cm | 949,440 | exhausted, no path |
| 1 | 8 cm | 16,297,344 | exhausted, no path |
| 2 | 2 cm | 3,722,016,480 | not exhaustible |

The sideways route exists — every pose along it is collision-free and the whole
traverse validates, which `test/tiltFamily.test.ts` pins — but it exists **only
on the reference lattice**. Laid on its side the sofa spans `origin-70` to
`origin+15`, so a doorway of width W puts its origin in a window `70 - W/2` to
`W/2 - 15`. For 90 cm that window is 25..30 and no multiple of 16 or 8 falls
inside it; for 86 cm it is 27..28. The coarse rungs cannot express the pose at
all, however long they search.

And on the reference rung the search cannot reach it, for a reason that predates
this work. `iyGoalMin` — where the heuristic reaches zero — is 30 cm, because it
has to be the most optimistic orientation or the heuristic would overestimate.
The goal test, which wants the item's whole bounding box inside the room, does
not fire for the sideways orientation until y = 126 cm. Between the two lies a
plateau about fifty moves deep at a branching factor of twenty-two, and A* is
searching it blind. Starting the sofa already on its side and lined up with the
doorway does not help: the straight walk through is 160 uninformed moves.

So switching it on today costs and buys nothing: `legs-must-come-off` goes from
825,087 nodes to 1,130,248, and the 96 cm doorway — the one scene a visitor
actually runs — goes from two clean steps to four.

*(An earlier revision of this paragraph also said the family degraded an 80 cm
doorway from a clean `no-path-found` to `search-budget-exhausted`. That was
wrong, and checking it against the committed tree is what showed it: 80 cm was
already `search-budget-exhausted` with one family. The family cost nothing
there. The claim is retracted rather than quietly deleted because it was used as
an argument.)*

**What would make it pay** is a heuristic that knows where the goal actually is
for the orientation in hand:
`h(n) = min over orientations o of [ max(0, G(o) - y) + d(orientation(n), o) ]`,
where `G(o)` is the y at which orientation `o` is wholly inside the room and `d`
is lattice distance in orientation space. That has since been **built** — it is
the heuristic A\* now runs — and it did not close the plateau. The measurements,
and why a relaxation over orientations alone still cannot see the wall, are
under [the orientation-aware
heuristic](#the-orientation-aware-heuristic-and-the-plateau-it-does-not-close)
below.

---

### The narrowest a sofa can be

This section used to say 95 cm, on the reasoning that pitch turns about the very
axis the 95 cm depth lies on. That was a fact about one tilt family, not about
the sofa. With both families the number is **85.00 cm**, and it is worth setting
out how it is arrived at, because the interesting part is what sets it.

Swept over full SO(3) — yaw, pitch **and** roll, which is wider than the model
the planner searches — under a 210 cm lintel:

| body | narrowest it can be held | at |
| --- | ---: | --- |
| sofa as authored, 8 boxes | **85.00 cm** | yaw 90, pitch 18, roll 90 |
| legs removed | 70.00 cm | yaw 90, pitch 32, roll 90 |
| mid-length section alone: seat + backrest | 66.22 cm | yaw 90, pitch −31, roll 249 |

The three numbers are the whole story. The sofa's mid-length cross-section is an
**L** — a seat 95 cm deep and 40 tall, and a backrest leaning over the back of
it, 30 deep and reaching 70 — and an L rolled past the upright tucks into 66 cm,
well under the 95 its bounding box will show at any angle. That is real, and it
is exactly the geometry that lets a non-convex item thread an opening its box
could never enter.

**It does not help this sofa, and the reason is the legs.** They stand 15 cm
proud of the body at x = ±100. Laid on its side the body is 70 cm across and the
legs make it 85. Every station of the item has to cross the wall, so the leg
station's 85 cm is a floor for the whole passage — measured over every rotation,
not assumed. Taking the legs off drops the floor to 70, which is what the
`legs-must-come-off` scenario is.

Width presented as the sofa is rolled, by station:

| roll | mid-length | at a leg | armrest tip |
| ---: | ---: | ---: | ---: |
| 0° | 95.00 | 95.00 | 95.00 |
| −45° | 114.03 | 122.16 | 114.03 |
| −75° | 88.59 | 102.17 | 88.59 |
| −90° | **70.00** | **85.00** | 70.00 |

**Can it be threaded through something narrower than 85?** Asked directly,
because the L-shape makes it a fair question: lead with the thin part, turn as
the thick part arrives, and the full cross-section is never in the doorway plane
at one time. Nothing was found. The search exhausts its budget at every width
below 96 and returns no path, threading or otherwise; the straight-run witnesses
stop at 86; and the geometry says why — the mid-length section would thread down
to 66, but the legs must cross too, and 85 is the least they can be made to
present at any rotation.

What has **not** been established is that threading is impossible below 85 for
this fixture. That would need a statement about continuous motions, and the only
sound negative this engine has is `provableNoFit`, which does not fire here. So
the honest position is the one the rest of this file takes: a floor of 85.00 cm
for a straight run, measured; no threading path found, searched for; and no
proof that none exists.

### A*

Neighbours are one step along a single dimension, in a fixed declared order,
plus the twelve pivot moves above. Yaw wraps; a full turn is a loop in the
lattice, not a wall.

Edge cost is a uniform 1. That is deliberately crude — a 2 cm slide and a 15°
turn are not equally hard to perform — but it makes the heuristic admissible
with no tuning, and the path is smoothed and re-segmented afterwards anyway, so
the cost function's job is to terminate, not to be beautiful.

The heuristic is orientation-aware:

    h(n) = min over orientations o of [ max(0, G(o) - y) + d(orientation(n), o) ]

`G(o)` is the smallest y-index at which an item held at orientation `o` is
wholly inside the room, and `d` counts the lattice moves needed to turn into
`o`. Pick whichever orientation you mean to arrive in, pay for the turning, and
pay for the walking that orientation still needs. It is strictly tighter than
the plain y-shortfall it replaced, which is the same expression with the `d`
term dropped, and it is admissible for the same reason: no move changes both an
angular index and the y index — pivots excepted, which is a hole the previous
heuristic had identically and which is discussed under pivot moves above.

It costs one breadth-first sweep over the orientation graph per orientation
(624 of them on the reference lattice) plus a linear fold per orientation, a few
milliseconds in total. What it buys, and does not buy, is measured below.

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

A coarse rung may decide **feasibility**; it may not decide what a person is
told to do. The two are not the same job, and treating them as one produced the
worst output this engine has shipped: for a 96 cm doorway the 8 cm / 30 degree
rung returned a path that lifted a sofa a metre off the floor and swung it from
60 degrees of pitch to minus 60, which came out as *"rotate it 120 degrees"* and
*"tilt the back edge up about 120 degrees"*.

Two of those three moves existed only to satisfy the goal test. **A\* stops at
the first configuration whose bounding box lies inside the room, and tipping an
item up shrinks its bounding box** — so standing a sofa on end is a cheaper way
to "be in the room" than carrying it another half metre and setting it down. The
search was right by the definition it was given; the definition was the problem.

So a found path goes through four stages before anyone sees it:

1. **Re-cut at the reference resolution.** Each coarse edge is subdivided into
   reference-sized pieces. This does not change the path — the pieces lie on the
   straight interpolation the edge validator already cleared — it changes how
   many places the smoother is allowed to cut.
2. **Settle.** Look beyond the end of the path for a pose that is level, resting
   on the floor, and far enough in to be wholly inside the room, and append it if
   a validated motion reaches it. Lowering a tilted item lengthens its footprint,
   which drives its tail back through the doorway it just came through, so the
   settle tries a straight descent first and a carry-then-level-then-lower
   sequence second.
3. **Shortcut smoothing**, twice: once after settling, and again after
   relaxation, because relaxation changes the shape.
4. **Relaxation.** Smoothing removes waypoints; it never moves one. Each interior
   waypoint is offered two destinations — lower and flatter, or closer to the
   straight line between its neighbours — and moves to the furthest one whose
   two edges revalidate.

Every one of those keeps the same guarantee as the search: nothing is added that
the edge validator has not cleared, and the last placement is re-checked against
the goal.

What that leaves, on the scene above: *forward 126 cm, rotate 120 degrees, tilt
the back edge up 41 degrees, forward 133 cm*. The item ends level and on the
floor, and no instruction repeats another's magnitude. The 120 degree turn is
still not the 90 degrees a person would use — edge cost is uniform, so a path
that turns too far costs exactly what one that does not costs, and A\* has no
reason to prefer either. Pricing rotation would change every result in this
README and has not been done.

`describePath` refuses to emit a rotation beyond 180 degrees at all, and throws
instead. A wrong number there is worse than an error: it is read, believed, and
acted on.

Then, in detail:

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
the answer. Every positive number reported was produced by a search that
succeeded.

- **A wider opening**: the smallest extra width, up to +20 cm.
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

### The cost is all in one place

One measurement shapes everything else here. Proving that no path exists is
cheap on the scene as given and ruinous on an enlarged one, because enlarging
the scene is precisely what gives the search more space to rule out:

| full-resolution question | nodes | time |
| --- | ---: | ---: |
| no path in the scene as given (100 cm hallway) | 341 K | 0.3 s |
| no path with a 176 cm hallway | 3.9 M | 14.8 s |
| **a path with a 177 cm hallway** | 3.3 M | 10.0 s |
| a path with a 195 cm hallway | 26 K | 0.06 s |

Note the third row. Near the threshold even *finding* a path is slow, because
the weak heuristic makes A* explore nearly the whole reachable set before it
threads the gap. **Pinning a threshold to the centimetre at full resolution
therefore costs tens of seconds however it is arranged**; no ordering trick
avoids it, because the single cheapest probe that separates 177 from 176 costs
about ten seconds on its own.

So the default trades exactness for speed, explicitly:

1. **Probe each family once**, at its most generous value, in a fixed order —
   part removal, then the opening, then the hallway. That order is by how much
   the counterfactual enlarges the search space, which governs its cost, and it
   happens to coincide with least-effort-first for whoever is doing the moving.
   Families that do not blow the space up are probed at full resolution, because
   a positive there is the answer and finding one is cheap. The hallway, which
   does, is probed on the coarse rungs.
2. **Stop at the first actionable answer.** Once a fix is on the table, spending
   minutes proving that two other fixes would also have failed serves nobody.
   Pass `allSuggestions: true` to carry on.
3. **Bracket the threshold on the coarse rungs**, then confirm the winning value
   at full resolution — the cheap direction. Refining downward is attempted only
   when `diagnosticsNodeBudget` is generous enough to finish.

Every suggestion says which of these it got:

| `basis` | meaning |
| --- | --- |
| `full-resolution` | settled on the reference lattice, or by the closed-form proof |
| `coarse-lattice` | settled only on the coarse rungs |
| `not-evaluated` | never run: the budget ran out, or an answer was already in hand |

and the result carries `truncated: true` whenever anything is less than
`full-resolution`.

**A `coarse-lattice` threshold is one-sided, and the direction is the safe one.**
The coarse rungs can miss a path, never invent one, so the number can be too
generous but never too small. Told to widen a hallway to 195 cm, you will not
then discover that 195 cm was short. What you lose is sharpness: the exact
answer for that scenario is 177 cm, and asking for it costs 79 seconds instead
of 2.3.

```ts
plan(item, environment);                                   // 195 cm, 2.3 s
plan(item, environment, { diagnosticsNodeBudget: 6e7 });   // 177 cm, 79 s
```

### How the budget stays deterministic

`diagnosticsNodeBudget` is a **node count, not a time limit**, and that is the
entire point. Node counts are a deterministic function of the input, so the same
scene yields the same suggestions and the same `truncated` flag on a fast laptop
and on a loaded CI box alike. A wall-clock budget would make the engine's output
depend on how busy the machine happened to be, which is exactly the
irreproducibility this project promises not to have. There is a test that runs
the same starved diagnosis twice and compares the results byte for byte.

Budget starvation is also biased in the safe direction: inside the bracketing
search, anything short of a definite success moves the answer upward, so a
starved probe can only make a suggestion more generous, never less.

`exhaustive: true` runs the literal linear 1 cm scan at full resolution instead.
It is exact, and far slower.

The closed-form proof short-circuits counterfactuals for free: asking "would a
wider hallway help?" about an item that cannot fit the opening at all is
answered by a single rectangle comparison rather than by exhausting an enormous
corridor, and that negative is exact rather than merely not-found.

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

## Triage: deciding whether to search at all

`provableNoFit` is a **proof** and it is deliberately weak. Everything below is
a **measurement** and is deliberately not trusted.

### Why the proof is per-box, and why that is not a bug

The closed-form check walks the item's boxes and asks whether any *one* of them
has a smallest face too large for the opening. It never looks at the item as a
whole, and for a multi-box item that is a big gap: a three-seat sofa's widest
"smallest face" is its seat block's 40 x 80, which sails through a 76 cm
doorway, while the assembled sofa is 85 cm across at its narrowest.

The gap is not an oversight — it is where the argument runs out. The proof is
sound because each box is a **convex** rigid sub-body that must cross the wall
plane, so at the instant that box's centre lies on the plane its section is a
central section, and the smallest rectangle containing any central section of a
box is its smallest face. Every step of that needs convexity. The item as a
whole is not convex, and neither of the obvious substitutes works:

- **Its bounding box** is not sound. The item is a *subset* of its bounding box,
  so a bounding box too large to pass proves nothing whatever about the item.
- **Its convex hull** is not sound either, for the same reason and less
  obviously. What has to fit through the hole is the item's *section* at the
  instant it crosses, and the section of a non-convex body can be arbitrarily
  smaller than the corresponding section of its hull.

### The bounding box, used the way round it works

Both bullets above are about the bounding box **failing**, and both are right:
a box too large to pass proves nothing about the item inside it.

The other direction is sound, and is worth having. The item sits rigidly inside
its box, so any motion that carries the box through carries the item through
with it. If the box goes, the item goes. `openingAdmits` is that argument, and
it is a **positive screen only**:

    three choices of travel axis; the remaining two dimensions p x q enter a
    W x H opening if (p <= W and q <= H) or (q <= W and p <= H)

A pass is a proof the aperture admits the item, with no search. A failure is a
**hint** — it says a straight walk-through will not do it and the route, if
there is one, has to turn the item — and it is used only to bias where the
greedy pass looks first. Nothing may report a negative from it. The only thing
allowed to say "no" is `provableNoFit`, whose argument runs per box, on central
sections, and holds over all of SO(3).

Two conservatisms, both in the safe direction for a positive screen:

- **Axis-aligned entry only.** A rectangle tilted in the opening's plane
  genuinely can fit where the axis-aligned placement cannot, and this engine has
  the exact criterion for it in `rectangleFitsInRectangle`, brute-force verified
  in the tests. Using it here would make the screen strictly stronger. It is
  left out because a tilted entry is a maneuver rather than a walk-through.
- **The authored frame.** The box is taken as the author drew it; some other
  orientation may have a smaller one.

And what a pass licenses is narrow. It is a statement about the **aperture**,
not the environment: the `narrow-hallway` fixture has a 110 cm opening this
screen passes and no path at all, because there is nowhere to line the sofa up.

Measured on the fixture that motivated it — the sofa's mid-length section, a
seat and a leaning backrest, whose bounding box is 95 x 70. The box will never
present less than 70 cm. The L inside it rolls to 66.22. So a 68 cm opening
fails the screen and admits the shape, which is the whole reason a failure is
not a verdict.

### The counterexample, because "less obviously" is not good enough

`test/hullWidth.test.ts` builds a helix out of overlapping cubes: 40 cm radius,
two turns, a 6 cm wire. Its convex hull is a cylinder, and the hull's minimum
width over all directions is **86 cm**. It goes through a **60 cm** opening —
cleanly, with 2,000 sampled placements all verified clear by the engine's own
`collides` — by screwing, the way a bolt goes through a nut. The engine's
placement model expresses that motion exactly: at yaw 0, pitch turns about the
world Y axis, which is the axis through the wall, so a screw is a pitch sweep
with the translation matched to the helix's pitch.

So a body can be wider than a hole in **every** direction and still thread it.
Any rule of the form "hull minimum width > opening, therefore impossible" would
be confidently wrong about that shape, and `proven` would stop meaning proven.

### What the sofa case actually is

For the commonest real query — a 220 x 95 x 85 sofa at a standard 76 cm interior
door — **no closed-form refutation is available at all**, and the engine says so
by declining. The reason is the sofa's seating well: a plane cutting through it
produces an L-shaped profile roughly 95 x 70, and turned on its side that clears
a 76 x 210 doorway. Sampling every candidate fixed point against 16,380 plane
directions, between 30% and 55% of directions give a section that fits. The
section argument therefore cannot refute it, and nothing weaker is sound.

That scene is a search question. It is also one the search does not settle: it
exhausts 1.2 M nodes and reports `search-budget-exhausted`.

### `convexHullMinimumWidth` and `passageOutlook`

Which is where the measurement earns its place. `passageOutlook` compares the
item's hull minimum width against the opening's smaller side and returns
`'hopeless'` or `'worth-searching'`. It decides **how much time to spend**, never
what the answer is, and a caller that shows it to a person must say the search
was skipped rather than that the item does not fit.

- `outlook` is about the item **as authored**, because that is the search about
  to run.
- A removable part that would bring the item under the opening is reported
  separately in `relievedBy` — the sofa's legs take it from 85 cm to 70 cm —
  rather than folded into `outlook`, which would answer a different question.

The width is minimised over a fixed lattice of directions, so the figure is an
**upper bound** on the true minimum, converging from above. For every fixture
here it is exact at any density, because their thinnest direction is an axis.

| item | hull minimum width |
| --- | ---: |
| 3-seat sofa | 85 cm |
| ...without its legs | 70 cm |
| wardrobe | 60 cm |
| refrigerator | 70 cm |

Ordering matters: run the proof first, the outlook second. `IMPOSSIBLE` (a
refrigerator at a 50 cm opening) would be triaged as hopeless, but the proof
answers it first and answers it *better* — with a proof.

---

### A distance-field heuristic, measured and rejected

The heuristic above is the search's weakest point, and the obvious fix is a
distance field: one backward breadth-first sweep from the goal over the position
grid, ignoring the item's shape and orientation, used in place of the
y-shortfall. It was built, and then removed. The reasoning is worth keeping so
that nobody spends the day on it twice.

**The informative version is not admissible.** "Treat a cell as free only if the
item's bounding sphere fits" makes the field's free space *smaller* than the
truth, so its distances are over-estimates, and A\* stops being able to trust
them. The admissible version has to relax in the other direction: a cell is
blocked only when a *point* could not be there.

**The admissible version is not informative.** Measured against the reference
lattice, node counts moved like this:

| scenario | y-shortfall | distance field |
| --- | ---: | ---: |
| trivially fits | 53,891 | 40,038 |
| fits only when tilted | 275,399 | 260,744 |
| hallway too narrow to turn in | 341,506 | **341,506** |
| fits only after removing the legs | 825,087 | **825,087** |

Identical on the two cases that matter, because in an open corridor the item's
origin can go anywhere the point can. Back to back on the narrow hallway it was
slower on both halves — plan 1,205 ms against 774 ms, diagnostics 3,629 ms
against 2,527 ms — since every search pays for a sweep of the grid.

The reason is structural, not a tuning failure. **The binding constraint in
these scenes is orientation**, and no relaxation over positions alone can see
it. What makes a 96 cm doorway hard is not getting the sofa to the door, it is
that reaching the one bearing that fits costs about thirty non-advancing moves,
and with a branching factor of 22 the search must consider every way of spending
them. A heuristic that would help has to price *that*. So one was built that
does, and the next section is what it measured.

---

### The orientation-aware heuristic, and the plateau it does not close

The distance field failed because it relaxed over positions when the binding
constraint is orientation. The `h` now in `goalHeuristic.ts` relaxes over
orientations instead, and it is genuinely tighter — where the plain y-shortfall
read **0** for the last fifty moves of a sideways approach, the new one reads
**5**, because it knows the sofa still has to turn before it can be a goal.

It did not close the plateau. Sofa fixture, 210 cm lintel, 300 cm hallway,
1.2 M node budget, both tilt families searched — the width swept down in 2 cm
steps, and beside each the answer to a different question: does a path exist at
all? That second column is not the search's opinion. It is a straight run
constructed at a fixed orientation and put through the same `EdgeValidator` the
planner uses on every edge it considers. A run that validates is a path.

| doorway | what `plan` returns | nodes | time | does a path exist? |
| ---: | --- | ---: | ---: | --- |
| 96 cm | **feasible**, 4 steps | 44,574 | 0.2 s | yes |
| 94 cm | budget exhausted | 1,200,000 | 17 s | **yes** — sideways, x = 24 |
| 92 cm | budget exhausted | 1,200,000 | 25 s | **yes** — sideways, x = 24 |
| 90 cm | budget exhausted | 1,200,000 | 20 s | **yes** — sideways, x = 26 |
| 88 cm | budget exhausted | 1,200,000 | 15 s | **yes** — sideways, x = 26 |
| 86 cm | budget exhausted | 1,200,000 | 14 s | **yes** — sideways, x = 28 |
| 84 cm | budget exhausted | 1,200,000 | 14 s | no |
| 82 cm | budget exhausted | 1,200,000 | 14 s | no |
| 80 cm | budget exhausted | 1,200,000 | 14 s | no |

Two things to read off it. The floor is between 84 and 86, and the closed-form
sweep above puts it at exactly **85.00 cm**, set by the legs. And between 86 and
94 the engine returns `search-budget-exhausted` for five doorways a person walks
a sofa through. That verdict is honest — the budget ran out, nothing was proved,
and it is not the same claim as `no-path-found` — but it is a gap, and it is a
gap in the search rather than in the model. `test/fastPasses.test.ts` now labels
those three cases **search-limited** where it used to say model-limited, and
`test/tiltFamily.test.ts` carries the witnesses that justify the relabelling.

**Why the tighter estimate is still far too loose.** `min over o` is dominated
by orientations the relaxation cannot know are unusable. It charges for turning
into *some* orientation that would be a goal, and there is always a cheap one —
the sofa held level and square, which is a perfectly good goal pose two moves
away *if you are already in the room*. The wall is what makes it unreachable,
and the wall is exactly what a relaxation over orientations alone drops. Pricing
that would require the joint position-and-orientation reachability the search is
there to compute.

The decisive check: start the sofa **already on its side and already lined up**
with a 90 cm doorway, 150 cm out, so that nothing remains but to walk it in. It
still exhausts 600,000 nodes. The difficulty is not finding the sideways
orientation. It is that the corridor around it is a needle in the position
dimensions too, and every move out of the needle looks equally good to any
heuristic that has not solved the problem.

**And the lattice-alignment finding stands separately.** For the sofa on its
side to clear a 90 cm opening its origin must sit in a window roughly 25–30 cm
across the corridor. No coarse rung's grid has a node in it — 25–30 contains no
multiple of 16 and no multiple of 8 that also satisfies the other axes — so the
pose is not merely expensive to find on the rungs that are fast enough to reach
it, it is **absent** from them. Only the 2 cm reference rung represents it, and
that rung is the one whose full search is measured in billions of nodes. Adding
a rung positioned to hit this window would make this one scene pass and would be
a special case dressed as a parameter, so it has not been added.

**The 80 cm reading is not what an earlier note in this file claimed.** It is
`search-budget-exhausted`, not a clean `no-path-found` — and it already was
before the second tilt family existed, on one family, verified against the
committed tree. The family did not degrade it. 80 cm remains a true negative in
the sense that matters (85 cm is the sofa's smallest face, so no rotation about
any axis gets it through, and the test pinning it must never flip) but the
engine reaches that verdict by running out of budget rather than by exhausting
the space, and this file should not have said otherwise.

---

## The maneuver library

The planner searches. The library does not: it is a short list of maneuvers,
each already validated for one item, each recorded with the four numbers it asks
of a doorway. At runtime the question "will it fit" becomes a comparison of a
few numbers, which is instant, deterministic, and — unlike a search result —
explainable in a sentence.

**A maneuver is a sequence of stages, and a stage has a footprint.** The
footprint is `doorWidth`, `doorHeight`, `hallwayClearance`, `roomDepth`, and a
maneuver's requirement is the componentwise maximum over its stages. Splitting
by stage is what lets the answer say *which* of a shopper's four numbers is the
one that fails: tipping a sofa onto its side needs room in front of the wall and
nothing of the doorway, and carrying it through needs the doorway and nothing in
front.

**The width at the doorway is a section, not a bounding box.** A sofa halfway
through a door is 220 cm long and only the 15 cm of it inside the wall has to
fit the opening. `slabSection` computes that exactly, by clipping each box to
the wall slab and taking the extent over the clipped vertices — a convex set
attains its extremes at its vertices, so there is no sampling and no tolerance
in the number. Measuring the bounding box instead would make every threading
maneuver look impossible, which is the mistake the library exists to avoid.

### Offline: instantiate, then prove

A template is a shape of motion written for a family of items. Instantiating it
for one item's actual dimensions gives numbers; it does not give a maneuver.
Whether the motion survives contact with *this* item — armrests 4 cm taller, a
backrest that leans further — is a question only the collider can answer, so
every waypoint is tested with `collides` and every edge with the same
`EdgeValidator` the planner uses, in an environment built to exactly the
requirement the motion was measured to need. Nothing is recorded unless it
passes.

The requirement is **derived from the motion** and then checked against it,
rather than assumed: sample the path finely, measure the section at the wall and
the item's reach either side, take the largest, build that environment, and see
whether the motion still runs in it. `test/maneuvers.test.ts` checks the promise
from both sides — each maneuver runs in exactly the environment it asks for, and
fails in one a centimetre tighter.

### The three templates, measured on the sofa

Behind a 15 cm wall, which is what the library assumed when these were taken;
the default is 30 cm now and the numbers below did not move (see *The wall is
a tunnel* below).

| maneuver | stages | door it needs | valid? |
| --- | ---: | --- | --- |
| Straight in | 1 | **95.01** x 85.00 | yes |
| On its side | 3 | **85.01** x 95.00 | yes |
| Seat first, turning as it goes | 4 | **85.04** x 117.81 | yes |
| Lean into the doorway and straighten inside it | 5 | **82.72** x 116.83 | yes — see *The lean, in the library* |

The first three need 222 cm of hallway clearance, which is the sofa's own
length plus a margin (the lean needs 236, and its own section below says
why): the maneuvers begin with the item already square to the doorway, and
holding a 220 cm sofa square to a wall takes 220 cm of depth in front of it.
Getting it square from along a corridor is the planner's business, not the
library's.

**Threading ties. It does not win, and this is not a limitation of the
implementation.** `rollSchedule` returns the minimax value over the whole
crossing — the narrowest doorway *any* roll schedule could get the item through,
computed station by station at one degree over the full circle — and for this
sofa it is **85.00 cm**, the same width the item shows lying flat on its side.
The maneuver achieves it to within 0.04 cm. A claim of anything narrower *by
rolling* would have to be wrong.

That qualifier is the whole claim. The minimax runs over roll — rotation about
the travel axis — and over nothing else. It bounds no motion that changes the
item's yaw or pitch while it is inside the wall: a sofa leaning into the
direction of travel moves points *along* the travel axis, so what is inside
the slab is no longer a function of the station, and the recurrence does not
describe it. Whether such a lean-and-straighten beats 85 is a different
measurement, recorded under *The pitch-and-straighten question* below.

The reason is worth stating, because the geometry that motivates threading is
real and the sofa has it. The middle of the item is an **L** — a seat 95 cm deep
and a backrest leaning over the back of it — and rolled past the upright that L
tucks into **66.22 cm**, well under the 95 it shows square on. But the legs
stand 15 cm proud at each end, every station of the item has to cross the wall,
and no roll makes a leg station narrower than 85. Threading can only be as good
as the worst station it has to carry, and the worst station does not care how it
is turned.

Take the legs off — the fixture's own removable part — and the floor drops to
the body's 70 cm, and threading reaches it:

| maneuver | legs on | legs off |
| --- | ---: | ---: |
| Straight in | 95.01 | 95.01 |
| On its side | 85.01 | 70.01 |
| Seat first | 85.04 | 70.01 |
| best any roll schedule could do | 85.00 | 70.00 |

So for this item threading is dominated: it ties on width and needs a 117 cm
lintel to do it. It would pay for an item whose ends are not solid full-depth
blocks — which is a fact about sofas with armrests, not about the idea.

### Runtime: a comparison of a few numbers

`selectManeuver` filters the library by the four measurements and returns the
least demanding survivor. Least demanding means **fewest stages first**: among
maneuvers that all fit, the one worth telling someone about is the one with the
fewest separate motions, not the one that would squeeze through the narrowest
door. Walking a sofa straight through a 110 cm doorway beats threading it
through the same doorway, even though threading would also clear an 85 cm one.

What it buys, against the planner, on the doorways between:

| doorway | library | planner |
| ---: | --- | --- |
| 96 cm | Straight in | feasible, 4 steps, 151 ms |
| 94 cm | On its side | budget exhausted, 5.7 s |
| 90 cm | On its side | budget exhausted, 9.5 s |
| 86 cm | On its side | budget exhausted, 9.6 s |
| 85 cm | nothing in the library | budget exhausted, 10.1 s |

The middle three are the point. Those doorways have paths — there are validated
witnesses for them in `test/tiltFamily.test.ts` — and the planner cannot find
them inside 1.2 M nodes. The library answers them in microseconds, with the
maneuver, the numbers, and the path to animate.

### "No maneuver fits" is not "it does not fit"

The rule the rest of this file keeps, kept here. A miss returns the reasons each
maneuver was ruled out and which measurement fell short; it carries no
`feasible` field to be misread as a verdict. The library is a list of things
known to work, so its silence is a statement about the list. The caller falls
back to the planner, and the closed-form `provableNoFit` remains the only thing
allowed to report a definite no.

### The wall is a tunnel, and every figure says how thick

A doorway is a tunnel the depth of the wall, not a plane. The environment has
always modelled it that way — the wall occupies `y ∈ [0, wallThickness]` as
four solids around the opening — and both engines respect it: the planner
tests every sampled placement against those solids, and `buildManeuver`
measures each requirement with `slabSection`, the item clipped to the *whole*
slab, at samples a quarter of a centimetre apart, before validating every
waypoint and edge behind that wall. Only the closed-form proof treats the wall
as a plane, which is the sound direction for a proof of impossibility.

What was wrong was the number: **15 cm, everywhere, by default, and never
stated.** Every figure this file quoted was for a stud partition. Thicker walls
are strictly harder — the wall's solid grows and the clearances either side
are measured from its faces — so a shopper with a 30 cm masonry wall measured
against a 15 cm library was being handed a doorway number that could be too
small, with nothing on the page to say so.

Now:

- `DEFAULT_WALL_THICKNESS` is **30 cm**, and `reportOn`, `buildLibrary` and
  `onboardItem` all take an override.
- Every `Maneuver` carries `wallThickness` (what it was measured behind) and
  `holdsForWallsUpTo`. The requirement is monotone in the thickness, so two
  measurements settle it: `buildLibrary` rebuilds each maneuver behind a
  `THICK_WALL_BOUND` wall of 100 cm, and one whose five numbers come out
  identical and still validate holds for every thickness between. Otherwise
  the bound equals the thickness it was built at, and the result says so.
- `ItemReport.wallStatement` puts it in a sentence, so a page that publishes
  the figures publishes the assumption with them.

Measured on the catalogue behind 30 cm: *Straight in*, *On its side* and
*Seat first* need the same doorway behind a metre of wall on every sofa. The
two *Stood on end* approaches, which turn near the wall, hold only to the
30 cm they were measured at on three of the six, and the report says which.
The doorway widths themselves did not move between 15 and 30 cm — 85.01,
77.79, 85.01, 75.01, 100.00, 90.01 — because every one of them is a
constant-orientation crossing, and a constant orientation presents the same
section to any slab.

### What the floor bounds, and what it does not

`rollSchedule` is a minimax over **roll** — rotation about the travel axis —
station by station. It is a floor on every roll schedule and on nothing else.
It bounds no motion that changes the item's yaw or its pitch while it is
inside the wall, because a lean moves points *along* the travel axis, so what
is inside the slab stops being a function of the station and the recurrence
does not describe it. For three rounds the three-seater's 85.00 was reported
as though it bounded every way of turning the sofa. It does not, and the next
section is the measurement that shows it.

### The pitch-and-straighten question

The hypothesis: approach the opening leaning into the direction of travel, so
that the leading legs enter the tunnel at an angle and the sofa straightens
inside the wall's thickness. A pitch-and-straighten sequence, not a roll
schedule and not one of the five templates.

**The free planner, as asked.** The three-seater with its real legs, a 30 cm
wall, a 210 cm lintel, 300 cm of hallway, against a narrowing doorway. The
planner's node table is a JavaScript `Map`, and V8 caps a `Map` at 2²⁴
entries, so **16 million nodes is the largest budget this engine can run**;
above that it throws rather than searching. The runs (`bench/free-planner-width.ts`):

| doorway | sofa as authored | authored flat on its side (roll 270) | authored rolled 280 |
| ---: | --- | --- | --- |
| 96 cm | feasible, 56 K nodes, 0.2 s | — | — |
| 94 cm | budget exhausted at 16 M | — | — |
| 90 cm | budget exhausted at 16 M | **feasible**, 1.9 M nodes, 55 s | **feasible**, 214 K nodes, 5 s |
| 86 cm | budget exhausted at 16 M | **feasible**, 3.8 M nodes, 128 s | — |
| 85 cm | — | budget exhausted at 16 M, 7 min | — |
| 84 cm | — | budget exhausted at 16 M, 7 min | budget exhausted at 16 M |

None of the exhausted rows is a negative. Two things stop the planner short
of the answer, and neither is the geometry:

1. **The motion is outside its state space for the sofa as authored.** It
   needs a roll of about 280° *and* a pitch about the axis across the doorway
   at the same time. A `Placement` has yaw and one pitch, about local Y or
   local X, and the two families meet only at level. Authoring the roll into
   the item is what makes the lean expressible, which is why the third column
   exists at all.
2. **The plateau.** Even with the roll authored in, the doorways below 86 cm
   exhaust the budget for the reason the orientation-aware heuristic section
   already sets out: the corridor of valid poses is a needle in the position
   dimensions and nothing prices it.

**So the question was answered directly instead.** With the sofa authored
rolled by ρ about its length, the engine's own `pitch` at yaw 90 *is* the
lean, and `slabSection` gives the exact section behind the wall at any
instant. `bench/lean-minimax.ts` runs a minimax over lean schedules together
with a sideways slide, at a fixed ρ, with the lean limited to 60° and 3° per
centimetre of travel and the slide to 2 cm per centimetre; every transition is
costed by the half-width the opening needs along the *whole* straight
interpolation between its ends, sampled so no material point moves more than
0.25 cm — the same rule `buildManeuver` measures with. Two cheaper versions of
this measurement were wrong in ways worth recording: sampling only at the
stations missed the moment, between samples, when a leg and the backrest's
top were inside the slab together (it claimed 82.65 and the collider refused
the path); costing each edge by its own union of sections fixed that and still
overclaimed, because adjacent edges wanted the item at different sideways
positions and a sofa cannot jump across a doorway between one centimetre and
the next (the constructed path needed 96.56). The sideways position had to be
a state.

Behind a 30 cm wall, under a 210 cm lintel, every row a path the collider
cleared end to end:

| roll off flat | lean-and-slide floor | witness |
| ---: | ---: | --- |
| 270 — flat on its side | 85.00, level throughout | 85.01 |
| 277 | 84.00 | 84.01 |
| 279 | 83.37 | 83.38 |
| **280** | **83.04** | **83.05** |
| 281 | 83.84 | 83.85 |
| 283 | 93.45 | 93.46 |
| 90 — flat on its *other* side | 85.00, level | 85.01 |
| 85 / 95 | 86.26 / 90.65 | 86.27 / 90.66 |

**83.05 cm, with the real legs on — 1.96 cm under the library's 85.01.** It
only works on one side: rolled the other way, so the backrest's top leads the
legs into the tunnel instead of trailing them, no lean helps. The sofa lies
ten degrees short of flat on its side, leans up to 58° into the
doorway while the leading leg station crosses so that the leg is through
before the backrest's top arrives, levels for the middle, and leans the other
way for the trailing end. Put through `buildManeuver` as a one-stage template
it measures **83.01 × 147.96 cm** of doorway, 236 cm in front, 177 cm along the
wall, 236 cm behind, and needs **243 cm of ceiling** to lean under; it
validates in exactly that environment. The same in a 15 cm wall; a 40 cm wall
takes it away again (95.98) — the tunnel has to be short enough for the leg to
clear before the backrest's top arrives. `test/leanWitness.test.ts` carries
the path and re-validates it on every run, at 84 and at 83.05, and checks that
82 refuses it.

**The planner could not have found this, and the reason is architectural,
not a matter of budget.** A `Placement` is `{ x, y, z, yaw, pitch, tiltAxis }`:
one tilt, about the item's local Y or its local X, and the two families meet
only at level. The lean needs the sofa rolled ten degrees short of its side
*and* pitched about the axis across the doorway at the same time — two
rotations besides yaw — and no placement in the planner's state space holds
both. The motion is not hard to find; it is not there to be found. That is
the difference between the exhausted rows in the table above and a negative,
and it is the difference between a search limit and a model limit. Every
placement the planner can search is one the engine can also validate; the
converse is not true, and this is the first maneuver to live in the gap.

So the library is missing a maneuver, and the earlier conclusion that the
legs' void is worth nothing was a conclusion about roll schedules. In that
family it is worth 0.00 cm; in this one about 2 of the 15 cm the legs cost
(with them off, the body goes through 70). 83.05 is a witness, not a floor:
the family it was found in is one roll, one travel axis, a 2° lean grid and a
0.5 cm slide grid, and the schedule that also changes the roll as it goes has
not been measured soundly — a coarser version suggested lower and did not
survive construction, so no number from it is claimed.

### The lean, in the library

It is a template now — `LEAN_AND_STRAIGHTEN`, the sixth — and the route
chosen was a roll on `Placement` rather than pre-rolled items in the data.
The reasons: the maneuver is then a maneuver *of the sofa*, validated by the
same `collides` and `EdgeValidator` and drawn by the same `placementRotation`
as every other, instead of a path for a re-authored copy that every consumer
would have to know to swap in; a pre-rolled item breaks the library's
contract, which is that `build(item)` returns placements of *that* item; and
the planner's guarantee stays exact, because a placement without the field
means what it always did, the lattice never generates one, and `plan`
refuses a start that carries one. **Validated and animated, never
searched** is enforced, not promised.

`Placement.roll` is a rotation about the item's local X applied innermost:
`R = Rz(yaw) · Ry(pitch) · Rx(roll)` in tilt family `y`; in family `x`, whose
tilt is already about local X, it simply adds to the tilt. Every place that
composes or samples a rotation carries it — `placementRotation`,
`interpolate`, both swept-distance bounds, the viewer's timeline — and one
place had to be caught: the collider builds its rotation inline for speed and
silently dropped the roll, so a rolled placement was validated as a different
pose from the one drawn. It routes rolled placements through
`placementRotation` now, and `test/roll.test.ts` sweeps 600 poses to check
that a rolled placement of the sofa and the same placement of a sofa
*authored* pre-rolled put every corner in the same place and get the same
verdict from the collider.

The template runs the measurement above for any item, fast enough to live
in a library build: the roll is scanned coarsely on both sides of flat (2.4
seconds for fourteen candidates) and the best refined on a 2° lean grid with
a 0.5 cm slide grid, sampled at the engine's own 0.25 cm, in 2.7 seconds
altogether for the three-seater. It applies only where a short stretch of
the item sets the width — under half of the stations at the roll floor —
because where every station binds there is nothing to lead with; on this
catalogue that is the three-seater alone, and a plinth sofa gets a plain "does
not apply". Its five stages are the motion's own phases: tip ten degrees
short of the side, lean the leading end in and straighten as it clears,
carry the middle level, lean the trailing end through, stand it up.

| item | wall | door it needs | in front | along | behind | ceiling |
| --- | ---: | --- | ---: | ---: | ---: | ---: |
| 3-seat sofa | 30 cm | **82.72** x 147.96 | 236 | 197.5 | 236 | 244 |
| 3-seat sofa | 15 cm | **82.72** x 116.83 | 236 | 198.5 | 236 | 244 |

The width is the same behind either wall; the height it needs is the one
number that depends on the tunnel's depth. It is flagged `wallSensitive`, so
`buildLibrary` does not rebuild it behind a thicker wall and it claims its
requirement only for the thickness it was built at — the report's wall
statement lists it with the two stood-on-end approaches. And `selectManeuver`
offers it last: five separate motions and a doorway half again as tall are
the price of a width nobody needs above 85, so at 110 cm it is an alternative
and at 84 cm it is the answer.

What is claimed is exactly what is measured: one roll, one travel axis, a
lean up to 60° at 4° per centimetre and a slide at 2, a witness and not a
floor. The floor beside it is still the roll floor, 85.00, and the library
now goes 2.28 cm under it on the one sofa whose legs let it.

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
| trivially fits | feasible | 202 ms | 180 ms | 53,891 |
| fits only when tilted | feasible | 710 ms | 705 ms | 275,399 |
| cannot fit in any orientation | proven-too-large | 0 ms | 215 ms | 0 |
| hallway too narrow to turn in | no path found | 376 ms | 1,622 ms | 341,506 |
| fits only after removing the legs | no path found | 1,927 ms | 2,760 ms | 825,087 |

Every planner time is under the 2-second target, and every diagnostics phase is
comfortably under three seconds — 1.2 s for the narrow hallway and 0.8 s for the
cellar, down from 65 s and 35 s before the budgeting and best-first ordering
described above.

Pivot moves cut the easy cases sharply — "trivially fits" went from 1022 ms to
about 200 ms, because a pivot reaches in one move what used to take a staircase
of them — while making the infeasible cases dearer, since a richer neighbourhood
means a larger reachable set to rule out. That trade is worth taking: the cost
falls on proving absence, and the benefit lands on every case that has an answer.

Under Vitest the same work runs roughly 2–3× slower because of the transform
layer.

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

- **Roll, as a search dimension.** The planner searches yaw and one tilt, and
  still cannot find a motion that needs a roll and a pitch at once. A
  `Placement` may now *carry* a roll — the lean maneuver authors one — and
  everything that validates or draws a placement honours it, but nothing
  searches it, and `plan` refuses a start that has one. See *The lean, in
  the library*.

- **A single tilt family, chosen by the fixture author.** This one deserves more
  than a line, because it is the limitation most likely to produce a wrong
  answer rather than a missing one.

  Roll is fixed at zero and pitch turns about the item's local Y. Together those
  mean an item can only ever tip over **one** pair of its faces, and *which*
  pair is decided by nothing more principled than how whoever authored the
  fixture assigned its local axes. Yaw does not compensate: yaw changes the
  world direction the item tips in, not which of the body's faces are involved.

  The wardrobe fixture is the worked example. Its 60 × 220 face sweeps 228 cm
  when tipped and its 180 × 220 face sweeps 284 cm. Author it one way and it
  goes backward onto its back under an ordinary 250 cm ceiling; author it the
  other way and the engine reports, with complete confidence and no warning,
  that an ordinary wardrobe cannot be tilted at all.

  For a one-off that is a bug you would catch. For a real catalogue, where
  hundreds of items are imported from suppliers who each have their own axis
  convention, it is a silent generator of false "no path found" results —
  precisely the failure mode this engine is otherwise careful to avoid.

  **The fix, not implemented here:** allow pitch about either local X *or* local
  Y, as two alternative tilt families, and search both. The state space grows by
  a factor of two — a tilt-family flag alongside the existing angles — rather
  than the roughly twelvefold cost of admitting full roll as a third continuous
  angle. That is affordable, and it would make the answer independent of the
  author's axis convention, which is what actually matters.
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
provableNoFit(boxes, openingWidth, openingHeight) -> NoFitProof     // a proof
rectangleFitsInRectangle(p, q, a, b) -> boolean
firstContactAlongPath(item, path, environment) -> PathContact | undefined

convexHullMinimumWidth(boxes, resolution?) -> number                // a measurement
passageOutlook(item, openingWidth, openingHeight) -> PassageOutlook // never a verdict

buildLibrary(item, wallThickness = DEFAULT_WALL_THICKNESS) -> Library   // every Maneuver says holdsForWallsUpTo
reportOn(item, wallThickness = DEFAULT_WALL_THICKNESS) -> ItemReport   // carries wallStatement
wallThicknessBound(item, template, maneuver) -> number
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
