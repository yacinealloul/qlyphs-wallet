/** Small state-change cues. Each one explains a change; none delays an action. */
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)';

/** A refused input shakes once, so the eye lands on what needs fixing. */
export function nudge(element: Element | null) {
  if (!element || reduced()) return;
  element.animate(
    [
      { transform: 'translateX(0)' },
      { transform: 'translateX(-5px)' },
      { transform: 'translateX(4px)' },
      { transform: 'translateX(-2px)' },
      { transform: 'translateX(0)' },
    ],
    { duration: 320, easing: EASE },
  );
}

/** A value that just changed glows briefly in the direction of the change. */
export function flash(element: Element | null, tone: 'up' | 'down' | 'neutral' = 'neutral') {
  if (!element || reduced()) return;
  const color = tone === 'up' ? '#8aca9f' : tone === 'down' ? '#ff946e' : '#e8e6e0';
  element.animate([{ color }, { color: 'inherit' }], { duration: 1400, easing: 'ease-out' });
}

/** Rolls a number from its previous to its new value; the final text is always exact. */
export function roll(
  element: HTMLElement,
  from: number,
  to: number,
  format: (n: number) => string,
  final: string,
) {
  const token = String(Math.random());
  element.dataset.roll = token;
  if (reduced() || !Number.isFinite(from) || !Number.isFinite(to) || from === to) {
    element.firstChild!.textContent = final;
    return;
  }
  const start = performance.now(),
    duration = 650;
  const frame = (now: number) => {
    if (element.dataset.roll !== token) return;
    const t = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - t, 3);
    element.firstChild!.textContent = t < 1 ? format(from + (to - from) * eased) : final;
    if (t < 1) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

/** Enter animation. `highlight` adds a fading tint for list rows; surfaces with their
 * own background (toasts, badges, buttons) must keep it, so they only slide and fade. */
export function arrive(element: HTMLElement, highlight = false) {
  if (reduced()) return;
  element.animate(
    highlight
      ? [
          { opacity: 0, transform: 'translateY(-6px)', backgroundColor: '#ff6b3522' },
          { opacity: 1, transform: 'translateY(0)', backgroundColor: '#ff6b3510', offset: 0.4 },
          { opacity: 1, transform: 'translateY(0)', backgroundColor: 'transparent' },
        ]
      : [
          { opacity: 0, transform: 'translateY(-6px)' },
          { opacity: 1, transform: 'translateY(0)' },
        ],
    { duration: highlight ? 1400 : 220, easing: EASE },
  );
}

/** Soft pop for a status that just moved forward. */
export function pop(element: Element | null) {
  if (!element || reduced()) return;
  element.animate(
    [{ transform: 'scale(1)' }, { transform: 'scale(1.12)' }, { transform: 'scale(1)' }],
    { duration: 360, easing: EASE },
  );
}

/** Overlays sit on top of content: they slide in fully opaque, never fading through it. */
export function drop(element: HTMLElement) {
  if (reduced()) return;
  element.animate(
    [{ transform: 'translateY(-10px) scale(0.98)' }, { transform: 'translateY(0) scale(1)' }],
    { duration: 220, easing: EASE },
  );
}
