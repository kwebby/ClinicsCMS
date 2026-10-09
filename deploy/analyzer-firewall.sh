#!/bin/sh
# Author: ramanpal singh | URL: https://kwebby.com
# Linux host rule: install after Docker starts and before exposing the analyzer.
# Select an unused IPv4 subnet in compose and persist these rules via the host firewall manager.
# ANALYZER_DNS_SERVERS: space/comma-separated IPv4 resolvers Docker's embedded DNS forwards to (from the analyzer's network
# namespace). Defaults to the non-loopback nameservers Docker itself uses from the host resolver configuration.
set -eu
ANALYZER_NET=${ANALYZER_SUBNET:-172.30.240.0/28}
case "$ANALYZER_NET" in *[!0-9./]*) echo 'Invalid ANALYZER_SUBNET' >&2; exit 1;; esac
if [ -z "${ANALYZER_DNS_SERVERS:-}" ]; then
 RESOLV=/etc/resolv.conf
 if [ -f /run/systemd/resolve/resolv.conf ] && grep -q '^nameserver 127\.0\.0\.53' /etc/resolv.conf 2>/dev/null; then RESOLV=/run/systemd/resolve/resolv.conf; fi
 ANALYZER_DNS_SERVERS=$(awk '$1 == "nameserver" && $2 ~ /^[0-9.]+$/ && $2 !~ /^127\./ { print $2 }' "$RESOLV" | tr '\n' ' ')
fi
DNS_SERVERS=$(printf '%s' "$ANALYZER_DNS_SERVERS" | tr ',' ' ' | tr -s ' ')
[ -n "$(printf '%s' "$DNS_SERVERS" | tr -d ' ')" ] || { echo 'Set ANALYZER_DNS_SERVERS to the IPv4 resolvers used by Docker' >&2; exit 1; }
for server in $DNS_SERVERS; do
 printf '%s\n' "$server" | grep -qE '^[0-9]{1,3}(\.[0-9]{1,3}){3}$' || { echo "Invalid resolver in ANALYZER_DNS_SERVERS: $server" >&2; exit 1; }
done
command -v iptables >/dev/null
# Forwarded traffic (DOCKER-USER): DNS to the configured resolvers only, then public TCP 80/443; everything else is rejected.
iptables -N CLINIC_ANALYZER 2>/dev/null || true
iptables -F CLINIC_ANALYZER
for server in $DNS_SERVERS; do
 iptables -A CLINIC_ANALYZER -d "$server" -p udp --dport 53 -j RETURN
 iptables -A CLINIC_ANALYZER -d "$server" -p tcp --dport 53 -j RETURN
done
# Keep identical to RESTRICTED_IPV4_CIDRS in packages/platform/src/tools.ts (a regression test compares them).
for destination in 0.0.0.0/8 10.0.0.0/8 100.64.0.0/10 127.0.0.0/8 169.254.0.0/16 172.16.0.0/12 192.0.0.0/24 192.0.2.0/24 192.88.99.0/24 192.168.0.0/16 198.18.0.0/15 198.51.100.0/24 203.0.113.0/24 224.0.0.0/4 240.0.0.0/4; do
 iptables -A CLINIC_ANALYZER -d "$destination" -j REJECT
done
iptables -A CLINIC_ANALYZER -p tcp -m multiport --dports 80,443 -j RETURN
iptables -A CLINIC_ANALYZER -j REJECT
iptables -C DOCKER-USER -s "$ANALYZER_NET" -j CLINIC_ANALYZER 2>/dev/null || iptables -I DOCKER-USER 1 -s "$ANALYZER_NET" -j CLINIC_ANALYZER
# Traffic addressed to the host itself (gateway, host or published addresses) uses INPUT, not FORWARD: allow only DNS to a
# configured resolver that lives on the host, and reject everything else from the analyzer subnet.
iptables -N CLINIC_ANALYZER_INPUT 2>/dev/null || true
iptables -F CLINIC_ANALYZER_INPUT
for server in $DNS_SERVERS; do
 iptables -A CLINIC_ANALYZER_INPUT -d "$server" -p udp --dport 53 -j RETURN
 iptables -A CLINIC_ANALYZER_INPUT -d "$server" -p tcp --dport 53 -j RETURN
done
iptables -A CLINIC_ANALYZER_INPUT -j REJECT
iptables -C INPUT -s "$ANALYZER_NET" -j CLINIC_ANALYZER_INPUT 2>/dev/null || iptables -I INPUT 1 -s "$ANALYZER_NET" -j CLINIC_ANALYZER_INPUT
echo "Analyzer egress rules installed for $ANALYZER_NET (DNS resolvers: $DNS_SERVERS)"
