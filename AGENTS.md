# Agent Rules & Contribution Standards (`AGENTS.md`)

Use the codegraph MCP to find files and understand context before making any changes.

This document defines the strict branch model, contribution workflow, commit standards, architecture boundaries, and mandatory verification pipeline for all automated and pair-programming AI agents working in this repository.

---

## 1. Codebase Exploration

Always use the **codegraph MCP** to find files, locate symbol definitions, and understand dependencies before making any modifications.

---

## 2. Branch Model — STRICT

This repository has two permanent protected branches:

| Branch    | Purpose                        | Releases                                  |
| --------- | ------------------------------ | ----------------------------------------- |
| `main`    | Stable, production-ready code  | Stable releases (e.g. `v1.20.0`)          |
| `staging` | Beta / pre-release integration | Beta pre-releases (e.g. `v1.20.1-beta.1`) |

### Rules — do NOT violate these:

- **NEVER push commits or merge directly into `main` or `staging`.** All changes must arrive exclusively via Pull Request on GitHub. Even if instructed to merge, never run a local git merge into `staging` or `main` and push; the merge must happen through the GitHub PR.
- **Feature and bug-fix branches MUST branch off `staging`**, not `main`.
- **Feature and bug-fix PRs MUST target `staging`**, not `main`.
- **Delete remote feature branches immediately after merging:** Once a PR into `staging` is merged, the remote topic branch must be deleted immediately to prevent stale branches from accumulating.
- **The only branch that may open a PR into `main` is `staging`** — this is the promotion step from beta to stable, executed by human maintainers.
- `main` must ONLY receive merges from `staging`. It is never a direct target for individual feature, fix, or chore branches.

### Branch hierarchy (strictly follow this order):

```
main  ← only staging merges here (stable promotion)
  └── staging  ← all feature, fix, chore, docs branches merge here (beta releases)
        ├── feat/<name>
        ├── fix/<name>
        ├── chore/<name>
        └── docs/<name>
```

---

## 3. Branching Workflow — Step by Step

### 3.1 Starting new work

Always sync and branch off `staging`:

```bash
git checkout staging
git pull origin staging
git checkout -b feat/<short-description>   # or fix/, chore/, docs/, perf/
```

### 3.2 Opening a Pull Request

