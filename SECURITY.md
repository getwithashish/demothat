# Security Policy

## Supported Versions

| Version                       | Supported             |
| ----------------------------- | --------------------- |
| Latest stable (`main`)        | ✅ Actively supported |
| Beta pre-releases (`staging`) | ⚠️ Best-effort only   |
| Older releases                | ❌ Not supported      |

## Reporting a Vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.** Doing so discloses the vulnerability before a patch can be released.

### Preferred Channel — GitHub Private Vulnerability Reporting

Use GitHub's built-in private advisory system:

1. Go to the [Security Advisories](../../security/advisories/new) page of this repository.
2. Click **"Report a vulnerability"**.
3. Fill in the description, affected versions, and any proof-of-concept.

We monitor this channel continuously.

### Response SLA

| Step                           | Target                     |
| ------------------------------ | -------------------------- |
| Acknowledgement                | Within **48 hours**        |
| Triage and severity assessment | Within **5 business days** |
| Patch release (critical/high)  | Within **14 days**         |
| Patch release (medium/low)     | Within **30 days**         |
| Public disclosure              | After patch is released    |

### What to Include in Your Report

- A clear description of the vulnerability and its potential impact.
- Steps to reproduce or a proof-of-concept (PoC).
- The affected version(s) of DemoThat.
- Any proposed mitigation or patch, if available.

### Scope

The following are **in scope** for security reports:

- DemoThat Electron application (main process, preload, renderer)
- Cloud API integration (`contract/openapi.yaml`, API client code)
- Build pipeline and release workflow security

The following are **out of scope**:

- Vulnerabilities in third-party `node_modules` dependencies (please report those upstream)
- Issues requiring physical access to the user's machine
- Social engineering attacks

## Security-Related Configuration

DemoThat uses `pull_request_target` in its CLA workflow. This event has elevated permissions.
The CLA workflow is strictly isolated and does **not** check out or execute untrusted contributor code.

## Thank You

We appreciate responsible disclosure and are committed to working with security researchers to protect our users. Reporters of valid vulnerabilities will be credited in the release notes unless they prefer to remain anonymous.
