import { useState, type FormEvent } from 'react'
import { Card, Empty, Timer } from './components'
import { hasLowEnergyStreak, nextTask, todayString, upcomingEvent } from './planning'
import { useStore } from './store'
import type { CalendarEvent, Day, Energy, Item, Priority, Routine, Task } from './types'

const priorityLabels: Record<Priority, string> = { critical: 'Kritisk', high: 'Høj', normal: 'Normal', low: 'Lav' }
const energyLabels: Record<Energy, string> = { low: 'Lav', medium: 'Middel', high: 'Høj' }
const defaultTask = (): Task => ({ title: '', description: '', priority: 'normal', deadline: null, category: '', minutes: 15, energy: 10, done: false, archived: false, steps: [] })
const defaultDay = (): Day => ({ date: todayString(), energy: 'medium', energy_budget: 50, important_task: '', intention: '', reflection: '' })
const defaultRoutine = (): Routine => ({ title: '', time_of_day: 'morning', steps: [], minutes: 15, energy: 10 })

function message(error: unknown) {
  return error instanceof Error ? error.message : 'Noget gik galt. Prøv igen.'
}

export function Today({ focus, setFocus }: { focus: boolean; setFocus: (value: boolean) => void }) {
  const { items, save } = useStore()
  const dayItem = items.find(item => item.kind === 'day' && (item.data as Day).date === todayString())
  const day = dayItem ? dayItem.data as Day : defaultDay()
  const [planning, setPlanning] = useState(false)
  const [draft, setDraft] = useState(day)
  const [timer, setTimer] = useState<{ title: string; minutes: number }>()
  const [error, setError] = useState('')
  const taskItem = nextTask(items, day.energy)
  const task = taskItem?.data as Task | undefined
  const eventItem = upcomingEvent(items)
  const event = eventItem?.data as CalendarEvent | undefined
  const eventMinutes = event ? Math.max(0, Math.ceil((new Date(event.starts_at).getTime() - Date.now()) / 60000)) : 0
  const next = event && eventMinutes <= 30 ? event : task ?? event
  const todayEvents = items.filter(item => item.kind === 'event' && (item.data as CalendarEvent).starts_at.slice(0, 10) === todayString())
  const plannedEnergy = todayEvents.reduce((sum, item) => sum + (item.data as CalendarEvent).energy, 0)
  const lowTrend = hasLowEnergyStreak(items)
  if (timer) return <Timer {...timer} onClose={() => setTimer(undefined)} />
  if (planning) return <Card>
    <h1>En blid plan for i dag</h1>
    <form className="form" onSubmit={async e => {
      e.preventDefault()
      try { await save('day', draft, dayItem); setPlanning(false) } catch (err) { setError(message(err)) }
    }}>
      <label>Vigtigste opgave<input value={draft.important_task} maxLength={200} onChange={e => setDraft({ ...draft, important_task: e.target.value })} /></label>
      <label>Hvad vil du gerne opnå?<input value={draft.intention} maxLength={500} onChange={e => setDraft({ ...draft, intention: e.target.value })} /></label>
      <label>Hvordan er energien?
        <select value={draft.energy} onChange={e => setDraft({ ...draft, energy: e.target.value as Energy })}>
          <option value="low">Lav</option><option value="medium">Middel</option><option value="high">Høj</option>
        </select>
      </label>
      <label>Din energiramme i point<input type="number" min="0" max="1000" required value={draft.energy_budget} onChange={e => setDraft({ ...draft, energy_budget: Number(e.target.value) })} /></label>
      <label>Aften: Hvordan var dagen?<textarea maxLength={1000} value={draft.reflection} onChange={e => setDraft({ ...draft, reflection: e.target.value })} /></label>
      {error && <p role="alert">{error}</p>}
      <div className="button-row"><button className="primary">Gem planen</button><button type="button" className="secondary" onClick={() => setPlanning(false)}>Annuller</button></div>
    </form>
  </Card>
  return <div className="space-y-5">
    <header><p className="eyebrow">{focus ? 'Fokusvisning' : 'Tag dagen i dit tempo'}</p><h1>{focus ? 'Kun det næste skridt' : 'Goddag'}</h1></header>
    <Card className="space-y-4">
      <p className="eyebrow">Næste aktivitet</p>
      <h2>{next?.title ?? 'Der er ikke planlagt noget endnu'}</h2>
      {next && <p className="muted">{'starts_at' in next ? `Kl. ${new Date(next.starts_at).toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit' })} · om ${eventMinutes} min.` : `${next.minutes} minutter · ${next.energy} energipoint`}</p>}
      <button className="primary w-full" disabled={!next} onClick={() => next && setTimer({ title: next.title, minutes: next.minutes })}>Start</button>
    </Card>
    {!focus && <>
      <Card><p className="eyebrow">Dagens vigtigste opgave</p><p>{day.important_task || task?.title || 'Du kan vælge én, når du er klar.'}</p></Card>
      <Card className="space-y-3"><p className="eyebrow">Dagens energi</p><p>{energyLabels[day.energy]} · {plannedEnergy} af {day.energy_budget} planlagte point</p>
        {plannedEnergy > day.energy_budget && <p>Du har planlagt mere energi end din valgte ramme. Måske kan noget vente?</p>}
        {day.energy === 'low' && <p>En rolig dag med ekstra pauser kan være en god mulighed.</p>}
        {lowTrend && <p>Din energi har været lav flere dage. Overvej hvile og færre aktiviteter.</p>}
      </Card>
      <div className="button-row"><button className="secondary" onClick={() => { setDraft(day); setPlanning(true) }}>Planlæg dagen</button><button className="secondary" onClick={() => setFocus(true)}>Vis kun næste aktivitet</button></div>
    </>}
    {focus && <button className="secondary" onClick={() => setFocus(false)}>Tilbage til overblik</button>}
  </div>
}

