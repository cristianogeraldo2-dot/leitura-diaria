/**
 * Camada analítica da operação — funções puras, sem inventar números.
 *
 * Entrada: knowledge/operacao.json (ver knowledge/operacao.exemplo.json).
 * Definições usadas (podem ser ajustadas com a Cris):
 *   conversão       = vendas ÷ casais Q (qualificados)
 *   taxa de Q       = Q ÷ casais
 *   ritmo esperado  = meta × progressoDia (fração do dia/turno já decorrida)
 * Tudo que depende de um campo ausente volta como `null` — nunca como estimativa.
 */

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const div = (a, b) => (num(a) !== null && num(b) !== null && b !== 0 ? a / b : null)
const pct = (x) => (x === null ? null : Math.round(x * 1000) / 10)

export const ALERT = {
  BELOW_PACE: '⚠ META ABAIXO DO RITMO',
  CONVERSION_DROP: '⚠ CONVERSÃO CAINDO',
  LOW_PROD: '⚠ PRODUTIVIDADE BAIXA',
  ON_PACE: '✓ META NO RITMO',
  ABOVE_AVG: '✓ PERFORMANCE ACIMA DA MÉDIA',
  RECOVERY: '🔥 OPORTUNIDADE DE RECUPERAÇÃO',
}

export function analyze(data) {
  if (!data || typeof data !== 'object') return { available: false, reason: 'Não tenho esse dado disponível.' }
  const r = data.realizado ?? {}
  const m = data.meta ?? {}
  const alerts = []

  const dados = {
    data: data.data ?? null,
    casais: num(r.casais),
    q: num(r.q),
    nq: num(r.nq),
    vendas: num(r.vendas),
    cotas: num(r.cotas),
    vgv: num(r.vgv),
    meta: { casais: num(m.casais), vendas: num(m.vendas), vgv: num(m.vgv), cotas: num(m.cotas) },
    taxaQ: pct(div(r.q, r.casais)),
    // conversão = vendas de casais Q ÷ Q (quando o dashboard separa Q de NQ), senão vendas ÷ Q
    conversao: pct(div(num(r.qComVenda) !== null ? r.qComVenda : r.vendas, r.q)),
    conversaoGeral: pct(div(r.vendas, r.casais)), // casais com venda ÷ casais presentes
    gap: {
      casais: num(m.casais) !== null && num(r.casais) !== null ? m.casais - r.casais : null,
      vendas: num(m.vendas) !== null && num(r.vendas) !== null ? m.vendas - r.vendas : null,
      vgv: num(m.vgv) !== null && num(r.vgv) !== null ? m.vgv - r.vgv : null,
      cotas: num(m.cotas) !== null && num(r.cotas) !== null ? m.cotas - r.cotas : null,
    },
    atingimentoCasais: pct(div(r.casais, m.casais)),
    atingimentoVgv: pct(div(r.vgv, m.vgv)),
    atingimentoCotas: pct(div(r.cotas, m.cotas)),
    atingimentoMetasEscalonadas: Object.fromEntries(
      Object.entries(data.metasEscalonadas ?? {}).map(([k, v]) => [k, pct(div(r.cotas, v))]),
    ),
    propostas: num(r.propostas),
    compradores: num(r.compradores),
    comparativos: data.comparativos ?? null,
    metricasDiarias: Array.isArray(data.metricasDiarias) ? data.metricasDiarias : [],
  }

  // Ritmo: só avaliado se o progresso do dia foi informado.
  const prog = num(data.progressoDia)
  let ritmo = null
  const base = [['casais', dados.atingimentoCasais], ['VGV', dados.atingimentoVgv], ['cotas', dados.atingimentoCotas]].find(([, v]) => v !== null)
  if (prog !== null && prog > 0 && base) {
    const [bn, bv] = base
    ritmo = Math.round((bv / 100 / prog) * 1000) / 1000 // 1.0 = exatamente no ritmo
    if (ritmo < 0.9) alerts.push({ code: 'META_ABAIXO_DO_RITMO', label: ALERT.BELOW_PACE, why: `Atingimento de ${bn} em ${bv}% com ${pct(prog)}% do dia decorrido.` })
    else if (ritmo >= 0.95) alerts.push({ code: 'META_NO_RITMO', label: ALERT.ON_PACE, why: `Atingimento de ${bn} em ${bv}% com ${pct(prog)}% do dia decorrido.` })
    const gapBase = bn === 'casais' ? dados.gap.casais : bn === 'VGV' ? dados.gap.vgv : dados.gap.cotas
    const realBase = bn === 'casais' ? r.casais : bn === 'VGV' ? r.vgv : r.cotas
    if (ritmo < 0.9 && prog < 1 && gapBase > 0) {
      const needed = gapBase / (1 - prog)
      const current = realBase / prog
      if (current > 0 && needed / current <= 1.5)
        alerts.push({ code: 'OPORTUNIDADE_RECUPERACAO', label: ALERT.RECOVERY, why: `Faltam ${gapBase} (${bn}); exige ${Math.round((needed / current) * 100)}% do ritmo atual no restante do dia.` })
    }
  }

  // Conversão caindo: compara com a média do histórico, se houver.
  const hist = Array.isArray(data.historico) ? data.historico : []
  const hconv = hist.map((h) => div(h.vendas, h.q)).filter((x) => x !== null)
  const avgConv = hconv.length ? hconv.reduce((a, b) => a + b, 0) / hconv.length : null
  if (avgConv !== null && dados.conversao !== null && dados.conversao / 100 < avgConv * 0.85)
    alerts.push({ code: 'CONVERSAO_CAINDO', label: ALERT.CONVERSION_DROP, why: `Conversão ${dados.conversao}% contra média histórica de ${pct(avgConv)}%.` })

  // Captadores
  const caps = (Array.isArray(data.captadores) ? data.captadores : []).map((c) => ({
    nome: c.nome,
    casais: num(c.casais) ?? 0,
    q: num(c.q) ?? 0,
    nq: num(c.nq) ?? 0,
    vendas: num(c.vendas) ?? 0,
    vgv: num(c.vgv) ?? 0,
    taxaQ: pct(div(c.q, c.casais)),
  }))
  let equipe = null
  if (caps.length) {
    const avg = caps.reduce((a, c) => a + c.casais, 0) / caps.length
    const ranking = [...caps].sort((a, b) => b.casais - a.casais || b.q - a.q)
    const baixos = caps.filter((c) => avg > 0 && c.casais < avg * 0.5).map((c) => c.nome)
    const altos = caps.filter((c) => avg > 0 && c.casais > avg * 1.3).map((c) => c.nome)
    equipe = { captadores: caps.length, mediaCasais: Math.round(avg * 10) / 10, ranking: ranking.map((c, i) => ({ pos: i + 1, ...c })), atencao: baixos, destaque: altos }
    if (baixos.length) alerts.push({ code: 'PRODUTIVIDADE_BAIXA', label: ALERT.LOW_PROD, why: `Abaixo de 50% da média da equipe: ${baixos.join(', ')}.` })
    if (altos.length) alerts.push({ code: 'PERFORMANCE_ACIMA_DA_MEDIA', label: ALERT.ABOVE_AVG, why: `Acima de 130% da média: ${altos.join(', ')}.` })
    // Gargalo: etapa com maior perda proporcional
    const casais = caps.reduce((a, c) => a + c.casais, 0)
    const q = caps.reduce((a, c) => a + c.q, 0)
    const vendas = caps.reduce((a, c) => a + c.vendas, 0)
    equipe.funil = { casais, q, vendas, casaisParaQ: pct(div(q, casais)), qParaVenda: pct(div(vendas, q)) }
  }

  // Indicativo: a etapa do funil com a menor taxa de passagem entre as medidas.
  const f = equipe?.funil
  const gargalo = f && f.casaisParaQ !== null && f.qParaVenda !== null
    ? (f.casaisParaQ < f.qParaVenda ? 'qualificação (casal → Q)' : 'fechamento (Q → venda)')
    : null

  const avisos = []
  if (data.geradoEm) avisos.push(`Dados do dashboard gerados em ${data.geradoEm}.`)
  if (!caps.length) avisos.push('Não tenho dados por captador (ranking e produtividade individual indisponíveis).')
  if (prog === null) avisos.push('Progresso do dia não informado: alertas de ritmo não avaliados.')
  if (Array.isArray(data.derivados) && data.derivados.length) avisos.push(`Valores derivados (calculados): ${data.derivados.join(', ')}.`)
  return { available: true, fonte: data.fonte ?? 'manual', geradoEm: data.geradoEm ?? null, avisos, dados, ritmo, equipe, gargalo, alertas: alerts, historicoDias: hist.length }
}
