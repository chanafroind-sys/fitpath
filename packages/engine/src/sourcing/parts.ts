/**
 * Furniture that comes in more than one piece.
 *
 * ## Why this replaces the bounding-box fallback on L-shapes
 *
 * A corner sofa was previously emitted as its own bounding box and flagged
 * near-useless, because nothing in the contract described the return leg. That
 * was true of the contract, not of the world: every shop that sells a corner
 * sofa publishes the chaise's own dimensions and which side it is on, because
 * nobody can order one without choosing. The information was always there. So
 * the contract takes it, and an L-shape becomes two boxes at right angles rather
 * than a 280 x 200 slab — no image analysis required, and no inference.
 *
 * ## `separates` is the largest distinction in this file
 *
 * The same two parts, with the same dimensions, are two completely different
 * problems depending on one boolean. A rigid L-shaped body has to cross the
 * doorway whole, sweeping its corner. The same shape as two bolted modules is
 * two easy separate carries, and the answer a product page should give is "as
 * one piece it needs X; module by module it needs Y".
 *
 * `'unknown'` is treated as rigid. Assuming a body comes apart when it does not
 * is the fatal direction — it would report a doorway passable that a solid
 * corner sofa will never get through.
 *
 * ## Arrangement is stated, never inferred
 *
 * Part dimensions alone do not determine a shape: 280 x 95 and 95 x 105 could
 * be an L either way round, or in line. Which it is comes from the same field
 * the shop already prints — left-facing or right-facing — taken as input.
 */

import type { Box, Item } from '../types.ts';

/**
 * Which end of the part it attaches to, seen from in front of the sofa.
 *
 * The industry's own words. A "right-facing chaise" sits at the right-hand end
 * as you stand looking at the sofa, which in this frame — +X to the right, +Y
 * toward the back — is the +X end.
 */
export type AttachmentSide = 'left' | 'right';

export interface PartAttachment {
  /** The `id` of the part this one is bolted to. */
  to: string;
  side: AttachmentSide;
}

/**
 * Whether a piece can be carried in on its own.
 *
 * Tri-state on purpose, and `'unknown'` means rigid. See the module comment.
 */
export type Separates = true | false | 'unknown';

/** Where a part's own local frame sits inside the assembled body. */
export interface PartPlacement {
  offsetX: number;
  offsetY: number;
}

/**
 * Lay parts out against each other and return where each one's origin lands.
 *
 * The anchor — the part nothing attaches from, which is the first one — sits at
 * the origin. A part attached to it occupies the named end of its width and
 * projects **forward**, out past the anchor's front face, because that is what a
 * chaise return does: an L-shape is deeper than either limb, not deeper than
 * their sum overlapped.
 *
 * Only one level of attachment is supported, which is every corner sofa anyone
 * sells. A part attached to a part that is itself attached is refused rather
 * than approximated.
 */
export function arrangeParts(
  parts: readonly { id: string; widthCm: number; depthCm: number; attachment?: PartAttachment }[],
): Map<string, PartPlacement> {
  if (parts.length === 0) throw new RangeError('an item needs at least one part');

  const byId = new Map(parts.map((part) => [part.id, part]));
  const anchor = parts[0]!;
  if (anchor.attachment !== undefined) {
    throw new RangeError(`the first part ("${anchor.id}") is the anchor and may not attach to anything`);
  }

  const placements = new Map<string, PartPlacement>([[anchor.id, { offsetX: 0, offsetY: 0 }]]);

  for (const part of parts.slice(1)) {
    const attachment = part.attachment;
    if (attachment === undefined) continue; // ships alongside; not part of the body
    const host = byId.get(attachment.to);
    if (host === undefined) {
      throw new RangeError(`part "${part.id}" attaches to "${attachment.to}", which is not a part of this item`);
    }
    if (host.attachment !== undefined) {
      throw new RangeError(
        `part "${part.id}" attaches to "${host.id}", which is itself attached. ` +
          'Only one level of attachment is modelled: a chain of three would need a shape nobody sells.',
      );
    }
    const hostPlacement = placements.get(host.id)!;

    // Flush with the host's chosen end...
    const offsetX =
      attachment.side === 'right'
        ? hostPlacement.offsetX + host.widthCm / 2 - part.widthCm / 2
        : hostPlacement.offsetX - host.widthCm / 2 + part.widthCm / 2;
    // ...and entirely in front of it: the host's front face is the part's back face.
    const offsetY = hostPlacement.offsetY - host.depthCm / 2 - part.depthCm / 2;

    placements.set(part.id, { offsetX, offsetY });
  }

  return placements;
}

/** Shift every box of an item into the assembled body's frame. */
export function translateBoxes(boxes: readonly Box[], by: PartPlacement): Box[] {
  return boxes.map((box) => ({
    ...box,
    center: { x: box.center.x + by.offsetX, y: box.center.y + by.offsetY, z: box.center.z },
  }));
}

/**
 * Fuse placed parts into one rigid body.
 *
 * The union of the boxes, re-centred so the assembled item keeps the engine's
 * convention: origin at the centre of the footprint, on the floor. Labels carry
 * the part's name when there is more than one piece, because "the armrests"
 * alone stops being a useful thing to read once there are two sets of them.
 */
export function assemble(
  id: string,
  name: string,
  nameHe: string,
  placed: readonly { id: string; name: string; boxes: readonly Box[]; placement: PartPlacement }[],
): Item {
  const boxes: Box[] = [];
  for (const part of placed) {
    const multi = placed.length > 1;
    for (const box of translateBoxes(part.boxes, part.placement)) {
      boxes.push(
        multi && box.label !== undefined
          ? { ...box, label: `${box.label} (${part.name})` }
          : box,
      );
    }
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const box of boxes) {
    minX = Math.min(minX, box.center.x - box.halfExtents.x);
    maxX = Math.max(maxX, box.center.x + box.halfExtents.x);
    minY = Math.min(minY, box.center.y - box.halfExtents.y);
    maxY = Math.max(maxY, box.center.y + box.halfExtents.y);
  }
  const shiftX = -(minX + maxX) / 2;
  const shiftY = -(minY + maxY) / 2;

  return {
    id,
    name,
    nameHe,
    boxes: boxes.map((box) => ({
      ...box,
      center: { x: box.center.x + shiftX, y: box.center.y + shiftY, z: box.center.z },
    })),
  };
}
