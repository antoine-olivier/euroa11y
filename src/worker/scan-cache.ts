// Raw scan results reused for a while, so that the same page with the same options is not scanned again
// (Browser Run bills each scan). Held by the Workers cache of the data centre for the time to live (24 h). An
// entry is keyed by a hash of the request and encrypted with a key derived from it: the page address is stored
// only inside the encrypted entry, and an entry can only be read by a call for the same page with the same
// options. A request with `fresh` skips an entry old enough to be replaced. A cache failure never fails a scan.
import { RESCAN_AFTER_MS, type RawScan, type ScanRequest } from "../scan-core.ts";

/** The part of the Workers Cache API used here. */
export interface CacheStore {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
}

export interface ScanCache {
  get(request: ScanRequest): Promise<RawScan | undefined>;
  put(request: ScanRequest, raw: RawScan): Promise<void>;
}

const IV_BYTES = 12;

// A bounded result should take a few tens of kB (estimate, 5 elements per rule); a larger one is not kept.
const MAX_ENTRY_BYTES = 256_000;

async function sha256(text: string): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}

/** Cache key URL and encryption key of one request; `v2` changes with the stored format (v2: bounded results, 2026-10-05). */
async function derive(origin: string, request: ScanRequest): Promise<{ key: Request; secret: CryptoKey }> {
  const material = JSON.stringify(["v2", request.url.href, request.bestPractices ?? false, request.viewport?.width ?? null, request.viewport?.height ?? null]);
  const id = Array.from(await sha256(`id\n${material}`), (byte) => byte.toString(16).padStart(2, "0")).join("");
  const secret = await crypto.subtle.importKey("raw", await sha256(`key\n${material}`), "AES-GCM", false, ["encrypt", "decrypt"]);
  return { key: new Request(`${origin}/__scan-cache/${id}`), secret };
}

export function createScanCache(store: CacheStore, origin: string, ttlSeconds: number, now: () => number = Date.now): ScanCache {
  return {
    async get(request) {
      try {
        const { key, secret } = await derive(origin, request);
        const hit = await store.match(key);
        if (!hit) return undefined;
        const sealed = new Uint8Array(await hit.arrayBuffer());
        const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: sealed.slice(0, IV_BYTES) }, secret, sealed.slice(IV_BYTES));
        const { raw, expires } = JSON.parse(new TextDecoder().decode(plain)) as { raw: RawScan; expires: number };
        // The data centre may keep an entry a little longer than asked.
        if (expires <= now()) return undefined;
        const rescanFrom = Date.parse(raw.scannedAt) + RESCAN_AFTER_MS;
        if (!Number.isFinite(rescanFrom) || (request.fresh && now() >= rescanFrom)) return undefined;
        return { ...raw, reusedUntil: new Date(expires).toISOString(), rescanFrom: new Date(rescanFrom).toISOString() };
      } catch {
        return undefined;
      }
    },
    async put(request, raw) {
      try {
        const plain = new TextEncoder().encode(JSON.stringify({ raw, expires: now() + ttlSeconds * 1000 }));
        if (plain.byteLength > MAX_ENTRY_BYTES) return;
        const { key, secret } = await derive(origin, request);
        const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
        const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, secret, plain));
        const body = new Uint8Array(IV_BYTES + sealed.byteLength);
        body.set(iv);
        body.set(sealed, IV_BYTES);
        await store.put(key, new Response(body, { headers: { "cache-control": `max-age=${ttlSeconds}`, "content-type": "application/octet-stream" } }));
      } catch {
        // Not cached: the next call scans again.
      }
    },
  };
}
