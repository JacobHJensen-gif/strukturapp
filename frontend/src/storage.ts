import { openDB, type DBSchema } from 'idb'
import { seal, unseal, type Sealed } from './crypto'
import type { Data, Day, Item, Kind, Mutation, QueuedMutation, UnlockedSession } from './types'

type SecureItem = { id: string; revision: number; sealed: Sealed }
type SecureQueue = { sequence?: number; itemId: string; operationId: string; sealed: Sealed }

interface LocalDB extends DBSchema {
  items: { key: string; value: Item }
  queue: { key: number; value: QueuedMutation }
  secure_items: { key: string; value: SecureItem }
  secure_queue: { key: number; value: SecureQueue }
}

async function abortFailedTransaction(tx: { abort: () => void; done: Promise<unknown> }) {
  try { tx.abort() } catch (error) {
    if (!(error instanceof DOMException && error.name === 'InvalidStateError')) throw error
  }
  await tx.done.catch(() => undefined)
}

function database(userId: string) {
  let rejectBlocked: (error: Error) => void = () => undefined
  const blocked = new Promise<never>((_resolve, reject) => { rejectBlocked = reject })
  const opening = openDB<LocalDB>(`hverdagsro-${userId}`, 2, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('items')) db.createObjectStore('items', { keyPath: 'id' })
      if (!db.objectStoreNames.contains('queue')) db.createObjectStore('queue', { keyPath: 'sequence', autoIncrement: true })
      db.createObjectStore('secure_items', { keyPath: 'id' })
      db.createObjectStore('secure_queue', { keyPath: 'sequence', autoIncrement: true })
    },
    blocked() { rejectBlocked(new Error('Luk andre Hverdagsro-faner, og prøv igen, så lokale data kan beskyttes.')) },
  })
  return Promise.race([opening, blocked]).catch(error => {
    void opening.then(db => db.close(), () => undefined)
    throw error
  })
}

async function encryptItem(key: CryptoKey, item: Item): Promise<SecureItem> {
  return { id: item.id, revision: item.revision, sealed: await seal(key, `item:${item.id}:${item.revision}`, item) }
}

async function decryptItem(key: CryptoKey, item: SecureItem): Promise<Item> {
  return unseal<Item>(key, `item:${item.id}:${item.revision}`, item.sealed)
}

async function encryptMutation(key: CryptoKey, mutation: Mutation, sequence?: number): Promise<SecureQueue> {
  return {
    ...(sequence === undefined ? {} : { sequence }), itemId: mutation.id, operationId: mutation.operation_id,
    sealed: await seal(key, `queue:${mutation.id}:${mutation.operation_id}`, mutation),
  }
}

async function decryptMutation(key: CryptoKey, entry: SecureQueue): Promise<Mutation> {
  return unseal<Mutation>(key, `queue:${entry.itemId}:${entry.operationId}`, entry.sealed)
}

export async function migrateLegacy(session: UnlockedSession) {
  const db = await database(session.user_id)
  try {
    const oldItems = await db.getAll('items')
    const oldQueue = await db.getAll('queue')
    if (!oldItems.length && !oldQueue.length) return
    const items = await Promise.all(oldItems.map(item => encryptItem(session.key, item)))
    const queue = await Promise.all(oldQueue.map(({ sequence, ...mutation }) => encryptMutation(session.key, mutation, sequence)))
    const tx = db.transaction(['items', 'queue', 'secure_items', 'secure_queue'], 'readwrite')
    const currentItems = await tx.objectStore('items').getAll()
    const currentQueue = await tx.objectStore('queue').getAll()
    const secureCount = await tx.objectStore('secure_items').count()
    const secureQueueCount = await tx.objectStore('secure_queue').count()
    if (JSON.stringify(currentItems) !== JSON.stringify(oldItems) || JSON.stringify(currentQueue) !== JSON.stringify(oldQueue)
      || secureCount || secureQueueCount) {
      await tx.done
      throw new Error('Eksisterende lokale data kunne ikke flyttes sikkert. Luk andre faner, og prøv igen.')
    }
    try {
      for (const item of items) await tx.objectStore('secure_items').put(item)
      for (const entry of queue) await tx.objectStore('secure_queue').put(entry)
      await tx.objectStore('items').clear()
      await tx.objectStore('queue').clear()
      await tx.done
    } catch (error) {
      await abortFailedTransaction(tx)
      throw error
    }
  } finally { db.close() }
}

export async function hasSecureData(userId: string) {
  const db = await database(userId)
  try { return (await db.count('secure_items')) > 0 || (await db.count('secure_queue')) > 0 }
  finally { db.close() }
}

export async function verifySecureData(session: UnlockedSession) {
  const db = await database(session.user_id)
  try {
    const items = await db.getAll('secure_items')
    const queue = await db.getAll('secure_queue')
    await Promise.all(items.map(item => decryptItem(session.key, item)))
    await Promise.all(queue.map(item => decryptMutation(session.key, item)))
  } catch {
    throw new Error('Lokale data kunne ikke låses op. Ingen lokale data er slettet; kontakt administratoren.')
  } finally { db.close() }
}

export async function localItems(session: UnlockedSession) {
  const db = await database(session.user_id)
  try {
    const records = await db.getAll('secure_items')
    return (await Promise.all(records.map(item => decryptItem(session.key, item)))).filter(item => !item.deleted)
  } finally { db.close() }
}

