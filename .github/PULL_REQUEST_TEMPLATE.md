## Description

Please provide a clear and concise description of what this Pull Request does.

## Related Issue

Fixes #[issue_number]

## Type of Change

- [ ] Bug fix (non-breaking change which fixes an issue)
- [ ] New feature (non-breaking change which adds functionality)
- [ ] Breaking change (fix or feature that would cause existing functionality to not work as expected)
- [ ] This change requires a documentation update

## Checklist

- [ ] I have read the [DemoThat Contributor License Agreement (CLA)](../CLA.md) and I agree to its terms.
      **To complete signing, post this exact comment on this PR:**
      `I have read the CLA Document and I hereby sign the CLA`
- [ ] My code follows the style guidelines of this project (semantic design tokens, no raw color literals,
      font size ≥ 11px).
- [ ] I have performed a self-review of my own code.
- [ ] I have commented my code, particularly in hard-to-understand areas.
- [ ] I have made corresponding changes to the documentation.
- [ ] My changes generate no new warnings.
- [ ] I have run the full 7-step local verification pipeline and all checks pass:
  - [ ] `npm run contract:check`
  - [ ] `npm run format:check`
  - [ ] `npm run lint`
  - [ ] `npx tsc --noEmit`
  - [ ] `npm test`
  - [ ] `npm run contract:types && git diff --exit-code -- shared/api-types.ts`
  - [ ] `npx vite build --mode development`
