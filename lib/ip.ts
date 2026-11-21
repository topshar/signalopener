import { BlockList, isIP } from "node:net";

// Address ranges we never fetch from: loopback, private networks, link-local
// (includes the 169.254.169.254 cloud metadata endpoint), carrier-grade NAT,
// documentation/benchmark ranges, multicast and reserved space.
const blocked = new BlockList();

const V4_SUBNETS: [string, number][] = [
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

const V6_SUBNETS: [string, number][] = [
  ["::", 128], // unspecified
  ["::1", 128], // loopback
  ["64:ff9b::", 96], // NAT64, can map to internal IPv4
  ["100::", 64], // discard
  ["2001:db8::", 32], // documentation
  ["fc00::", 7], // unique local
  ["fe80::", 10], // link-local
  ["ff00::", 8], // multicast
];

for (const [net, prefix] of V4_SUBNETS) blocked.addSubnet(net, prefix, "ipv4");
for (const [net, prefix] of V6_SUBNETS) blocked.addSubnet(net, prefix, "ipv6");

export function isBlockedIp(address: string): boolean {
  const ip = address.replace(/^\[|\]$/g, "").toLowerCase();
  const version = isIP(ip);
  if (version === 0) return true; // not an IP at all: refuse rather than guess

  if (version === 6) {
    // IPv4-mapped IPv6 (::ffff:127.0.0.1) must be checked as IPv4.
    const mapped = ip.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
    if (mapped) return blocked.check(mapped[1], "ipv4");
    // Hex form of a mapped address (::ffff:7f00:1): decode and check as IPv4.
    const hexMapped = ip.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (hexMapped) {
      const hi = parseInt(hexMapped[1], 16);
      const lo = parseInt(hexMapped[2], 16);
      const v4 = `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
      return blocked.check(v4, "ipv4");
    }
    return blocked.check(ip, "ipv6");
  }
  return blocked.check(ip, "ipv4");
}