export function Tasks() {
  const { items, save, session } = useStore()
  const [editing, setEditing] = useState<Item | null | undefined>()
  const [draft, setDraft] = useState<Task>(defaultTask())
  const [filter, setFilter] = useState<'active' | 'done' | 'archived'>('active')
  const [index, setIndex] = useState(0)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const filtered = items.filter(item => {
    if (item.kind !== 'task') return false
    const task = item.data as Task
    return filter === 'archived' ? task.archived : filter === 'done' ? task.done && !task.archived : !task.done && !task.archived
  })
  const item = filtered[Math.min(index, Math.max(0, filtered.length - 1))]
  const task = item?.data as Task | undefined
  const startEditing = (selected?: Item) => { setDraft(selected ? { ...selected.data as Task } : defaultTask()); setEditing(selected ?? null); setError('') }
  const suggest = async () => {
    setLoading(true); setError('')
    try {
      const response = await fetch('/api/suggestions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` }, body: JSON.stringify({ title: draft.title }) })
      if (!response.ok) {
        const result = await response.json() as { detail?: string }
        throw new Error(result.detail || 'Forslag kunne ikke hentes.')
      }
      const result = await response.json() as { steps: { title: string; minutes: number; energy: number }[] }
      setDraft(current => ({ ...current, steps: result.steps.map(step => `${step.title} (${step.minutes} min, ${step.energy} point)`), minutes: Math.max(1, result.steps.reduce((sum, step) => sum + step.minutes, 0)), energy: Math.min(100, result.steps.reduce((sum, step) => sum + step.energy, 0)) }))
    } catch (err) { setError(message(err)) } finally { setLoading(false) }
  }
  if (editing !== undefined) return <Card>
    <h1>{editing ? 'Redigér opgave' : 'Ny opgave'}</h1>
    <form className="form" onSubmit={async e => { e.preventDefault(); if (draft.steps.filter(Boolean).length > 30) { setError('Højst 30 skridt er tilladt.'); return } try { await save('task', { ...draft, steps: draft.steps.filter(Boolean) }, editing ?? undefined); setEditing(undefined) } catch (err) { setError(message(err)) } }}>
      <label>Hvad vil du gerne gøre?<input required maxLength={200} value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} /></label>
      <label>Beskrivelse<textarea maxLength={2000} value={draft.description} onChange={e => setDraft({ ...draft, description: e.target.value })} /></label>
      <label>Prioritet<select value={draft.priority} onChange={e => setDraft({ ...draft, priority: e.target.value as Priority })}>{Object.entries(priorityLabels).map(([key, value]) => <option key={key} value={key}>{value}</option>)}</select></label>
      <label>Deadline<input type="date" value={draft.deadline ?? ''} onChange={e => setDraft({ ...draft, deadline: e.target.value || null })} /></label>
      <label>Kategori<input maxLength={100} value={draft.category} onChange={e => setDraft({ ...draft, category: e.target.value })} /></label>
      <div className="grid gap-4 sm:grid-cols-2"><label>Minutter<input required type="number" min="1" max="1440" value={draft.minutes} onChange={e => setDraft({ ...draft, minutes: Number(e.target.value) })} /></label><label>Energipoint<input required type="number" min="0" max="100" value={draft.energy} onChange={e => setDraft({ ...draft, energy: Number(e.target.value) })} /></label></div>
      <label>Små skridt, ét pr. linje<textarea value={draft.steps.join('\n')} onChange={e => setDraft({ ...draft, steps: e.target.value.split('\n') })} /></label>
      <button type="button" className="secondary" disabled={!draft.title.trim() || loading} onClick={() => void suggest()}>{loading ? 'Henter forslag …' : 'Foreslå små skridt med lokal AI'}</button>
      {error && <p role="alert">{error}</p>}
      <div className="button-row"><button className="primary">Gem opgave</button><button type="button" className="secondary" onClick={() => setEditing(undefined)}>Annuller</button></div>
    </form>
  </Card>
  return <div className="space-y-5"><header><p className="eyebrow">Ét skridt ad gangen</p><h1>Opgaver</h1></header>
    <button className="primary" onClick={() => startEditing()}>Ny opgave</button>
    <label>Vis<select value={filter} onChange={e => { setFilter(e.target.value as typeof filter); setIndex(0) }}><option value="active">Aktive</option><option value="done">Gennemførte</option><option value="archived">Arkiverede</option></select></label>
    {task && item ? <Card className="space-y-4"><p className="eyebrow">{Math.min(index + 1, filtered.length)} af {filtered.length} · {priorityLabels[task.priority]}</p><h2>{task.title}</h2>
      <p className="muted">{task.minutes} minutter · {task.energy} energipoint{task.deadline ? ` · senest ${task.deadline}` : ''}</p>
      {task.description && <p>{task.description}</p>}{task.steps.length > 0 && <ul className="list-disc pl-5">{task.steps.filter(Boolean).map((step, i) => <li key={i}>{step}</li>)}</ul>}
      <div className="button-row"><button className="primary" onClick={() => void save('task', { ...task, done: !task.done }, item).catch(err => setError(message(err)))}>{task.done ? 'Genåbn' : 'Færdig'}</button><button className="secondary" onClick={() => startEditing(item)}>Redigér</button><button className="secondary" onClick={() => void save('task', { ...task, archived: !task.archived }, item).catch(err => setError(message(err)))}>{task.archived ? 'Gendan' : 'Arkivér'}</button><button className="secondary" onClick={() => { if (window.confirm('Vil du slette opgaven?')) void save('task', task, item, true).catch(err => setError(message(err))) }}>Slet</button></div>
    </Card> : <Card><Empty>Der er ingen opgaver her.</Empty></Card>}
    {error && <p role="alert">{error}</p>}
    {filtered.length > 1 && <div className="button-row"><button className="secondary" disabled={index <= 0} onClick={() => setIndex(index - 1)}>Forrige</button><button className="secondary" disabled={index >= filtered.length - 1} onClick={() => setIndex(index + 1)}>Næste</button></div>}
  </div>
}

