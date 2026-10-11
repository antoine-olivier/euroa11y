// Pont node:http de l'entrée MCP web standard (`http.ts`), pour le serveur local et les tests ; séparé pour
// que le build Workers n'importe pas node:http.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { DEFAULT_MAX_BODY_BYTES, type HttpEntry } from "./http.ts";

async function readBody(req: IncomingMessage, maxBytes: number): Promise<Uint8Array | undefined | "too_large"> {
  if (req.method === "GET" || req.method === "HEAD") return undefined;
  if (Number(req.headers["content-length"] ?? 0) > maxBytes) return "too_large";
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > maxBytes) return "too_large";
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function writeResponse(res: ServerResponse, response: Response): Promise<void> {
  const headers: Record<string, string | string[]> = {};
  response.headers.forEach((value, name) => {
    if (name !== "set-cookie") headers[name] = value;
  });
  const cookies = response.headers.getSetCookie();
  if (cookies.length > 0) headers["set-cookie"] = cookies;
  res.writeHead(response.status, headers);
  if (!response.body) {
    res.end();
    return;
  }
  // Flux SSE compris : chaque morceau part dès qu'il arrive ; la fermeture côté client annule la lecture.
  const reader = response.body.getReader();
  res.on("close", () => void reader.cancel().catch(() => undefined));
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
  } finally {
    res.end();
  }
}

async function handleNode(req: IncomingMessage, res: ServerResponse, entry: HttpEntry, maxBodyBytes: number): Promise<void> {
  // Une cible absolue (requête de mandataire) n'a rien à faire ici.
  if (!req.url?.startsWith("/")) {
    res.writeHead(400, { "content-type": "text/plain; charset=utf-8" }).end("Bad request.");
    return;
  }
  const body = await readBody(req, maxBodyBytes);
  if (body === "too_large") {
    res.writeHead(413, { "content-type": "text/plain; charset=utf-8", connection: "close" }).end("Payload too large.");
    return;
  }
  const headers = new Headers();
  for (let index = 0; index + 1 < req.rawHeaders.length; index += 2) headers.append(req.rawHeaders[index] ?? "", req.rawHeaders[index + 1] ?? "");
  const controller = new AbortController();
  res.on("close", () => controller.abort());
  // L'origine de l'URL est locale ; l'en-tête Host reçu reste dans les en-têtes, et c'est lui que l'entrée vérifie.
  const request = new Request(new URL(req.url, "http://127.0.0.1"), { method: req.method, headers, body: body as Uint8Array<ArrayBuffer> | undefined, signal: controller.signal });
  await writeResponse(res, await entry.fetch(request));
}

/** Sert l'entrée avec node:http, sur 127.0.0.1 par défaut ; `port: 0` choisit un port libre. */
export function serveNode(entry: HttpEntry, options: { port: number; hostname?: string; maxBodyBytes?: number; onerror?: (error: Error) => void }): Promise<Server> {
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  const server = createServer((req, res) => {
    handleNode(req, res, entry, maxBodyBytes).catch((error: Error) => {
      options.onerror?.(error);
      if (!res.headersSent) res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      res.end();
    });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, options.hostname ?? "127.0.0.1", () => resolve(server));
  });
}
