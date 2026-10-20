/** Static import: dynamic import is not supported in a Chrome extension SW.
 * The binary and glue are bundled from the existing locked Quantus SDK. */
import { loadQuantusWasm } from '../../../packages/chain/src/browser/quantus-wasm.web.js';
import { requireMnemonic } from '../../../packages/chain/src/browser/mnemonic.ts';
import type { QuantusWasm } from '../../../packages/chain/src/browser/quantus-wasm.web.js';
import { hex } from '../../../packages/native/src/codec.ts';
import { browser } from './browser.ts';
let instance: Promise<QuantusWasm> | undefined;
export function wasm():Promise<QuantusWasm> {
  instance ??= loadQuantusWasm(fetch(browser.runtime.getURL('quantus_wasm_bg.wasm'))).catch(()=>{
    instance=undefined; throw Error('Bundled signing module could not be loaded');
  });
  return instance;
}
export async function identity(phrase:string,index=0):Promise<{owner:string;address:string}> {
  const api=await wasm(), account=api.accountFromMnemonic(requireMnemonic(phrase),index,0,0);
  // The secret key is never read here: its getter copies it out of the module (solana-vault.ts publicKeyOf).
  try { return {owner:hex(account.accountId),address:account.address}; }
  finally { account.free(); }
}
