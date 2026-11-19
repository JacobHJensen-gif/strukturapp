import type { CalendarEvent, Day, Energy, Item, Task } from './types'

export function todayString(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function nextTask(items: Item[], energy: Energy) {
  const priority = { critical: 0, high: 1, normal: 2, low: 3 }
  const candidates = items.filter(item => item.kind === 'task' && !(item.data as Task).done && !(item.data as Task).archived)
  return candidates.sort((a, b) => {
    const left = a.data as Task
    const right = b.data as Task
    const energyLimit = energy === 'low' ? 15 : energy === 'medium' ? 30 : 100
    return Number(left.energy > energyLimit) - Number(right.energy > energyLimit)
      || priority[left.priority] - priority[right.priority]
      || (left.deadline ?? '9999').localeCompare(right.deadline ?? '9999')
      || left.minutes - right.minutes
  })[0]
}

export function upcomingEvent(items: Item[], now = new Date()) {
  return items.filter(item => item.kind === 'event' && new Date((item.data as CalendarEvent).starts_at).getTime() >= now.getTime())
    .sort((a, b) => (a.data as CalendarEvent).starts_at.localeCompare((b.data as CalendarEvent).starts_at))[0]
}

export function hasLowEnergyStreak(items: Item[], today = todayString()) {
  const recent = items.filter(item => item.kind === 'day' && (item.data as Day).date <= today)
    .sort((a, b) => (b.data as Day).date.localeCompare((a.data as Day).date)).slice(0, 3)
  if (recent.length !== 3 || !recent.every(item => (item.data as Day).energy === 'low')) return false
  const days = recent.map(item => Date.parse(`${(item.data as Day).date}T00:00:00Z`))
  const todayTime = Date.parse(`${today}T00:00:00Z`)
  return todayTime - days[0] <= 86400000 && days[0] - days[1] === 86400000 && days[1] - days[2] === 86400000
}
