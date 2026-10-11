// Address rules shared by the Node and Workers builds (no Node import): private, local and reserved
// addresses, page URL parsing. Address table taken from ProvenPlaces (`src/core/net.ts`).

export function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    value = value * 256 + n;
  }
  return value;
}

const V4_BLOCKS: Array<[string, number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

function isPrivateV4(ip: string): boolean {
  const value = ipv4ToInt(ip);
  if (value === null) return true;
  return V4_BLOCKS.some(([base, bits]) => {
    const start = ipv4ToInt(base) ?? 0;
    const size = 2 ** (32 - bits);
    return value >= start && value < start + size;
  });
}

/** The eight 16-bit groups of an IPv6 address, `::` and a trailing dotted IPv4 expanded; null if unreadable. */
export function ipv6Groups(ip: string): number[] | null {
  let text = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (text.includes("%")) return null;
  const dotted = text.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted?.[1] && dotted[2]) {
    const value = ipv4ToInt(dotted[2]);
    if (value === null) return null;
    text = `${dotted[1]}${(value >>> 16).toString(16)}:${(value & 0xffff).toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const split = (part: string | undefined) => (part ? part.split(":") : []);
  const head = split(halves[0]);
  const tail = split(halves[1]);
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill("0"), ...tail];
  if (groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return null;
  return groups.map((group) => parseInt(group, 16));
}

/** True for a private, local, reserved or unreadable address (IPv4 or IPv6). */
export function isPrivateAddress(ip: string): boolean {
  if (ip.includes(".") && !ip.includes(":")) return isPrivateV4(ip);
  const groups = ipv6Groups(ip);
  if (!groups) return true;
  // Global unicast (2000::/3) only. Everything else is refused, including the forms that embed an IPv4
  // address (::ffff:0:0/96, ::/96, 64:ff9b::/96): the URL parser rewrites [::ffff:127.0.0.1] as
  // [::ffff:7f00:1], which a dotted-quad pattern misses (security review, 2026-10-04). Inside 2000::/3,
  // 6to4 and Teredo tunnel an IPv4 address, and 2001:db8::/32 is for documentation.
  const [first = 0, second = 0] = groups;
  if ((first & 0xe000) !== 0x2000) return true;
  return first === 0x2002 || (first === 0x2001 && (second === 0 || second === 0xdb8));
}

/** True when the hostname is an IP literal (IPv4 dotted quad or IPv6, brackets allowed). */
export function isIpLiteral(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "");
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":");
}

export type HostVerdict = null | "private_address" | "dns";

/** Decides whether a hostname may be fetched; `null` means allowed. */
export type HostCheck = (hostname: string) => Promise<HostVerdict>;

/** Verdict that needs no DNS: IP literals and localhost names. `undefined` means a lookup is needed. */
export function staticVerdict(hostname: string): HostVerdict | undefined {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (isIpLiteral(host)) return isPrivateAddress(host) ? "private_address" : null;
  if (host === "localhost" || host.endsWith(".localhost")) return "private_address";
  return undefined;
}

/** Parses a user-supplied page URL: http(s) only, no embedded credentials. Throws a user-readable error. */
export function parsePageUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(raw.trim()) ? raw.trim() : `https://${raw.trim()}`);
  } catch {
    const shown = raw.trim();
    throw new Error(`Not a valid URL: ${shown.length > 200 ? `${shown.slice(0, 200)}…` : shown}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Only http:// and https:// pages can be scanned.");
  // DNS limits: a longer name cannot exist, and would go out in DNS queries and error messages (audit A1-10).
  if (url.hostname.length > 253 || url.hostname.split(".").some((label) => label.length > 63)) {
    throw new Error("The domain name is too long: a domain has at most 253 characters, and 63 between two dots.");
  }
  if (url.username || url.password) throw new Error("URLs with embedded credentials are not accepted.");
  url.hash = "";
  return url;
}
