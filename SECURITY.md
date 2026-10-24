# Security Policy

Vitrin handles App Store Connect API keys and can upload content to App Store Connect, so we take security reports seriously.

## Supported versions

Only the latest release on `main` receives fixes.

## Reporting a vulnerability

**Please do not open a public issue.** Report privately through [GitHub Security Advisories](https://github.com/ardasnturk/auto-asc-metadata/security/advisories/new). Include the affected command, the version (`vitrin --version`) and steps to reproduce. You can expect an acknowledgement within a few days.

Examples of what we want to hear about:

- A secret (`ASC_KEY_ID`, `ASC_ISSUER_ID`, `.p8` contents, JWTs, demo account passwords) printed unmasked, written to a file outside `.env`, or sent anywhere other than Apple's API
- An upload or submit path that runs without the documented confirmation (`--yes`, `--confirm <bundleId>`)
- Command injection through config values, file names or captured data

## Handling your own keys

- Keep `.env` and `*.p8` out of version control (the generated `.gitignore` does this).
- Use an App Store Connect **Team Key** with the minimum role that works (App Manager).
- If a key may have leaked, revoke it in App Store Connect → Users and Access → Integrations immediately.
