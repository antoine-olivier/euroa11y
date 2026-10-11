// Provided by the `nodejs_compat` flag; only what the Worker uses, Node's own types stay out of this build.
declare module "node:buffer" {
  type NodeBuffer = Uint8Array & { toString(encoding: "base64"): string };
  export const Buffer: { from(data: ArrayBuffer): NodeBuffer; alloc(size: number): NodeBuffer };
}
declare module "node:crypto" {
  interface Hash {
    update(data: string): Hash;
    digest(encoding: "hex"): string;
  }
  export function createHash(algorithm: "sha256"): Hash;
  export function createHmac(algorithm: "sha256", key: string): Hash;
}
declare module "node:async_hooks" {
  export class AsyncLocalStorage<T> {
    getStore(): T | undefined;
    run<R>(store: T, callback: () => R): R;
  }
}

// Modules bundled as text by wrangler (see the `rules` of wrangler.jsonc).
declare module "axe-core/axe.min.js" {
  const source: string;
  export default source;
}
declare module "*.svg" {
  const source: string;
  export default source;
}

// Modules bundled as binary data.
declare module "*.woff2" {
  const data: ArrayBuffer;
  export default data;
}
declare module "*.png" {
  const data: ArrayBuffer;
  export default data;
}
