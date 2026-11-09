import { useEffect, useState } from 'react'
import App from './App.tsx'
import WalletGate from './agent/WalletGate.tsx'

export default function AppShell() {
  const [hash, setHash] = useState(() => window.location.hash || '#/agent')
  const [dark, setDark] = useState(() => {
    try { return localStorage.getItem('recallloop.theme') !== 'light' } catch { return true }
  })
  useEffect(() => {
    const change = () => setHash(window.location.hash || '#/agent')
    window.addEventListener('hashchange', change)
    return () => window.removeEventListener('hashchange', change)
  }, [])
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
    try { localStorage.setItem('recallloop.theme', dark ? 'dark' : 'light') } catch { /* theme works without a cache */ }
  }, [dark])
  return hash.startsWith('#/console') ? <>
    <nav className="border-b border-secondary bg-secondary px-xl py-md text-sm"><a href="#/agent" className="rounded-md text-brand-primary underline focus-visible:ring-2 focus-visible:ring-focus-ring">← Back to coding workspace</a><span className="ml-lg text-xs text-tertiary">Legacy developer console · separate storage path. Its demo records are not wallet memory or Mainnet evidence.</span></nav><App />
  </> : <WalletGate dark={dark} onTheme={() => setDark(old => !old)} />
}
