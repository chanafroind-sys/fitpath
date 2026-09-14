import { describe, expect, it } from 'vitest';
import type { Bitmap } from '../src/sourcing/silhouette.ts';
import { legBandOf, rowProfile, silhouetteOf } from '../src/sourcing/silhouette.ts';

/**
 * The silhouette primitives, on bitmaps small enough to read.
 *
 * Every case here is a hand-drawn stencil rather than a render, so when one
 * fails the answer is visible in the test rather than in a 600-pixel image.
 */

/** Build a bitmap from rows of characters: `#` is item, `.` is background. */
function stencil(rows: readonly string[], itemLuma = 30, backgroundLuma = 240): Bitmap {
  const height = rows.length;
  const width = rows[0]!.length;
  const luma = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    expect(rows[y]!.length).toBe(width);
    for (let x = 0; x < width; x++) {
      luma[y * width + x] = rows[y]![x] === '#' ? itemLuma : backgroundLuma;
    }
  }
  return { width, height, luma };
}

describe('silhouetteOf', () => {
  it('separates the item from the background and bounds it tightly', () => {
    const mask = silhouetteOf(
      stencil([
        '........',
        '..####..',
        '..####..',
        '........',
      ]),
    )!;

    expect({ left: mask.left, right: mask.right, top: mask.top, bottom: mask.bottom }).toEqual({
      left: 2,
      right: 5,
      top: 1,
      bottom: 2,
    });
  });

  /**
   * Largest connected component, which is what removes the shadow.
   *
   * Product photography pools a shadow beside the sofa and sometimes a watermark
   * in a corner. Both threshold as "not background", and both would stretch the
   * silhouette's bounds — which is the denominator every fraction here is
   * measured against, so a shadow would rescale the whole measurement.
   */
  it('drops a detached blob rather than adopting it into the item', () => {
    const mask = silhouetteOf(
      stencil([
        '#.......',
        '..####..',
        '..####..',
        '.......#',
      ]),
    )!;

    expect({ left: mask.left, right: mask.right, top: mask.top, bottom: mask.bottom }).toEqual({
      left: 2,
      right: 5,
      top: 1,
      bottom: 2,
    });
  });

  it('returns nothing for an image with no item in it', () => {
    expect(silhouetteOf(stencil(['....', '....']))).toBeUndefined();
  });

  it('refuses a bitmap whose sample count does not match its shape', () => {
    expect(() => silhouetteOf({ width: 4, height: 4, luma: new Uint8Array(9) })).toThrow(RangeError);
  });
});

describe('rowProfile and legBandOf', () => {
  /** A body on two legs: the classic signal this whole file exists to read. */
  const onLegs = [
    '.########.',
    '.########.',
    '.########.',
    '..#....#..',
    '..#....#..',
  ];

  it('reduces the mask to the filled fraction of each row', () => {
    const profile = rowProfile(silhouetteOf(stencil(onLegs))!);

    expect(profile.rows).toBe(5);
    expect(profile.span).toBe(8);
    expect([...profile.fill]).toEqual([1, 1, 1, 0.25, 0.25]);
  });

  it('reads the band height and the inset off the bottom of the profile', () => {
    const band = legBandOf(rowProfile(silhouetteOf(stencil(onLegs))!))!;

    // Two rows of five are leg band.
    expect(band.bandRows).toBe(2);
    expect(band.heightFraction).toBeCloseTo(2 / 5, 10);
    // One column of clear air on each side of an eight-column span.
    expect(band.insetFraction).toBeCloseTo(1 / 8, 10);
  });

  /**
   * The inset is the tightest gap anywhere in the band, not the average.
   *
   * The claim it becomes — "there is no material within this of the perimeter" —
   * has to hold at the worst row. A leg that flares out at the foot makes the
   * band's own bottom row the binding one, and taking any looser reading would
   * carve through the flare.
   */
  it('takes the tightest row of a tapered leg, not a representative one', () => {
    const band = legBandOf(
      rowProfile(
        silhouetteOf(
          stencil([
            '.##########.',
            '.##########.',
            '...##..##...',
            '..##....##..',
          ]),
        )!,
      ),
    )!;

    // The upper row of the band leaves two clear columns of ten; the flared
    // bottom row leaves one. One is the answer.
    expect(band.insetFraction).toBeCloseTo(1 / 10, 10);
  });

  /**
   * A plinth is not a leg band, and the distinction is the whole safety margin.
   *
   * Five of the six catalogue fixtures stand on a recessed plinth or a solid
   * base. A plinth is slightly narrower than the body and overwhelmingly solid;
   * legs are mostly air. Reading a plinth as legs would carve a hollow under a
   * sofa that has none.
   */
  it('finds no band under a recessed plinth', () => {
    const band = legBandOf(
      rowProfile(
        silhouetteOf(
          stencil([
            '.########.',
            '.########.',
            '..######..',
            '..######..',
          ]),
        )!,
      ),
    );

    expect(band).toBeUndefined();
  });

  it('finds no band under a body that reaches the floor', () => {
    const band = legBandOf(
      rowProfile(silhouetteOf(stencil(['.########.', '.########.', '.########.']))!),
    );

    expect(band).toBeUndefined();
  });

  /** An item that is all leg band is not a reading, it is a thresholding failure. */
  it('finds no band when every row is mostly air', () => {
    const band = legBandOf(rowProfile(silhouetteOf(stencil(['..#....#..', '..#....#..']))!));

    expect(band).toBeUndefined();
  });

  /** Same bitmap, same numbers. The engine's rule, and this is not exempt. */
  it('is deterministic', () => {
    const once = legBandOf(rowProfile(silhouetteOf(stencil(onLegs))!));
    const twice = legBandOf(rowProfile(silhouetteOf(stencil(onLegs))!));

    expect(JSON.stringify(once)).toBe(JSON.stringify(twice));
  });
});
