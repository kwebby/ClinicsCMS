<!-- Author: ramanpal singh | URL: https://kwebby.com -->
# Security policy

ClinicsCMS 0.1.0 is an implementation candidate. A real-patient pilot remains gated by [release acceptance](docs/security/RELEASE-GATES.md), including independent penetration testing and outstanding deployment/cloud certification. A public repository or passing CI is not clinical or regulatory approval.

To report a vulnerability, use GitHub's private vulnerability reporting if enabled for this repository. Otherwise contact the maintainer through [kwebby.com](https://kwebby.com) to arrange a private channel. Do not put exploit details, credentials, medical records, payroll data or customer identifiers in public issues. Send a minimal fictional reproduction, affected version and impact privately.

Maintainers should reproduce with disposable data, prepare a fix and regression test, and coordinate disclosure. No response-time or supported-version commitment has been established for this initial release. Track security fixes on the default branch and read release notes before upgrading.

Deployment controls, backup recovery and the threat model are documented in [docs/security](docs/security/THREAT-MODEL.md). Keep production credentials and backups outside the repository and never enable development bypasses on a public clinic installation.
