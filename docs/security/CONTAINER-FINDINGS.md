<!-- Author: ramanpal singh | URL: https://kwebby.com -->
# Container release blocker — 9 October 2026

The public source release is an implementation candidate. Its Docker application image **builds successfully but fails the High/Critical vulnerability gate**. It is not approved for real-patient deployment.

## Observed evidence

[GitHub Actions run 37946951337](https://github.com/kwebby/ClinicsCMS/actions/runs/37946951337), source commit `8b2647088808e804b318ab868bfc8f4344ce85bb`, completed the application type checks, tests, build, production dependency audit, license check, source secret scan and source vulnerability/misconfiguration scan. PostgreSQL 17, PostgreSQL 18 and MySQL 8.4 contract jobs passed. Remote cloud jobs were intentionally skipped.

Trivy 0.75.0 then reported the following findings in the built `clinicscms:ci` application image:

| Component group | High | Critical |
| --- | ---: | ---: |
| Debian 12.15 packages, including the installed ClamAV client dependencies | 89 | 5 |
| JavaScript packages found in the image, including package-manager tooling | 10 | 0 |
| Go standard library embedded in the bundled esbuild executable | 23 | 1 |

These are scanner findings, not 128 independently verified exploitation paths. Multiple packages may report the same advisory. Runtime reachability and any disputed classification require documented assessment. The gate has not been suppressed or changed to ignore unfixed findings.

## Why source checks did not catch the complete image

The runtime application stage currently copies the full build workspace, including development tooling, and the Node base image includes package managers. It also installs the distribution's `clamdscan` package and dependencies. Image scanning sees these installed files and operating-system packages in addition to the application dependency lockfile.

Some reported operating-system advisories have no fixed version in the selected distribution stream; others and several bundled JavaScript dependencies have published fixes. A passing `pnpm audit --prod` therefore does not establish that this container is ready for use.

## Required remediation and retest

1. Separate production runtime dependencies from build/test tools. Preserve PDF worker requirements in its own image and verify API/worker startup after pruning.
2. Review maintained base-image/distribution and scanner-client options, verify package provenance and patched versions, and update pinned image digests. Do not remove malware scanning to make the scan pass.
3. Remove unneeded package managers from final runtime images or update their included dependencies when needed by that image.
4. Review each remaining advisory against the installed binary/package and actual runtime use. Record justified decisions individually; do not blanket-ignore unfixed or High/Critical findings.
5. Rebuild and scan the application, web, PDF and supporting images. Retest scanned uploads, isolated PDF generation, SQL/cloud contracts and deployment/recovery paths. Keep release approval blocked until the required security criteria pass.

CI now generates a CycloneDX SBOM and JSON vulnerability report before enforcing the image gate, and uploads them as `container-security-reports` even when that gate fails. The initial failing run predates this artifact-order correction, so its evidence is in the job log. Local repro commands, after installing Docker and Trivy, are:

```sh
docker build -f deploy/Dockerfile --target application -t clinicscms:ci .
trivy image --format cyclonedx --output application-sbom.json clinicscms:ci
trivy image --severity HIGH,CRITICAL --format json --output container-vulnerabilities.json clinicscms:ci
trivy image --severity HIGH,CRITICAL --exit-code 1 clinicscms:ci
```

Scanner databases change over time, so later counts may differ. Use these checks alongside the broader [release gates](RELEASE-GATES.md), which still require real Supabase/Firestore projects, target deployments, recovery evidence, clinical approval and independent penetration testing.
