/**
 * Measuring a sofa's leg band from its silhouette.
 *
 * ## The division of labour
 *
 * A vision model decides *what is in the picture*; this decides *where things
 * are*. The model answers discrete questions only — front elevation or three
 * quarter, legs or no legs, straight or L-shaped — and nothing it says ever
 * becomes a number in a model. Every number here comes from counting pixels,
 * which is deterministic, inspectable, and wrong in ways that can be measured.
 *
 * That split is not fastidiousness. A number from a vision model is an
 * assumption wearing a measurement's clothes: it has no error bar anyone can
 * defend, it cannot be re-derived from the image by a person checking the work,
 * and it would carve real material off a sofa on no better authority than a
 * plausible-sounding token. The rest of this subsystem refuses to carve on an
 * assumption; this is the same rule applied to a new source.
 *
 * ## The measurement
 *
 * Threshold the near-uniform background, keep the largest connected component,
 * then reduce the mask to one number per row: the fraction of the silhouette's
 * own width that is filled. The transitions in that 1-D signal are the
 * boundaries. A sharp drop to a low fraction at the bottom is the leg band, and
 * the leftmost and rightmost filled pixels within that band give the inset.
 *
 * Everything is measured as a fraction of the silhouette's own extent and only
 * then multiplied by a published dimension to become centimetres. The image
 * never supplies a scale; it supplies proportions.
 *
 * ## Not in this file
 *
 * No decoding. The caller hands over a bitmap that something else turned into
 * pixels, because the engine has no DOM, no canvas, and no dependencies, and
 * that is not going to change for an image. No perspective correction: a shot
 * that is not an elevation is rejected rather than unwarped — see
 * `imageEvidence.ts`.
 */

/** A decoded image, reduced to one luminance byte per pixel, row-major from the top left. */
export interface Bitmap {
  width: number;
  height: number;
  /** 0 = black, 255 = white. Length must be `width * height`. */
  luma: Uint8Array;
}

/** A binary mask of the same shape: 1 where the item is, 0 where the background is. */
export interface Silhouette {
  width: number;
  height: number;
  filled: Uint8Array;
  /** Tight bounds of the filled pixels, inclusive. */
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface ThresholdOptions {
  /**
   * How far a pixel must sit from the background's own luminance to count as
   * item, in luminance units.
   *
   * Product photography is shot on a near-uniform sweep, so the background is a
   * narrow cluster and the item is anything outside it. The default is
   * deliberately generous: a threshold that is too tight eats the item's own
   * edge, and eating the edge of a leg makes the leg look narrower and its inset
   * look larger, which carves material that is really there.
   */
  marginFromBackground?: number;
}

export const DEFAULT_BACKGROUND_MARGIN = 24;

/** The background luminance: the most common value along the border, which is all sweep. */
function backgroundLuma(bitmap: Bitmap): number {
  const histogram = new Uint32Array(256);
  const { width, height, luma } = bitmap;
  for (let x = 0; x < width; x++) {
    histogram[luma[x]!]! += 1;
    histogram[luma[(height - 1) * width + x]!]! += 1;
  }
  for (let y = 0; y < height; y++) {
    histogram[luma[y * width]!]! += 1;
    histogram[luma[y * width + width - 1]!]! += 1;
  }
  let best = 0;
  for (let value = 1; value < 256; value++) {
    if (histogram[value]! > histogram[best]!) best = value;
  }
  return best;
}

/**
 * Threshold against the background, then keep only the largest connected blob.
 *
 * The largest-component step is what removes the shadow pooled beside a sofa,
 * the watermark in the corner, and the cushion someone left on the floor of the
 * set.
 *
 * It uses **8-connectivity**, and the choice is a safety one rather than a
 * convention. Under 4-connectivity a slender leg that meets the body only
 * diagonally in the raster is a separate component and gets dropped; the leg
 * then reads narrower than it is, its inset reads *larger* than it is, and the
 * model carves through a leg that is really there. Eight-connectivity errs the
 * other way: at worst it adopts a shadow that touches the item, which makes the
 * silhouette larger, the inset smaller, and the carve more conservative. Both
 * mistakes are possible; only one of them is dangerous.
 *
 * Returns undefined when nothing survives, which is a real answer — a blank
 * image, or a background the thresholding could not tell from the item.
 */
export function silhouetteOf(bitmap: Bitmap, options: ThresholdOptions = {}): Silhouette | undefined {
  const { width, height, luma } = bitmap;
  if (width <= 0 || height <= 0 || luma.length !== width * height) {
    throw new RangeError(`bitmap is ${width}x${height} but carries ${luma.length} samples`);
  }
  const margin = options.marginFromBackground ?? DEFAULT_BACKGROUND_MARGIN;
  const background = backgroundLuma(bitmap);

  const candidate = new Uint8Array(width * height);
  for (let i = 0; i < candidate.length; i++) {
    candidate[i] = Math.abs(luma[i]! - background) >= margin ? 1 : 0;
  }

  // Largest 4-connected component, by flood fill with an explicit stack: a sofa
  // silhouette is tens of thousands of pixels and recursion would not survive it.
  const label = new Int32Array(width * height).fill(-1);
  const stack: number[] = [];
  let bestLabel = -1;
  let bestSize = 0;
  let next = 0;

  for (let seed = 0; seed < candidate.length; seed++) {
    if (candidate[seed] === 0 || label[seed] !== -1) continue;
    const current = next++;
    let size = 0;
    stack.push(seed);
    label[seed] = current;
    while (stack.length > 0) {
      const at = stack.pop()!;
      size += 1;
      const x = at % width;
      const y = (at - x) / width;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= width) continue;
          pushIf(yy * width + xx);
        }
      }
    }
    if (size > bestSize) {
      bestSize = size;
      bestLabel = current;
    }
    continue;

    function pushIf(index: number): void {
      if (candidate[index] === 1 && label[index] === -1) {
        label[index] = current;
        stack.push(index);
      }
    }
  }

  if (bestLabel < 0) return undefined;

  const filled = new Uint8Array(width * height);
  let left = width;
  let right = -1;
  let top = height;
  let bottom = -1;
  for (let i = 0; i < filled.length; i++) {
    if (label[i] !== bestLabel) continue;
    filled[i] = 1;
    const x = i % width;
    const y = (i - x) / width;
    if (x < left) left = x;
    if (x > right) right = x;
    if (y < top) top = y;
    if (y > bottom) bottom = y;
  }

  return { width, height, filled, left, right, top, bottom };
}

