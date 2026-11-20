# Contributing to DemoThat

First off, thank you for considering contributing to DemoThat! It's people like you that make open source such
a great community.

## How Can I Contribute?

- **Reporting Bugs:** If you find a bug, please open a new issue using the "Bug Report" template.
- **Suggesting Enhancements:** Have an idea for a new feature? Open an issue using the "Feature Request"
  template.
- **Pull Requests:** If you're ready to contribute code, please follow the workflow below.

## Your First Code Contribution

Unsure where to begin? You can start by looking through `good first issue` and `help wanted` issues.

## Branch Model

This project uses two permanent branches:

| Branch    | Purpose                                             |
| --------- | --------------------------------------------------- |
| `main`    | Stable releases — always production-ready           |
| `staging` | Beta pre-releases — integration branch for new work |

**All new work targets `staging`.** The `main` branch only receives merges from `staging` when a beta is
ready to be promoted to a stable release.

## Contribution Workflow

1. **Fork the repository:** Create your own copy of the project on GitHub by clicking the "Fork" button on
   the repository page.

2. **Clone your fork:**

   ```bash
   git clone https://github.com/<your-github-username>/demothat.git
   cd demothat
   ```

3. **Branch off `staging`** — not `main`:

   ```bash
   git checkout staging
   git pull origin staging
   git checkout -b feat/your-amazing-feature   # or fix/, chore/, docs/
   ```

4. **Install dependencies:** `npm install`

5. **Make your changes:** Write your code and make sure it works by running the app locally (`npm run dev`).

6. **Run the full verification pipeline locally before pushing** (all 7 steps must pass — this mirrors CI
   exactly):

   ```bash
   # 1. Verify contract version consistency
   npm run contract:check

   # 2. Check code formatting (run `npm run format` to auto-fix)
   npm run format:check

   # 3. ESLint (must have 0 errors and 0 warnings)
   npm run lint

   # 4. TypeScript type checking
   npx tsc --noEmit

   # 5. Full unit and integration test suite
   npm test

   # 6. Verify generated contract types are synchronized
   npm run contract:types
   git diff --exit-code -- shared/api-types.ts

   # 7. Verify production build succeeds
   npx vite build --mode development
   ```

7. **Commit your changes** using [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) —
   this drives automatic versioning and changelogs:

   - `feat: add webcam overlay feature` → triggers a minor release
   - `fix: correctly handle multi-monitor recording on Windows` → triggers a patch release
   - `docs: update README with installation instructions` → no release
   - `BREAKING CHANGE:` in the commit footer → triggers a major release

8. **Push to your fork:** `git push origin feat/your-amazing-feature`

9. **Open a Pull Request** targeting `staging` (not `main`) and fill out the PR template with as much detail
   as possible.

## Contributor License Agreement (CLA)

DemoThat requires all contributors to sign our Contributor License Agreement before contributions can be
merged. The CLA clarifies IP grants, guarantees that code remains free and open-source under GNU GPL v3, and
confirms agreement to project guidelines and rules (`AGENTS.md`).

Signing is a **two-step process**:

1. **Check the CLA box** in the Pull Request checklist (declaration of intent).
2. **Post this exact comment** on your Pull Request to have your signature formally recorded:

   ```
   I have read the CLA Document and I hereby sign the CLA
   ```

The CLA Assistant bot will record your signature and update the `license/cla` status check to passing. Both
steps are required before your PR can be merged.

See [CLA.md](CLA.md) for the full text. If you are contributing on behalf of a company, see the
**Corporate CLA (CCLA)** section in `CLA.md`.

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md). By participating, you
are expected to uphold this code. Please report unacceptable behavior via
[GitHub Security Advisories](../../security/advisories/new).

## Security

To report a security vulnerability, please follow the process outlined in [SECURITY.md](SECURITY.md).
**Do not open a public issue for security vulnerabilities.**

## Release Flow

- **Merging into `staging`** automatically creates a **beta pre-release** (e.g. `v1.2.0-beta.1`) with
  platform binaries attached. It is marked as Pre-release on GitHub, not Latest.
- **Merging `staging` into `main`** automatically creates a **stable release** (e.g. `v1.2.0`) marked as
  Latest. Only maintainers do this step once a beta is validated.

You do not need to create tags or update version numbers manually — the CI pipeline handles all of that.
