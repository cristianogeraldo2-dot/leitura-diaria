import { tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DIRS, log, redact } from './home.mjs'
import { createStore } from './instagram.mjs'

/**
 * DIRETOR DE MARKETING — camada de decisão sobre o que já existe (perfil, rascunhos, métricas,
 * publicação oficial). Não duplica armazenamento: lê o store do Instagram e guarda só campanhas e
 * aprendizados. Tudo vem de dados reais; sem dado, diz "Não tenho esse dado disponível.".
 * Publicação continua exigindo a confirmação da Cris (DIRECTOR_REVIEW). DIRECTOR_AUTONOMOUS é
 * reconhecido, mas NÃO está implementado: cai em revisão e avisa.
 */
export const CONTA_OFICIAL = 'cristianogeraldo.ofc'
export const MARCA = {
  arroba: CONTA_OFICIAL,
  posicionamento: 'Liderança, Performance, Legado',
  publico: 'líderes, gestores, profissionais de vendas e pessoas que querem evolução pessoal e profissional',
  regras: ['sem mostrar clientes nem funcionários', 'sem nomes, números internos ou dados da empresa', 'sem promessa de ganho financeiro', 'linguagem forte, humana, elegante e autoral; sem frases genéricas de coach'],
}
const text = (t) => ({ content: [{ type: 'text', text: typeof t === 'string' ? t : JSON.stringify(t, null, 2) }] })
const readJ = (f, fb) => { try { return JSON.parse(readFileSync(f, 'utf8')) } catch { return fb } }

/** MARKETING_DIRECTOR_MODE=true liga o diretor; DIRECTOR_AUTONOMOUS ainda não publica sozinho. */
export function modoDiretor(env = process.env) {
  const ativo = String(env.MARKETING_DIRECTOR_MODE).toLowerCase() === 'true'
  const pediuAutonomo = String(env.DIRECTOR_AUTONOMOUS).toLowerCase() === 'true'
  return {
    ativo,
    modo: 'revisao',
    pediuAutonomo,
    aviso: pediuAutonomo ? 'DIRECTOR_AUTONOMOUS ainda não está implementado: o JARVIS cria e prepara tudo, mas só publica com o seu "confirmo" (DIRECTOR_REVIEW).' : null,
  }
}

const AGENDA_PADRAO = [
  { hora: '07:00', tarefa: 'analisar desempenho' }, { hora: '07:10', tarefa: 'identificar oportunidades' },
  { hora: '07:20', tarefa: 'definir o conteúdo do dia' }, { hora: '07:30', tarefa: 'produzir o roteiro' },
  { hora: '08:00', tarefa: 'produzir/editar a mídia' }, { hora: '12:00', tarefa: 'revisar a estratégia' },
  { hora: '18:00', tarefa: 'preparar a publicação' }, { hora: '20:00', tarefa: 'publicar conforme o calendário (com sua confirmação)' },
  { hora: '23:30', tarefa: 'analisar o resultado e registrar o aprendizado' },
]
/** Horários configuráveis em config/marketing-agenda.json: [{ "hora": "07:00", "tarefa": "..." }] */
export function agenda(arquivo = join(DIRS.config, 'marketing-agenda.json')) {
  const a = readJ(arquivo, null)
  const ok = Array.isArray(a) && a.length && a.every((x) => /^\d{2}:\d{2}$/.test(x?.hora ?? '') && typeof x.tarefa === 'string')
  return (ok ? a : AGENDA_PADRAO).slice().sort((x, y) => x.hora.localeCompare(y.hora))
}
export function proximaAcao(agora = new Date(), ag = agenda()) {
  const hhmm = `${String(agora.getHours()).padStart(2, '0')}:${String(agora.getMinutes()).padStart(2, '0')}`
  return ag.find((x) => x.hora >= hhmm) ?? { ...ag[0], amanha: true }
}

export function createMarketingStore(dir = DIRS.knowledge) {
  const f = join(dir, 'instagram', 'marketing.json')
  const ler = () => readJ(f, { campanhas: [], aprendizados: [] })
  const gravar = (d) => { writeFileSync(f, JSON.stringify(d, null, 2)) }
  return {
    ler,
    campanha: (c) => { const d = ler(); const i = d.campanhas.findIndex((x) => x.nome === c.nome); const novo = { ...c, atualizadoEm: new Date().toISOString() }; if (i >= 0) d.campanhas[i] = novo; else d.campanhas.push(novo); gravar(d); return novo },
    aprendizado: (a) => { const d = ler(); const x = { id: `${Date.now().toString(36)}`, registradoEm: new Date().toISOString(), ...a }; d.aprendizados.push(x); d.aprendizados = d.aprendizados.slice(-100); gravar(d); return x },
  }
}

