import { el } from './dom.ts';

/**
 * A plan view of the three corridor numbers, drawn so they cannot be confused.
 *
 * Two of them are depths and one is a width, they all sound alike written
 * down, and the one that decides whether an item can be turned to face the door
 * was the one nobody could find. A shopper cannot answer a question they cannot
 * picture, so the form gets a picture: the wall across the middle, the doorway
 * as a gap in it, the hallway below and the room above, with each measurement
 * drawn as the arrow it actually is.
 *
 * Inline SVG rather than an asset, because it is theme-aware: every colour is
 * `currentColor` or a CSS variable, so it follows light and dark without a
 * second copy.
 */
export function corridorDiagram(): HTMLElement {
  const svg = `
<svg viewBox="0 0 260 220" role="img" aria-labelledby="corridor-title corridor-desc"
     xmlns="http://www.w3.org/2000/svg" class="corridor-svg">
  <title id="corridor-title">Plan view of a doorway, the hallway in front of it and the room behind</title>
  <desc id="corridor-desc">Looking down from above. The wall runs left to right with the
    doorway as a gap in it. Depth in front is measured from the door back into the hallway;
    width along the wall is measured left to right past the door; depth behind is measured
    from the door into the room.</desc>

  <!-- the room, behind the wall -->
  <rect x="14" y="14" width="232" height="72" class="corridor-room" />
  <text x="130" y="34" class="corridor-zone">the room</text>

  <!-- the wall, with the doorway as a gap -->
  <rect x="14" y="90" width="94" height="14" class="corridor-wall" />
  <rect x="152" y="90" width="94" height="14" class="corridor-wall" />

  <!-- the hallway, in front -->
  <rect x="14" y="108" width="232" height="88" class="corridor-hall" />
  <text x="130" y="190" class="corridor-zone">the hallway</text>

  <!-- depth behind: door into the room -->
  <line x1="130" y1="90" x2="130" y2="16" class="corridor-arrow" marker-end="url(#tip)" />
  <text x="136" y="56" class="corridor-label">depth behind</text>

  <!-- depth in front: door back into the hallway -->
  <line x1="130" y1="104" x2="130" y2="178" class="corridor-arrow" marker-end="url(#tip)" />
  <text x="136" y="146" class="corridor-label">depth in front</text>

  <!-- width along the wall -->
  <line x1="18" y1="128" x2="242" y2="128" class="corridor-arrow corridor-arrow-along"
        marker-start="url(#tip)" marker-end="url(#tip)" />
  <text x="130" y="122" class="corridor-label corridor-label-along">width along the wall</text>

  <!-- the opening itself -->
  <line x1="108" y1="97" x2="152" y2="97" class="corridor-opening" />
  <text x="130" y="86" class="corridor-label corridor-label-opening">opening</text>

  <defs>
    <marker id="tip" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5"
            orient="auto-start-reverse">
      <path d="M0.5 0.5 L7.5 4 L0.5 7.5 z" fill="currentColor" />
    </marker>
  </defs>
</svg>`;

  const figure = el('figure', { class: 'corridor-figure' });
  figure.innerHTML = svg;
  figure.append(
    el('figcaption', { class: 'muted' }, [
      'Looking down from above. Two of these are depths and one is a width — the width along the wall is what you need to turn a sofa to face the door.',
    ]),
  );
  return figure;
}
