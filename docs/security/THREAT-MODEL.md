<!-- Author: ramanpal singh | URL: https://kwebby.com -->
# ClinicsCMS security boundaries and threat model

## Assets and actors

ClinicsCMS protects identifiable patient/clinical data, staff payroll, financial records, sessions/MFA seeds, payment/email/AI credentials, clinic reputation, and availability. Relevant actors include anonymous visitors, leads, patients/caregivers, invited employees, specialists/clinical staff, finance/HR/content staff, privileged administrators, infrastructure operators, and remote providers. Roles are server-resolved; organization, branch, patient links, and authorizations must never come from browser assertions.

## Boundaries and controls

| Boundary | Main failure | Required control and test |
|---|---|---|
| Public registration → staff privileges | Submitted role or linked-patient escalation | Patient-only creation; explicit staff invite and identity-link workflows; deny role/branch overrides |
| Session → API/socket | Session theft, CSRF, revoked privileges | Opaque server sessions, staff MFA, origin/CSRF controls, revocation and server authorization on every request/event |
| Actor → records/files | Cross-patient/branch access, inappropriate payroll access | Organization plus role/branch/patient checks; explicit patient release; same checks on downloads and exports |
| Draft → signed clinical document | Silent edit or AI release | Version conflict detection, signed immutable snapshots, amendments, review-required AI outputs |
| Booking → schedule | Concurrent overlapping appointments | Transactional locks/invariants in each authoritative database adapter |
| Invoice/payment → balance | Forged/replayed events, rounding drift | Exact decimal calculations, immutable issue snapshots, webhook signature checks and idempotency |
| Uploaded ZIP/file → local disk | Traversal, symlink, archive bomb, executable content | Generated paths, bounded streaming, regular-file reads, validated declarative format and asset signatures, malware scan before visibility |
| Theme/content → browser | Stored XSS or CSS data exfiltration | Application-owned components; strict theme tokens; escaped BlockNote allowlist and JSON-LD escaping; no theme code |
| Financial template → Chromium | SSRF/file reads/RCE | Typed escaped snapshot input, no arbitrary URLs/HTML, scripts and network blocked, no-network non-root worker container |
| Website URL → analyzer | SSRF/DNS rebinding/internal discovery | Separate no-secret worker, firewall egress isolation, all-address DNS checks, DNS pinning, redirect revalidation, response/time budgets |
| Clinic text → AI provider | Unapproved disclosure, hallucinated decisions | Administrator-configured policy/provider, least data needed, quotas, provenance, no signing/release capability |
| Durable work → external provider | Duplicate mail/payment/notification effects | Outbox records plus idempotency, explicit retries, acceptance vs delivery distinction, reconciliation after restore |
| Database/files → backup | Irrecoverable server loss, inconsistent attachments | Encrypted off-host paired checkpoints, integrity manifests, measured recovery drills |

The database and local-file roots are not accessible to the browser. Provider credentials are encrypted at rest. The PDF and URL analyzer processes receive no application provider/database credentials. Public lead tools collect bounded non-diagnostic input and separate marketing consent. The vendor's business tools use a separate installation/datastore.

## Security verification requirements

Use OWASP ASVS 5 Level 2 as the baseline, with additional review of clinical signatures, identity links, payroll permissions, payment math, backup completeness, and publication rollback. Security tests in this repository are automated regression evidence only. Production configuration, independent penetration testing, all-backend certification, staff training, and recovery timing require separately recorded external evidence before a clinic pilot.

See [release gates](RELEASE-GATES.md) for required deployment evidence and [recovery](RECOVERY.md) for backup boundaries. Generated scan and test reports are local or CI artifacts, not files guaranteed to exist after cloning. Record the tested commit and configuration, and keep real patient data and credentials out of public issue reports.
