// One-off helper: copy the deployment's license-token PUBLIC key into the app.
//
// The API keeps the keypair base64-encoded so it survives a single-line environment
// variable (`npm run keygen` in demothat-api); the app needs it as a PEM to hand to
// `importSPKI`. This decodes one to the other and writes it into the constant, without
// printing key material.
//
//   node scripts/set-license-public-key.mjs /path/to/demothat-api/.env
//
// Only the public half is ever read here. The private key stays where it belongs.

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const envPath = process.argv[2]
const target = join(ROOT, 'electron', 'main', 'lib', 'api-config.ts')

if (!envPath) {
  console.error('usage: node scripts/set-license-public-key.mjs <path to demothat-api/.env>')
  process.exit(1)
}

const env = readFileSync(envPath, 'utf8')
const match = /^JWT_PUBLIC_KEY=(.*)$/m.exec(env)
if (match === null || match[1].trim().length === 0) {
  console.error(`FAIL: no JWT_PUBLIC_KEY in ${envPath} (run \`npm run keygen\` in demothat-api)`)
  process.exit(1)
}

const pem = Buffer.from(match[1].trim().replace(/^"|"$/g, ''), 'base64').toString('utf8').trim()
if (!pem.includes('BEGIN PUBLIC KEY') || !pem.includes('END PUBLIC KEY')) {
  console.error('FAIL: JWT_PUBLIC_KEY does not decode to a PEM public key')
  process.exit(1)
}
if (pem.includes('PRIVATE')) {
  console.error('FAIL: that is a private key. Refusing to put it in the app bundle.')
  process.exit(1)
}

const source = readFileSync(target, 'utf8')
const pattern = /(export const LICENSE_TOKEN_PUBLIC_KEY_PEM = `)[\s\S]*?(`)/m
if (!pattern.test(source)) {
  console.error(`FAIL: could not find the LICENSE_TOKEN_PUBLIC_KEY_PEM constant in ${target}`)
  process.exit(1)
}

writeFileSync(target, source.replace(pattern, `$1${pem}$2`))
// Deliberately no key material in the output — just enough to see it worked.
console.log(`ok: embedded a ${pem.split('\n').length}-line SPKI public key (${pem.length} chars)`)