const dia = (d) => String(d ?? '').slice(0, 10)
const quando = (v) => { const t = String(v ?? '').trim(); if (!t) return NaN; return Date.parse(/(z|[+-]\d{2}:?\d{2})$/i.test(t) ? t : `${t.replace(' ', 'T')}-03:00`) }

/** Revisão editorial determinística: o que dá para checar sem inventar nada. */
export function revisarRascunho(x) {
  const av = []
  const leg = `${x.titulo ?? ''} ${x.legenda ?? ''} ${x.roteiro ?? ''} ${x.textoNaArte ?? ''}`
  if (/garant(ido|ia)|ganhe\s+r\$|renda\s+extra|fique\s+rico|lucro\s+certo/i.test(leg)) av.push('Promessa de ganho financeiro: remova.')
  if (/\b(cliente|clientes|funcion[aá]rio|captador|casal|casais|cotas?|vgv|vila\s+dia|gav)\b/i.test(leg)) av.push('Cita termos internos da operação (cliente, captador, cotas, VGV, Vila Dia, GAV): confira se pode ser público.')
  if (/\d+\s*%|\br\$\s*\d/i.test(leg) && !x.fonteDados) av.push('Tem número sem fonte registrada: só publique se for real e liberado.')
  if (x.tipo === 'reel' && !x.roteiro) av.push('Reel sem roteiro.')
  if (!x.legenda) av.push('Sem legenda.')
  if (!/salv|compartilh|coment|segu|mande|marque|responda|conta pra mim/i.test(`${x.legenda ?? ''} ${x.roteiro ?? ''}`)) av.push('Sem CTA claro (salvar, compartilhar, comentar).')
  if ((x.hashtags ?? []).length > 15) av.push('Hashtags demais (use de 3 a 8).')
  if (/\b(acredite|segredo|truque|f[oó]rmula\s+m[aá]gica|mindset\s+de\s+campe)/i.test(leg)) av.push('Linguagem de coach genérico: reescreva com uma cena ou exemplo real, anônimo.')
  if (x.tipo === 'reel' && !(x.midiaUrls?.length || x.videoLocal)) av.push('Sem mídia ainda (vídeo local ou URL https pública).')
  return { id: x.id, titulo: x.titulo, aprovadoParaPublicar: av.filter((a) => !/Sem mídia/.test(a)).length === 0, avisos: av }
}

