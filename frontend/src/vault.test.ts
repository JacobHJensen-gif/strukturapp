import 'fake-indexeddb/auto'
import { openDB } from 'idb'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { localItems, pendingCount, saveLocal } from './storage'
import { unlockOffline, unlockOnline } from './vault'
import type { Item, Mutation, Session, Task } from './types'

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('password-protected offline vault', () => {
  it('migrates existing items and pending changes without exposing their content', async () => {
    const user: Session = { user_id: crypto.randomUUID(), username: `test-${crypto.randomUUID()}`, token: 'private-test-token' }
    const task: Task = { title: 'Følsom testopgave', description: '', priority: 'normal', deadline: null, category: '', minutes: 15, energy: 5, done: false, archived: false, steps: [] }
    const item: Item = { id: crypto.randomUUID(), kind: 'task', data: task, revision: 1, deleted: false, updated_at: '' }
    const operation: Mutation = { operation_id: crypto.randomUUID(), id: item.id, kind: 'task', base_revision: 0, data: task, deleted: false }
    const legacy = await openDB(`hverdagsro-${user.user_id}`, 1, { upgrade(db) {
      db.createObjectStore('items', { keyPath: 'id' })
      db.createObjectStore('queue', { keyPath: 'sequence', autoIncrement: true })
    } })
    await legacy.put('items', item)
    await legacy.add('queue', operation)
    legacy.close()
    vi.stubGlobal('localStorage', { removeItem: vi.fn() })

    const unlocked = await unlockOnline(user.username, 'a-long-test-password', user)
    expect((await localItems(unlocked))[0].data).toEqual(task)
    expect(await pendingCount(unlocked)).toBe(1)
    const db = await openDB(`hverdagsro-${user.user_id}`, 2)
    expect(await db.count('items')).toBe(0)
    expect(await db.count('queue')).toBe(0)
    expect(JSON.stringify(await db.getAll('secure_items'))).not.toContain(task.title)
    expect(JSON.stringify(await db.getAll('secure_queue'))).not.toContain(task.title)
    db.close()
    const vaults = await openDB('hverdagsro-vaults', 2)
    expect(JSON.stringify(await vaults.getAll('vaults'))).not.toContain(user.token)
    vaults.close()
    await expect(unlockOffline(user.username, 'wrong-password')).rejects.toThrow('kunne ikke låse')
    const reopened = await unlockOffline(user.username, 'a-long-test-password')
    expect((await localItems(reopened))[0].data).toEqual(task)
    expect(await pendingCount(reopened)).toBe(1)
  }, 30_000)

  it('keeps legacy data if migration cannot finish, and can retry', async () => {
    const user: Session = { user_id: crypto.randomUUID(), username: `test-${crypto.randomUUID()}`, token: 'test-token' }
    const item: Item = { id: crypto.randomUUID(), kind: 'task', revision: 1, deleted: false, updated_at: '', data: {
      title: 'Gem mig', description: '', priority: 'normal', deadline: null, category: '', minutes: 15, energy: 5, done: false, archived: false, steps: [],
    } }
    const legacy = await openDB(`hverdagsro-${user.user_id}`, 1, { upgrade(db) {
      db.createObjectStore('items', { keyPath: 'id' })
      db.createObjectStore('queue', { keyPath: 'sequence', autoIncrement: true })
    } })
    await legacy.put('items', item)
    legacy.close()
    vi.stubGlobal('localStorage', { removeItem: vi.fn() })
    const put = IDBObjectStore.prototype.put
    const spy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value, key) {
      if (this.name === 'secure_items') throw new DOMException('test failure', 'DataError')
      return put.call(this, value, key)
    })
    await expect(unlockOnline(user.username, 'a-long-test-password', user)).rejects.toThrow('test failure')
    spy.mockRestore()
    const db = await openDB(`hverdagsro-${user.user_id}`, 2)
    expect(await db.count('items')).toBe(1)
    expect(await db.count('secure_items')).toBe(0)
    db.close()
    const unlocked = await unlockOnline(user.username, 'a-long-test-password', user)
    expect((await localItems(unlocked))[0].id).toBe(item.id)
  }, 30_000)

  it('asks the user to close an older open tab before migration', async () => {
    const user: Session = { user_id: crypto.randomUUID(), username: `test-${crypto.randomUUID()}`, token: 'test-token' }
    const legacy = await openDB(`hverdagsro-${user.user_id}`, 1, { upgrade(db) {
      db.createObjectStore('items', { keyPath: 'id' })
      db.createObjectStore('queue', { keyPath: 'sequence', autoIncrement: true })
    } })
    vi.stubGlobal('localStorage', { removeItem: vi.fn() })
    await expect(unlockOnline(user.username, 'a-long-test-password', user)).rejects.toThrow('Luk andre Hverdagsro-faner')
    legacy.close()
    const unlocked = await unlockOnline(user.username, 'a-long-test-password', user)
    expect(await localItems(unlocked)).toEqual([])
  }, 30_000)

  it('does not replace the key when encrypted data exist but the vault is missing', async () => {
    const user: Session = { user_id: crypto.randomUUID(), username: `test-${crypto.randomUUID()}`, token: 'test-token' }
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
    const unlocked = { ...user, key }
    const task: Task = { title: 'Gem mig', description: '', priority: 'normal', deadline: null, category: '', minutes: 15, energy: 5, done: false, archived: false, steps: [] }
    await saveLocal(unlocked, 'task', task)
    vi.stubGlobal('localStorage', { removeItem: vi.fn() })
    await expect(unlockOnline(user.username, 'a-long-test-password', user)).rejects.toThrow('Nøglen til eksisterende lokale data mangler')
    expect((await localItems(unlocked))[0].data).toEqual(task)
    expect(await pendingCount(unlocked)).toBe(1)
  }, 30_000)

  it('unlocks offline with the username entered online when the server normalized it', async () => {
    const suffix = crypto.randomUUID()
    const user: Session = { user_id: crypto.randomUUID(), username: `strasse-${suffix}`, token: 'test-token' }
    const input = `Straße-${suffix}`
    vi.stubGlobal('localStorage', { removeItem: vi.fn() })
    await unlockOnline(input, 'a-long-test-password', user)
    const unlocked = await unlockOffline(input, 'a-long-test-password')
    expect(unlocked.user_id).toBe(user.user_id)
  }, 30_000)
})
