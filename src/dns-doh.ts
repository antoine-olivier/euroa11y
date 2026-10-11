// Host check for the Workers build, where `node:dns` is not available: DNS over HTTPS (JSON API of
// cloudflare-dns.com), A and AAAA records, CNAME chains followed by the resolver. Any private, local or
// reserved address in the answer refuses the host. Known limit: DNS rebinding between this check and the
// browser's own resolution.
import { isPrivateAddress, staticVerdict, type HostCheck, type HostVerdict } from "./address.ts";

const DOH_ENDPOINT = "https://cloudflare-dns.com/dns-query";
const RECORD_A = 1;
const RECORD_AAAA = 28;

interface DohAnswer {
  Status: number;
  Answer?: Array<{ type: number; data: string }>;
}

export type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

async function resolve(hostname: string, type: "A" | "AAAA", fetcher: Fetcher, timeoutMs: number): Promise<DohAnswer> {
  const url = `${DOH_ENDPOINT}?name=${encodeURIComponent(hostname)}&type=${type}`;
  const response = await fetcher(url, { headers: { accept: "application/dns-json" }, signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`DoH ${response.status}`);
  return (await response.json()) as DohAnswer;
}

/** Host check through DNS over HTTPS; `fetcher` is injectable for tests. */
export function createDohHostCheck(options: { fetcher?: Fetcher; timeoutMs?: number } = {}): HostCheck {
  const fetcher = options.fetcher ?? ((input, init) => fetch(input, init));
  const timeoutMs = options.timeoutMs ?? 5_000;
  return async (hostname) => {
    const known = staticVerdict(hostname);
    if (known !== undefined) return known;
    try {
      const answers = await Promise.all([resolve(hostname, "A", fetcher, timeoutMs), resolve(hostname, "AAAA", fetcher, timeoutMs)]);
      const addresses = answers.flatMap((answer) => (answer.Answer ?? []).filter((record) => record.type === RECORD_A || record.type === RECORD_AAAA).map((record) => record.data));
      // NXDOMAIN, or a name without any address record: nothing to load.
      if (addresses.length === 0) return "dns";
      return addresses.some(isPrivateAddress) ? "private_address" : null;
    } catch {
      return "dns";
    }
  };
}

/** Memoises a host check for the duration of one scan (many subresources share a few hosts). */
export function memoHostCheck(check: HostCheck): HostCheck {
  const seen = new Map<string, Promise<HostVerdict>>();
  return (hostname) => {
    const key = hostname.toLowerCase();
    let verdict = seen.get(key);
    if (!verdict) {
      verdict = check(key);
      seen.set(key, verdict);
    }
    return verdict;
  };
}
