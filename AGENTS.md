Use the codegraph MCP to find the files and know the context

---

# Agent Rules & Workflow Reference

## 1. Codebase Exploration

Always use the **codegraph MCP** to find files and understand context before making any changes.

---

## 2. Branch Model — STRICT

This repository has two permanent protected branches:

| Branch    | Purpose                        | Releases           |
|-----------|--------------------------------|--------------------|
| `main`    | Stable, production-ready code  | Stable (e.g. `v1.2.0`) |
| `staging` | Beta / pre-release integration | Beta pre-release (e.g. `v1.2.0-beta.1`) |

### Rules — do NOT violate these:

- **NEVER push commits directly to `main` or `staging`.** All changes must arrive via Pull Request.
- **Feature branches MUST be branched off `staging`**, not `main`.
- **Feature PRs MUST target `staging`**, not `main`.
- **The only branch that may open a PR into `main` is `staging`** — this is the promotion step from beta to stable.
- `main` must ONLY receive merges from `staging`. It is never a direct target for feature or fix branches.

### Branch hierarchy (strictly follow this order):

```
main  ← only staging merges here (stable promotion)
  └── staging  ← feature/fix/chore branches merge here (beta releases)
        ├── feat/<name>
        ├── fix/<name>
        ├── chore/<name>
        └── docs/<name>
```

---

## 3. Branching Workflow — Step by Step

### Starting new work

```bash
git checkout staging
git pull origin staging
git checkout -b feat/<short-description>   # or fix/, chore/, docs/
```

### Opening a PR

- **Base branch:** `staging`
- Run checks locally before opening: `npm run lint && npm run format:check && npx tsc --noEmit && npm test`
- Use [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) for all commit messages (see Section 4).

### Promoting beta → stable

When `staging` has been validated:

1. Open a PR from `staging` → `main`.
2. Merge it.
3. The release workflow auto-publishes a stable release.

---

## 4. Commit Message Format — STRICT

All commits MUST follow [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/).
Semantic-release reads these to determine the version bump automatically.

| Commit prefix | Version bump | Example |
|---|---|---|
| `feat:` | minor (`1.1.0 → 1.2.0`) | `feat: add export to MP4` |
| `fix:` | patch (`1.1.0 → 1.1.1`) | `fix: resolve blank frame on Wayland` |
| `perf:` | patch | `perf: reduce FFmpeg startup time` |
| `BREAKING CHANGE:` in footer | major (`1.1.0 → 2.0.0`) | footer line: `BREAKING CHANGE: removed legacy API` |
| `chore:`, `docs:`, `test:`, `refactor:` | no release | `chore: update dependencies` |

Do NOT use free-form commit messages. They will not trigger a release and will pollute the changelog.

---

## 5. Release Pipeline — How It Works

### On merge to `staging`

1. GitHub Actions `release.yml` triggers.
2. Semantic-release computes the next **pre-release** version (e.g. `v1.2.0-beta.1`).
3. A GitHub Release is created tagged `v1.2.0-beta.1`, flagged as **Pre-release** (not Latest).
4. Platform binaries (Linux, Windows, macOS) are built and attached to the pre-release.

### On merge to `main`

1. GitHub Actions `release.yml` triggers.
2. Semantic-release computes the next **stable** version (e.g. `v1.2.0`).
3. A GitHub Release is created tagged `v1.2.0`, flagged as **Latest**.
4. Platform binaries are built and attached to the stable release.
5. `CHANGELOG.md` and `package.json` version are committed back automatically with `[skip ci]`.

### Key config files

| File | Purpose |
|---|---|
| `.releaserc.json` | Semantic-release config: branches, plugins, rules |
| `.github/workflows/release.yml` | Triggers on `main` and `staging`; runs semantic-release then builds |
| `.github/workflows/checks.yml` | Lint, typecheck, tests — runs on all PRs and pushes to `main`/`staging` |

---

## 6. What Agents Must NOT Do

- Do not push directly to `main` or `staging`.
- Do not open PRs from a feature branch targeting `main`.
- Do not create release tags manually — semantic-release owns all tags.
- Do not modify `CHANGELOG.md` or bump `version` in `package.json` manually — semantic-release owns these.
- Do not bypass CI checks.
