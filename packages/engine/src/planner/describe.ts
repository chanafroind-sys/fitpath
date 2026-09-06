import type { Placement, Step } from '../types.ts';
import type { PreparedItem } from '../geometry/collide.ts';
import type { Segment } from './segment.ts';
import { angleDelta, degrees, rotationMatrix } from '../math/rotation.ts';
import { itemWorldBoxes } from '../geometry/collide.ts';
import { unionAabb } from '../geometry/worldBox.ts';
import { stepKind } from './segment.ts';

/**
 * Hebrew instructions are written in the infinitive (שם פועל): "להטות",
 * "לסובב", not "הטה"/"הטי".
 *
 * Two reasons, and both matter. It is the register Hebrew actually uses for
 * instructions — recipes, assembly leaflets, safety notices — so it reads
 * naturally. And it carries no grammatical gender, so the engine never has to
 * guess something about the person reading it that it has no way of knowing.
 */

const cm = (value: number): string => `${Math.round(Math.abs(value))}`;
const deg = (radians: number): string => `${Math.round(Math.abs(degrees(radians)))}`;

/**
 * Which end of the item rises during a pitch change, described from the
 * doorway's point of view.
 *
 * Pitch turns about the item's own +Y axis, and a positive pitch drops the
 * item's local +X end. So the rising end is the local -X end for a positive
 * change and the local +X end for a negative one. Whether that end reads as
 * "front" or "back" to a person depends on which way it points once the item
 * has been yawed, which is why this is computed from the placement rather than
 * hard-coded.
 */
function risingEndIsLeading(from: Placement, to: Placement): boolean {
  const risingLocalX = to.pitch > from.pitch ? -1 : 1;
  // Column 0 of the rotation is the world direction of the item's local +X.
  const forward = rotationMatrix(to.yaw, to.pitch, 0)[0];
  return risingLocalX * forward.y > 0;
}

/**
 * The corner of the item's footprint that enters the doorway first, if any one
 * corner clearly does.
 *
 * Only reported when the item is turned far enough for it to matter: with the
 * item square to the wall the whole leading face arrives at once and "lead with
 * the right corner" would be noise dressed up as advice.
 */
function leadingCorner(item: PreparedItem, placement: Placement): 'left' | 'right' | undefined {
  const boxes = itemWorldBoxes(item, placement);
  let bestY = -Infinity;
  let bestX = 0;
  let centreX = 0;
  let count = 0;
  for (const box of boxes) {
    centreX += box.center.x;
    count++;
    // The AABB corners are a sound stand-in for the true corners here: we only
    // need to know which side of the item reaches furthest toward the room.
    for (const x of [box.aabbMin.x, box.aabbMax.x]) {
      const y = box.aabbMax.y;
      if (y > bestY + 1e-9) {
        bestY = y;
        bestX = x;
      } else if (Math.abs(y - bestY) <= 1e-9 && Math.abs(x) > Math.abs(bestX)) {
        bestX = x;
      }
    }
  }
  if (count === 0) return undefined;
  centreX /= count;

  const aabb = unionAabb(boxes);
  const halfWidth = (aabb.maxX - aabb.minX) / 2;
  // A corner only "leads" if it is meaningfully off-centre; 25% of the item's
  // own width is the threshold at which the asymmetry is worth mentioning.
  if (halfWidth <= 0 || Math.abs(bestX - centreX) < halfWidth * 0.5) return undefined;
  return bestX > centreX ? 'right' : 'left';
}