/** The 1-D signal the boundaries are read from. */
export interface RowProfile {
  /** For each row of the silhouette's own bounds, the fraction of its width that is filled. */
  readonly fill: Float64Array;
  /** Leftmost filled column in each row, or -1 for an empty row. */
  readonly firstFilled: Int32Array;
  /** Rightmost filled column in each row, or -1. */
  readonly lastFilled: Int32Array;
  /** Rows in the profile, top to bottom. */
  readonly rows: number;
  /** Columns spanned by the silhouette. */
  readonly span: number;
  /** The silhouette's left bound, so `firstFilled` can be read as a gap. */
  readonly leftEdge: number;
}

/** Collapse the mask to one number per row, over the silhouette's own bounds. */
export function rowProfile(silhouette: Silhouette): RowProfile {
  const { filled, width, left, right, top, bottom } = silhouette;
  const rows = bottom - top + 1;
  const span = right - left + 1;
  const fill = new Float64Array(rows);
  const firstFilled = new Int32Array(rows).fill(-1);
  const lastFilled = new Int32Array(rows).fill(-1);

  for (let row = 0; row < rows; row++) {
    const y = top + row;
    let count = 0;
    let first = -1;
    let last = -1;
    for (let x = left; x <= right; x++) {
      if (filled[y * width + x] !== 1) continue;
      count += 1;
      if (first < 0) first = x;
      last = x;
    }
    fill[row] = count / span;
    firstFilled[row] = first;
    lastFilled[row] = last;
  }

  return { fill, firstFilled, lastFilled, rows, span, leftEdge: left };
}

/** What the profile says about the band at the bottom, in fractions of the silhouette. */
export interface LegBandReading {
  /** Height of the leg band as a fraction of the silhouette's total height. */
  heightFraction: number;
  /**
   * Smallest gap between the band's material and the silhouette's edge, as a
   * fraction of the silhouette's width.
   *
   * The **minimum** over both sides and over every row of the band, because the
   * claim the model will make from it — "there is no material within this of the
   * perimeter" — has to hold everywhere in the band, not on average.
   */
  insetFraction: number;
  /** Rows the band occupies, for a caller that wants to see the working. */
  bandRows: number;
}

export interface LegBandOptions {
  /**
   * Fill fraction below which a row counts as leg band rather than body.
   *
   * A body row is nearly solid; a row through a pair of legs is mostly air. The
   * default sits well below anything a plinth or a skirt would produce, because
   * mistaking a solid plinth for a leg band is the error that carves material
   * that is really there.
   */
  bandFillCeiling?: number;
}

export const DEFAULT_BAND_FILL_CEILING = 0.5;

/**
 * Find the leg band: the run of rows at the bottom that is mostly air.
 *
 * Returns undefined when the silhouette is solid to the floor, which is the
 * right answer for a plinth and for a sofa bed, and is not a failure.
 */
export function legBandOf(profile: RowProfile, options: LegBandOptions = {}): LegBandReading | undefined {
  const ceiling = options.bandFillCeiling ?? DEFAULT_BAND_FILL_CEILING;
  const { fill, firstFilled, lastFilled, rows, span } = profile;
  if (rows === 0 || span === 0) return undefined;

  // Walk up from the floor for as long as the rows stay mostly air.
  let bandTop = rows;
  while (bandTop > 0 && fill[bandTop - 1]! <= ceiling) bandTop -= 1;
  const bandRows = rows - bandTop;
  if (bandRows === 0 || bandTop === 0) return undefined;

  // The tightest gap anywhere in the band, on either side. Anything looser would
  // claim a clearance the band does not actually have in every row, and the
  // claim this becomes — "no material within this of the perimeter" — has to
  // hold at the worst row, not on average.
  const leftEdge = profile.leftEdge;
  const rightEdge = leftEdge + span - 1;
  let smallestGap = span;
  for (let row = bandTop; row < rows; row++) {
    const first = firstFilled[row]!;
    const last = lastFilled[row]!;
    if (first < 0) continue;
    smallestGap = Math.min(smallestGap, first - leftEdge, rightEdge - last);
  }
  if (smallestGap === span) return undefined;

  return {
    heightFraction: bandRows / rows,
    insetFraction: Math.max(0, smallestGap) / span,
    bandRows,
  };
}
