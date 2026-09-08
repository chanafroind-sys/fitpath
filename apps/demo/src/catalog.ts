/**
 * The shop's six products, all sofas.
 *
 * Every measurement on the page is read out of the engine's own fixtures — the
 * same objects its tests are written against — rather than typed in here. What
 * this file adds is the retail dressing the engine has no opinion about: a
 * price, a blurb, a picture, and which of the item's local axes a shopper calls
 * "width".
 */
import {
  CORNER_SOFA,
  DEEP_SEAT_LOUNGE,
  LEGS_MUST_COME_OFF,
  NARROW_HALLWAY,
  RECLINER_2_SEAT,
  SLIM_ARM_2_SEAT,
  SOFA_3_SEAT,
  SOFA_BED,
  TRIVIAL_FIT,
  itemWorldBoxes,
  unionAabb,
} from '@fitpath/engine';
import type { AxisBox, EnvironmentParams, Item, Placement, Scenario } from '@fitpath/engine';
import type { ItemId } from './engine/protocol.ts';
import { PRECOMPUTED } from './precomputed.ts';
import sofaImage from './assets/sofa.svg';

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
 * The scene each product page opens with.
 *
 * Read from the precomputed payload rather than written here, because the build
 * verifies every maneuver against these exact numbers before it will publish.
 * Two literals that agreed by good intentions is how a sofa ended up animating
 * through a wall.
 */
const scene = (id: string): EnvironmentParams =>
  PRECOMPUTED.scenes[id] ?? {
    openingWidth: 110,
    openingHeight: 210,
    wallThickness: 15,
    hallwayWidth: 240,
    hallwayDepth: 360,
    roomDepth: 400,
    roomWidth: 400,
    ceilingHeight: 250,
  };

const SOFA_DEFAULTS = scene('sofa-3-seat');
const SLIM_DEFAULTS = scene('slim-arm-2-seat');
const CORNER_DEFAULTS = scene('corner-sofa');
const DEEP_DEFAULTS = scene('deep-seat-lounge');
const RECLINER_DEFAULTS = scene('recliner-2-seat');
const SOFA_BED_DEFAULTS = scene('sofa-bed');

export const PRODUCTS: readonly Product[] = [
  {
    id: 'sofa-3-seat',
    item: SOFA_3_SEAT,
    title: 'Almedal 3-seat sofa',
    titleHe: 'ספה תלת-מושבית אלמדל',
    tagline: 'Deep seat, feather-topped cushions, solid beech legs',
    price: 6490,
    blurb:
      'A generous three-seater with a 12° reclined back and a removable leg set. The legs unscrew in about a minute, and they are exactly what decides the answer.',
    material: 'Wool-blend upholstery · solid beech legs',
    image: sofaImage,
    widthAxis: 'x',
    defaults: SOFA_DEFAULTS,
    scenarios: [TRIVIAL_FIT, NARROW_HALLWAY, LEGS_MUST_COME_OFF],
  },
  {
    id: 'slim-arm-2-seat',
    item: SLIM_ARM_2_SEAT,
    title: 'Vetle slim-arm 2-seat',
    titleHe: 'ספה דו-מושבית ווטלה',
    tagline: 'Eight-centimetre arms, low back, recessed plinth',
    price: 4290,
    blurb:
      'Slim arms that stop well below the back, and a plinth instead of legs. That combination is why this is the one sofa here that gains from being turned as it goes rather than simply laid on its side.',
    material: 'Bouclé upholstery · powder-coated plinth',
    image: sofaImage,
    widthAxis: 'x',
    defaults: SLIM_DEFAULTS,
    scenarios: [],
  },
  {
    id: 'corner-sofa',
    item: CORNER_SOFA,
    title: 'Rosendal corner sofa',
    titleHe: 'ספה פינתית רוזנדל',
    tagline: 'Chaise return, 280 × 200 cm overall',
    price: 11900,
    blurb:
      'An L, which a rectangular doorway does not forgive. Delivered as two modules that bolt together, and the difference between the assembled figure and the module figure is the difference between impossible and ordinary.',
    material: 'Linen-blend upholstery · steel connectors',
    image: sofaImage,
    widthAxis: 'x',
    defaults: CORNER_DEFAULTS,
    scenarios: [],
  },
  {
    id: 'deep-seat-lounge',
    item: DEEP_SEAT_LOUNGE,
    title: 'Havsta deep-seat lounge',
    titleHe: 'ספת לאונג עמוקה הבסטה',
    tagline: '110 cm deep, 75 cm tall, nothing removable',
    price: 7350,
    blurb:
      'Low and very deep, so depth rather than height is what a doorway sees. It is the narrowest-clearing sofa in the catalogue, and it goes in on end.',
    material: 'Cotton-velvet upholstery · hardwood frame',
    image: sofaImage,
    widthAxis: 'x',
    defaults: DEEP_DEFAULTS,
    scenarios: [],
  },
  {
    id: 'recliner-2-seat',
    item: RECLINER_2_SEAT,
    title: 'Brekke 2-seat recliner',
    titleHe: 'ספת ריקליינר דו-מושבית ברקה',
    tagline: 'Powered recline, mechanism housed across the back',
    price: 8990,
    blurb:
      'The reclining mechanism lives in a housing across the back and is bolted to the frame. It adds ten centimetres of depth that cannot be taken off, and those ten centimetres are the whole answer.',
    material: 'Leather upholstery · steel mechanism',
    image: sofaImage,
    widthAxis: 'x',
    defaults: RECLINER_DEFAULTS,
    scenarios: [],
  },
  {
    id: 'sofa-bed',
    item: SOFA_BED,
    title: 'Lindholm sofa bed',
    titleHe: 'ספה נפתחת לינדהולם',
    tagline: 'Full-size folding frame, nothing to unbolt',
    price: 6790,
    blurb:
      'The folded bed fills the body, so there is no hollow to turn into clearance and nothing that comes off. The hardest case here, and it is in the catalogue for that reason.',
    material: 'Heavy-weave upholstery · sprung steel frame',
    image: sofaImage,
    widthAxis: 'x',
    defaults: SOFA_BED_DEFAULTS,
    scenarios: [],
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
