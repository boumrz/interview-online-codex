#!/usr/bin/env bash
# Run once on Ubuntu 22.04+ as root: sets public DNS via netplan and disables
# provider DNS from DHCPv4/DHCPv6 (IPv6 DHCP was still overriding on some VPS).
#
# Usage: sudo ./setup_server_dns.sh [iface]
# Default iface: eth0

set -euo pipefail

IFACE="${1:-eth0}"
NETPLAN_DNS="/etc/netplan/99-dns-overrides.yaml"
NETD_DROPIN_DIR="/etc/systemd/network/10-netplan-${IFACE}.network.d"
NETD_DROPIN="${NETD_DROPIN_DIR}/no-dhcpv6-dns.conf"

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root (sudo)."
  exit 1
fi

cat > "${NETPLAN_DNS}" << EOF
network:
  version: 2
  ethernets:
    ${IFACE}:
      dhcp4-overrides:
        use-dns: false
      dhcp6-overrides:
        use-dns: false
      nameservers:
        addresses: [1.1.1.1, 8.8.8.8, 1.0.0.1, 8.8.4.4]
EOF
chmod 600 "${NETPLAN_DNS}"

mkdir -p "${NETD_DROPIN_DIR}"
cat > "${NETD_DROPIN}" << 'EOF'
[DHCPv6]
UseDNS=false
EOF

netplan generate
netplan apply
systemctl restart systemd-networkd
sleep 1
systemctl restart systemd-resolved

echo "==> DNS for ${IFACE}"
resolvectl dns "${IFACE}"
echo "==> Test"
getent hosts github.com
