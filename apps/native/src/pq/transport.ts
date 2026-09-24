/** Bounded public-data transport. A witness URL is operator configuration, never dapp input. */
import { requireThat } from '../../../../packages/native/src/codec.ts';
import { MAX_PROOF_BYTES, object, natural } from './checkpoint.ts';
import type { Bundle } from './checkpoint.ts';
export async function boundedJson(url: string, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(url, {
    signal: signal ?? AbortSignal.timeout(12000),
    redirect: 'error',
    credentials: 'omit',
    cache: 'no-store',
  });
  requireThat(response.ok && response.body, 'attestation endpoint unavailable');
  const length = response.headers.get('content-length');
  requireThat(
    length === null || Number(length) <= MAX_PROOF_BYTES,
    'attestation response too large',
  );
  const reader = response.body.getReader(),
    chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.length;
      requireThat(bytes <= MAX_PROOF_BYTES, 'attestation response limit');
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  }
  const out = new Uint8Array(bytes);
  let offset = 0;
  for (const b of chunks) {
    out.set(b, offset);
    offset += b.length;
  }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(out)) as unknown;
}
export class PqAggregator {
  readonly urls: string[];
  constructor(urls: unknown) {
    requireThat(
      Array.isArray(urls) &&
        urls.length >= 2 &&
        urls.length <= 5 &&
        urls.every((x) => typeof x === 'string'),
      'two witness endpoints required',
    );
    this.urls = urls.map((x) => {
      const u = new URL(String(x));
      requireThat(
        ['http:', 'https:'].includes(u.protocol) &&
          !u.username &&
          !u.password &&
          u.pathname === '/' &&
          !u.search &&
          !u.hash,
        'invalid witness URL',
      );
      return u.origin;
    });
    requireThat(
      new Set(this.urls).size === this.urls.length,
      'distinct witness endpoints required',
    );
  }
  async bundle(challenge: string): Promise<Bundle> {
    requireThat(/^0x[0-9a-f]{64}$/.test(challenge), 'challenge required');
    const latest = await Promise.all(
      this.urls.map(async (u) =>
        object(await boundedJson(`${u}/v1/checkpoint?challenge=${challenge}`), [
          'snapshot',
          'attestations',
        ]),
      ),
    );
    const heights = latest.map((b) => {
      requireThat(b.snapshot && typeof b.snapshot === 'object', 'snapshot required');
      return natural((b.snapshot as { height: unknown }).height, 0xffffffff);
    });
    // One independently validating node can lag the other by a few blocks. Agree
    // on the latest common height; never relax the witness's freshness window.
    const height = Math.min(...heights);
    const replies = await Promise.all(
      latest.map(async (b, i) =>
        heights[i] === height
          ? b
          : object(
              await boundedJson(
                `${this.urls[i]}/v1/checkpoint?height=${height}&challenge=${challenge}`,
              ),
              ['snapshot', 'attestations'],
            ),
      ),
    );
    const attestations = replies.flatMap((b) => {
      requireThat(
        Array.isArray(b.attestations) && b.attestations.length === 1,
        'one attestation per endpoint',
      );
      return b.attestations;
    });
    // Nothing is trusted here. The wallet authenticates every root and operator.
    return { snapshot: replies[0]!.snapshot, attestations } as Bundle;
  }
}
