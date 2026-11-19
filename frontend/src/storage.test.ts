import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { localItems, pendingCount, saveLocal, synchronize } from './storage'
import { openDB } from 'idb'
import type { Day, Task, UnlockedSession } from './types'

const task: Task = { title: 'En lille opgave', description: '', priority: 'normal', deadline: null, category: '', minutes: 15, energy: 5, done: false, archived: false, steps: [] }
async function session(): Promise<UnlockedSession> {
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
  return { user_id: crypto.randomUUID(), token: 'test', username: 'test', key }
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('offline queue', () => {
  it('keeps unsent changes and sends them in order when connectivity returns', async () => {
    const user = await session()
    const first = await saveLocal(user, 'task', task)
    await saveLocal(user, 'task', { ...task, title: 'Ændret' }, first)
    expect(await pendingCount(user)).toBe(2)
    vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new TypeError('offline')))
    await expect(synchronize(user)).rejects.toThrow('offline')
    expect(await pendingCount(user)).toBe(2)

    const revisions: number[] = []
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        revisions.push((JSON.parse(init.body as string) as { base_revision: number }).base_revision)
        return new Response('{}')
      }
      return Response.json([])
    }))
    await synchronize(user)
    expect(revisions).toEqual([0, 1])
    expect(await pendingCount(user)).toBe(0)
    expect(((await localItems(user))[0].data as Task).title).toBe('Ændret')
  })

  it('retains the queued change when the server reports a conflict', async () => {
    const user = await session()
    const item = await saveLocal(user, 'task', task)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ detail: 'Konflikt' }, { status: 409 })))
    await expect(synchronize(user)).rejects.toMatchObject({ conflictId: item.id })
    expect(await pendingCount(user)).toBe(1)
    expect(((await localItems(user))[0].data as Task).title).toBe(task.title)
  })

  it('uses the same identifier for the same day on each device', async () => {
    const user = await session()
    const day: Day = { date: '2026-11-19', energy: 'low', energy_budget: 40, important_task: '', intention: '', reflection: '' }
    const first = await saveLocal(user, 'day', day)
    const second = await saveLocal(user, 'day', day)
    expect(second.id).toBe(first.id)
    expect(second.revision).toBe(2)
    expect((await localItems(user)).length).toBe(1)
  })

  it('stores neither task text nor pending changes as plaintext', async () => {
    const user = await session()
    await saveLocal(user, 'task', task)
    const db = await openDB(`hverdagsro-${user.user_id}`, 2)
    const records = [await db.getAll('secure_items'), await db.getAll('secure_queue')]
    db.close()
    expect(JSON.stringify(records)).not.toContain(task.title)
    expect(await localItems(user)).toHaveLength(1)
  })

  it('does not save an item when enqueueing fails', async () => {
    const user = await session()
    const add = IDBObjectStore.prototype.add
    vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementation(function (this: IDBObjectStore, value, key) {
      if (this.name === 'secure_queue') throw new DOMException('test failure', 'DataError')
      return add.call(this, value, key)
    })
    await expect(saveLocal(user, 'task', task)).rejects.toThrow('test failure')
    expect(await localItems(user)).toHaveLength(0)
    expect(await pendingCount(user)).toBe(0)
  })
})
