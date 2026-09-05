/**
 * The shop's three products.
 *
 * Every measurement on the page is read out of the engine's own fixtures — the
 * same objects its tests are written against — rather than typed in here. What
 * this file adds is the retail dressing the engine has no opinion about: a
 * price, a blurb, a picture, and which of the item's local axes a shopper calls
 * "width".
 */
import {
  IMPOSSIBLE,
  LEGS_MUST_COME_OFF,
  NARROW_HALLWAY,
  REFRIGERATOR,
  SOFA_3_SEAT,
  TILT_REQUIRED,
  TRIVIAL_FIT,
  WARDROBE,
  itemWorldBoxes,
  unionAabb,
} from '@fitpath/engine';
import type { AxisBox, EnvironmentParams, Item, Placement, Scenario } from '@fitpath/engine';
import type { ItemId } from './engine/protocol.ts';
import sofaImage from './assets/sofa.svg';
import wardrobeImage from './assets/wardrobe.svg';
import refrigeratorImage from './assets/refrigerator.svg';

/** The item at its own origin, unrotated: the pose its declared box list describes. */
const ORIGIN: Placement = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };

export function boundsOf(item: Item): AxisBox {
  return unionAabb(itemWorldBoxes(item, ORIGIN));
}

/**
 * How high the placement's `z` has to be for the item to rest on the floor.
 *
 * For the sofa this is 15 cm, because its local origin sits at the top of the
 * legs and the legs hang below it — the convention that makes "take the legs
 * off" a meaningful operation.
 */
export function restingZ(item: Item): number {
  return -boundsOf(item).minZ;
}

/**
 * Which local axis a shopper means by "width".
 *
 * The engine's axis assignment is load-bearing geometry, not presentation: the
 * wardrobe puts its 60 cm depth on local Y because local Y is the axis pitch
 * tips the item over, and getting that wrong makes the engine confidently
 * report that an ordinary wardrobe cannot be tilted at all. So the catalogue
 * says which axis to *label* width, and never reassigns one.
 */
export type PlanAxis = 'x' | 'y';

export interface Product {
  id: ItemId;
  item: Item;
  /** Shop-facing name. The engine's own `item.name` is shown alongside it. */
  title: string;
  titleHe: string;
  tagline: string;
  price: number;
  blurb: string;
  material: string;
  image: string;
  widthAxis: PlanAxis;
  /** A measured, decisive scene to open the checker with. */
  defaults: EnvironmentParams;
  /** Named engine scenarios that use this item, offered as one-click presets. */
  scenarios: readonly Scenario[];
}

/**
 * Defaults chosen by measurement, not by taste: each answers decisively in
 * under a second so the first thing a visitor does is not a wait.
 */
const SOFA_DEFAULTS: EnvironmentParams = {
  openingWidth: 110,
  openingHeight: 210,
  wallThickness: 15,
  hallwayWidth: 240,
  hallwayDepth: 320,
  roomDepth: 400,
  roomWidth: 400,
  ceilingHeight: 250,
};

const WARDROBE_DEFAULTS: EnvironmentParams = {
  openingWidth: 200,
  openingHeight: 205,
  wallThickness: 15,
  hallwayWidth: 260,
  hallwayDepth: 420,
  roomDepth: 380,
  roomWidth: 380,
  ceilingHeight: 250,
};

const REFRIGERATOR_DEFAULTS: EnvironmentParams = {
  openingWidth: 80,
  openingHeight: 200,
  wallThickness: 15,
  hallwayWidth: 150,
  hallwayDepth: 320,
  roomDepth: 400,
  roomWidth: 400,
  ceilingHeight: 250,
};

export const PRODUCTS: readonly Product[] = [
  {
    id: 'sofa-3-seat',
    item: SOFA_3_SEAT,
    title: 'Almedal 3-seat sofa',
    titleHe: 'ספה תלת-מושבית אלמדל',
    tagline: 'Deep seat, feather-topped cushions, solid beech legs',
    price: 6490,
    blurb:
      'A generous three-seater with a 12° reclined back and a removable leg set. The legs unscrew in about a minute, which occasionally turns out to matter.',
    material: 'Wool-blend upholstery · solid beech legs',
    image: sofaImage,
    widthAxis: 'x',
    defaults: SOFA_DEFAULTS,
    scenarios: [TRIVIAL_FIT, NARROW_HALLWAY, LEGS_MUST_COME_OFF],
  },
  {
    id: 'wardrobe',
    item: WARDROBE,
    title: 'Vinter two-door wardrobe',
    titleHe: 'ארון בגדים דו-דלתי וינטר',
    tagline: 'Full-height hanging space, soft-close doors',
    price: 3890,
    blurb:
      'Taller than a standard door, which is the whole problem. It goes in tipped onto its back — a maneuver that needs the ceiling as much as it needs the doorway.',
    material: 'Oak veneer · soft-close hinges',
    image: wardrobeImage,
    widthAxis: 'y',
    defaults: WARDROBE_DEFAULTS,
    scenarios: [TILT_REQUIRED],
  },
  {
    id: 'refrigerator',
    item: REFRIGERATOR,
    title: 'Kelvin 380 fridge-freezer',
    titleHe: 'מקרר-מקפיא קלווין 380',
    tagline: '380 litres, no-frost, reversible doors',
    price: 5250,
    blurb:
      'A single rigid block with nothing to remove and nothing that folds. When it does not fit, it does not fit — and the engine can sometimes prove that outright.',
    material: 'Brushed stainless steel',
    image: refrigeratorImage,
    widthAxis: 'x',
    defaults: REFRIGERATOR_DEFAULTS,
    scenarios: [IMPOSSIBLE],
  },
];

export function productById(id: string): Product | undefined {
  return PRODUCTS.find((p) => p.id === id);
}

export interface RetailDimensions {
  width: number;
  depth: number;
  height: number;
}

/** The three numbers for the dimensions table, measured by the engine. */
export function retailDimensions(product: Product): RetailDimensions {
  const bounds = boundsOf(product.item);
  const alongX = bounds.maxX - bounds.minX;
  const alongY = bounds.maxY - bounds.minY;
  return {
    width: product.widthAxis === 'x' ? alongX : alongY,
    depth: product.widthAxis === 'x' ? alongY : alongX,
    height: bounds.maxZ - bounds.minZ,
  };
}

/**
 * The compare view: one sofa, one doorway, two corridors.
 *
 * The doorway is identical on both sides and the sofa passes through it in
 * both. The start pose is pinned rather than left to the engine, because the
 * engine's default backs the item against the corridor's far wall — a different
 * pose in a 100 cm corridor than in a 240 cm one — and then the two sides would
 * not be the same maneuver.
 */
const COMPARE_SHARED: Omit<EnvironmentParams, 'hallwayWidth'> = {
  openingWidth: 110,
  openingHeight: 210,
  wallThickness: 15,
  hallwayDepth: 320,
  roomDepth: 400,
  roomWidth: 400,
  ceilingHeight: 220,
};

export const COMPARE = {
  product: PRODUCTS[0]!,
  start: { x: 0, y: -50, z: restingZ(SOFA_3_SEAT), yaw: 0, pitch: 0 } as Placement,
  roomy: { ...COMPARE_SHARED, hallwayWidth: 240 } satisfies EnvironmentParams,
  tight: { ...COMPARE_SHARED, hallwayWidth: 100 } satisfies EnvironmentParams,
} as const;
