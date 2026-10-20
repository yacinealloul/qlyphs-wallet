/** The priority tip picker of a lot mint review: preset levels, a custom amount, a sliding thumb. */
import { formatUnits, parseUnits } from '../../native/src/commands.ts';
import { MAX_TIP, TIP_LEVELS } from '../../../packages/native/src/tip.ts';
import { arrive, nudge } from './feel.ts';

/** Shown to the user; the background refuses anything else with its own checks. */
export const CUSTOM_TIP_ERROR = 'Enter a tip from 0 to 10 QTC.';
const NAMES = ['Normal', 'Fast', 'Turbo', 'Max'] as const;

const qtc = (tip: bigint) => formatUnits(tip, 12);
/** What the header says about a tip: the amount added, or that there is none. */
export const tipLabel = (tip: bigint) => (tip === 0n ? 'No tip' : '+' + qtc(tip) + ' QTC');

/** A custom amount typed in QTC, as the planck string the background takes. */
export function parseCustomTip(text: string): string {
  const typed = text.trim().replace(',', '.');
  // parseUnits refuses zero, a valid choice here.
  if (/^0(\.0*)?$/.test(typed)) return '0';
  let tip: bigint;
  try {
    tip = parseUnits(typed, 12);
  } catch {
    throw Error(CUSTOM_TIP_ERROR);
  }
  if (tip < 0n || tip > MAX_TIP) throw Error(CUSTOM_TIP_ERROR);
  return tip.toString();
}

interface TipPicker {
  /** Show the picker for this review's tip, or hide it when the review cannot carry one. */
  show(tip: string | null): void;
  /** While the review is prepared again with a new tip. */
  pending(on: boolean): void;
}

/** `pick` prepares the review again with the chosen tip; it reports its own errors. */
export function mountTipPicker(root: HTMLElement, pick: (tip: string) => void): TipPicker {
  const group = root.querySelector<HTMLElement>('.tip-options')!;
  const thumb = root.querySelector<HTMLElement>('.tip-thumb')!;
  const value = root.querySelector<HTMLElement>('.review-tip-value')!;
  const custom = root.querySelector<HTMLFormElement>('.tip-custom')!;
  const input = custom.querySelector<HTMLInputElement>('input')!;
  group.replaceChildren(
    thumb,
    ...TIP_LEVELS.map((tip, i) => option(String(tip), NAMES[i]!, tip === 0n ? 'No tip' : qtc(tip) + ' QTC')),
    option('custom', 'Custom', 'Any'),
  );
  let current = '0';

  function option(tip: string, name: string, detail: string) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.tip = tip;
    button.setAttribute('aria-pressed', 'false');
    const strong = document.createElement('span');
    strong.textContent = name;
    const small = document.createElement('small');
    small.textContent = detail;
    button.append(strong, small);
    return button;
  }
  const buttons = () => [...group.querySelectorAll<HTMLButtonElement>('button')];
  /** Slide the thumb under the pressed option; its warmth follows the level. */
  function place(selected: HTMLButtonElement) {
    for (const b of buttons()) b.setAttribute('aria-pressed', String(b === selected));
    thumb.style.transform = `translateX(${selected.offsetLeft}px)`;
    thumb.style.width = selected.offsetWidth + 'px';
    root.dataset.heat = String(Math.max(0, buttons().indexOf(selected)));
  }
  function select(tip: string, typed = false) {
    const preset = buttons().find((b) => b.dataset.tip === tip);
    const selected = typed || !preset ? buttons().find((b) => b.dataset.tip === 'custom')! : preset;
    // The thumb has no size while hidden: place it once the picker is laid out.
    requestAnimationFrame(() => place(selected));
    value.textContent = tipLabel(BigInt(tip));
  }
  group.addEventListener('click', (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>('button');
    if (!button || button.disabled) return;
    if (button.dataset.tip === 'custom') {
      place(button);
      custom.hidden = false;
      arrive(custom);
      input.focus();
      return;
    }
    custom.hidden = true;
    place(button);
    if (button.dataset.tip !== current) pick(button.dataset.tip!);
  });
  custom.addEventListener('submit', (event) => {
    event.preventDefault();
    let tip: string;
    try {
      tip = parseCustomTip(input.value);
    } catch (error) {
      nudge(custom);
      value.textContent = (error as Error).message;
      return;
    }
    if (tip !== current) pick(tip);
  });
  new ResizeObserver(() => {
    const pressed = buttons().find((b) => b.getAttribute('aria-pressed') === 'true');
    if (pressed) place(pressed);
  }).observe(group);

  return {
    show(tip) {
      root.hidden = tip === null;
      if (tip === null) return;
      const typed = !TIP_LEVELS.some((level) => String(level) === tip);
      custom.hidden = !typed;
      if (typed) input.value = qtc(BigInt(tip));
      current = tip;
      select(tip, typed);
    },
    pending(on) {
      root.toggleAttribute('data-pending', on);
    },
  };
}
