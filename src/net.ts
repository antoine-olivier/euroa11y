// SSRF guard of the Node build: the scanner drives a real browser from this machine, so neither the scanned
// URL nor any subresource or redirect may reach a private, local or reserved address. The address rules are
// shared with the Workers build (`address.ts`); only the system DNS lookup is here. Known limit: DNS
// rebinding between the check and the fetch.
import { lookup } from "node:dns/promises";
import { isPrivateAddress, staticVerdict, type HostCheck } from "./address.ts";

export { isPrivateAddress, parsePageUrl, type HostCheck, type HostVerdict } from "./address.ts";

export const checkPublicHost: HostCheck = async (hostname) => {
  const known = staticVerdict(hostname);
  if (known !== undefined) return known;
  try {
    const addresses = await lookup(hostname, { all: true, verbatim: true });
    if (addresses.length === 0) return "dns";
    return addresses.some((entry) => isPrivateAddress(entry.address)) ? "private_address" : null;
  } catch {
    return "dns";
  }
};
