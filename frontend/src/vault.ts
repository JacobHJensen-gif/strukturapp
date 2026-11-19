import { openDB, type DBSchema } from 'idb'
import type { Session, UnlockedSession } from './types'
import { hasSecureData, migrateLegacy, verifySecureData } from './storage'
import { deriveKey, encode, seal, unseal, type Sealed } from './crypto'

type VaultRecord = { id: string; salt: string; session: Sealed }

interface VaultDB extends DBSchema {
  vaults: { key: string; value: VaultRecord }
  aliases: { key: string; value: { id: string; target: string } }
}

const encoder = new TextEncoder()

async function vaultId(username: string): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(username.trim().toLowerCase())))
  return encode(hash)
}

function vaultDb() {
  return openDB<VaultDB>('hverdagsro-vaults', 2, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('vaults')) db.createObjectStore('vaults', { keyPath: 'id' })
      if (!db.objectStoreNames.contains('aliases')) db.createObjectStore('aliases', { keyPath: 'id' })
    },
  })
}

async function readVault(username: string, password: string): Promise<{ record: VaultRecord; session: Session; key: CryptoKey }> {
  const aliasId = await vaultId(username)
  const db = await vaultDb()
  const id = (await db.get('aliases', aliasId))?.target ?? aliasId
  const record = await db.get('vaults', id)
  db.close()
  if (!record) throw new Error('Offlineadgang kræver et tidligere online-login på denne enhed.')
  const key = await deriveKey(password, record.salt)
  let session: Session
  try {
    session = await unseal<Session>(key, `session:${id}`, record.session)
  } catch {
    throw new Error('Adgangskoden kunne ikke låse de lokale data op.')
  }
  return { record, session, key }
}

export async function unlockOffline(username: string, password: string): Promise<UnlockedSession> {
  const { session, key } = await readVault(username, password)
  const unlocked = { ...session, key }
  await migrateLegacy(unlocked)
  await verifySecureData(unlocked)
  localStorage.removeItem('hverdagsro-session')
  return unlocked
}

export async function unlockOnline(username: string, password: string, session: Session): Promise<UnlockedSession> {
  const id = await vaultId(session.username)
  const aliasId = await vaultId(username)
  const db = await vaultDb()
  let record = await db.get('vaults', id)
  db.close()
  let key: CryptoKey
  if (record) {
    const saved = await readVault(session.username, password)
    if (saved.session.user_id !== session.user_id) {
      throw new Error('Lokale data tilhører en anden konto. Kontakt administratoren.')
    }
    key = saved.key
  } else {
    if (await hasSecureData(session.user_id)) {
      throw new Error('Nøglen til eksisterende lokale data mangler. Ingen lokale data er slettet; kontakt administratoren.')
    }
    const salt = encode(crypto.getRandomValues(new Uint8Array(16)))
    key = await deriveKey(password, salt)
    record = { id, salt, session: await seal(key, `session:${id}`, session) }
    const freshDb = await vaultDb()
    try { await freshDb.add('vaults', record) } finally { freshDb.close() }
  }
  const unlocked = { ...session, key }
  await migrateLegacy(unlocked)
  await verifySecureData(unlocked)
  record = { ...record, session: await seal(key, `session:${id}`, session) }
  const updateDb = await vaultDb()
  try {
    const tx = updateDb.transaction(['vaults', 'aliases'], 'readwrite')
    const alias = await tx.objectStore('aliases').get(aliasId)
    if (alias && alias.target !== id) {
      await tx.done
      throw new Error('Brugernavnet er allerede knyttet til andre lokale data.')
    }
    try {
      await tx.objectStore('vaults').put(record)
      await tx.objectStore('aliases').put({ id: aliasId, target: id })
      await tx.done
    } catch (error) {
      try { tx.abort() } catch (abortError) {
        if (!(abortError instanceof DOMException && abortError.name === 'InvalidStateError')) throw abortError
      }
      await tx.done.catch(() => undefined)
      throw error
    }
  } finally { updateDb.close() }
  localStorage.removeItem('hverdagsro-session')
  return unlocked
}
