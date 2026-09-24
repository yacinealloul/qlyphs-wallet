import { checkPayerBalance, checkQlyphsFee, nativeOutlay, PROTOCOL_LABEL } from './fees.ts';
import type { NativeBalance } from './send-balance.ts';
import { checkInscribe, checkQlyphCommand, checkSymbol, parseInscription, QLYPH_READ_ERROR } from './qlyphs.ts';
import { API, RPC } from './config.ts';
import { sameNetwork } from './pinned-network.ts';
import { MAINNET } from '../../../packages/native/src/protocol.ts';
import type { Ticket } from '../../../packages/native/src/protocol.ts';
import { checkManifest } from '../../native/src/network.ts';
import { PROFILE, WRONG_NETWORK_ERROR } from './profile.ts';
import { fromHex, hex, requireThat } from '../../../packages/native/src/codec.ts';
import { buildCall, parseCommand, json } from '../../native/src/commands.ts';
import type { Command } from '../../native/src/commands.ts';
import type { Manifest, SigningContext } from '../../native/src/network.ts';
export type { Manifest, SigningContext };
export interface Status {ready:boolean;network:string;protocol:string;mainnetEnabled:boolean;manifest:Manifest;
  head:number;finalized:number;checkpoint:string;lastSync:number;error:string|null}
export interface Costs {networkFee:string;nativeFee:string;deposit:string;platformFee:string;existentialDeposit:string;at:string;estimate:true}
export interface Prepared {id:string;owner:string;callHex:string;context:SigningContext;createdAt:number;expiresAt:number;sequence:string;costs:Costs}
/** A Quark (policy 'inscription') carries its number; in a review also its content (hex), read
 * from GET /api/inscription and shown only through the safe renderer. */
