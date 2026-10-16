// Small encrypted key/value store backed by Electron `safeStorage`.
//
// The license key and the license token are credentials: they must not sit in
// `electron-store`'s plain JSON. Each value is encrypted with the OS keychain
// (`safeStorage.encryptString`) and the ciphertext is written to a file under
// `userData`. Only values, never raw credentials, are logged.
//
// When `safeStorage` is unavailable (some headless Linux setups with no keyring)
// the value is written unencrypted and a warning is logged, so development keeps
// working; the `enc` flag records which case a value is in.

import fs from 'node:fs'
import path from 'node:path'
import { app, safeStorage } from 'electron'
import log from 'electron-log/main'

interface StoredValue {
  v: 1
  enc: boolean
  data: string
}

type SecretsFile = Record<string, StoredValue>

function storePath(name: string): string {
  return path.join(app.getPath('userData'), `${name}.secrets.json`)
}

function readFile(name: string): SecretsFile {
  try {
    const raw = fs.readFileSync(storePath(name), 'utf8')
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return {}
    return parsed as SecretsFile
  } catch {
    // Missing or unreadable: treat as empty rather than crashing the app.
    return {}
  }
}

function writeFile(name: string, contents: SecretsFile): void {
  const dest = storePath(name)
  const tmp = `${dest}.tmp`
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.writeFileSync(tmp, JSON.stringify(contents), { mode: 0o600 })
  fs.renameSync(tmp, dest)
}

/** Reads one secret, or null when it is absent or cannot be decrypted. */
export function readSecret(name: string, key: string): string | null {
  const entry = readFile(name)[key]
  if (!entry || typeof entry.data !== 'string') return null
  if (!entry.enc) return entry.data
  if (!safeStorage.isEncryptionAvailable()) {
    log.warn(`[SecureStore] ${name}.${key} is encrypted but safeStorage is unavailable on this system.`)
    return null
  }
  try {
    return safeStorage.decryptString(Buffer.from(entry.data, 'base64'))
  } catch (error) {
    log.warn(`[SecureStore] Could not decrypt ${name}.${key}: ${(error as Error).message}`)
    return null
  }
}

/** Writes one secret, encrypting it when the platform keychain is available. */
export function writeSecret(name: string, key: string, value: string): void {
  const contents = readFile(name)
  if (safeStorage.isEncryptionAvailable()) {
    const encrypted = safeStorage.encryptString(value)
    contents[key] = { v: 1, enc: true, data: encrypted.toString('base64') }
  } else {
    log.warn(`[SecureStore] safeStorage is unavailable; storing ${name}.${key} unencrypted.`)
    contents[key] = { v: 1, enc: false, data: value }
  }
  writeFile(name, contents)
}

/** Removes one secret. */
export function deleteSecret(name: string, key: string): void {
  const contents = readFile(name)
  if (!(key in contents)) return
  delete contents[key]
  writeFile(name, contents)
}

/** Removes every secret in a store (used when the license is signed out). */
export function clearSecrets(name: string): void {
  try {
    fs.rmSync(storePath(name), { force: true })
  } catch {
    // Nothing to remove.
  }
}
