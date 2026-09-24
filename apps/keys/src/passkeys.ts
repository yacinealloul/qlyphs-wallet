/** Web copy of the extension's passkeys.ts: WebAuthn on the keys origin, in a dedicated tab. */
import { fromHex, hex } from '../../../packages/native/src/codec.ts';
export interface PasskeyChallenge {
  id: string;
  challenge: string;
  salt: string;
  credentialId?: string;
  owner: string;
}
const buffer = (v: string) => new Uint8Array(fromHex(v)).buffer;
export async function passkeyPRF(
  challenge: PasskeyChallenge,
  enroll: boolean,
  signal: AbortSignal,
): Promise<{ credentialId: string; prf: Uint8Array }> {
  if (!window.isSecureContext) throw Error('Passkeys need a secure connection. Use your password.');
  if (!globalThis.PublicKeyCredential || !navigator.credentials)
    throw Error('Passkeys are not available in this browser. Use your password.');
  let id = challenge.credentialId;
  if (enroll) {
    const created = (await navigator.credentials.create({
      signal,
      publicKey: {
        challenge: buffer(challenge.challenge),
        rp: { id: location.hostname, name: 'Qlyphs Keys (Development)' },
        user: {
          id: buffer(challenge.owner),
          name: 'Qlyphs Keys wallet',
          displayName: 'Qlyphs · All wallets',
        },
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 },
          { type: 'public-key', alg: -257 },
        ],
        authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
        attestation: 'none',
        extensions: { prf: {} },
        timeout: 60000,
      },
    })) as PublicKeyCredential | null;
    if (!created) throw Error('Passkey request cancelled.');
    if (created.getClientExtensionResults().prf?.enabled !== true)
      throw Error(
        'This passkey cannot encrypt your wallet. Choose a PRF-compatible passkey or use your password.',
      );
    id = hex(new Uint8Array(created.rawId));
  }
  if (!id) throw Error('No passkey is linked to this wallet.');
  const credential = (await navigator.credentials.get({
    signal,
    publicKey: {
      rpId: location.hostname,
      challenge: buffer(challenge.challenge),
      allowCredentials: [{ id: buffer(id), type: 'public-key' }],
      userVerification: 'required',
      extensions: { prf: { eval: { first: buffer(challenge.salt) } } },
      timeout: 60000,
    },
  })) as PublicKeyCredential | null;
  if (!credential || hex(new Uint8Array(credential.rawId)) !== id)
    throw Error('Passkey request cancelled.');
  const result = credential.getClientExtensionResults().prf?.results?.first;
  if (!result || result.byteLength !== 32)
    throw Error('Passkey encryption is unavailable. Use your password.');
  return {
    credentialId: id,
    prf: ArrayBuffer.isView(result)
      ? new Uint8Array(result.buffer, result.byteOffset, result.byteLength)
      : new Uint8Array(result),
  };
}
export function passkeyError(error: unknown): Error {
  if (error instanceof DOMException) {
    if (['NotAllowedError', 'AbortError'].includes(error.name))
      return Error('Passkey request cancelled. Your password still works.');
    if (['NotSupportedError', 'SecurityError'].includes(error.name))
      return Error(
        'Passkeys are not supported in this browser on your device. Use your password.',
      );
    return Error('Passkey request failed. Use your password or try again.');
  }
  return error instanceof Error ? error : Error('Passkey request failed.');
}
