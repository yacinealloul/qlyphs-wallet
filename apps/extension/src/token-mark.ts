/** Token marks: the QTC symbol, or a token's drawn emblem with its creator's logo over it once
 * loaded. The emblem is derived from the full asset identifier, the same one the Qlyphs app draws,
 * so a token looks the same in both. A mark is a recognition aid beside the name, never proof of
 * identity: reviews still show the full asset identifier. */
const SVG = 'http://www.w3.org/2000/svg';
const PALETTES = [
  ['#231A15', '#ECA879', '#FACFA9'],
  ['#17201C', '#91B59B', '#CCE0BF'],
  ['#191E2B', '#93A8D4', '#C7D7F2'],
  ['#251A20', '#CF94A4', '#F0C0CB'],
  ['#232117', '#C5B879', '#EEE0AB'],
  ['#172224', '#82B5B6', '#B8DEDC'],
  ['#201C29', '#AE9BCC', '#D9CAEC'],
  ['#24211F', '#BAAEA0', '#E8DED0'],
] as const;
// Each emblem: [path, uses highlight, opacity] in a 64 × 64 box.
const EMBLEMS: readonly (readonly [string, boolean, number?])[][] = [
  [['M29 14a15 15 0 1 0 0 30v-7a8 8 0 1 1 0-16z', false], ['M35 50a15 15 0 1 0 0-30v7a8 8 0 1 1 0 16z', true]],
  [['m13 35 19-22 19 22-19 16z', false], ['M32 13v38L21 34z', true], ['m32 13 19 22H32z', true, 0.45]],
  [
    ['M14 19h25a11 11 0 0 1 0 22h-8v-7h8a4 4 0 0 0 0-8H14z', false],
    ['M50 45H25a11 11 0 0 1 0-22h8v7h-8a4 4 0 0 0 0 8h25z', true],
    ['M31 23h7v7h-7z', false],
  ],
  [['M14 43V29l10-10v24zM27 43V21l10-8v30z', false], ['M40 43V29l10-10v24z', true], ['M14 47h36v4H14z', false, 0.45]],
  [
    ['M31 13a19 19 0 0 0 0 38c-6-5-9-11-9-19s3-14 9-19Z', false],
    ['M35 13c6 5 9 11 9 19s-3 14-9 19a19 19 0 0 0 0-38Z', true],
    ['M32 22c-3 3-5 6-5 10s2 7 5 10c3-3 5-6 5-10s-2-7-5-10Z', false],
  ],
  [['M30 30H15V15h7a8 8 0 0 1 8 8zM34 34h15v15h-7a8 8 0 0 1-8-8z', false], ['M34 30V15h15v7a8 8 0 0 1-8 8zM30 34v15H15v-7a8 8 0 0 1 8-8z', true]],
  [['m14 23 8-8h28l-8 8zM14 49l8-8h28l-8 8z', false], ['m14 36 8-8h28l-8 8z', true]],
  [['M14 14h27v8H22v19h-8z', false], ['M50 50H23v-8h19V23h8z', true], ['M27 27h10v10H27z', false]],
  [
    ['M17 15h32l-8 9H25l-8 9zM15 40h24l8-9v18H15z', false],
    ['M17 24h8l22 16h-8L17 33z', true],
    ['m17 15 8 9h-8zM39 40l8 9v-9z', true, 0.4],
  ],
  [
    ['M13 34a21 21 0 0 1 38 0h-8a14 14 0 0 0-22 0z', false],
    ['M13 43a21 21 0 0 1 38 0h-8a14 14 0 0 0-22 0z', true],
    ['M13 51a21 21 0 0 1 38 0h-8a14 14 0 0 0-22 0z', false, 0.5],
  ],
];

export function fingerprint(id: string): number {
  let hash = 2166136261;
  for (const character of id.toLowerCase()) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35);
  hash ^= hash >>> 16;
  return hash >>> 0;
}

function emblem(id: string): SVGSVGElement {
  const seed = fingerprint(id);
  const [background, ink, highlight] = PALETTES[(seed >>> 8) % PALETTES.length]!;
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 64 64');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('token-emblem');
  const rect = (fill: string, stroke?: string) => {
    const r = document.createElementNS(SVG, 'rect');
    for (const [k, v] of Object.entries({ x: '0.5', y: '0.5', width: '63', height: '63', rx: '18', fill }))
      r.setAttribute(k, v);
    if (stroke) {
      r.setAttribute('stroke', stroke);
      r.setAttribute('stroke-opacity', '0.16');
    }
    return r;
  };
  svg.append(rect(background), rect('none', ink));
  for (const [d, light, opacity] of EMBLEMS[seed % EMBLEMS.length]!) {
    const path = document.createElementNS(SVG, 'path');
    path.setAttribute('d', d);
    path.setAttribute('fill', light ? highlight : ink);
    path.setAttribute('stroke', 'none');
    if (opacity !== undefined) path.setAttribute('opacity', String(opacity));
    svg.append(path);
  }
  return svg;
}

/** The QTC symbol, from the page's sprite. */
export function qtcMark(): HTMLElement {
  const box = document.createElement('span');
  box.className = 'token-mark qtc';
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 320 320');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(SVG, 'use');
  use.setAttribute('href', '#i-qtc');
  svg.append(use);
  box.append(svg);
  return box;
}

/** A token's mark: the emblem now, the logo over it when `logo` resolves to a data: URL. */
export function tokenMark(id: string, logo: (id: string) => Promise<string | null>): HTMLElement {
  const box = document.createElement('span');
  box.className = 'token-mark';
  box.append(emblem(id));
  void logo(id)
    .then((src) => {
      if (!src || !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(src)) return;
      const img = document.createElement('img');
      img.alt = '';
      img.decoding = 'async';
      img.addEventListener('load', () => (box.dataset.logo = 'true'), { once: true });
      img.src = src;
      box.append(img);
    })
    .catch(() => undefined);
  return box;
}
