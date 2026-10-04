import { useEffect, useState } from 'react'
import { BRIDGE_WS_URL } from '../config'

/**
 * JARVIS INTELLIGENCE — status dos componentes, modo ativo e alertas da operação.
 * Tudo vem da bridge (/jarvis/status e /jarvis/insight); nada é estimado aqui.
 */
const HTTP = BRIDGE_WS_URL.replace(/^ws/, 'http')
const MODE_LABEL: Record<string, string> = {
  padrao: 'PADRÃO',
  reuniao: 'MODO REUNIÃO',
  lideranca: 'MODO LIDERANÇA',
  analise: 'MODO ANÁLISE',
}

type Status = { claude: boolean; bridge: boolean; dashboard: boolean; mcp: boolean; modo: string }
type Alert = { code: string; label: string; why: string }
type Insight = { available: boolean; reason?: string; alertas?: Alert[] }

export function Intelligence() {
  const [st, setSt] = useState<Status | null>(null)
  const [ins, setIns] = useState<Insight | null>(null)

  useEffect(() => {
    let live = true
    const pull = async () => {
      try {
        const [a, b] = await Promise.all([fetch(`${HTTP}/jarvis/status`), fetch(`${HTTP}/jarvis/insight`)])
        if (!live) return
        setSt(await a.json())
        setIns(await b.json())
      } catch {
        if (live) setSt(null)
      }
    }
    void pull()
    const t = setInterval(pull, 10_000)
    return () => {
      live = false
      clearInterval(t)
    }
  }, [])

  const voice = typeof window !== 'undefined' && 'speechSynthesis' in window
  const row = (name: string, ok: boolean | undefined) => (
    <div className="rail-item" key={name}>
      {name}: <b style={{ color: ok ? '#4dffb0' : '#ff6b6b' }}>{ok ? 'ONLINE' : 'OFFLINE'}</b>
    </div>
  )
  const alerts = ins?.available ? (ins.alertas ?? []) : []

  return (
    <div className="intel" aria-label="JARVIS INTELLIGENCE" style={{ marginTop: 14, textAlign: 'right' }}>
      <div className="rail-title">JARVIS INTELLIGENCE</div>
      <div className="rail-item">
        <b style={{ color: st ? '#4dffb0' : '#ff6b6b' }}>● SYSTEM {st ? 'ONLINE' : 'OFFLINE'}</b>
      </div>
      {row('Claude', st?.claude)}
      {row('Voice', voice)}
      {row('Bridge', Boolean(st?.bridge))}
      {row('Dashboard', st?.dashboard)}
      {row('MCP', st?.mcp)}
      <div className="rail-item dim">MODO: {MODE_LABEL[st?.modo ?? 'padrao'] ?? 'PADRÃO'}</div>
      <div className="rail-title" style={{ marginTop: 10 }}>JARVIS INSIGHT</div>
      {!ins?.available && <div className="rail-item dim">Não tenho esse dado disponível.</div>}
      {ins?.available && alerts.length === 0 && <div className="rail-item dim">Sem alertas nos dados atuais.</div>}
      {alerts.map((a) => (
        <div className="rail-item" key={a.code} title={a.why}>
          {a.label}
        </div>
      ))}
    </div>
  )
}
