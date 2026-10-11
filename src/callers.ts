// Who calls the public server, for its per-client limits (audit A1-01, QCM of 2026-10-05). ChatGPT and Claude
// on the web call from their platform's servers, shared by all their users: such an address names a platform,
// not a person. A client on the user's own computer (Claude Code, a code editor) calls from the user's own
// address. The address is the one Cloudflare saw (cf-connecting-ip), which a client cannot choose.
import { ipv4ToInt, ipv6Groups } from "./address.ts";

export type Platform = "chatgpt" | "claude" | "direct";

export interface Caller {
  platform: Platform;
  /** One user or one machine, when known; the server stores only a keyed hash of it. */
  id?: string;
  /** The platform server's own address, for a caller that names no user: limited per minute only (review of 2026-10-05, n° 2). */
  address?: string;
}

/** An address range: the leading `bits` of its 128-bit addresses (IPv4 mapped into ::ffff:0:0/96). */
export interface Cidr {
  prefix: bigint;
  bits: number;
}

const V4_MAPPED = 0xffffn;

/** 128-bit value of an IPv4 or IPv6 address, IPv4 mapped into ::ffff:0:0/96; null if unreadable. */
export function addressValue(ip: string): bigint | null {
  if (!ip.includes(":")) {
    const v4 = ipv4ToInt(ip);
    return v4 === null ? null : (V4_MAPPED << 32n) | BigInt(v4);
  }
  const groups = ipv6Groups(ip);
  return groups ? groups.reduce((value, group) => (value << 16n) | BigInt(group), 0n) : null;
}

export function parseCidr(text: string): Cidr | null {
  const match = /^([^/\s]+)\/(\d{1,3})$/.exec(text.trim());
  const ip = match?.[1];
  const value = ip === undefined ? null : addressValue(ip);
  if (!match || ip === undefined || value === null) return null;
  const v4 = !ip.includes(":");
  const length = Number(match[2]);
  if (length > (v4 ? 32 : 128)) return null;
  const bits = length + (v4 ? 96 : 0);
  return { prefix: value >> BigInt(128 - bits), bits };
}

function within(value: bigint, cidr: Cidr): boolean {
  return value >> BigInt(128 - cidr.bits) === cidr.prefix;
}

/**
 * Addresses Anthropic uses for its outbound requests, MCP tool calls of Claude on the web included
 * (platform.claude.com/docs/en/api/ip-addresses, read on 2026-10-05). Claude Code calls from the user's machine.
 */
const ANTHROPIC_RANGES = ["160.79.104.0/21"].map((text) => parseCidr(text)).filter((cidr) => cidr !== null);

// `openai/subject`: anonymised user identifier that ChatGPT sends to MCP servers for rate limiting
// (developers.openai.com/apps-sdk/reference, read on 2026-10-05). Any client can write it: it is read only
// from OpenAI's addresses.
const MAX_SUBJECT_LENGTH = 256;

/** The caller of one request, from the network address and the tool call's `_meta`. */
export function identifyCaller(address: string | null | undefined, meta: Record<string, unknown> | undefined, openai: readonly Cidr[]): Caller {
  const value = address ? addressValue(address.trim()) : null;
  if (value === null) return { platform: "direct", id: "unknown" };
  // An IPv6 subscriber line gets a whole /64 network: it counts as one machine.
  const machine = value >> 32n === V4_MAPPED ? `ip:${value & 0xffffffffn}` : `ip6:${(value >> 64n).toString(16)}`;
  if (openai.some((cidr) => within(value, cidr))) {
    const subject = meta?.["openai/subject"];
    return typeof subject === "string" && subject.length > 0 && subject.length <= MAX_SUBJECT_LENGTH ? { platform: "chatgpt", id: `openai:${subject}` } : { platform: "chatgpt", address: machine };
  }
  // Anthropic sends no user identifier: the calls of Claude on the web are counted together.
  if (ANTHROPIC_RANGES.some((cidr) => within(value, cidr))) return { platform: "claude", address: machine };
  return { platform: "direct", id: machine };
}

/**
 * The caller of each tool call of one HTTP request, from the address Cloudflare received it from
 * (`cf-connecting-ip`, set by Cloudflare whatever the client sends).
 */
export function callerOf(request: Request | undefined, openai: () => readonly Cidr[]): (meta: Record<string, unknown> | undefined) => Caller {
  return (meta) => identifyCaller(request?.headers.get("cf-connecting-ip"), meta, openai());
}

// A range wider than this is not taken from the published list (the widest was a /17 on 2026-09-22).
const WIDEST_V4 = 16;
const WIDEST_V6 = 32;
// Fewer ranges than this is not the real list (278 on 2026-09-22) but an error page or a truncated file.
const MIN_RANGES = 10;
const MAX_RANGES = 10_000;

/**
 * Address ranges of ChatGPT connectors, from the list OpenAI publishes at
 * https://openai.com/chatgpt-connectors.json (`{creationTime, prefixes: [{ipv4Prefix}]}`); null for anything else.
 */
export function parseConnectorList(json: unknown): Cidr[] | null {
  const prefixes = typeof json === "object" && json !== null ? (json as { prefixes?: unknown }).prefixes : undefined;
  if (!Array.isArray(prefixes) || prefixes.length > MAX_RANGES) return null;
  const ranges: Cidr[] = [];
  for (const entry of prefixes as Array<{ ipv4Prefix?: unknown; ipv6Prefix?: unknown } | null>) {
    const text = entry?.ipv4Prefix ?? entry?.ipv6Prefix;
    if (typeof text !== "string") continue;
    const cidr = parseCidr(text);
    if (cidr && cidr.bits >= (text.includes(":") ? WIDEST_V6 : 96 + WIDEST_V4)) ranges.push(cidr);
  }
  return ranges.length >= MIN_RANGES ? ranges : null;
}

const RELOAD_MS = 24 * 3600_000;
const RETRY_MS = 3600_000;

export interface RangeList {
  current(): readonly Cidr[];
  /** Loads the published list again once a day (once an hour after a failure); undefined when not due. */
  reload(): Promise<void> | undefined;
}

export interface RangeListOptions {
  now?: () => number;
  /** One line per load, for the operator: ranges loaded, or why the previous ones were kept. */
  log?: (line: string) => void;
}

/** ChatGPT's ranges: the copy bundled with the server, replaced by the published list once loaded. */
export function createRangeList(snapshot: unknown, load: () => Promise<unknown>, { now = Date.now, log }: RangeListOptions = {}): RangeList {
  let ranges: readonly Cidr[] = parseConnectorList(snapshot) ?? [];
  let due = 0;
  return {
    current: () => ranges,
    reload() {
      if (now() < due) return undefined;
      due = now() + RETRY_MS;
      return load().then(
        (json) => {
          const loaded = parseConnectorList(json);
          if (!loaded) return log?.(`ChatGPT list unreadable, ${ranges.length} ranges kept`);
          ranges = loaded;
          due = now() + RELOAD_MS;
          log?.(`ChatGPT list loaded, ${ranges.length} ranges`);
        },
        (error: unknown) => log?.(`ChatGPT list not loaded (${String(error instanceof Error ? error.message : error).split("\n")[0]?.slice(0, 120)}), ${ranges.length} ranges kept`),
      );
    },
  };
}