export interface QlyphInfo {number:number;contentType?:string;size?:number;content?:string}
export interface Asset {id:string;creator:string;definition:{symbol:string;decimals:number;cap:string;limit:string;policy:string};available:string;qlyph?:QlyphInfo}
export interface View {assets:Asset[];offers:unknown[];pairs:unknown[];sequence:string;more:boolean;status:Status}
export interface Review {intent:Prepared;command:Record<string,unknown>;ticket?:Ticket;asset?:Asset;digest:string}
export async function getJSON<T>(url:string, body?:unknown):Promise<T> {
  const res=await fetch(url,{method:body===undefined?'GET':'POST',cache:'no-store',credentials:'omit',
    headers:body===undefined?{}:{'content-type':'application/json'},
    ...(body===undefined?{}:{body:json(body)}),signal:AbortSignal.timeout(15000)});
  requireThat(res.body,'Missing response');
  const reader=res.body!.getReader(); const chunks:Uint8Array[]=[]; let size=0;
  try {
    for (;;) {const c=await reader.read(); if(c.done)break; size+=c.value.length;
      requireThat(size<=1024*1024,'Response too large');chunks.push(c.value);}
  } finally {await reader.cancel().catch(()=>undefined);}
  const bytes=new Uint8Array(size);let at=0;for(const c of chunks){bytes.set(c,at);at+=c.length;}
  const data:unknown=JSON.parse(new TextDecoder().decode(bytes));
  requireThat(res.ok,`Service refused request (${res.status}); check network and permissions`);
  return data as T;
}
export const api=<T>(path:string,body?:unknown)=>getJSON<T>(API+path,body);
export async function rpc<T>(method:string,params:unknown[]=[]):Promise<T> {
  const id=crypto.randomUUID();
  const r=await getJSON<{id:string;result:T;error?:unknown}>(RPC,{jsonrpc:'2.0',id,method,params});
  requireThat(r.id===id && !r.error && Object.hasOwn(r,'result'),'RPC unavailable or invalid response'); return r.result;
}
export function decimal(value:unknown):string {
  requireThat(typeof value==='string' && /^(0|[1-9]\d{0,38})$/.test(value),'Invalid amount from service'); return value as string;
}
export async function network(pinned?:Manifest):Promise<Status> {
  const [s,genesis,chain,best,final]=await Promise.all([api<Status>('/api/status'),rpc<string>('chain_getBlockHash',[0]),
    rpc<string>('system_chain'),rpc<string>('chain_getBlockHash'),rpc<string>('chain_getFinalizedHead')]);
  fromHex(genesis,32);
  if(PROFILE.network==='mainnet')requireThat(genesis===PROFILE.genesis,WRONG_NETWORK_ERROR);
  else requireThat(genesis!==MAINNET && /dev/i.test(chain),'Mainnet is disabled');
  const [version,code,head,finalHead,health]=await Promise.all([
    rpc<{specName:string;specVersion:number;transactionVersion:number}>('state_getRuntimeVersion',[best]),
    rpc<string>('state_getStorageHash',['0x3a636f6465',best]),rpc<{number:string}>('chain_getHeader',[best]),
    rpc<{number:string}>('chain_getHeader',[final]),rpc<{isSyncing:boolean}>('system_health')]);
  requireThat(version.specName==='quantus-runtime' && version.specVersion===PROFILE.runtime.specVersion
    && version.transactionVersion===PROFILE.runtime.transactionVersion && code===PROFILE.runtime.codeHash,'Unsupported runtime; signing disabled');
  const m=s.manifest;
  // A wallet still running a previous build meets an indexer that moved on; say so rather than blaming the network.
  requireThat(s.protocol===PROTOCOL_LABEL,'Wallet and indexer run different protocol versions. Reload the extension, or restart the indexer.');
  const mainnet=PROFILE.network==='mainnet';
  requireThat(s.ready===true && s.network===PROFILE.network && s.mainnetEnabled===mainnet
    && !!m && m.genesis===genesis && m.runtimeHash===code,'Incorrect network or protocol activation');
  try {checkManifest(m,PROFILE);} catch {throw Error('Incorrect network or protocol activation');}
  requireThat(!health.isSyncing && Number.isSafeInteger(s.head) && Number.isSafeInteger(s.finalized)
    && s.finalized>=0 && s.finalized<=s.head && Math.abs(parseInt(head.number,16)-s.head)<=3
    && Math.abs(parseInt(finalHead.number,16)-s.finalized)<=3 && Date.now()-s.lastSync<15000
    && s.lastSync<=Date.now()+5000,'Indexer is stale');
  requireThat(await rpc<string>('chain_getBlockHash',[s.finalized])===s.checkpoint,'Finalized checkpoint mismatch');
  if(pinned)requireThat(sameNetwork(m,pinned),'Network configuration changed; reconnect explicitly');
  return s;
}
function ticketFromJSON(value:unknown):Ticket {
  requireThat(value && typeof value==='object','Invalid ticket');
  const t=value as Ticket;fromHex(t.multisig,32);fromHex(t.seller,32);
  const cmd=parseCommand({kind:'sell',multisig:t.multisig,offer:t.offer});
  requireThat(cmd.kind==='sell' && t.key===`${t.multisig}:${t.proposal}` && Number.isSafeInteger(t.proposal)
    && t.proposal>=0 && Number.isSafeInteger(t.createdHeight) && t.createdHeight>=0
    && ['locked','settled','released'].includes(t.status),'Invalid reservation');
  fromHex(t.callHex);return {...t,offer:(cmd as Extract<Command,{kind:'sell'}>).offer};
}
export async function ticket(key:string,owner:string,buy:boolean,head:number):Promise<Ticket> {
  const r=await api<{ticket:unknown;finalized:boolean}>('/api/ticket?key='+encodeURIComponent(key));
  const t=ticketFromJSON(r.ticket);
  requireThat(t.key===key && t.status==='locked','Reservation cancelled or already settled');
  if(buy)requireThat(r.finalized===true && t.offer.buyer===owner && t.offer.expiry>head+8,'Reservation is not finalized, expired or assigned to another buyer');
  else requireThat(t.seller===owner,'Only seller may cancel');
  return t;
}
async function digest(value:unknown):Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(json(value)))));
}
export async function prepare(pinned:Manifest,owner:string,input:unknown):Promise<Review> {
  const s=await network(pinned), command=parseCommand(input);
  const t=(command.kind==='buy'||command.kind==='cancel')?await ticket(command.ticket,owner,command.kind==='buy',s.head):undefined;
  // Unique symbols: a claim of a taken symbol is rejected after its fee is paid, so refuse it here.
  await checkSymbol(command,api);
  checkInscribe(command);
  const intent=await api<Prepared>('/api/prepare',{owner,command});
  requireThat(intent.owner===owner && typeof intent.id==='string' && /^[0-9a-f-]{36}$/.test(intent.id)
    && Number.isSafeInteger(intent.createdAt) && Number.isSafeInteger(intent.expiresAt)
    && intent.expiresAt>Date.now() && intent.expiresAt<=Date.now()+125000,'Invalid preparation');
  decimal(intent.sequence);
  const bytes=buildCall(pinned.genesis,owner,BigInt(intent.sequence),command,t);
  requireThat(hex(bytes)===intent.callHex,'Prepared call differs from requested action');
  validateContext(intent.context,pinned.genesis);
  for (const k of ['networkFee','nativeFee','deposit','platformFee','existentialDeposit'] as const)decimal(intent.costs[k]);
  requireThat(intent.costs.estimate===true && intent.costs.at===intent.context.blockHash,'Invalid cost estimate or unexpected platform fee');
  // QLYP-v1: the wallet recomputes the Qlyphs fee (deploy 1 QTC, mint 0.01 QTC, sale 1%) and refuses any other.
  checkQlyphsFee(command,t,intent.costs.platformFee);
  if (nativeOutlay(command,t)!==undefined)
    checkPayerBalance(await api<NativeBalance>('/api/balance?owner='+owner),intent.costs,command,t);
  const assetId=command.kind==='mint'||command.kind==='transfer'?command.asset:command.kind==='sell'?command.offer.asset:t?.offer.asset;
  const asset=assetId?await api<Asset>('/api/asset?id='+encodeURIComponent(assetId)):undefined;
  if(asset)requireThat(asset.id===assetId && Number.isInteger(asset.definition.decimals)
    && asset.definition.decimals>=0 && asset.definition.decimals<=18,'Invalid asset definition');
  // A Quark moves only as a whole (amount 1); the review shows it through the safe renderer.
  if(asset&&asset.definition.policy==='inscription'){
    checkQlyphCommand(command);
    let found:unknown;
    try {found=await api<unknown>('/api/inscription?id='+encodeURIComponent(asset.id));}
    catch {throw Error(QLYPH_READ_ERROR);}
    const q=parseInscription(found,asset.id);
    asset.qlyph={number:q.number,contentType:q.contentType,size:q.size,content:q.content};
  }
  const value={intent,command:JSON.parse(json(command)) as Record<string,unknown>,...(t?{ticket:t}:{}),...(asset?{asset}:{})};
  return {...value,digest:await digest(value)};
}
export function validateContext(c:SigningContext,genesis:string):void {
  requireThat(c.genesisHash===genesis && c.specVersion===PROFILE.runtime.specVersion && c.transactionVersion===PROFILE.runtime.transactionVersion && c.period===256
    && c.tip==='0' && Number.isSafeInteger(c.nonce) && c.nonce>=0 && c.nonce<=0xffffffff
    && Number.isSafeInteger(c.blockNumber) && c.blockNumber>=0,'Unexpected signing context');
  fromHex(c.blockHash,32);
}
export async function recheck(review:Review,pinned:Manifest,address:string):Promise<void> {
  requireThat(Date.now()<review.intent.expiresAt,'Review expired; start again');
  const s=await network(pinned),i=review.intent, command=parseCommand(review.command);
  validateContext(i.context,pinned.genesis);
  requireThat(await rpc<string>('chain_getBlockHash',[i.context.blockNumber])===i.context.blockHash,'Review block was reorganized');
  requireThat(s.head-i.context.blockNumber<64,'Review is too old; start again');
  const nonce=await rpc<number>('system_accountNextIndex',[address]);
  requireThat(nonce===i.context.nonce,'Account nonce changed; review again');
  const state=await api<View>('/api/state?owner='+i.owner);
  requireThat(state.sequence===i.sequence,'Token sequence changed; review again');
  const t=review.ticket?await ticket(review.ticket.key,i.owner,command.kind==='buy',s.head):undefined;
  requireThat(json(t)===json(review.ticket),'Reservation changed; review again');
  checkQlyphsFee(command,t,i.costs.platformFee);
  if (nativeOutlay(command,t)!==undefined)
    checkPayerBalance(await api<NativeBalance>('/api/balance?owner='+i.owner),i.costs,command,t);
  // Re-check the symbol right before signing: another claim may have landed since the review.
  await checkSymbol(command,api);
  requireThat(hex(buildCall(pinned.genesis,i.owner,BigInt(i.sequence),command,t))===i.callHex,'Call changed after approval');
}
