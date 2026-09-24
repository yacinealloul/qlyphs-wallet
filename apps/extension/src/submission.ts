/** Exactly one transport invocation. Read-only history cannot rewrite its acknowledgment. */
export async function submitOnce(
  hash: string,
  send: () => Promise<unknown>,
): Promise<{ readonly hash: string; readonly status: 'submitted' | 'broadcast-uncertain' }> {
  let status: 'submitted' | 'broadcast-uncertain' = 'broadcast-uncertain';
  try {
    const response = (await send()) as { hash?: unknown; status?: unknown } | null;
    if (
      response?.hash === hash &&
      (response.status === 'submitted' || response.status === 'broadcast-uncertain')
    )
      status = response.status;
  } catch {
    // A lost response never authorizes a second call, even for an apparent timeout.
  }
  return Object.freeze({ hash, status });
}
