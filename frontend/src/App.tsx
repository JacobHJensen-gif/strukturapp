import { useState, type FormEvent } from 'react'
import { CalendarDays, CheckSquare, Home, Repeat, Settings as SettingsIcon } from 'lucide-react'
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { Card } from './components'
import { Calendar, Routines, Tasks, Today } from './screens'
import { StoreProvider, useStore } from './store'
import { unlockOffline, unlockOnline } from './vault'
import type { Session, UnlockedSession } from './types'

function Login({ onLogin }: { onLogin: (session: UnlockedSession) => void }) {
  const [register, setRegister] = useState(false)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [invitation, setInvitation] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError('')
    let accountCreated = false
    try {
      const body = register ? { username, password, invitation: invitation.trim() } : { username, password }
      const response = await fetch(`/api/auth/${register ? 'register' : 'login'}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      if (!response.ok) {
        const body = await response.json() as { detail?: string }
        throw new Error(typeof body.detail === 'string' ? body.detail : 'Kontrollér brugernavn og adgangskode.')
      }
      const session = await response.json() as Session
      accountCreated = register
      onLogin(await unlockOnline(username, password, session))
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Kunne ikke logge ind.'
      setError(accountCreated ? `Brugeren blev oprettet, men lokale data kunne ikke åbnes: ${detail} Log ind igen.` : detail)
      if (accountCreated) setRegister(false)
    } finally { setBusy(false) }
  }
  const offline = async () => {
    setBusy(true); setError('')
    try { onLogin(await unlockOffline(username, password)) }
    catch (error) { setError(error instanceof Error ? error.message : 'Kunne ikke åbne lokale data.') }
    finally { setBusy(false) }
  }
  return <main className="login-shell"><Card><p className="eyebrow">Velkommen til</p><h1>Hverdagsro</h1><p className="muted mt-2">Ét lille skridt ad gangen.</p>
    <form className="form" onSubmit={submit}>
      <label>Brugernavn<input autoComplete="username" required minLength={3} maxLength={100} value={username} onChange={e => setUsername(e.target.value)} /></label>
      <label>Adgangskode<input type="password" autoComplete={register ? 'new-password' : 'current-password'} required minLength={12} maxLength={128} value={password} onChange={e => setPassword(e.target.value)} /></label>
      {register && <label>Invitationskode<input autoComplete="off" required minLength={32} maxLength={256} value={invitation} onChange={e => setInvitation(e.target.value)} /></label>}
      {register && <p className="muted">Vælg en adgangskode med mindst 12 tegn.</p>}
      {error && <p role="alert">{error}</p>}
      <button className="primary" disabled={busy}>{busy ? 'Vent et øjeblik …' : register ? 'Opret bruger' : 'Log ind'}</button>
      {!register && <button type="button" className="secondary" disabled={busy || !username || !password} onClick={() => void offline()}>Åbn offline</button>}
      <button type="button" className="secondary" onClick={() => { setRegister(!register); setError('') }}>{register ? 'Jeg har allerede en bruger' : 'Opret en bruger'}</button>
    </form>
  </Card></main>
}

function Settings() {
  const { signOut, pending, sync, items } = useStore()
  const [theme, setTheme] = useState(localStorage.getItem('hverdagsro-theme') || 'light')
  const [large, setLarge] = useState(localStorage.getItem('hverdagsro-large') === 'true')
  const [contrast, setContrast] = useState(localStorage.getItem('hverdagsro-contrast') === 'true')
  const setAppearance = (nextTheme: string, nextLarge: boolean, nextContrast: boolean) => {
    setTheme(nextTheme); setLarge(nextLarge); setContrast(nextContrast)
    localStorage.setItem('hverdagsro-theme', nextTheme)
    localStorage.setItem('hverdagsro-large', String(nextLarge))
    localStorage.setItem('hverdagsro-contrast', String(nextContrast))
    document.documentElement.classList.toggle('dark', nextTheme === 'dark')
    document.documentElement.classList.toggle('large-text', nextLarge)
    document.documentElement.classList.toggle('high-contrast', nextContrast)
  }
  const exportData = () => {
    if (!window.confirm('Eksporten er ukrypteret og kan indeholde følsomme oplysninger. Vil du fortsætte?')) return
    const blob = new Blob([JSON.stringify({ version: 1, exported_at: new Date().toISOString(), items }, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `hverdagsro-${new Date().toISOString().slice(0, 10)}.json`
    link.click()
    URL.revokeObjectURL(url)
  }
  return <div className="space-y-5"><header><p className="eyebrow">Gør appen til din</p><h1>Indstillinger</h1></header>
    <Card className="space-y-4"><h2>Udseende</h2>
      <label>Farvetema<select value={theme} onChange={e => setAppearance(e.target.value, large, contrast)}><option value="light">Lyst</option><option value="dark">Mørkt</option></select></label>
      <label className="check"><input type="checkbox" checked={large} onChange={e => setAppearance(theme, e.target.checked, contrast)} /> Større tekst</label>
      <label className="check"><input type="checkbox" checked={contrast} onChange={e => setAppearance(theme, large, e.target.checked)} /> Høj kontrast</label>
    </Card>
    <Card className="space-y-3"><h2>Dine data</h2><p>{pending ? `${pending} ændringer venter på synkronisering.` : 'Ingen ændringer venter.'}</p><div className="button-row"><button className="secondary" onClick={() => void sync()}>Synkronisér nu</button><button className="secondary" onClick={exportData}>Eksportér mine data</button></div>
      <p className="muted">Offline-data er krypteret. Eksport er ukrypteret og kan endnu ikke indlæses igen i appen.</p></Card>
    <button className="secondary" onClick={() => { if (!pending || window.confirm('Der er ændringer, som ikke er synkroniseret. De bliver på denne enhed. Vil du logge ud?')) void signOut() }}>Log ud</button>
  </div>
}

const navigation = [
  { to: '/', label: 'I dag', icon: Home },
  { to: '/opgaver', label: 'Opgaver', icon: CheckSquare },
  { to: '/rutiner', label: 'Rutiner', icon: Repeat },
  { to: '/kalender', label: 'Kalender', icon: CalendarDays },
  { to: '/indstillinger', label: 'Indstillinger', icon: SettingsIcon },
]

function Layout() {
  const { pending, notice, conflict, resolve } = useStore()
  const [focus, setFocus] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()
  return <div className="app-shell">
    <a className="skip" href="#main">Spring til indhold</a>
    <header className="topbar"><span className="brand">◌ <strong>Hverdagsro</strong></span>
      {!focus && <button className="overwhelmed" onClick={() => { navigate('/'); setFocus(true) }}>Jeg er overvældet</button>}
    </header>
    {notice && <div role="alert" className="notice"><p>{notice}</p>{conflict && <div className="button-row"><button className="secondary" onClick={() => void resolve(true)}>Behold min ændring</button><button className="secondary" onClick={() => { if (window.confirm('Din lokale ændring bliver erstattet. Fortsæt?')) void resolve(false) }}>Brug serverens version</button></div>}</div>}
    {pending > 0 && <p className="sync-status" role="status">{pending} ændringer afventer synkronisering</p>}
    <main id="main" className="content" tabIndex={-1}>
      {focus && location.pathname === '/' ? <Today focus setFocus={setFocus} /> : <Routes><Route path="/" element={<Today focus={false} setFocus={setFocus} />} /><Route path="/opgaver" element={<Tasks />} /><Route path="/rutiner" element={<Routines />} /><Route path="/kalender" element={<Calendar />} /><Route path="/indstillinger" element={<Settings />} /><Route path="*" element={<Navigate to="/" replace />} /></Routes>}
    </main>
    {!focus && <nav aria-label="Hovedmenu" className="bottom-nav">{navigation.map(({ to, label, icon: Icon }) => <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}><Icon size={20} aria-hidden="true" /><span>{label}</span></NavLink>)}</nav>}
  </div>
}

export default function App() {
  const [session, setSession] = useState<UnlockedSession | null>(null)
  document.documentElement.classList.toggle('dark', localStorage.getItem('hverdagsro-theme') === 'dark')
  document.documentElement.classList.toggle('large-text', localStorage.getItem('hverdagsro-large') === 'true')
  document.documentElement.classList.toggle('high-contrast', localStorage.getItem('hverdagsro-contrast') === 'true')
  if (!session) return <Login onLogin={setSession} />
  const signOut = async () => {
    try {
      const response = await fetch('/api/auth/logout', { method: 'POST', headers: { Authorization: `Bearer ${session.token}` } })
      if (!response.ok && response.status !== 401) throw new Error('Serveren kunne ikke afslutte sessionen.')
    } catch {
      if (!window.confirm('Serveren kunne ikke afslutte sessionen. Vil du låse denne enhed alligevel? Sessionen kan være gyldig, indtil den udløber.')) return
    }
    setSession(null)
  }
  return <StoreProvider session={session} signOut={signOut}><Layout /></StoreProvider>
}
