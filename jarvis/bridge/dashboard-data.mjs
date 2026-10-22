import { readFileSync } from 'node:fs'

/** Lê o snapshot de dados embutido no leao-da-vila-dashboard.html (somente leitura). */
function tryParse(txt) {
  const t = txt.trim()
  for (const cand of [t, b64(t)]) {
    if (!cand) continue
    try { return JSON.parse(cand) } catch { /* próximo */ }
  }
  return undefined
}
function b64(t) {
  if (!/^[A-Za-z0-9+/=\s]{40,}$/.test(t)) return null
  try { return Buffer.from(t.replace(/\s/g, ''), 'base64').toString('utf8') } catch { return null }
}

export function readSnapshot(file) {
  const html = readFileSync(file, 'utf8')
  const cands = []
  const el = /<([a-z0-9]+)[^>]*\bid=["']data-app-reviewed-snapshot["'][^>]*>([\s\S]*?)<\/\1>/i.exec(html)
  if (el) cands.push(el[2])
  for (const m of html.matchAll(/<script[^>]*type=["']application\/(?:json|ld\+json)["'][^>]*>([\s\S]*?)<\/script>/gi)) cands.push(m[1])
  for (const c of cands) {
    const d = tryParse(c)
    if (d && typeof d === 'object' && d.queries) return d
  }
  return null
}

const n = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const sub = (a, b) => (n(a) !== null && n(b) !== null ? a - b : null)

/** Converte o snapshot no formato de knowledge/operacao.json. Nada é estimado; o que é derivado fica listado. */
export function snapshotToOperacao(snap) {
  const q = snap.queries ?? {}
  const c = q.casais_detail?.rows?.[0] ?? {}
  const k = q.cotas_detail?.rows?.[0] ?? {}
  const v = q.vgv_detail?.rows?.[0] ?? {}
  const gen = typeof snap.generatedAt === 'string' ? snap.generatedAt : null
  const qComVenda = sub(c.qMaisNqComVenda, c.nqsComVendas)
  return {
    data: gen ? gen.slice(0, 10) : null,
    fonte: 'dashboard:snapshot',
    geradoEm: gen,
    statusDashboard: { status: snap.status ?? null, build: snap.buildStatus ?? null },
    progressoDia: null, // o dashboard não informa; só entra se a Cris informar
    meta: { casais: null, vendas: null, vgv: n(v.metaVgv), cotas: n(k.metaCotas) },
    metasEscalonadas: { superMeta: n(k.superMeta), megaMeta: n(k.megaMeta), metaEsparta: n(k.metaEsparta) },
    realizado: {
      casais: n(c.presencas),
      q: n(c.qsRealizados),
      nq: sub(c.presencas, c.qsRealizados), // DERIVADO: presenças − Qs realizados
      propostas: n(c.qMaisNqComProposta),
      vendas: n(c.qMaisNqComVenda), // casais (Q+NQ) com venda
      qComVenda, // DERIVADO: (Q+NQ com venda) − NQ com venda
      nqComVenda: n(c.nqsComVendas),
      cotas: n(k.cotasVendidas),
      compradores: n(k.compradoresPropostas),
      vgv: n(v.vendasVgv),
      vgvPropostas: n(v.propostasVgv),
    },
    comparativos: {
      casais: { anoAnterior: n(c.anoAnterior), mesAnterior: n(c.mesAnterior) },
      cotas: { anoAnterior: n(k.anoAnterior), mesAnterior: n(k.mesAnterior) },
      eficienciaVgv: { geral: n(v.eficienciaGeralPropostas), propostas: n(v.eficienciaPropostas), meta: n(v.eficienciaMeta), anoAnterior: n(v.eficienciaAnoAnterior), mesAnterior: n(v.eficienciaMesAnterior) },
    },
    metricasDiarias: (q.daily_metrics?.rows ?? []).map((r) => ({ metric: r.metric, actual: n(r.actual), target: n(r.target), attainment: n(r.attainment), gap: n(r.gap), unit: r.unit })),
    historico: [],
    captadores: [], // o snapshot NÃO traz dados por captador
    derivados: ['realizado.nq', 'realizado.qComVenda'],
  }
}
