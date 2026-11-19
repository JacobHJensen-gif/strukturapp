import { describe, expect, it } from 'vitest'
import { hasLowEnergyStreak, nextTask } from './planning'
import type { Day, Item, Task } from './types'

function task(title: string, priority: Task['priority'], energy: number): Item {
  return { id: title, kind: 'task', revision: 1, deleted: false, updated_at: '', data: {
    title, priority, energy, description: '', category: '', deadline: null, minutes: 15, done: false, archived: false, steps: [],
  } }
}

describe('nextTask', () => {
  it('favours manageable tasks when energy is low', () => {
    expect(nextTask([task('Stor', 'high', 50), task('Lille', 'normal', 5)], 'low')?.id).toBe('Lille')
  })

  describe('hasLowEnergyStreak', () => {
    function day(date: string): Item {
      const data: Day = { date, energy: 'low', energy_budget: 50, important_task: '', intention: '', reflection: '' }
      return { id: date, kind: 'day', revision: 1, deleted: false, updated_at: '', data }
    }
    it('only considers consecutive low-energy days a streak', () => {
      expect(hasLowEnergyStreak([day('2026-11-19'), day('2026-11-18'), day('2026-11-17')], '2026-11-19')).toBe(true)
      expect(hasLowEnergyStreak([day('2026-11-19'), day('2026-11-18'), day('2026-11-15')], '2026-11-19')).toBe(false)
      expect(hasLowEnergyStreak([day('2026-11-10'), day('2026-11-09'), day('2026-11-08')], '2026-11-19')).toBe(false)
    })
  })
  it('uses priority when both tasks fit the energy level', () => {
    expect(nextTask([task('Normal', 'normal', 5), task('Vigtig', 'high', 5)], 'high')?.id).toBe('Vigtig')
  })
})
