// Copied from ProvenPlaces (src/mcp/http.ts, commit 9a1babd); one cast added for the DOM typings of this project.
// Entrée HTTP du serveur MCP (Streamable HTTP, SDK v2) : Worker Cloudflare, ou serveur local derrière un tunnel.
// Le gestionnaire est web standard (`fetch(Request)`), servi tel quel sous Workers et par `http-node.ts` en local.
// Garde-fous : écoute sur 127.0.0.1 ; point MCP sur un chemin secret ; en-têtes Host et Origin vérifiés
// (rebond DNS) ; corps de requête plafonné ; requêtes MCP simultanées bornées.
import { createMcpHandler, hostHeaderValidationResponse, originValidationResponse, type McpServerFactory } from "@modelcontextprotocol/server";

export const DEFAULT_MAX_BODY_BYTES = 1_048_576;

export interface HttpEntryOptions {
  /** Chemin exact du point MCP, secret : `/mcp/<jeton>`. */
  mcpPath: string;
  /** Noms d'hôte acceptés dans l'en-tête Host (sans port). Lu à chaque requête : l'hôte du tunnel s'ajoute après le démarrage. */
  allowedHosts: Set<string>;
  /** Noms d'hôte acceptés dans l'en-tête Origin, quand il est présent (les clients serveur n'en envoient pas). */
  allowedOrigins: Set<string>;
  factory: McpServerFactory;
  maxBodyBytes?: number;
  maxConcurrent?: number;
  /** Routes hors MCP (téléchargements, page d'état) : `undefined` = route inconnue. */
  extraRoutes?: (request: Request, url: URL) => Response | undefined | Promise<Response | undefined>;
  onerror?: (error: Error) => void;
}

export interface HttpEntry {
  fetch(request: Request): Promise<Response>;
  close(): Promise<void>;
}

function text(status: number, body: string, headers: Record<string, string> = {}): Response {
  return new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8", ...headers } });
}

/**
 * Error raised before the MCP SDK sees the request, in JSON-RPC like the SDK's own (audit A3-16): -32600 for
 * a request refused as sent, -32000 for a server busy.
 */
export function jsonRpcError(status: number, code: number, message: string, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ jsonrpc: "2.0", error: { code, message }, id: null }), { status, headers: { "content-type": "application/json", ...headers } });
}

export function createHttpEntry(options: HttpEntryOptions): HttpEntry {
  const handler = createMcpHandler(options.factory, { onerror: options.onerror, maxRequestBodySize: options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES });
  const maxConcurrent = options.maxConcurrent ?? 8;
  let inFlight = 0;

  return {
    async fetch(request) {
      const rejected = hostHeaderValidationResponse(request, [...options.allowedHosts]) ?? originValidationResponse(request, [...options.allowedOrigins]);
      if (rejected) return rejected;
      const url = new URL(request.url);
      if (url.pathname === options.mcpPath) {
        if (inFlight >= maxConcurrent) return jsonRpcError(503, -32000, "Too many concurrent requests. Try again in a few seconds.", { "retry-after": "2" });
        inFlight += 1;
        try {
          return await handler.fetch(request);
        } finally {
          inFlight -= 1;
        }
      }
      return (await options.extraRoutes?.(request, url)) ?? text(404, "Not found.");
    },
    close: () => handler.close(),
  };
}
