# fitpath

A geometry engine that works out whether a piece of furniture can be maneuvered
through a doorway into a room — and if so, how; and if not, what specifically is
in the way.

```
fitpath/
  packages/engine/   the geometry engine (this is the whole project so far)
  apps/              consumers of the engine — nothing here yet
```

The interesting part is [`packages/engine`](packages/engine) — start with its
[README](packages/engine/README.md).

A taste of what it is for. A 220 cm sofa passes a 110 cm doorway comfortably;
its cross-section is only 95 × 85 cm. But if it arrives down a corridor with
100 cm of clearance in front of that door, it can never be turned to face the
opening, and no amount of widening the door helps. The engine reports that the
**hallway** is the binding constraint and that it needs 177 cm — a number it
gets by re-planning, not by guessing.

Instructions come out in English and Hebrew:

> Tilt the front edge up about 35° · להטות את הקצה הקדמי כלפי מעלה בערך 35°

## Invariants

Recorded in [CLAUDE.md](CLAUDE.md) and enforced by tests: no DOM or canvas in
the engine, no physics library, a deterministic planner with no randomness
anywhere, and zero runtime dependencies.

## Getting started

```bash
npm install
npm test
npm run bench
```

Requires Node 24 or newer (the sources run under native TypeScript type
stripping, so there is no build step).

## Licence

MIT.