async function dayId(userId: string, date: string) {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`hverdagsro:day:${userId}:${date}`)))
  hash[6] = (hash[6] & 0x0f) | 0x50
  hash[8] = (hash[8] & 0x3f) | 0x80
  const hex = Array.from(hash.slice(0, 16), byte => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export async function saveLocal(session: UnlockedSession, kind: Kind, data: Data, existing?: Item, deleted = false) {
  const id = existing?.id ?? (kind === 'day' ? await dayId(session.user_id, (data as Day).date) : crypto.randomUUID())
  const db = await database(session.user_id)
  try {
    for (let attempt = 0; attempt < 5; attempt++) {
      const current = await db.get('secure_items', id)
      const revision = current?.revision ?? 0
      const item: Item = { id, kind, data, revision: revision + 1, deleted, updated_at: new Date().toISOString() }
      const mutation: Mutation = { operation_id: crypto.randomUUID(), id, kind, base_revision: revision, data, deleted }
      const [sealedItem, sealedMutation] = await Promise.all([
        encryptItem(session.key, item), encryptMutation(session.key, mutation),
      ])
      const tx = db.transaction(['secure_items', 'secure_queue'], 'readwrite')
      const latest = await tx.objectStore('secure_items').get(id)
      if ((latest?.revision ?? 0) !== revision) { await tx.done; continue }
      try {
        await tx.objectStore('secure_items').put(sealedItem)
        await tx.objectStore('secure_queue').add(sealedMutation)
        await tx.done
      } catch (error) {
        await abortFailedTransaction(tx)
        throw error
      }
      return item
    }
    throw new Error('Elementet blev ændret samtidigt. Prøv at gemme igen.')
  } finally { db.close() }
}

export class SyncError extends Error {
  constructor(message: string, readonly conflictId?: string) { super(message) }
}

async function responseError(response: Response) {
  const value: unknown = await response.json().catch(() => null)
  return typeof value === 'object' && value !== null && 'detail' in value && typeof value.detail === 'string'
    ? value.detail : `Serveren svarede ${response.status}`
}

export async function synchronize(session: UnlockedSession) {
  const db = await database(session.user_id)
  try {
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` }
    const queue = await db.getAll('secure_queue')
    for (const entry of queue) {
      if (entry.sequence === undefined) throw new Error('En lokal ændring mangler sit kønummer.')
      const mutation = await decryptMutation(session.key, entry)
      const response = await fetch('/api/items/mutate', { method: 'POST', headers, body: JSON.stringify(mutation) })
      if (!response.ok) throw new SyncError(await responseError(response), response.status === 409 ? entry.itemId : undefined)
      await db.delete('secure_queue', entry.sequence)
    }
    const response = await fetch('/api/items', { headers })
    if (!response.ok) throw new SyncError(await responseError(response))
    const items = await response.json() as Item[]
    const encrypted = await Promise.all(items.map(item => encryptItem(session.key, item)))
    const tx = db.transaction(['secure_items', 'secure_queue'], 'readwrite')
    const pendingIds = new Set((await tx.objectStore('secure_queue').getAll()).map(item => item.itemId))
    try {
      for (const item of encrypted) {
        if (!pendingIds.has(item.id)) await tx.objectStore('secure_items').put(item)
      }
      await tx.done
    } catch (error) {
      await abortFailedTransaction(tx)
      throw error
    }
  } finally { db.close() }
}

export async function pendingCount(session: UnlockedSession) {
  const db = await database(session.user_id)
  try { return await db.count('secure_queue') } finally { db.close() }
}

export async function resolveConflict(session: UnlockedSession, itemId: string, useLocal: boolean) {
  const response = await fetch('/api/items', { headers: { Authorization: `Bearer ${session.token}` } })
  if (!response.ok) throw new SyncError(await responseError(response))
  const remote = (await response.json() as Item[]).find(item => item.id === itemId)
  if (!remote) throw new SyncError('Elementet findes ikke på serveren. Dine lokale ændringer er bevaret.')
  const db = await database(session.user_id)
  try {
    const encryptedLocal = await db.get('secure_items', itemId)
    if (!encryptedLocal) throw new SyncError('Den lokale ændring blev ikke fundet.')
    const local = await decryptItem(session.key, encryptedLocal)
    const replacement = useLocal ? { ...local, revision: remote.revision + 1 } : remote
    const item = await encryptItem(session.key, replacement)
    const mutation: Mutation | undefined = useLocal ? {
      operation_id: crypto.randomUUID(), id: itemId, kind: local.kind, base_revision: remote.revision,
      data: local.data, deleted: local.deleted,
    } : undefined
    const queued = mutation && await encryptMutation(session.key, mutation)
    const tx = db.transaction(['secure_items', 'secure_queue'], 'readwrite')
    const latest = await tx.objectStore('secure_items').get(itemId)
    if (latest?.revision !== encryptedLocal.revision) {
      await tx.done
      throw new SyncError('Elementet er ændret igen. Prøv at løse konflikten på ny.')
    }
    try {
      const operations = await tx.objectStore('secure_queue').getAll()
      for (const operation of operations) {
        if (operation.itemId === itemId && operation.sequence !== undefined) await tx.objectStore('secure_queue').delete(operation.sequence)
      }
      if (queued) await tx.objectStore('secure_queue').add(queued)
      await tx.objectStore('secure_items').put(item)
      await tx.done
    } catch (error) {
      await abortFailedTransaction(tx)
      throw error
    }
  } finally { db.close() }
}