export function Routines() {
  const { items, save } = useStore()
  const [editing, setEditing] = useState<Item | null | undefined>()
  const [draft, setDraft] = useState<Routine>(defaultRoutine())
  const [active, setActive] = useState<Item>()
  const [step, setStep] = useState(0)
  const [index, setIndex] = useState(0)
  const [error, setError] = useState('')
  const routines = items.filter(item => item.kind === 'routine')
  const selected = routines[Math.min(index, Math.max(0, routines.length - 1))]
  const routine = selected?.data as Routine | undefined
  if (active) {
    const current = active.data as Routine
    const steps = current.steps.filter(Boolean)
    return <Card className="space-y-5"><p className="eyebrow">{current.title} · {Math.min(step + 1, steps.length)} af {steps.length}</p><h1>{steps[step] ?? 'Rutinen er færdig'}</h1>
      {step < steps.length ? <button className="primary w-full" onClick={() => setStep(step + 1)}>Næste</button> : <p>Godt gået. Du må gerne holde pause.</p>}
      <button className="secondary" onClick={() => setActive(undefined)}>Afslut</button>
    </Card>
  }
  if (editing !== undefined) return <Card><h1>{editing ? 'Redigér rutine' : 'Ny rutine'}</h1><form className="form" onSubmit={async e => { e.preventDefault(); if (draft.steps.filter(Boolean).length > 30) { setError('Højst 30 skridt er tilladt.'); return } try { await save('routine', { ...draft, steps: draft.steps.filter(Boolean) }, editing ?? undefined); setEditing(undefined) } catch (err) { setError(message(err)) } }}>
    <label>Navn<input required maxLength={200} value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} /></label>
    <label>Tid på dagen<select value={draft.time_of_day} onChange={e => setDraft({ ...draft, time_of_day: e.target.value as Routine['time_of_day'] })}><option value="morning">Morgen</option><option value="afternoon">Eftermiddag</option><option value="evening">Aften</option><option value="custom">Andet</option></select></label>
    <label>Skridt, ét pr. linje<textarea required value={draft.steps.join('\n')} onChange={e => setDraft({ ...draft, steps: e.target.value.split('\n') })} /></label>
    <label>Minutter<input type="number" min="1" max="1440" required value={draft.minutes} onChange={e => setDraft({ ...draft, minutes: Number(e.target.value) })} /></label>
    <label>Energipoint<input type="number" min="0" max="100" required value={draft.energy} onChange={e => setDraft({ ...draft, energy: Number(e.target.value) })} /></label>
    {error && <p role="alert">{error}</p>}<div className="button-row"><button className="primary">Gem rutine</button><button type="button" className="secondary" onClick={() => setEditing(undefined)}>Annuller</button></div>
  </form></Card>
  return <div className="space-y-5"><header><p className="eyebrow">Én ting ad gangen</p><h1>Rutiner</h1></header><button className="primary" onClick={() => { setDraft(defaultRoutine()); setEditing(null) }}>Ny rutine</button>
    {routine && selected ? <Card className="space-y-4"><p className="eyebrow">{index + 1} af {routines.length}</p><h2>{routine.title}</h2><p className="muted">{routine.steps.filter(Boolean).length} små skridt</p>
      <div className="button-row"><button className="primary" onClick={() => { setStep(0); setActive(selected) }}>Start</button><button className="secondary" onClick={() => { setDraft(routine); setEditing(selected) }}>Redigér</button><button className="secondary" onClick={() => { if (window.confirm('Vil du slette rutinen?')) void save('routine', routine, selected, true).catch(err => setError(message(err))) }}>Slet</button></div>
    </Card> : <Card><Empty>Tilføj en rutine, når du er klar.</Empty></Card>}
    {error && <p role="alert">{error}</p>}
    {routines.length > 1 && <div className="button-row"><button className="secondary" disabled={index <= 0} onClick={() => setIndex(index - 1)}>Forrige</button><button className="secondary" disabled={index >= routines.length - 1} onClick={() => setIndex(index + 1)}>Næste</button></div>}
  </div>
}

