# DemoThat Contributor License Agreement (CLA)

Thank you for your interest in contributing to **DemoThat** ("DemoThat", "we", "us", or "our").

To clarify the intellectual property license granted with contributions, and to ensure that DemoThat remains free, open-source, compliant with our software license, and aligned with our engineering standards and rules, contributors must agree to this Contributor License Agreement ("Agreement" or "CLA").

By submitting a Pull Request, contributing code, or commenting on GitHub to sign this Agreement, you ("You" or "Contributor") accept and agree to the following terms and conditions.

---

## 1. Definitions

- **"Contribution"** means any source code, documentation, assets, scripts, test cases, issues, modifications, or other materials submitted by You to the DemoThat repository, project, or organization.
- **"Submit"** or **"Submission"** means any form of electronic, verbal, or written communication sent to the DemoThat project, including but not limited to GitHub Pull Requests, commit pushes, issue tracker comments, and email communications.
- **"Project License"** means the GNU General Public License v3.0 (GPL-3.0) as published by the Free Software Foundation and set forth in the repository's `LICENSE` file.
- **"Project Guidelines"** means the contribution guidelines, architecture boundaries, and rules outlined in `CONTRIBUTING.md`, `AGENTS.md`, and `CODE_OF_CONDUCT.md`.

---

## 2. Grant of Copyright License

You retain full copyright ownership of Your Contributions.

Subject to the terms and conditions of this Agreement, You hereby grant to the DemoThat project maintainers, successors, and users a perpetual, worldwide, non-exclusive, no-charge, royalty-free, irrevocable copyright license to:

- Reproduce, prepare derivative works of, publicly display, publicly perform, sublicense, and distribute Your Contributions and such derivative works.
- Incorporate Your Contributions into the DemoThat Electron application, libraries, binaries, installers, and associated services.
- Distribute Your Contributions under the Project License (GNU GPL-3.0) or any subsequent version or compatible license adopted by the project maintainers.

---

## 3. Grant of Patent License

Subject to the terms and conditions of this Agreement, You hereby grant to DemoThat and to recipients of software distributed by DemoThat a perpetual, worldwide, non-exclusive, no-charge, royalty-free, irrevocable patent license to make, have made, use, offer to sell, sell, import, and otherwise transfer the Work, where such license applies only to those patent claims licensable by You that are necessarily infringed by Your Contribution(s) alone or by combination of Your Contribution(s) with the Work to which such Contribution(s) was submitted.

---

## 4. Compliance with Rules, Guidelines, and License

By contributing to DemoThat, You explicitly agree that:

1. **Project License Adherence:** All Your code and contributions conform to the GNU General Public License v3.0 (`LICENSE`). You will not introduce third-party code that imposes conflicting, proprietary, or incompatible license terms.
2. **Engineering & Branching Standards:** You agree to follow the project's branching model, commit format, and verification guidelines documented in `AGENTS.md` and `CONTRIBUTING.md`:
   - Feature and fix branches must target `staging`. Direct commits to `main` and `staging` are strictly forbidden.
   - All commits must follow the [Conventional Commits v1.0.0](https://www.conventionalcommits.org/) specification.
   - All changes must pass the full local verification pipeline (`npm run contract:check`, `npm run format:check`, `npm run lint`, `npx tsc --noEmit`, `npm test`, and `npx vite build --mode development`).
   - Architectural boundaries (e.g., process isolation between Electron main and renderer, semantic tokens without raw color literals, font size floor of 11px) must be respected.
3. **Code of Conduct:** You will uphold a welcoming, professional, and harassment-free environment as specified in `CODE_OF_CONDUCT.md`.

---

## 5. Contributor Representations and Warranties

You represent and warrant that:

1. **Originality:** You are the sole creator of the Contribution and have the legal right to grant the rights and licenses set forth in this Agreement.
2. **No Infringement:** Your Contribution does not infringe upon any third party's copyright, patent, trademark, trade secret, or other intellectual property or proprietary rights.
3. **Employer Approval:** If Your employer has intellectual property rights in Your creations, You have received permission from Your employer to make the Contribution on their behalf, or Your employer has executed a Corporate CLA or waived such rights for Your Contribution.
4. **Notification of Changes:** Should You become aware of any inaccuracy in Your representations (such as third-party licensing obligations or patent disclosures), You agree to notify the DemoThat project maintainers promptly.

---

## 6. Disclaimer of Warranty

Except for the representations and warranties expressly stated in Section 5, Your Contribution is provided on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied, including, without limitation, any warranties or conditions of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A PARTICULAR PURPOSE.

---

## 7. How to Sign the CLA on GitHub

Contributors can sign and agree to this CLA through any of the following standard GitHub methods:

### Method A — GitHub Pull Request Checklist (Recommended)

When opening a Pull Request, confirm Your agreement by checking the CLA box in `.github/PULL_REQUEST_TEMPLATE.md`:

```markdown
- [x] I have read and agree to the DemoThat Contributor License Agreement (CLA).
```

### Method B — Pull Request Comment

Post a comment on Your open Pull Request with the following exact text:

```
I have read the CLA Document and I hereby sign the CLA
```

### Method C — Git Commit Sign-Off (DCO)

Sign off on Your git commits using `git commit -s`, which adds a `Signed-off-by:` trailer to Your commit message certifying adherence to this Agreement.

---

_Thank you for helping make DemoThat an exceptional open-source screen recording and editing tool!_
