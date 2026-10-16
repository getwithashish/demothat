#!/usr/bin/env node
/**
 * Contract drift check (CI).
 *
 * `demothat-api` owns the app -> API contract. This repo vendors a pinned copy in
 * `contract/` and declares the version it targets in package.json
 * (`demothat.contractVersion`). CI fails when those disagree.
 *
 * The declaration and the vendored copy are checked separately on purpose: a
 * *partial* re-vendor — dropping in a new `openapi.yaml` but forgetting to update
 * the declaration, or bumping one and not the other — is the mistake that a
 * single-file check cannot see.
 *
 * Mirrors demothat-worker/scripts/check_contract_version.py.
 */

import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** The version this repo declares it targets. */
function declaredVersion() {
  const text = readFileSync(join(ROOT, 'package.json'), 'utf8')
  const parsed = JSON.parse(text)
  const version = parsed?.demothat?.contractVersion
  if (typeof version !== 'string' || version.length === 0) {
    console.error('FAIL: package.json is missing demothat.contractVersion')
    process.exit(1)
  }
  return version
}

/** The version of the copy actually vendored in this repo. */
function vendoredVersion() {
  return readFileSync(join(ROOT, 'contract', 'VERSION'), 'utf8').trim()
}

/**
 * The version in the vendored file's own header, which is what a reader sees first.
 * A stale header means someone copied a file without looking at it.
 */
function headerVersion() {
  const text = readFileSync(join(ROOT, 'contract', 'openapi.yaml'), 'utf8')
  const match = /^# CONTRACT VERSION: (\S+)$/m.exec(text)
  if (match === null) {
    console.error('FAIL: contract/openapi.yaml has no "# CONTRACT VERSION: X" header')
    process.exit(1)
  }
  return match[1]
}

function main() {
  const declared = declaredVersion()
  const vendored = vendoredVersion()
  const header = headerVersion()

  if (declared !== vendored || declared !== header) {
    console.error('FAIL: contract version drift')
    console.error(`  package.json                  targets : ${declared}`)
    console.error(`  contract/VERSION              vendored: ${vendored}`)
    console.error(`  contract/openapi.yaml header  vendored: ${header}`)
    console.error('Re-vendor the pinned copy from demothat-api, or update the pin deliberately.')
    return 1
  }

  console.log(`ok: contract version ${declared} pinned and consistent`)
  return 0
}

process.exit(main())
