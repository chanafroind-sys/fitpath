/**
 * @fitpath/viewer — the engine's scenes, drawn.
 *
 * A consumer of @fitpath/engine, never a copy of it: every position, extent and
 * rotation drawn here is an engine number written out verbatim, inside one
 * group rotated so that the engine's frame becomes Three's. It lives in its own
 * package because two apps draw the same scenes — the demo and the embeddable
 * widget — and one drawing of the geometry is one place for it to be wrong.
 *
 * Nothing in here touches the document: a caller hands in a canvas and gets a
 * viewer back, which is what lets it run inside a shadow root as easily as on
 * a page.
 */
export { Viewer, type SceneSetup } from './viewer.ts';
export {
  DARK_PALETTE,
  LIGHT_PALETTE,
  buildEnvironmentView,
  buildItemView,
  viewingBox,
  type EnvironmentView,
  type ItemView,
  type Palette,
} from './scene.ts';
export { buildTimeline, stepRanges, type StepRange, type Timeline } from './timeline.ts';
export { Playback, type PlaybackListener } from './playback.ts';
