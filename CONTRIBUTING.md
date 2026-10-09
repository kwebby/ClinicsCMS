<!-- Author: ramanpal singh | URL: https://kwebby.com -->
# Contributing to ClinicsCMS

Read [development](docs/DEVELOPMENT.md), [architecture](docs/ARCHITECTURE.md), and the [threat model](docs/security/THREAT-MODEL.md) before changing the application. Use a branch and a pull request with the problem, resulting behavior, relevant checks and remaining limits.

Use fictional fixtures only. Keep `.env`, `.runtime`, uploaded files, database exports, generated access credentials and raw test reports out of commits. Preserve author comments in first-party main files and add the same attribution to new main files. Keep third-party notices intact.

Business decisions belong in the domain/API, with authorization on every entry point. Database operations must work through the persistence contracts; external effects follow committed outbox events. Changes to shared persistence behavior need the same contract tests across the supported profiles. Do not call a backend certified because unit tests or an emulator pass.

Use dedicated pages for creation, editing and consequential workflows. Preserve accessible inline status shortcuts, calendar and Kanban views. Add public-page metadata through application controls, and use the constrained theme format for theme contributions. Read `apps/web/AGENTS.md` and installed Next.js documentation before changing web code.

Before submitting, run `pnpm typecheck`, `pnpm test`, `pnpm build`, and `pnpm deploy:verify`. Add relevant browser, adapter or security regression checks for behavior changes; documentation-only corrections do not require redundant tests. Disclose skipped checks and missing external infrastructure.

Contributions to first-party code are made under the repository's MIT license. Dependency and asset licenses retain their own terms. Report vulnerabilities through the [security policy](SECURITY.md), without sensitive records or secrets in public issues.
