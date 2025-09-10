/**
 * Minimal ambient declarations to cover Cloudflare Worker and Node hybrid runtime
 * used by this project. These are intentionally permissive (use `any`) to avoid
 * blocking compilation; they can be tightened later if desired.
 */

declare interface KVNamespace {
  get(key: string): Promise<any>;
  put(key: string, value: string): Promise<void>;
  list?(options?: any): Promise<any>;
  delete?(key: string): Promise<void>;
}

declare var GLOBAL: any;
declare var globalThis: any;

/** crypto */
declare var crypto: {
  randomUUID(): string;
  getRandomValues?(buf: Uint8Array): Uint8Array;
  subtle?: any;
};

/** Timers */
declare function setTimeout(fn: (...args: any[]) => void, ms?: number, ...args: any[]): number;
declare function clearTimeout(id?: number): void;
declare function setInterval(fn: (...args: any[]) => void, ms?: number, ...args: any[]): number;
declare function clearInterval(id?: number): void;

/** Console */
declare var console: {
  log: (...args: any[]) => void;
  error: (...args: any[]) => void;
  warn: (...args: any[]) => void;
  info: (...args: any[]) => void;
  debug: (...args: any[]) => void;
};

/** Basic fetch / Request / Response / Headers */
declare function fetch(input: any, init?: any): Promise<any>;

declare class Headers {
  constructor(init?: any);
  get(name: string): string | null;
  append(name: string, value: string): void;
  set(name: string, value: string): void;
}

declare class Request {
  constructor(input: any, init?: any);
  readonly url: string;
  readonly method: string;
  readonly headers: Headers;
  json(): Promise<any>;
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

declare class Response {
  constructor(body?: any, init?: any);
  readonly body: any;
  status: number;
  headers: Headers;
  text(): Promise<string>;
  json(): Promise<any>;
}

/** Streams / Transformers */
declare class ReadableStream<T = any> {
  constructor(source?: any);
  getReader(): any;
  pipeThrough(transform?: any): any;
  pipeTo(dest: any): Promise<void>;
}

declare class WritableStream<T = any> {
  constructor(sink?: any);
  getWriter(): any;
}

declare class TransformStream<I = any, O = any> {
  readonly readable: ReadableStream<O>;
  readonly writable: WritableStream<I>;
  constructor(transform?: any);
}

declare class TextDecoderStream {
  constructor(label?: string);
  readonly readable: ReadableStream<string>;
  readonly writable: WritableStream<Uint8Array>;
}

declare class TextEncoderStream {
  constructor(label?: string);
  readonly readable: ReadableStream<Uint8Array>;
  readonly writable: WritableStream<string>;
}

/** TextDecoder / TextEncoder (node/browser) */
declare class TextDecoder {
  constructor(encoding?: string);
  decode(input?: any): string;
}

declare class TextEncoder {
  constructor();
  encode(input?: string): Uint8Array;
}

/** Minimal URL / FormData shims */
declare class URL {
  constructor(input: string);
  toString(): string;
}

declare class FormData {
  append(name: string, value: any, fileName?: string): void;
}

/** Other globals */
declare var process: any;
declare var module: any;
declare var require: any;
declare var __dirname: string;
declare var __filename: string;

export {};