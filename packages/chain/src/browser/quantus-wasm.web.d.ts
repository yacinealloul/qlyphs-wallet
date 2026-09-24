/** Types for the generated browser glue (raw wasm-bindgen surface, positional arguments). */
export interface QuantusWasmAccountHandle {
  readonly accountId: Uint8Array;
  readonly address: string;
  readonly publicKey: Uint8Array;
  readonly secretKey: Uint8Array;
  free(): void;
}

export interface QuantusWasmSignContext {
  nonce: number;
  /** Decimal string (u128). */
  tip: string;
  /** 0 = immortal. */
  period: number;
  blockNumber?: number;
  genesisHash: string;
  /** Required when `period > 0`. */
  blockHash?: string;
  specVersion: number;
  transactionVersion: number;
}

export interface QuantusWasm {
  accountFromMnemonic(
    mnemonic: string,
    account: number,
    change: number,
    addressIndex: number,
    passphrase?: string | null,
  ): QuantusWasmAccountHandle;
  signCallFromMnemonic(
    mnemonic: string,
    call: Uint8Array,
    context: QuantusWasmSignContext,
    account: number,
    change: number,
    addressIndex: number,
    passphrase?: string | null,
  ): Uint8Array;
}

export function loadQuantusWasm(
  source: Response | Promise<Response> | BufferSource,
): Promise<QuantusWasm>;
