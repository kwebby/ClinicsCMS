#!/bin/sh
# Author: ramanpal singh | URL: https://kwebby.com
# Run in CI with pinned tools available; missing scanners fail the gate.
set -eu
pnpm typecheck
pnpm test
pnpm audit --prod --audit-level=high
pnpm exec license-checker-rseidelsohn --production --excludePrivatePackages --onlyAllow 'MIT;Apache-2.0;BSD-2-Clause;BSD-3-Clause;ISC;0BSD;CC0-1.0;CC-BY-4.0;Unlicense;BlueOak-1.0.0;Python-2.0;MPL-2.0;OFL-1.1;LGPL-2.1-or-later;LGPL-3.0-or-later'
command -v gitleaks >/dev/null
command -v trivy >/dev/null
gitleaks git --redact --no-banner .
trivy fs --scanners vuln,secret,misconfig --severity HIGH,CRITICAL --exit-code 1 --skip-dirs node_modules,.runtime .
if [ -n "${SCAN_IMAGE:-}" ]; then
 trivy image --severity HIGH,CRITICAL --exit-code 1 "$SCAN_IMAGE"
fi
