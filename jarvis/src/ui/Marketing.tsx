import { useEffect, useState } from 'react'
import { BRIDGE_WS_URL } from '../config'

/**
 * DIRETOR DE MARKETING — painel de @cristianogeraldo.ofc. Tudo vem da bridge (/jarvis/marketing).
 * Nenhum número é estimado aqui: sem dado, mostra "Não tenho esse dado disponível."
 */
const HTTP = BRIDGE_WS_URL.replace(/^ws/, 'http')
const ND = 'Não tenho esse dado disponível.'

type Item = { id: string; tipo: string; titulo: string; status: string; agendadoPara?: string | null }
type Painel = {
  conta: string
  modoDiretor: { ativo: boolean; modo: string; aviso: string | null }
  conteudoDeHoje: Item[]
  proximoConteudo: Item | null
  producao: { rascunhos: number; aprovados: number; publicados: number; semMidia: number; comVideoLocal: number }
  calendario: Item[]
  publicacoes: { id: string; titulo: string; idMidia: string | null; publicadoEm: string }[]
  desempenho: { disponivel?: boolean; posts?: number }
  melhoresConteudos: { legenda: string | null; tipo: string | null; taxaEngajamento: number | null }[]
  piorConteudo: { legenda: string | null; tipo: string | null; taxaEngajamento: number | null } | null
  seguidoresGanhos: { disponivel: boolean }
  recomendacao: string
  proximaAcao: string
}

const fmt = (v?: string | null) => (v ? v.replace('T', ' ').slice(0, 16) : 'sem horário')

export function Marketing() {
  const [p, setP] = useState<Painel | null>(null)
  useEffect(() => {
    let live = true
    const pull = async () => {
      try {
        const r = await fetch(`${HTTP}/jarvis/marketing`)
        if (live) setP(await r.json())
      } catch {
        if (live) setP(null)
      }
    }
    void pull()
    const t = setInterval(pull, 30_000)
    return () => {
      live = false
      clearInterval(t)
    }
  }, [])

  const box = { whiteSpace: 'normal' as const, maxWidth: 260, marginLeft: 'auto' }
  const hoje = p?.conteudoDeHoje ?? []
  const des = p?.desempenho
  return (
    <div className="intel" aria-label="DIRETOR DE MARKETING" style={{ marginTop: 14, textAlign: 'right' }}>
      <div className="rail-title">DIRETOR DE MARKETING</div>
      {!p && <div className="rail-item dim">Aguardando a bridge…</div>}
      {p && (
        <>
          <div className="rail-item dim">@{p.conta} · {p.modoDiretor.modo === 'revisao' ? 'REVISÃO (você confirma)' : p.modoDiretor.modo}</div>
          <div className="rail-item" style={box}>HOJE: {hoje.length ? hoje.map((c) => `${c.tipo} “${c.titulo}” ${fmt(c.agendadoPara).slice(11)} [${c.status}]`).join(' · ') : 'nada agendado'}</div>
          <div className="rail-item" style={box}>PRÓXIMO: {p.proximoConteudo ? `${p.proximoConteudo.tipo} “${p.proximoConteudo.titulo}” ${fmt(p.proximoConteudo.agendadoPara)}` : 'nenhum'}</div>
          <div className="rail-item">PRODUÇÃO: {p.producao.rascunhos} rascunho · {p.producao.aprovados} aprovado · {p.producao.publicados} publicado · {p.producao.semMidia} sem mídia</div>
          <div className="rail-item">CALENDÁRIO: {p.calendario.length} nos próximos dias</div>
          <div className="rail-item">PUBLICAÇÕES: {p.publicacoes.length ? p.publicacoes.map((x) => x.idMidia ?? 'sem id').slice(0, 3).join(', ') : 'nenhuma registrada'}</div>
          <div className="rail-item" style={box}>ALCANCE / VIEWS / ENGAJAMENTO: {des?.disponivel === false ? ND : `${des?.posts ?? 0} post(s) importados`}</div>
          <div className="rail-item">SEGUIDORES GANHOS: {p.seguidoresGanhos.disponivel ? 'ver Insights' : ND}</div>
          <div className="rail-item" style={box}>MELHOR: {p.melhoresConteudos[0] ? `${p.melhoresConteudos[0].tipo ?? 'post'} · ${p.melhoresConteudos[0].taxaEngajamento}%` : ND}</div>
          <div className="rail-item" style={box}>PIOR: {p.piorConteudo ? `${p.piorConteudo.tipo ?? 'post'} · ${p.piorConteudo.taxaEngajamento}%` : ND}</div>
          <div className="rail-item" style={box} title={p.recomendacao}>RECOMENDAÇÃO: {p.recomendacao}</div>
          <div className="rail-item" style={box}>PRÓXIMA AÇÃO: {p.proximaAcao}</div>
          {p.modoDiretor.aviso && <div className="rail-item dim" style={box}>{p.modoDiretor.aviso}</div>}
        </>
      )}
    </div>
  )
}
