/** Internal wire between keys pages and the background worker. Same-origin only. */
export type HostToHub =
  | { type: 'hello'; hostId: string; lock: string; url: string; documentId: string }
  | { type: 'focus' }
  | { type: 'call'; callId: number; message: unknown }
  | { type: 'attach'; windowId: number; documentId: string } // transfer: [MessagePort] (iframe doc end)
  | { type: 'closed'; windowId: number }
  | { type: 'port-open'; portId: number; origin: string }
  | { type: 'port-message'; portId: number; message: unknown }
  | { type: 'port-close'; portId: number }
  | { type: 'bye' };
export type HubToHost =
  | { type: 'welcome'; tabId: number; windowId: number }
  | { type: 'reply'; callId: number; value: unknown }
  | { type: 'open'; windowId: number; url: string }
  | { type: 'remove'; windowId: number }
  | { type: 'port-message'; portId: number; message: unknown }
  | { type: 'port-close'; portId: number };
export type DocToHub = { type: 'call'; callId: number; message: unknown }; // over an attached iframe port
export type HubToDoc = { type: 'reply'; callId: number; value: unknown };
export const RUNTIME_ID = 'qlyphs-keys';
