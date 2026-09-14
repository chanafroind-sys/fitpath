/** The least DOM plumbing that keeps the modal's rendering readable. */

type Child = Node | string | null | undefined | false;

interface Attributes {
  class?: string;
  text?: string;
  [key: string]: unknown;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes: Attributes = {},
  children: Child[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = String(value);
    else if (key === 'text') node.textContent = String(value);
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    } else if (value === true) node.setAttribute(key, '');
    else node.setAttribute(key, String(value));
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

export function clear(node: Element): void {
  while (node.firstChild) node.firstChild.remove();
}

/** A Hebrew run inside an otherwise left-to-right panel. */
export function hebrew(text: string, className = 'he'): HTMLElement {
  return el('span', { class: className, dir: 'rtl', lang: 'he', text });
}

/** Rounded to the centimetre for display, with one decimal only when it matters. */
export function cm(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/** A requirement, shown to the hundredth it was measured to, without trailing noise. */
export function need(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace(/0$/, '');
}