export function Calendar() {
  const { items, save } = useStore()
  const [date, setDate] = useState(todayString())
  const [week, setWeek] = useState(false)
  const [editing, setEditing] = useState<Item | null | undefined>()
  const [draft, setDraft] = useState<CalendarEvent>({ title: '', starts_at: `${todayString()}T09:00`, minutes: 30, energy: 10, color: 'blue' })
  const [error, setError] = useState('')
  const events = items.filter(item => {
    if (item.kind !== 'event') return false
    const start = (item.data as CalendarEvent).starts_at.slice(0, 10)
    const last = new Date(`${date}T12:00`); last.setDate(last.getDate() + 6)
    return start >= date && start <= (week ? todayString(last) : date)
  }).sort((a, b) => (a.data as CalendarEvent).starts_at.localeCompare((b.data as CalendarEvent).starts_at))
  if (editing !== undefined) return <Card><h1>{editing ? 'Redigér aktivitet' : 'Ny aktivitet'}</h1><form className="form" onSubmit={async e => { e.preventDefault(); try { await save('event', draft, editing ?? undefined); setEditing(undefined) } catch (err) { setError(message(err)) } }}>
    <label>Aktivitet<input required maxLength={200} value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} /></label>
    <label>Dato og tid<input required type="datetime-local" value={draft.starts_at.slice(0, 16)} onChange={e => setDraft({ ...draft, starts_at: e.target.value })} /></label>
    <label>Minutter<input required type="number" min="1" max="1440" value={draft.minutes} onChange={e => setDraft({ ...draft, minutes: Number(e.target.value) })} /></label>
    <label>Energipoint<input required type="number" min="0" max="100" value={draft.energy} onChange={e => setDraft({ ...draft, energy: Number(e.target.value) })} /></label>
    <label>Farve<select value={draft.color} onChange={e => setDraft({ ...draft, color: e.target.value as CalendarEvent['color'] })}><option value="blue">Blå</option><option value="green">Grøn</option><option value="sand">Sand</option></select></label>
    {error && <p role="alert">{error}</p>}<div className="button-row"><button className="primary">Gem aktivitet</button><button type="button" className="secondary" onClick={() => setEditing(undefined)}>Annuller</button></div>
  </form></Card>
  return <div className="space-y-5"><header><p className="eyebrow">Din tid, i dit tempo</p><h1>Kalender</h1></header>
    <button className="primary" onClick={() => { setDraft({ title: '', starts_at: `${date}T09:00`, minutes: 30, energy: 10, color: 'blue' }); setEditing(null) }}>Ny aktivitet</button>
    <div className="button-row"><label>Dato<input type="date" value={date} onChange={e => setDate(e.target.value)} /></label><button className="secondary" onClick={() => setWeek(!week)}>{week ? 'Vis dag' : 'Vis 7 dage'}</button></div>
    {events.length ? <ol className="timeline">{events.map(item => { const event = item.data as CalendarEvent; return <li key={item.id} className={`event event-${event.color}`}><time dateTime={event.starts_at}>{new Date(event.starts_at).toLocaleString('da-DK', { ...(week ? { weekday: 'short' } : {}), hour: '2-digit', minute: '2-digit' })}</time><div><h2>{event.title}</h2><p className="muted">{event.minutes} min · {event.energy} point</p><div className="button-row"><button className="text-button" onClick={() => { setDraft(event); setEditing(item) }}>Redigér</button><button className="text-button" onClick={() => { if (window.confirm('Vil du slette aktiviteten?')) void save('event', event, item, true).catch(err => setError(message(err))) }}>Slet</button></div></div></li> })}</ol> : <Card><Empty>Der er ingen aktiviteter i denne periode.</Empty></Card>}
    {error && <p role="alert">{error}</p>}
  </div>
}
