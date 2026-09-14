import { describe, expect, it } from 'vitest';
import { SOFAS, WARDROBE } from '@fitpath/engine';
import { illustrate } from '../src/index.ts';

describe('illustrate', () => {
  it('draws exactly three faces of a single axis-aligned box from a three-quarter view', () => {
    const svg = illustrate(WARDROBE, { shadow: false });
    expect(svg.match(/<polygon /g)).toHaveLength(3);
  });

  it('is deterministic', () => {
    const a = illustrate(SOFAS[0]!);
    const b = illustrate(SOFAS[0]!);
    expect(a).toBe(b);
  });

  it('draws every sofa in the catalogue differently', () => {
    const drawings = new Set(SOFAS.map((sofa) => illustrate(sofa)));
    expect(drawings.size).toBe(SOFAS.length);
  });

  it('draws removable parts as hardware, and names the item', () => {
    const svg = illustrate(SOFAS[0]!);
    expect(svg).toContain('aria-label="3-seat sofa, drawn from its box model"');
    // The leg colour, shaded, stays dark; the upholstery never gets near it.
    expect(svg).toMatch(/fill="#[3-5][0-9a-f]{5}"/);
  });

  it('keeps everything inside the viewBox', () => {
    const svg = illustrate(SOFAS[2]!, { width: 400, height: 300 });
    const coords = [...svg.matchAll(/points="([^"]+)"/g)].flatMap((m) =>
      m[1]!.split(' ').map((pair) => pair.split(',').map(Number)),
    );
    expect(coords.length).toBeGreaterThan(0);
    for (const [x, y] of coords) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(400);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(300);
    }
  });
});