/** Painel do diretor: só dados reais. */
export function painel({ store = createStore(), mk = createMarketingStore(), agora = new Date(), env = process.env, ag = agenda() } = {}) {
  const rasc = store.listar()
  const hoje = dia(agora.toISOString())
  const comHorario = rasc.filter((x) => Number.isFinite(quando(x.agendadoPara)))
  const doDia = comHorario.filter((x) => dia(new Date(quando(x.agendadoPara)).toISOString()) === hoje || String(x.agendadoPara).slice(0, 10) === hoje).sort((a, b) => quando(a.agendadoPara) - quando(b.agendadoPara))
  const futuros = comHorario.filter((x) => quando(x.agendadoPara) > agora.getTime() && x.status !== 'publicado').sort((a, b) => quando(a.agendadoPara) - quando(b.agendadoPara))
  const publicados = rasc.filter((x) => x.status === 'publicado').map(({ id, titulo, tipo, campanha, idMidia, publicadoEm }) => ({ id, titulo, tipo, campanha: campanha ?? null, idMidia: idMidia ?? null, publicadoEm }))
  const m = readJ(store.metricasF, null)
  const metricas = m?.posts ? {
    importadoEm: m.importadoEm, posts: m.posts, avisos: m.avisos ?? [],
    melhores: (m.melhores ?? []).slice(0, 3), mediaPorTipo: m.mediaPorTipo ?? {},
    pior: m.pior ?? null,
  } : null
  const tipos = metricas ? Object.entries(metricas.mediaPorTipo).sort((a, b) => b[1].taxaMedia - a[1].taxaMedia) : []
  const aprendizados = mk.ler().aprendizados.slice(-3)
  const modo = modoDiretor(env)
  const prod = {
    rascunhos: rasc.filter((x) => x.status === 'rascunho').length,
    aprovados: rasc.filter((x) => x.status === 'aprovado').length,
    publicados: publicados.length,
    semMidia: rasc.filter((x) => x.status !== 'publicado' && !(x.midiaUrls?.length || x.videoLocal)).length,
    comVideoLocal: rasc.filter((x) => x.videoLocal && existsSync(x.videoLocal)).length,
  }
  let recomendacao
  if (!metricas) recomendacao = 'Não tenho dados de desempenho. Exporte o Insights do Instagram (Painel profissional → Insights) para knowledge/instagram/entrada e peça "analise o Instagram".'
  else if (tipos.length) recomendacao = `Pelos dados importados, o formato de maior engajamento médio é "${tipos[0][0]}" (${tipos[0][1].taxaMedia}% em ${tipos[0][1].posts} post(s)). ${metricas.posts < 5 ? 'Amostra pequena: é indicativo, não conclusivo.' : 'Priorize esse formato e teste ganchos novos nele.'}`
  else recomendacao = 'Há métricas importadas, mas sem coluna de tipo/formato para comparar formatos.'
  const proxima = proximaAcao(agora, ag)
  return {
    conta: MARCA.arroba, posicionamento: MARCA.posicionamento, modoDiretor: modo,
    conteudoDeHoje: doDia.map(({ id, tipo, titulo, status, agendadoPara }) => ({ id, tipo, titulo, status, agendadoPara })),
    proximoConteudo: futuros[0] ? { id: futuros[0].id, tipo: futuros[0].tipo, titulo: futuros[0].titulo, status: futuros[0].status, agendadoPara: futuros[0].agendadoPara } : null,
    producao: prod,
    calendario: futuros.slice(0, 7).map(({ id, tipo, titulo, status, agendadoPara }) => ({ id, tipo, titulo, status, agendadoPara })),
    publicacoes: publicados.slice(0, 10),
    desempenho: metricas ?? { disponivel: false, motivo: 'Não tenho esse dado disponível.' },
    seguidoresGanhos: { disponivel: false, motivo: 'Não tenho esse dado disponível. O Insights exportado precisa trazer a coluna de seguidores.' },
    melhoresConteudos: metricas?.melhores ?? [],
    piorConteudo: metricas?.pior ?? null,
    aprendizadosRecentes: aprendizados,
    recomendacao, proximaAcao: `${proxima.hora}${proxima.amanha ? ' (amanhã)' : ''} — ${proxima.tarefa}`,
    agenda: ag,
  }
}

export function marketingTools(store = createStore(), mk = createMarketingStore()) {
  return [
    tool('marketing_painel', 'Painel do DIRETOR DE MARKETING de @cristianogeraldo.ofc: conteúdo de hoje, próximo, produção, calendário, publicações, desempenho, melhores/pior, recomendação e próxima ação. Só dados reais; campos sem dado dizem "Não tenho esse dado disponível". Use para "qual é a estratégia de hoje", "analise o Instagram" e "qual conteúdo performou melhor".', {}, async () => { log('tool', 'marketing_painel'); return text(painel({ store, mk })) }),
    tool('marketing_revisar', 'Revisão editorial de um rascunho (ou de todos os pendentes): promessa financeira, termos internos da empresa, número sem fonte, CTA, hashtags, coach genérico e mídia. Não altera nada. Use em "revise o conteúdo".', { id: z.string().optional() }, async ({ id }) => {
      const alvo = id ? [store.obter(id)].filter(Boolean) : store.listar().filter((x) => x.status !== 'publicado')
      if (!alvo.length) return text('Não encontrei rascunho para revisar.')
      return text(alvo.map(revisarRascunho))
    }),
    tool('marketing_campanha_definir', 'Cria ou atualiza uma campanha (nome, objetivo, pilares, regras). Só local. As regras servem de checklist para revisar o conteúdo.', { nome: z.string().min(2).max(60), objetivo: z.string().max(300), pilares: z.array(z.string().max(80)).max(8).optional(), regras: z.array(z.string().max(200)).max(12).optional() }, async (c) => {
      const x = mk.campanha(JSON.parse(redact(JSON.stringify(c)))); log('tool', `marketing_campanha_definir ${c.nome}`); return text({ salvo: true, campanha: x })
    }),
    tool('marketing_aprendizado_registrar', 'Registra o aprendizado de uma publicação ou semana: o que funcionou, o que falhou e o que mudar no próximo conteúdo. Use só fatos e números que vieram das métricas importadas.', { rascunhoId: z.string().optional(), funcionou: z.string().max(400).optional(), falhou: z.string().max(400).optional(), proximoPasso: z.string().max(400) }, async (a) => {
      const x = mk.aprendizado(JSON.parse(redact(JSON.stringify(a)))); log('tool', 'marketing_aprendizado_registrar'); return text({ registrado: true, id: x.id })
    }),
  ]
}
