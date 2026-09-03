# fitpath — project invariants

- The geometry engine has NO DOM, NO canvas, NO framework imports.
  It is pure TypeScript and must run in Node.
- No physics engine, ever. Collision detection is ours (SAT).
  Do not add cannon, ammo, rapier, three, or any similar dependency.
- The planner is DETERMINISTIC. The same input always produces the
  same path. No randomness, no RRT, no Math.random anywhere.
- Every degenerate case gets a named unit test before it gets a fix.
- Demo and widget apps are consumers of the engine, never duplicates of it.
- Zero runtime dependencies in packages/engine.
