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

At the time of that run, the runtime application stage copied the full build workspace, including development tooling, and the Node base image included package managers. It also installs the distribution's `clamdscan` package and dependencies (still true). Image scanning sees these installed files and operating-system packages in addition to the application dependency lockfile.

Some reported operating-system advisories have no fixed version in the selected distribution stream; others and several bundled JavaScript dependencies have published fixes. A passing `pnpm audit --prod` therefore does not establish that this container is ready for use.

## Required remediation and retest

1. Separate production runtime dependencies from build/test tools. Preserve PDF worker requirements in its own image and verify API/worker startup after pruning.
2. Review maintained base-image/distribution and scanner-client options, verify package provenance and patched versions, and update pinned image digests. Do not remove malware scanning to make the scan pass.
3. Remove unneeded package managers from final runtime images or update their included dependencies when needed by that image.
4. Review each remaining advisory against the installed binary/package and actual runtime use. Record justified decisions individually; do not blanket-ignore unfixed or High/Critical findings.
5. Rebuild and scan the application, web, PDF and supporting images. Retest scanned uploads, isolated PDF generation, SQL/cloud contracts and deployment/recovery paths. Keep release approval blocked until the required security criteria pass.

## Remediation changes made since the failing run (not yet rebuilt or rescanned)

The following changes address parts of steps 1, 3 and 5. They were made without a Docker daemon: the images have **not** been rebuilt or scanned since, the counts above are unchanged evidence, and the release blocker remains in force until CI builds and scans the new images.

- **Step 1, runtime dependencies.** A separate Dockerfile stage installs only the root package's production dependencies from the lockfile (`pnpm install --frozen-lockfile --prod --filter clinicscms`). The application image now contains `package.json`, that production `node_modules` and the compiled `dist` output, instead of the whole build workspace (sources, scripts, TypeScript, tsx, Vitest, esbuild, Next.js build tooling and the web workspace). The PDF image is built from the same runtime base with the production dependencies plus the Chromium build installed by `playwright-core`, and no longer inherits the scanner client. Runtime code previously imported Chromium automation from the development-only `@playwright/test`; it now uses `playwright-core` 1.56.1 as a production dependency, loaded only when a render runs, so `pnpm audit --prod` and the production license check cover it. The unused `sanitize-html` dependency was removed. Every bare import in the compiled API, worker and platform output was resolved against a production-only install, and the PDF stage's Chromium installation still needs confirming in a real build.
- **Step 3, package managers.** The application, web and PDF runtime images derive from a base stage that deletes npm, npx, corepack and yarn from the Node image. pnpm and corepack remain only in the build and dependency stages, which are not shipped. The Debian package manager (apt/dpkg) remains in the base image.
- **Step 5, scan coverage.** CI builds and scans the `application`, `web` and `pdf` targets in a matrix, each uploading its own CycloneDX SBOM and JSON report as `container-security-reports-<target>` even when its gate fails. Supporting third-party images (ClamAV, Valkey, PostgreSQL, MySQL, Nginx, Apache) are still not scanned by CI.
- **Hardening unrelated to scan counts.** The ClamAV container now runs as its unprivileged user with all capabilities dropped, `no-new-privileges` and a read-only root filesystem, on an internal network shared only with the API plus a signature-update egress network; the Compose verifier checks these settings.

Not yet addressed: step 2 (base image/distribution and `clamdscan` package review; the application image still installs `clamdscan` from Debian 12) and step 4 (per-advisory review). Removing the build toolchain from the shipped images may remove the esbuild Go standard-library findings and the package-manager JavaScript findings, but that is an expectation to confirm from the next scan, not a result.

CI generates a CycloneDX SBOM and JSON vulnerability report for each runtime image before enforcing the image gate, and uploads them even when that gate fails. The initial failing run predates this artifact-order correction, so its evidence is in the job log. Local repro commands, after installing Docker and Trivy, are (repeat for `web` and `pdf`):

```sh
docker build -f deploy/Dockerfile --target application -t clinicscms-application:ci .
trivy image --format cyclonedx --output application-sbom.json clinicscms-application:ci
trivy image --severity HIGH,CRITICAL --format json --output application-vulnerabilities.json clinicscms-application:ci
trivy image --severity HIGH,CRITICAL --exit-code 1 clinicscms-application:ci
```

Scanner databases change over time, so later counts may differ. Use these checks alongside the broader [release gates](RELEASE-GATES.md), which still require real Supabase/Firestore projects, target deployments, recovery evidence, clinical approval and independent penetration testing.
