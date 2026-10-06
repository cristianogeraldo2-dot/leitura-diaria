/**
 * Converte a exportação do "Radar Vila Dia" (artefato mantido pela Cris) em knowledge/operacao.json.
 * Definições da operação (vindas do próprio Radar):
 *   Total de Qs        = Q + NQ com venda
 *   NQ                 = presenças − Q
 *   aproveitamento     = Total de Qs ÷ presenças
 *   eficiência Qs      = cotas ÷ Total de Qs · comprador = compradores ÷ presenças · geral = cotas ÷ presenças
 * Nada é estimado: campo ausente fica null; derivados ficam listados.
 */
const n = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const div = (a, b) => (n(a) !== null && n(b) !== null && b !== 0 ? a / b : null)
const pct = (x) => (x === null ? null : Math.round(x * 1000) / 10)

/** '05/10/2026 · Sala' | '05/10/2026 23:02:09' → '2026-10-05' (ou null) */
export function parseRef(ref, ano) {
  const m = /(\d{2})\/(\d{2})(?:\/(\d{4}))?/.exec(String(ref ?? ''))
  if (!m) return null
  return `${m[3] ?? ano}-${m[2]}-${m[1]}`
}

export function validateRadar(x) {
  return x && typeof x === 'object' && x.SNAP && x.REAL && Array.isArray(x.CAPTADORES)
}

export function radarToOperacao(x) {
  const { SNAP, REAL, CAPTADORES } = x
  const data = parseRef(SNAP.ref, SNAP.ano)
  const casais = n(REAL.presencas)
  const q = n(REAL.qVenda) // Q (sem NQ com venda)
  const nqCv = n(REAL.nqVenda)
  const totalQs = q !== null && nqCv !== null ? q + nqCv : null

  // Progresso do mês em "unidades de peso" (seg–qui 1,0 · sex 1,3 · sáb/dom 1,6), até o dia da carga inclusive.
  let progressoMes = null
  if (data && SNAP.pesos && Number.isInteger(SNAP.mesIdx)) {
    const [Y, M, D] = data.split('-').map(Number)
    const dias = new Date(Y, M, 0).getDate()
    let total = 0, ate = 0
    for (let d = 1; d <= dias; d++) {
      const w = new Date(Y, M - 1, d).getDay()
      const peso = w === 5 ? SNAP.pesos.sex : w === 0 || w === 6 ? SNAP.pesos.fds : SNAP.pesos.util
      total += peso
      if (d <= D) ate += peso
    }
    progressoMes = total ? Math.round((ate / total) * 1000) / 1000 : null
  }

  const captadores = CAPTADORES.map((c) => {
    const semRegistro = c.q === null || c.q === undefined
    return {
      nome: c.nome, equipe: c.equipe ?? null, semRegistro,
      casais: semRegistro ? null : n(c.pres),
      q: semRegistro ? null : n(c.q),
      nq: semRegistro || n(c.pres) === null ? null : c.pres - c.q,
      nqComVenda: n(c.nqv),
      validos: n(c.valid),
      vendas: n(c.vendas),
      vgv: n(c.valor),
    }
  })

  const diario = Object.entries(x.DIARIO ?? {}).map(([dia, v]) => ({ dia, casais: n(v.casais), vendas: n(v.vendas), vgv: n(v.vgv), qs: n(v.qs), compradores: n(v.comp) }))

  const avisos = []
  const pend = (x.FONTES ?? []).filter((f) => f && f.conf === 'pendente').map((f) => f.nome)
  if (pend.length) avisos.push(`Fontes pendentes de carga: ${pend.join('; ')}.`)

  return {
    data,
    fonte: 'radar-artifact',
    geradoEm: data ? `${data}T23:59:59Z` : null,
    carimbo: SNAP.ref ?? null,
    mes: SNAP.mes ?? null,
    progressoDia: null,
    progressoMes,
    meta: { casais: null, vendas: n(SNAP.metaCotas), vgv: n(SNAP.metaVgv), cotas: n(SNAP.metaCotas), qs: n(SNAP.metaQs) },
    pesos: SNAP.pesos ?? null,
    realizado: {
      casais, q, nqComVenda: nqCv, totalQs,
      nq: casais !== null && q !== null ? casais - q : null, // DERIVADO: presenças − Q
      cotas: n(REAL.cotasVendidas), vendas: n(REAL.cotasVendidas), vgv: n(REAL.vgvVendido),
      compradores: n(REAL.compradores),
      propostas: n(REAL.qnqProposta), cotasPropostas: n(REAL.cotasPropostas), vgvPropostas: n(REAL.vgvPropostas),
    },
    eficiencias: {
      aproveitamentoQs: pct(div(totalQs, casais)),
      eficienciaQs: pct(div(REAL.cotasVendidas, totalQs)),
      comprador: pct(div(REAL.compradores, casais)),
      geral: pct(div(REAL.cotasVendidas, casais)),
    },
    diario,
    penetracao: x.PENETRACAO ?? {},
    planoFimDeSemana: x.PLANO_FDS ?? [],
    locais: (x.LOCAIS ?? []).map(([nome, qnqCv2, metaQ, pres]) => ({ nome, qnqComVenda: n(qnqCv2), metaQ: n(metaQ), presencas: n(pres) })),
    historico: [],
    captadores,
    avisosFonte: avisos,
    derivados: ['realizado.nq', 'realizado.totalQs', 'progressoMes', 'eficiencias.*'],
  }
}
