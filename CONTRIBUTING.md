# Contributing to DemoThat

First off, thank you for considering contributing to **DemoThat**! Open-source communities thrive on collaboration, and we appreciate your time and effort in making DemoThat an exceptional screen recording and demo creation tool.

---

## Table of Contents

1. [Code of Conduct](#code-of-conduct)
2. [Prerequisites & Development Setup](#prerequisites--development-setup)
3. [Branch Model — STRICT](#branch-model--strict)
4. [Contribution Workflow](#contribution-workflow)
5. [Mandatory 7-Step Local Verification](#mandatory-7-step-local-verification)
6. [Commit Message Guidelines](#commit-message-guidelines)
7. [Architecture & Design Guardrails](#architecture--design-guardrails)
8. [Contributor License Agreement (CLA)](#contributor-license-agreement-cla)
9. [Reporting Issues & Requesting Features](#reporting-issues--requesting-features)
10. [Security Disclosures](#security-disclosures)
11. [Release Automation](#release-automation)

---

## Code of Conduct

DemoThat follows the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md) (v2.1). By participating in this project, you agree to abide by its terms to foster a welcoming, diverse, and harassment-free community.

Please report any unacceptable behavior confidentially via a [Security Advisory](../../security/advisories/new) or by reaching out to [@getwithashish](https://github.com/getwithashish).

---

## Prerequisites & Development Setup

### 1. Node.js & Package Manager

- **Node.js 22** is required (the project engine specifies `>=18 <=22`).
  > **Note:** Do **not** use Node.js 24, as the postinstall script (`electron-builder install-app-deps`) currently fails on Node 24.
- **npm** is the designated package manager (`package-lock.json` is committed).

### 2. Native Build Tools

DemoThat relies on native modules for screen recording and input capture:

- **Linux:** Requires X11 and Wayland libraries. For Wayland capture, ensure `xdg-desktop-portal` and PipeWire are installed.
- **macOS:** Requires Xcode Command Line Tools and Python 3.8+ on your `PATH`.
- **Windows:** Requires [Visual Studio 2022 Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) (with the "Desktop development with C++" workload) and Python 3.8+ on your `PATH`.

### 3. FFmpeg Binaries

FFmpeg is downloaded separately into the `binaries/<os>/` directory (refer to the [README.md](README.md#install) for direct download links for your OS).

---

## Branch Model — STRICT

DemoThat maintains two permanent, protected branches:

| Branch    | Purpose                                                | Release Type                              |
| --------- | ------------------------------------------------------ | ----------------------------------------- |
| `main`    | Stable, production-ready releases                      | Stable releases (e.g. `v1.20.0`)          |
| `staging` | Integration branch for new features, fixes, and chores | Beta pre-releases (e.g. `v1.20.1-beta.1`) |

### Critical Branching Rules

- **ALL feature, bug-fix, chore, and docs branches MUST branch off and target `staging`.**
- **NEVER** open a pull request targeting `main`. PRs targeting `main` will be closed.
- **`main` only receives promotion merges from `staging`**, executed by project maintainers when a beta release is validated.
- Remote topic branches are deleted immediately after merging into `staging` to prevent stale branches.

### Branch Hierarchy

```
main  ← only staging merges here (stable release promotion)
  └── staging  ← all feature, fix, chore, docs PRs merge here (beta pre-releases)
        ├── feat/<short-description>
        ├── fix/<short-description>
        ├── chore/<short-description>
        ├── docs/<short-description>
        └── perf/<short-description>
```

---

## Contribution Workflow

### 1. Fork and Clone

1. Fork the repository to your GitHub account.
2. Clone your personal fork locally:
   ```bash
   git clone https://github.com/<your-username>/demothat.git
   cd demothat
   ```
3. Add the upstream repository as a remote:
   ```bash
   git remote add upstream https://github.com/getwithashish/demothat.git
   ```

### 2. Create a Topic Branch

Always ensure your local `staging` branch is up to date, then branch off `staging`:

```bash
git checkout staging
git pull upstream staging
git checkout -b feat/your-feature-name    # or fix/, chore/, docs/, perf/
```

### 3. Install Dependencies & Develop

```bash
npm install
npm run dev      # Launches Vite dev server with Hot Module Replacement and Electron
```

### 4. Running Tests During Development

You can run the full test suite or execute targeted tests:

```bash
npm test                                   # Run full test suite (Vitest)
npx vitest run path/to/specific.test.ts    # Run a single test file
npx vitest --watch                         # Interactive watch mode
```

---

## Mandatory 7-Step Local Verification

Before committing and pushing your code, you **must** execute the full 7-step local verification pipeline. This mirrors CI (`checks.yml`) and guarantees that your PR will pass automated checks:

```bash
# 1. Verify OpenAPI contract version consistency
npm run contract:check

# 2. Check code formatting with Prettier (run `npm run format` to auto-fix)
npm run format:check

# 3. Lint with ESLint (must have 0 errors and 0 warnings)
npm run lint

# 4. TypeScript type checking (no implicit any, strict checks)
npx tsc --noEmit

# 5. Full unit and integration test suite
npm test

# 6. Verify generated contract API types are synchronized
npm run contract:types
git diff --exit-code -- shared/api-types.ts

# 7. Verify production Vite build succeeds
npx vite build --mode development
```

---

## Commit Message Guidelines

All commit messages MUST follow the [Conventional Commits v1.0.0](https://www.conventionalcommits.org/en/v1.0.0/) specification. Semantic-release uses these commit prefixes to calculate version numbers and generate changelogs automatically:

| Commit Prefix                           | Release Impact                | Description                                                         |
| --------------------------------------- | ----------------------------- | ------------------------------------------------------------------- |
| `feat:`                                 | **MINOR** (`1.19.0 → 1.20.0`) | A new user-facing feature or enhancement                            |
| `fix:`                                  | **PATCH** (`1.19.0 → 1.19.1`) | A bug fix or corrective behavior                                    |
| `perf:`                                 | **PATCH** (`1.19.0 → 1.19.1`) | A code change that improves performance                             |
| `BREAKING CHANGE:` (footer)             | **MAJOR** (`1.19.0 → 2.0.0`)  | Breaking API or UX change                                           |
| `chore:`, `docs:`, `test:`, `refactor:` | None (no release cut)         | Maintenance, documentation, test additions, or internal refactoring |

### Commit Rules

- Format: `type(scope): imperative summary` (e.g., `feat(editor): add zoom-level slider in timeline toolbar`).
- Use lowercase prefixes and imperative present tense ("add", not "added" or "adds").
- Do not end the subject line with a period.
- Keep the first line under 72 characters.

---

## Architecture & Design Guardrails

To keep DemoThat maintainable and robust, all contributions must respect the following architectural constraints:

### 1. Process Isolation Boundaries

```
demothat/
├── electron/
│   ├── main/       # Main process (Node.js runtime, native APIs, FFmpeg)
│   └── preload.ts  # Context bridge (window.electronAPI)
├── shared/         # Shared code (API types, math, tokens) - imported by both
└── src/            # Renderer process (React 18 UI, Chromium)
```

- **Strict Isolation:** Code in `electron/main/` must **NEVER** import from `src/`. Shared types, math, and constants belong in `shared/`.

### 2. Strict Design Token Usage

- **Semantic Tokens Only:** All styling must consume design tokens defined in [`src/styles/tokens.css`](src/styles/tokens.css) via Tailwind utility classes (e.g. `bg-panel`, `bg-ctl`, `text-fg`, `text-muted`, `border-line`).
- **Zero Color Literals:** Do **not** use `#hex`, `rgb()`, or `rgba()` literals in UI `.tsx`/`.ts` files. Automated tests in `src/styles/style-guardrails.test.ts` enforce this in CI.
- **Font Size Floor:** Do not use font sizes smaller than `11px` (e.g. `text-[10px]` is forbidden; use `text-xs` or `text-[11px]`).
- **Dual-Theme Support:** Ensure UI components look clean and accessible in both Dark (`[data-theme='dark']`) and Light (`[data-theme='light']`) modes.

### 3. Assistant Mascot & Branding

- Never use generic AI or sparkle icons (`✨`, `Wand`, `Sparkles`) for the AI assistant.
- Use the official mascot icon at [`public/demothat-mascot-ed-neutral.svg`](public/demothat-mascot-ed-neutral.svg).
- Refer to the assistant as **Ed** or **Assistant**.

### 4. Cross-Platform Modifier Keys

- Dynamically detect modifier keys: render `⌘` on macOS (`darwin`) and `Ctrl` on Windows and Linux.

---

## Contributor License Agreement (CLA)

All contributors must agree to the [DemoThat Contributor License Agreement (CLA)](CLA.md) before contributions can be merged. The CLA clarifies intellectual property licenses, protects the project under the GNU General Public License v3.0, and confirms adherence to project standards.

Signing is a simple **two-step process**:

1. **Check the CLA box** in the Pull Request checklist (declaration of intent).
2. **Post this exact comment** on your open Pull Request:
   ```
   I have read the CLA Document and I hereby sign the CLA
   ```

The automated CLA Assistant bot will record your signature in `.github/cla-signatures.json` and mark the `license/cla` status check as passing.

### Corporate CLA (CCLA)

If you are contributing on behalf of your employer, please review Section 8 of [CLA.md](CLA.md) and open an issue labeled `ccla` to execute a Corporate CLA.

---

## Reporting Issues & Requesting Features

### Reporting Bugs

- Search existing issues to ensure the bug hasn't already been reported.
- Open a new issue using the **Bug Report** template.
- Include your operating system, desktop environment (X11 or Wayland on Linux), DemoThat version, exact reproduction steps, and any console/terminal logs.

### Suggesting Enhancements

- Open a new issue using the **Feature Request** template.
- Describe the problem you are solving, your proposed solution, and alternative ideas considered.

---

## Security Disclosures

Please **do not** report security vulnerabilities via public GitHub issues. Follow the confidential disclosure procedure documented in [SECURITY.md](SECURITY.md) via [GitHub Security Advisories](../../security/advisories/new).

---

## Release Automation

- **Merging into `staging`** triggers [`.github/workflows/release.yml`](.github/workflows/release.yml), which evaluates commit messages and publishes a **beta pre-release** (e.g. `v1.20.1-beta.1`) with platform installers attached.
- **Promoting `staging` into `main`** creates the **stable production release** (e.g. `v1.20.0`), updates `CHANGELOG.md`, and marks the release as Latest on GitHub.
- You do **not** need to manually update `version` in `package.json` or edit `CHANGELOG.md`; semantic-release handles all versioning automatically.

Thank you for contributing to DemoThat!
