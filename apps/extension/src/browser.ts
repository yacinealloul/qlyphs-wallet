/** Minimal, explicit subset used by the two packaged browser builds. */
export interface Sender { id?: string; url?: string; origin?: string; frameId?: number; documentId?: string; tab?: {id?: number; windowId?: number; url?: string} }
interface Event<T extends (...args: never[]) => unknown> { addListener(listener: T): void }
export interface Port {
  name: string; sender?: Sender; postMessage(value: unknown): void; disconnect(): void;
  onMessage: Event<(message: unknown) => void>; onDisconnect: Event<()=>void>;
}
export interface ExtensionAPI {
  action?: {setPopup(options:{popup:string}):Promise<void>};
  sidePanel?: {setPanelBehavior(options:{openPanelOnActionClick:boolean}):Promise<void>;open(options:{windowId:number}):Promise<void>};
  permissions?: {onAdded?:Event<(permissions:{permissions?:string[]})=>void>;contains(options:{permissions:string[]}):Promise<boolean>;request(options:{permissions:string[]}):Promise<boolean>;remove(options:{permissions:string[]}):Promise<boolean>};
  notifications?: {create(id:string,options:{type:'basic';iconUrl:string;title:string;message:string}):Promise<string>;getPermissionLevel():Promise<'granted'|'denied'>;onClicked:Event<(id:string)=>void>};
  runtime: {
    id: string; getURL(path: string): string; reload?:()=>void;
    sendMessage(value: unknown): Promise<unknown>;
    connect(info: {name: string}): Port;
    onConnect: Event<(port: Port)=>void>;
    onMessage: Event<(message: unknown, sender: Sender, respond: (value: unknown)=>void)=>boolean|void>;
    onInstalled: Event<(details:{reason:string})=>void>;
  };
  storage: {local: {
    get(keys: string|string[]|null): Promise<Record<string,unknown>>;
    set(items: Record<string,unknown>): Promise<void>;
    setAccessLevel?: (options: {accessLevel:'TRUSTED_CONTEXTS'})=>Promise<void>;
  }};
  tabs: {
    create(options: {url:string}): Promise<{id?:number}>;
    get(id:number): Promise<{id?:number;windowId?:number;url?:string;status?:string}>;
    onUpdated: Event<(id:number,change:{status?:string;url?:string})=>void>;
    onRemoved: Event<(id:number)=>void>;
  };
  windows: {
    getCurrent?():Promise<{id?:number}>;
    create(options:{url:string;type:'popup';width:number;height:number}): Promise<{id?:number}>;
    remove(id:number): Promise<void>;
    onRemoved: Event<(id:number)=>void>;
  };
  alarms: {create(name:string,options:{periodInMinutes:number}): Promise<void>|void;onAlarm: Event<()=>void>};
}
const globals = globalThis as unknown as {browser?:ExtensionAPI;chrome?:ExtensionAPI};
export const browser: ExtensionAPI = (globals.browser ?? globals.chrome)!;
