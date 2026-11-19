export type Kind = 'task' | 'routine' | 'event' | 'day'
export type Priority = 'critical' | 'high' | 'normal' | 'low'
export type Energy = 'low' | 'medium' | 'high'
export type Task = {
  title: string; description: string; priority: Priority; deadline: string | null;
  category: string; minutes: number; energy: number; done: boolean; archived: boolean; steps: string[]
}
export type Routine = { title: string; time_of_day: 'morning' | 'afternoon' | 'evening' | 'custom'; steps: string[]; minutes: number; energy: number }
export type CalendarEvent = { title: string; starts_at: string; minutes: number; energy: number; color: 'blue' | 'green' | 'sand' }
export type Day = { date: string; energy: Energy; energy_budget: number; important_task: string; intention: string; reflection: string }
export type Data = Task | Routine | CalendarEvent | Day
export type Item = { id: string; kind: Kind; data: Data; revision: number; deleted: boolean; updated_at: string }
export type Mutation = { operation_id: string; id: string; kind: Kind; base_revision: number; data: Data; deleted: boolean }
export type QueuedMutation = Mutation & { sequence: number }
export type Session = { token: string; user_id: string; username: string }
export type UnlockedSession = Session & { key: CryptoKey }
