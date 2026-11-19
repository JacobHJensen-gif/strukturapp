import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { localItems, pendingCount, resolveConflict, saveLocal, SyncError, synchronize } from './storage'
import type { Data, Item, Kind, UnlockedSession } from './types'

type Store = {
  session: UnlockedSession
  items: Item[]
  pending: number
  notice: string
  conflict?: string
  save: (kind: Kind, data: Data, existing?: Item, deleted?: boolean) => Promise<void>
  sync: () => Promise<void>
  resolve: (keepLocal: boolean) => Promise<void>
  signOut: () => Promise<void>
}
const Context = createContext<Store | null>(null)

export function useStore() {
  const context = useContext(Context)
  if (!context) throw new Error('Store is unavailable')
  return context
}

export function StoreProvider({ session, signOut, children }: { session: UnlockedSession; signOut: () => Promise<void>; children: ReactNode }) {
  const [items, setItems] = useState<Item[]>([])
  const [pending, setPending] = useState(0)
  const [notice, setNotice] = useState('')
  const [conflict, setConflict] = useState<string>()
  const syncInProgress = useRef(false)

  const refresh = useCallback(async () => {
    setItems(await localItems(session))
    setPending(await pendingCount(session))
  }, [session])

  const sync = useCallback(async () => {
    if (syncInProgress.current || !navigator.onLine) return
    syncInProgress.current = true
    let succeeded = false
    try {
      await synchronize(session)
      setNotice('')
      setConflict(undefined)
      succeeded = true
    } catch (error) {
      if (error instanceof SyncError) {
        setNotice(error.message)
        setConflict(error.conflictId)
      } else if (error instanceof TypeError) {
        setNotice('Kan ikke synkronisere lige nu. Dine ændringer er gemt på denne enhed.')
      } else {
        setNotice('Krypterede data kunne ikke læses eller gemmes. Luk ikke appen, og kontakt administratoren.')
      }
    } finally {
      try { await refresh() } finally { syncInProgress.current = false }
    }
    if (succeeded && await pendingCount(session) > 0) void sync()
  }, [refresh, session])

  useEffect(() => {
    void refresh().then(sync).catch(() => setNotice('Lokal lagring kunne ikke åbnes.'))
    const handleOnline = () => { void sync() }
    window.addEventListener('online', handleOnline)
    return () => window.removeEventListener('online', handleOnline)
  }, [refresh, sync])

  const save = async (kind: Kind, data: Data, existing?: Item, deleted = false) => {
    await saveLocal(session, kind, data, existing, deleted)
    await refresh()
    void sync()
  }

  const resolve = async (keepLocal: boolean) => {
    if (!conflict) return
    try {
      await resolveConflict(session, conflict, keepLocal)
      setConflict(undefined)
      await refresh()
      await sync()
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Konflikten kunne ikke løses.')
    }
  }

  return <Context.Provider value={{ session, items, pending, notice, conflict, save, sync, resolve, signOut }}>{children}</Context.Provider>
}
