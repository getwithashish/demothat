# Contributing to DemoThat

First off, thank you for considering contributing to DemoThat! It's people like you that make open source such a great community.

## How Can I Contribute?

- **Reporting Bugs:** If you find a bug, please open a new issue using the "Bug Report" template.
- **Suggesting Enhancements:** Have an idea for a new feature? Open an issue using the "Feature Request" template.
- **Pull Requests:** If you're ready to contribute code, please follow the workflow below.

## Your First Code Contribution

Unsure where to begin? You can start by looking through `good first issue` and `help wanted` issues.

## Branch Model

This project uses two permanent branches:

| Branch    | Purpose                                             |
| --------- | --------------------------------------------------- |
| `main`    | Stable releases — always production-ready           |
| `staging` | Beta pre-releases — integration branch for new work |

**All new work targets `staging`.** The `main` branch only receives merges from `staging` when a beta is ready to be promoted to a stable release.

## Contribution Workflow

1.  **Fork the repository:** Create your own copy of the project on GitHub.
2.  **Clone your fork:** `git clone https://github.com/getwithashish/DemoThat.git`
3.  **Branch off `staging`** — not `main`:
    ```bash
    git checkout staging
    git pull origin staging
    git checkout -b feat/your-amazing-feature   # or fix/, chore/, docs/
    ```
4.  **Install dependencies:** `npm install`
5.  **Make your changes:** Write your code and make sure it works by running the app locally (`npm run dev`).
6.  **Run checks locally before pushing:**
    ```bash
    npm run lint
    npm run format:check
    npx tsc --noEmit
    npm test
    ```
7.  **Commit your changes** using [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) — this drives automatic versioning and changelogs:
    - `feat: add webcam overlay feature` → triggers a minor release
    - `fix: correctly handle multi-monitor recording on Windows` → triggers a patch release
    - `docs: update README with installation instructions` → no release
    - `BREAKING CHANGE:` in the commit footer → triggers a major release
8.  **Push to your fork:** `git push origin feat/your-amazing-feature`
9.  **Open a Pull Request targeting `staging`** (not `main`). Fill out the PR template with as much detail as possible.

## Release Flow

- **Merging into `staging`** automatically creates a **beta pre-release** (e.g. `v1.2.0-beta.1`) with platform binaries attached. It is marked as Pre-release on GitHub, not Latest.
- **Merging `staging` into `main`** automatically creates a **stable release** (e.g. `v1.2.0`) marked as Latest. Only maintainers do this step once a beta is validated.

You do not need to create tags or update version numbers manually — the CI pipeline handles all of that.
