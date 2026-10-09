#!/bin/sh
# Author: ramanpal singh | URL: https://kwebby.com
# Linux host rule: install after Docker starts and before exposing the analyzer.
# Select an unused IPv4 subnet in compose and persist these rules via the host firewall manager.
set -eu
ANALYZER_NET=${ANALYZER_SUBNET:-172.30.240.0/28}
case "$ANALYZER_NET" in *[!0-9./]*) echo 'Invalid ANALYZER_SUBNET' >&2; exit 1;; esac
command -v iptables >/dev/null
iptables -N CLINIC_ANALYZER 2>/dev/null || true
iptables -F CLINIC_ANALYZER
for destination in 0.0.0.0/8 10.0.0.0/8 100.64.0.0/10 127.0.0.0/8 169.254.0.0/16 172.16.0.0/12 192.0.0.0/24 192.0.2.0/24 192.168.0.0/16 198.18.0.0/15 198.51.100.0/24 203.0.113.0/24 224.0.0.0/4 240.0.0.0/4; do
 iptables -A CLINIC_ANALYZER -d "$destination" -j REJECT
done
iptables -A CLINIC_ANALYZER -p tcp -m multiport --dports 80,443 -j RETURN
iptables -A CLINIC_ANALYZER -j REJECT
iptables -C DOCKER-USER -s "$ANALYZER_NET" -j CLINIC_ANALYZER 2>/dev/null || iptables -I DOCKER-USER 1 -s "$ANALYZER_NET" -j CLINIC_ANALYZER
