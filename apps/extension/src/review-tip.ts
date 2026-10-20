/** The network fee of a review: one row that opens a sheet of tip levels and a custom tip. */
import { formatUnits, parseUnits } from '../../native/src/commands.ts';
import { MAX_TIP, TIP_LEVELS } from '../../../packages/native/src/tip.ts';
import { nudge } from './feel.ts';
import { roughQtc } from './mint-session-view.ts';

/** Shown to the user; the background refuses anything else with its own checks. */
export const CUSTOM_TIP_ERROR = 'Enter a tip from 0 to 10 QTC.';
const NAMES = ['Low', 'Normal', 'High'] as const;
/** The levels offered in the sheet: none, 0.01 and 0.1 QTC. Larger tips, up to MAX_TIP, are typed. */
const LEVELS = TIP_LEVELS.slice(0, NAMES.length);

const qtc = (tip: bigint) => formatUnits(tip, 12);
/** What a tip adds, or that there is none. */
export const tipLabel = (tip: bigint) => (tip === 0n ? 'No tip' : '+' + qtc(tip) + ' QTC');
/** The level a tip is, or Custom. */
export const levelName = (tip: bigint) => NAMES[LEVELS.indexOf(tip)] ?? 'Custom';

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

interface FeeChoice {
  /** Offer the choice for this review's tip, `cost` giving the network fee a tip leads to; null
   * when the review cannot carry a tip. */
  show(tip: string | null, cost?: (tip: bigint) => bigint): void;
  /** Whether the review offers a tip now. */
  readonly active: boolean;
  /** The review row's button: the estimate and the level, opening the sheet. */
  button(): HTMLButtonElement;
  /** While the review is prepared again with a new tip. */
  pending(on: boolean): void;
}

/** `pick` prepares the review again with the chosen tip; it reports its own errors. */
export function mountTipPicker(sheet: HTMLDialogElement, pick: (tip: string) => void): FeeChoice {
  const list = sheet.querySelector<HTMLElement>('.fee-options')!;
  const custom = sheet.querySelector<HTMLFormElement>('.fee-custom')!;
  const input = custom.querySelector<HTMLInputElement>('input')!;
  const error = sheet.querySelector<HTMLElement>('.fee-error')!;
  let current: string | null = null;
  let cost: (tip: bigint) => bigint = (tip) => tip;
  let waiting = false;
  let row: HTMLButtonElement | undefined;

  function paintList() {
    list.replaceChildren(
      ...LEVELS.map((tip, i) => {
        const option = document.createElement('button');
        option.type = 'button';
        option.className = 'fee-option';
        option.dataset.tip = String(tip);
        option.setAttribute('role', 'radio');
        option.setAttribute('aria-checked', String(current === String(tip)));
        const text = document.createElement('span');
        const name = document.createElement('strong');
        name.textContent = NAMES[i]!;
        const detail = document.createElement('small');
        detail.textContent = tipLabel(tip);
        text.append(name, detail);
        const estimate = document.createElement('span');
        estimate.className = 'fee-option-cost';
        estimate.textContent = '≈ ' + roughQtc(cost(tip));
        option.append(text, estimate);
        return option;
      }),
    );
  }
  function choose(tip: string) {
    sheet.close();
    if (tip !== current) pick(tip);
  }
  list.addEventListener('click', (event) => {
    const option = (event.target as Element).closest<HTMLButtonElement>('.fee-option');
    if (option && !waiting) choose(option.dataset.tip!);
  });
  /** A typed tip, applied by Enter or Done; an invalid one keeps the sheet open. Escape or a click
   * outside the sheet cancels it and keeps the tip chosen before. */
  function typed(): string | null {
    if (!input.value.trim()) return null;
    try {
      error.hidden = true;
      return parseCustomTip(input.value);
    } catch (e) {
      error.textContent = (e as Error).message;
      error.hidden = false;
      nudge(custom);
      return null;
    }
  }
  custom.addEventListener('submit', (event) => {
    event.preventDefault();
    const tip = typed();
    if (tip !== null) choose(tip);
  });
  sheet.querySelector('.fee-done')!.addEventListener('click', () => {
    const tip = typed();
    if (tip !== null) return choose(tip);
    if (error.hidden) sheet.close();
  });
  sheet.addEventListener('click', (event) => {
    if (event.target === sheet) sheet.close();
  });
  sheet.addEventListener('close', () => row?.focus({ preventScroll: true }));

  function open() {
    if (waiting || current === null) return;
    const levels = LEVELS.map(String);
    input.value = levels.includes(current) ? '' : qtc(BigInt(current));
    error.hidden = true;
    paintList();
    sheet.showModal();
    sheet.querySelector<HTMLElement>('[aria-checked="true"]')?.focus({ preventScroll: true });
  }

  return {
    get active() {
      return current !== null;
    },
    show(tip, estimate) {
      current = tip;
      if (estimate) cost = estimate;
      if (tip === null && sheet.open) sheet.close();
    },
    button() {
      const tip = BigInt(current ?? '0');
      row = document.createElement('button');
      row.type = 'button';
      row.className = 'fee-row';
      row.setAttribute('aria-haspopup', 'dialog');
      row.setAttribute('aria-label', `Network fee about ${roughQtc(cost(tip))}, ${levelName(tip)}. Change`);
      const estimate = document.createElement('span');
      estimate.textContent = '≈ ' + roughQtc(cost(tip));
      const chip = document.createElement('span');
      chip.className = 'fee-chip';
      chip.dataset.level = levelName(tip).toLowerCase();
      chip.textContent = levelName(tip);
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
      use.setAttribute('href', '#i-chevron');
      svg.append(use);
      chip.append(svg);
      row.append(estimate, chip);
      row.toggleAttribute('data-pending', waiting);
      row.addEventListener('click', open);
      return row;
    },
    pending(on) {
      waiting = on;
      row?.toggleAttribute('data-pending', on);
      row?.setAttribute('aria-busy', String(on));
    },
  };
}
