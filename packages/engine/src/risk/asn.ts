/**
 * Hosting, cloud and VPN networks (PRD 4.4.3 "Network looks like a VPN, hosting provider or
 * non-Indian"). A punch from one of these ASNs adds risk points; it never blocks on its own.
 *
 * Maintenance: add an ASN when a flagged punch shows a hosting or VPN network that is missing here,
 * with the operator's name. Do not add Indian consumer ISPs or mobile carriers (Jio 55836,
 * Airtel 45609, Vi 38266, BSNL 9829, ACT 24309, Hathway 17488): staff punch from those.
 */
export const HOSTING_VPN_ASNS: ReadonlyMap<number, string> = new Map([
  // Public clouds
  [16509, 'Amazon AWS'],
  [14618, 'Amazon AWS'],
  [8987, 'Amazon AWS'],
  [396982, 'Google Cloud'],
  [8075, 'Microsoft Azure'],
  [31898, 'Oracle Cloud'],
  [45102, 'Alibaba Cloud'],
  [132203, 'Tencent Cloud'],
  [36351, 'IBM Cloud (SoftLayer)'],
  // VPS and dedicated hosting
  [14061, 'DigitalOcean'],
  [63949, 'Akamai Linode'],
  [20473, 'Vultr (Choopa)'],
  [16276, 'OVHcloud'],
  [24940, 'Hetzner'],
  [213230, 'Hetzner Cloud'],
  [51167, 'Contabo'],
  [60781, 'Leaseweb'],
  [28753, 'Leaseweb'],
  [12876, 'Scaleway'],
  [46606, 'Unified Layer'],
  [36352, 'ColoCrossing'],
  [55286, 'Server Mania'],
  [40021, 'Contabo US'],
  [133199, 'SonderCloud'],
  // VPN egress and anonymising networks
  [13335, 'Cloudflare (WARP)'],
  [9009, 'M247'],
  [60068, 'Datacamp (CDN77)'],
  [212238, 'Datacamp'],
  [62371, 'Proton'],
  [39351, '31173 Services (Mullvad)'],
  [136787, 'TEFINCOM (NordVPN)'],
  [207137, 'PacketHub (NordVPN)'],
  [147049, 'PacketHub'],
  [209854, 'Surfshark'],
  [46562, 'Performive (PIA)'],
  [394711, 'Limenet'],
  [62240, 'Clouvider'],
  [200651, 'Flokinet'],
  [53667, 'FranTech (BuyVM)'],
]);

/** True when the ASN is a known hosting, cloud or VPN network. */
export function isSuspectAsn(asn: number | null): boolean {
  return asn !== null && HOSTING_VPN_ASNS.has(asn);
}