- **Base branch:** `staging`
- Run the full verification pipeline locally before opening a PR (see Section 8).
- Use [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) for all commit messages.
- Fill out the PR template in [`.github/PULL_REQUEST_TEMPLATE.md`](file:///home/ashish/Empire/demothat_WS/demothat/.github/PULL_REQUEST_TEMPLATE.md).
- **Use the GitHub CLI (`gh`) to open the PR:**
  ```bash
  gh pr create --base staging --head feat/<short-description> --title "feat(scope): imperative summary" --body-file .github/PULL_REQUEST_TEMPLATE.md
  # Or with inline body:
  # gh pr create --base staging --head feat/<short-description> --title "feat(scope): summary" --body "Detailed description..."
  ```

### 3.3 Merging the PR & Remote Branch Cleanup — MANDATORY

Once the PR into `staging` is approved and all CI checks in `checks.yml` pass:

1. **Verify CI checks via GitHub CLI:**
   ```bash
   gh pr checks
   ```
2. **Merge the PR and delete the remote branch in one step:**
   ```bash
   gh pr merge --merge --delete-branch
   # Or using squash if single commit desired:
   # gh pr merge --squash --delete-branch
   ```
   **NEVER bypass this with a direct local merge and push to `staging`.**
3. **Clean up locally:**
   ```bash
   git checkout staging
   git pull origin staging
   git branch -d feat/<short-description>
   git remote prune origin
   ```
   This guarantees that no stale, dangling branches remain on the remote repository.

### 3.4 Promoting beta → stable

When changes in `staging` have been validated in pre-release builds:

1. A Pull Request is opened from `staging` → `main`:
   ```bash
   gh pr create --base main --head staging --title "chore(release): promote staging to main" --body "Promoting validated beta release from staging to main."
   ```
2. Once CI passes, merge it into `main`:
   ```bash
   gh pr merge --merge
   ```
3. When merged into `main`, GitHub Actions automatically tags and publishes the stable release.

---

## 4. Commit Message Format — STRICT

All commits MUST follow [Conventional Commits v1.0.0](https://www.conventionalcommits.org/en/v1.0.0/).
Semantic-release reads these commit prefixes to determine version bumping and changelog generation automatically.

| Commit prefix                           | Release Impact        | Version Bump Example | Usage Guideline                               |
| --------------------------------------- | --------------------- | -------------------- | --------------------------------------------- |
| `feat:`                                 | **MINOR**             | `1.19.0 → 1.20.0`    | User-facing feature or enhancement            |
| `fix:`                                  | **PATCH**             | `1.19.0 → 1.19.1`    | Bug fix or corrective behavior                |
| `perf:`                                 | **PATCH**             | `1.19.0 → 1.19.1`    | Performance optimization                      |
| `BREAKING CHANGE:` in footer            | **MAJOR**             | `1.19.0 → 2.0.0`     | Breaking API or major breaking UX change      |
| `chore:`, `docs:`, `test:`, `refactor:` | None (no release cut) | —                    | Tooling, documentation, tests, or refactoring |

### Commit message rules:

- Format: `type(optional-scope): imperative summary` (e.g. `feat(ed): add live step progress in action card`).
- Use lowercase prefixes and imperative present tense ("add", not "added" or "adds").
- Do not end the subject line with a period.
- Keep the first line under 72 characters.
- Do NOT use free-form commit messages; they will pollute the changelog and fail release automation.

---

## 5. Release Pipeline & GitHub Actions Alignment

The repository's release cycle is managed entirely through GitHub Actions:

### 5.1 On merge to `staging`

1. GitHub Actions [`.github/workflows/release.yml`](file:///home/ashish/Empire/demothat_WS/demothat/.github/workflows/release.yml) triggers on push to `staging`.
2. Semantic-release evaluates commit messages since the last release and creates a **pre-release** version (e.g. `v1.20.1-beta.1`).
3. A GitHub Release is created tagged `v1.20.1-beta.1` and flagged as **Pre-release** (not Latest).
4. Cross-platform binaries (Linux AppImage/deb/rpm, Windows `.exe`, macOS `.dmg`) are compiled and uploaded to the beta release.

### 5.2 On merge to `main`

1. GitHub Actions [`.github/workflows/release.yml`](file:///home/ashish/Empire/demothat_WS/demothat/.github/workflows/release.yml) triggers on push to `main`.
2. Semantic-release computes the next **stable** version (e.g. `v1.20.0`).
3. A GitHub Release is created tagged `v1.20.0` and marked as **Latest**.
4. Cross-platform release binaries are compiled and attached.
5. `CHANGELOG.md` and `package.json` version are updated and committed back automatically with `[skip ci]`.

### 5.3 On every Pull Request

- [`.github/workflows/checks.yml`](file:///home/ashish/Empire/demothat_WS/demothat/.github/workflows/checks.yml) runs across all PRs.
- Validates contract pinning, ESLint, Prettier formatting, TypeScript compilation, Vitest tests, and generated contract types.

---

## 6. Core Engineering Principles — MANDATORY

All agents MUST strictly follow **SOLID**, **DRY**, and **KISS** principles at all costs to guarantee that the application remains robust, working, and easily extensible at all times:

### 6.1 SOLID Principles

- **S — Single Responsibility Principle (SRP):** Every function, React component, custom hook, and Zustand slice must have one clear, well-defined responsibility. Never conflate UI rendering, data fetching/IPC, and business logic into monolithic files.
- **O — Open/Closed Principle (OCP):** Systems must be open for extension, but closed for modification. Design extensible architectures using registries, strategy patterns, and pluggable dispatchers (such as [`src/features/ed/actions/registry.ts`](file:///home/ashish/Empire/demothat_WS/demothat/src/features/ed/actions/registry.ts)) so new capabilities can be introduced without rewriting or risking breakage in existing, tested modules.
- **L — Liskov Substitution Principle (LSP):** Subtypes, custom tool handlers, and component variants must honor the contracts of their base types without altering expected behavior or introducing unexpected side effects.
- **I — Interface Segregation Principle (ISP):** Avoid large, bloated interfaces. Split state selectors, component props, and API interfaces into focused, cohesive contracts so consumers only depend on what they actually use.
- **D — Dependency Inversion Principle (DIP):** High-level modules must depend on abstractions and shared contracts, not concrete low-level implementations. Shared types, models, and interfaces belong in `shared/` to maintain clean decoupling across process boundaries.

### 6.2 DRY (Don't Repeat Yourself)

- Maintain a **single source of truth** for all domain constants, styling tokens, timecode math, IPC event channels, and resolution mappings.
- Never duplicate coordinate math, FFmpeg argument builders, or state transformations across files. Centralize pure utilities in `shared/` or `src/lib/`.

### 6.3 KISS (Keep It Simple, Stupid)

- Always favor the simplest, most readable, and idiomatic TypeScript solution that completely satisfies the requirements.
- Avoid premature optimizations, convoluted inheritance hierarchies, or unnecessary third-party dependencies when native React/TypeScript primitives suffice.
- Code should be clean, self-documenting, and effortless for both human maintainers and subsequent AI agents to read, debug, and extend.

---

## 7. Architecture & Code Guardrails

### 7.1 Process Isolation Boundaries

```
demothat/
├── electron/
│   ├── main/       # Main process (Node.js runtime, native APIs, FFmpeg)
│   └── preload.ts  # Context bridge (window.electronAPI)
├── shared/         # Shared code (API types, math, tokens) - imported by both
└── src/            # Renderer process (React 18 UI, Chromium)
```

> [!CRITICAL]
> **Process Isolation Rule:** Main-process code (`electron/main/`) must NEVER import code from the renderer process (`src/`). Shared types, math, and constants must live in `shared/`.

### 7.2 Strict Design Token Usage

- **Semantic Tokens Only:** All styling must consume design tokens from [`src/styles/tokens.css`](file:///home/ashish/Empire/demothat_WS/demothat/src/styles/tokens.css) via Tailwind utility classes (`bg-panel`, `bg-ctl`, `text-fg`, `text-muted`, `border-line`, etc.).
- **Zero Color Literals:** Do NOT introduce `#hex`, `rgb()`, or `rgba()` literals in UI `.tsx`/`.ts` files. Automated tests in `src/styles/style-guardrails.test.ts` enforce this in CI.
- **Font Size Floor:** Do NOT use font sizes smaller than `11px`. Classes like `text-[10px]` or `text-[9px]` are strictly prohibited by style guardrails. Use `text-[11px]` or `text-xs`.
- **Both Themes Supported:** Test and support both Dark (`[data-theme='dark']`) and Light (`[data-theme='light']`) modes.

### 7.3 Mascot & Brand Identity

- **Never use generic AI / sparkle icons (`✨`, `Wand`, `Sparkles`)** for the assistant.
- Use the official mascot icon at [`public/demothat-mascot-ed-neutral.svg`](file:///home/ashish/Empire/demothat_WS/demothat/public/demothat-mascot-ed-neutral.svg).
- Refer to the assistant professionally as **Ed** or **Assistant**.

### 7.4 Platform Portability

- DemoThat targets Linux, Windows, and macOS.
- Dynamically detect modifier keys: render `⌘` for macOS (`darwin`) and `Ctrl` for Linux/Windows.

### 7.5 OpenAPI Contract Synchronization

- Cloud backend APIs are pinned in [`contract/openapi.yaml`](file:///home/ashish/Empire/demothat_WS/demothat/contract/openapi.yaml).
- The version in `package.json` under `demothat.contractVersion` must match `openapi.yaml`.
- Whenever modifying the contract, run `npm run contract:types` and ensure [`shared/api-types.ts`](file:///home/ashish/Empire/demothat_WS/demothat/shared/api-types.ts) is committed.

---

## 8. Mandatory Verification Before Pushing / Merging — STRICT

Every agent MUST execute the 7-step local verification pipeline before committing or pushing changes:

```bash
# 1. Verify contract version consistency
npm run contract:check

# 2. Check code formatting
npm run format:check
# (Run `npm run format` if any files need re-formatting)

# 3. Run ESLint (must have 0 errors and 0 warnings)
npm run lint

# 4. Verify TypeScript types
npx tsc --noEmit

# 5. Run the full unit and integration test suite
npm test

# 6. Verify generated contract types are synchronized
npm run contract:types
git diff --exit-code -- shared/api-types.ts

# 7. Verify production build succeeds
npx vite build --mode development
```

---

## 9. What Agents Must NOT Do

- **NEVER** push commits or perform direct local merges into `main` or `staging`. ALL code must arrive via Pull Request.
- **NEVER** open PRs from a feature/fix branch targeting `main`. Target `staging`.
- **NEVER** leave merged feature/fix branches lingering on `origin` — always delete the remote branch immediately after merging the PR.
- **NEVER** create release git tags manually — semantic-release manages all tags.
- **NEVER** modify `CHANGELOG.md` or bump `version` in `package.json` manually — semantic-release manages these during release.
- **NEVER** introduce raw color literals in component code outside `tokens.css`.
- **NEVER** suppress warnings or errors with `@ts-ignore` or `eslint-disable` without documented technical justification.
- **NEVER** push or merge without running and passing all checks locally.