/** Turn one segment of the path into an instruction a person can follow. */
export function describeSegment(item: PreparedItem, segment: Segment, index: number): Step {
  const { from, to } = segment;
  const kind = stepKind(segment.axis, from, to);

  let amount: number;
  let en: string;
  let he: string;

  switch (kind) {
    case 'advance': {
      amount = to.y - from.y;
      const corner = leadingCorner(item, to);
      en = `Move it forward about ${cm(amount)} cm, toward the room`;
      he = `להזיז אותה קדימה בערך ${cm(amount)} ס״מ, לכיוון החדר`;
      if (corner === 'right') {
        en += '. Lead with the right corner';
        he += '. להוביל עם הפינה הימנית';
      } else if (corner === 'left') {
        en += '. Lead with the left corner';
        he += '. להוביל עם הפינה השמאלית';
      }
      break;
    }
    case 'retreat': {
      amount = to.y - from.y;
      en = `Pull it back about ${cm(amount)} cm, away from the doorway`;
      he = `למשוך אותה אחורה בערך ${cm(amount)} ס״מ, הרחק מהפתח`;
      break;
    }
    case 'slide': {
      amount = to.x - from.x;
      const right = amount >= 0;
      en = `Slide it about ${cm(amount)} cm to the ${right ? 'right' : 'left'}`;
      he = `להסיט אותה בערך ${cm(amount)} ס״מ ${right ? 'ימינה' : 'שמאלה'}`;
      break;
    }
    case 'lift': {
      amount = to.z - from.z;
      en = `Lift it about ${cm(amount)} cm`;
      he = `להרים אותה בערך ${cm(amount)} ס״מ`;
      break;
    }
    case 'lower': {
      amount = to.z - from.z;
      en = `Lower it about ${cm(amount)} cm`;
      he = `להנמיך אותה בערך ${cm(amount)} ס״מ`;
      break;
    }
    case 'yaw': {
      const delta = angleDelta(from.yaw, to.yaw);
      amount = degrees(delta);
      // Seen from above with Z up, a positive yaw turns counter-clockwise.
      const counterClockwise = delta >= 0;
      en = `Rotate it ${deg(delta)}° ${counterClockwise ? 'counter-clockwise' : 'clockwise'}`;
      he = `לסובב אותה ${deg(delta)}° ${counterClockwise ? 'נגד כיוון השעון' : 'עם כיוון השעון'}`;
      break;
    }
    case 'pitch': {
      const delta = to.pitch - from.pitch;
      amount = degrees(delta);
      const leading = risingEndIsLeading(from, to);
      en = `Tilt the ${leading ? 'front' : 'back'} edge up about ${deg(delta)}°`;
      he = `להטות את הקצה ${leading ? 'הקדמי' : 'האחורי'} כלפי מעלה בערך ${deg(delta)}°`;
      break;
    }
  }

  return { index, kind, from, to, amount, en, he };
}

export function describePath(item: PreparedItem, segments: Segment[]): Step[] {
  const steps = segments.map((segment, i) => describeSegment(item, segment, i));
  assertPlausible(steps);
  return steps;
}

/**
 * The largest rotation any single instruction may report.
 *
 * Yaw is reported through `angleDelta`, which takes the short way round and so
 * cannot exceed 180 by construction; pitch is clamped to +/-90, so a net change
 * cannot exceed 180 either. The check is therefore not defending against
 * arithmetic — it is defending against a future change to segmentation or to
 * the lattice quietly producing an instruction like "tilt the back edge up
 * about 300 degrees", which is the kind of output that destroys trust in
 * everything else on the page.
 */
const MAX_REPORTED_ROTATION_DEG = 180;

/**
 * Refuse to hand back an instruction a person could not perform.
 *
 * Throwing is deliberate. A wrong number here is worse than an error: it is
 * read, believed, and acted on.
 */
export function assertPlausible(steps: readonly Step[]): void {
  for (const step of steps) {
    if (step.kind !== 'yaw' && step.kind !== 'pitch') continue;
    if (Math.abs(step.amount) > MAX_REPORTED_ROTATION_DEG + 1e-9) {
      throw new Error(
        `describePath: step ${step.index} reports a ${step.kind} of ${step.amount.toFixed(1)} degrees, ` +
          `beyond the ${MAX_REPORTED_ROTATION_DEG} degree maximum a single instruction may describe`,
      );
    }
  }
}
