# Contract (vendored)

`demothat-api` **owns** the app → API contract. This folder is a pinned copy of it.

| File           | What it is                                                                                              |
| -------------- | ------------------------------------------------------------------------------------------------------- |
| `openapi.yaml` | The app → API contract: every endpoint, request body, response and error the app is allowed to rely on. |
| `VERSION`      | The version of the copy vendored here.                                                                  |

**Do not edit these files.** A change made here is lost on the next re-vendor, and it
is invisible to the API repo. Propose the change in `demothat-api` first, then re-pin.

## The pin

`package.json` declares the version this repo targets:

```json
"demothat": { "contractVersion": "2.0.0" }
```

`npm run contract:check` fails when the declaration, `contract/VERSION` and the
`# CONTRACT VERSION:` header inside `openapi.yaml` disagree. CI runs it, so a
_partial_ re-vendor — new `openapi.yaml`, stale declaration — cannot land.

## Re-pinning to a new contract version

```bash
# 1. Take the owner's file, and its version.
cp <demothat-api>/contract/openapi.yaml contract/openapi.yaml
cp <demothat-api>/contract/VERSION contract/VERSION

# 2. Point the declaration at it.
#    package.json -> demothat.contractVersion

# 3. Regenerate the types, and commit them with the rest.
npm run contract:types

# 4. Everything must agree.
npm run contract:check && npm run lint && npx tsc --noEmit && npm test
```

Then read the API's changelog / `contract/openapi.yaml` diff for anything that
affects the app, because a version bump does not mean _your_ endpoints changed — and
it also does not mean they did not.

## Generated types

`shared/api-types.ts` is generated from `openapi.yaml` by `npm run contract:types`
(`openapi-typescript`). It is committed, ignored by lint and format, and CI fails if
it is out of date with the pinned contract. Import the shapes from there rather than
hand-writing them:

```ts
import type { paths } from '../shared/api-types'

type JobView = paths['/v1/jobs/{jobId}']['get']['responses']['200']['content']['application/json']
```

## Where the related contracts live

- **App → API:** `openapi.yaml` (this folder).
- **API → worker:** `demothat-api`'s `contract/worker-protocol.md` + `contract/schemas/`.
  `demothat-worker` vendors that one; this repo never talks to the worker directly.
