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

### The second tilt family, and what it is waiting for

Roll is still fixed at zero, but `pitch` may now turn about the item's local X
as well as its local Y — two alternative tilt *families* rather than a third
continuous angle. `PlanOptions.secondTiltFamily` switches it on, and it is
**off by default**, which needs explaining because the capability is real and
the reason is measured.

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

Worth stating plainly, because it is the answer to a question this section might
otherwise seem to be dodging. **A 220 x 95 x 85 sofa cannot pass an opening
narrower than 95 cm**, and no amount of search speed changes that.

At yaw 90 its 95 cm depth lies across the doorway, and pitch turns about that
very axis, so tilting cannot make the figure any smaller. Any other yaw brings
some of the 220 cm length across the opening, which is worse. Sweeping every
orientation the reference lattice admits, under a 210 cm lintel, the narrowest
presentation is exactly 95.0 cm.

Roll would fix it — laid on its side the sofa presents 85 cm — and roll is fixed
at zero. So an 86 cm or 90 cm doorway is not a slow *yes*, it is a *no* that
costs a proof of absence to establish. `test/fastPasses.test.ts` pins 80, 86, 90
and 94 as negatives and 96 as feasible, so a future "improvement" that starts
finding paths there is caught as the bug it would be.

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

It did not close the plateau. Measured on the 210 cm-high doorway, sofa fixture,
300 cm hallway, 1.2 M node budget:

| doorway | one tilt family | both families |
| --- | --- | --- |
| 96 cm | **feasible**, 32,344 nodes, 2 steps | feasible, 44,574 nodes, 4 steps |
| 94 cm | budget exhausted | budget exhausted |
| 90 cm | budget exhausted | budget exhausted |
| 86 cm | budget exhausted | budget exhausted |
| 80 cm | budget exhausted | budget exhausted |

**So the second tilt family stays off by default.** The condition for turning it
on was that it resolve the model-limited negatives; it does not, and on the one
scene that was working it costs two extra steps. The moves are implemented,
tested and reachable — `secondTiltFamily: true` — and the sideways route is a
documented next milestone rather than a shipped capability.

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

- **Roll.** Two angles, not three. Rolling an item onto its side is a real
  maneuver this engine will not find.

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
