import { useEffect, useState, type ReactNode } from 'react'
import { motion, useReducedMotion } from 'framer-motion'

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  const reduced = useReducedMotion()
  return <motion.section initial={reduced ? false : { opacity: 0 }} animate={{ opacity: 1 }} className={`card ${className}`}>{children}</motion.section>
}

export function Timer({ title, minutes, onClose }: { title: string; minutes: number; onClose: () => void }) {
  const [remaining, setRemaining] = useState(minutes * 60)
  const [running, setRunning] = useState(false)
  const [end, setEnd] = useState(0)
  useEffect(() => {
    if (!running) return
    const tick = () => {
      const value = Math.max(0, Math.ceil((end - Date.now()) / 1000))
      setRemaining(value)
      if (!value) setRunning(false)
    }
    tick()
    const handle = window.setInterval(tick, 1000)
    return () => window.clearInterval(handle)
  }, [running, end])
  const toggle = () => {
    if (running) setRunning(false)
    else { setEnd(Date.now() + remaining * 1000); setRunning(true) }
  }
  return <Card className="space-y-5">
    <p className="eyebrow">Ét skridt ad gangen</p>
    <h2>{title}</h2>
    <p className="timer" aria-label={`${Math.floor(remaining / 60)} minutter og ${remaining % 60} sekunder tilbage`}>
      {String(Math.floor(remaining / 60)).padStart(2, '0')}:{String(remaining % 60).padStart(2, '0')}
    </p>
    <progress className="w-full" max={minutes * 60} value={minutes * 60 - remaining} aria-label="Forløbet tid" />
    <div className="button-row">
      <button className="primary" onClick={toggle} disabled={remaining === 0}>{running ? 'Pause' : 'Start timer'}</button>
      <button className="secondary" onClick={onClose}>Tilbage</button>
    </div>
    {remaining === 0 && <p role="status">Tiden er gået. Du må gerne holde pause.</p>}
  </Card>
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="muted">{children}</p>
}
