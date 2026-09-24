/** Safe rendering of inscription content (docs/native/INSCRIPTIONS.md §5). Content is never
 * interpreted as HTML or script: raster images and SVG become an <img> with a data: URL (SVG is
 * never inlined, so its scripts cannot run), text/* and application/json become escaped text in a
 * <pre>, anything else a size and hex summary with a download link. No protocol imports: this
 * module is bundled into the UI. */

/** The only image types rendered as images; the data: URL uses these literals, never input. */
export const QLYPH_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml'] as const;
/** Characters of text shown in a preview; the rest is summarised. */
const TEXT_LIMIT = 4096;

export type QlyphPreview =
  | { kind: 'image'; src: string; contentType: string; size: number }
  | { kind: 'text'; text: string; contentType: string; size: number }
  | { kind: 'binary'; hex: string; contentType: string; size: number };

export function hexBytes(content: string): Uint8Array {
  if (typeof content !== 'string' || !/^0x(?:[0-9a-f]{2})*$/.test(content)) throw Error('Invalid Quark content');
  const out = new Uint8Array((content.length - 2) / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(content.slice(2 + 2 * i, 4 + 2 * i), 16);
  return out;
}
export function base64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
/** Classify content into a render descriptor. Pure: no DOM. */
export function qlyphPreview(contentType: string, content: string): QlyphPreview {
  const bytes = hexBytes(content),
    size = bytes.length;
  const image = QLYPH_IMAGE_TYPES.find((t) => t === contentType);
  if (image) return { kind: 'image', src: `data:${image};base64,${base64(bytes)}`, contentType: image, size };
  if (/^text\/[a-z0-9.+-]+$/.test(contentType) || contentType === 'application/json') {
    let text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    if (contentType === 'application/json')
      try {
        text = JSON.stringify(JSON.parse(text), null, 2);
      } catch {
        // Invalid JSON is still shown, as plain text.
      }
    if (text.length > TEXT_LIMIT) text = text.slice(0, TEXT_LIMIT) + '\n…';
    return { kind: 'text', text, contentType, size };
  }
  return { kind: 'binary', hex: content.slice(0, 2 + 64) + (size > 32 ? '…' : ''), contentType, size };
}
export const qlyphSize = (size: number) => `${size} byte${size === 1 ? '' : 's'}`;
/** Build the preview element with DOM APIs only (textContent, attributes): never innerHTML. */
export function renderQlyph(doc: Document, contentType: string, content: string, label = 'Quark'): HTMLElement {
  const p = qlyphPreview(contentType, content);
  const box = doc.createElement('figure');
  box.className = 'qlyph-preview qlyph-' + p.kind;
  if (p.kind === 'image') {
    const img = doc.createElement('img');
    img.alt = label;
    img.decoding = 'async';
    img.setAttribute('referrerpolicy', 'no-referrer');
    img.src = p.src;
    box.append(img);
  } else if (p.kind === 'text') {
    const pre = doc.createElement('pre');
    pre.textContent = p.text;
    box.append(pre);
  } else {
    const info = doc.createElement('p');
    info.textContent = `${qlyphSize(p.size)} · ${p.contentType} · not previewed`;
    const code = doc.createElement('code');
    code.textContent = p.hex;
    const link = doc.createElement('a');
    link.textContent = 'Download content';
    link.download = label.replace(/[^A-Za-z0-9#-]+/g, '-').replace('#', '') + '.bin';
    link.href = `data:application/octet-stream;base64,${base64(hexBytes(content))}`;
    box.append(info, code, link);
  }
  return box;
}
