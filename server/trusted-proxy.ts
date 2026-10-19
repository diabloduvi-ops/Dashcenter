import { isIP } from "node:net";

export function trustedProxyAddresses(env: NodeJS.ProcessEnv = process.env): string[] | false {
  const value = env.TRUST_PROXY?.trim() ?? "";
  if (!value || ["0", "false", "no", "off"].includes(value.toLowerCase())) return false;
  if (["1", "true", "yes", "on"].includes(value.toLowerCase())) {
    throw new Error("TRUST_PROXY must list trusted proxy IP addresses or CIDRs; a boolean trusts every client.");
  }

  const addresses = value.split(",").map((address) => address.trim());
  if (addresses.some((address) => {
    const [ip, prefix, extra] = address.split("/");
    const family = isIP(ip);
    if (!family || extra !== undefined) return true;
    if (prefix === undefined) return false;
    const bits = Number(prefix);
    return !/^\d+$/.test(prefix) || bits < 1 || bits > (family === 4 ? 32 : 128);
  })) {
    throw new Error("TRUST_PROXY must contain only trusted proxy IP addresses or CIDRs.");
  }
  return addresses;
}
