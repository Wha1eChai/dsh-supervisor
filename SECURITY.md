# Security policy

Report suspected vulnerabilities privately through [GitHub private vulnerability reporting](https://github.com/Wha1eChai/dsh-cross-session/security/advisories/new). Do not open a public issue for a security vulnerability.

Do not include API keys, access tokens, sensitive transcripts, `.env` files, or a complete `DSH_HOME` in a report. Include only the minimum evidence needed to reproduce the issue.

Please provide:

- dsh-cross-session version or source commit;
- DSH version;
- Node.js and pnpm versions;
- operating system;
- minimal reproduction steps;
- security impact and affected capability.

## Security scope

The security scope includes:

- live same-process Session discovery and inspection;
- transcript exposure through `fleet_inspect`;
- model-callable `fleet_send`, `fleet_steer`, and `fleet_cancel`;
- caller-bound target references and exact target selections;
- package installation, `prepare`, and build behavior.

The package currently has no remote endpoint, cross-process transport, daemon, or gateway. Those are not current attack surfaces and must not be assumed when assessing a report.

The supported runtime is DSH `0.1.0-rc.6`. Security fixes may require a package update and profile review; use an isolated `DSH_HOME` while validating a fix.
