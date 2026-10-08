import { tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve, relative, isAbsolute } from 'node:path'
import { DIRS, log, redact } from './home.mjs'
import { readTable, toNumber } from './tabular.mjs'

/**
 * Módulo Instagram — ETAPA 1: criação de conteúdo, rascunhos e ranking do que funcionou.
 * Nada aqui fala com o Instagram: não há login, token nem publicação. Tudo fica em
 * knowledge/instagram/ (fora do Git). A publicação é uma etapa futura, oficial e com confirmação.
 */
export const IG_DIR = join(DIRS.knowledge, 'instagram')
const sub = (d, n) => { const p = join(d, n); mkdirSync(p, { recursive: true }); return p }

const text = (t) => ({ content: [{ type: 'text', text: typeof t === 'string' ? t : JSON.stringify(t, null, 2) }] })
const readJ = (f, fb) => { try { return JSON.parse(readFileSync(f, 'utf8')) } catch { return fb } }
const idNovo = () => `${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.random().toString(36).slice(2, 7)}`

export function createStore(dir = IG_DIR) {
  mkdirSync(dir, { recursive: true })
  const perfilF = join(dir, 'perfil.json')
  const rascD = sub(dir, 'rascunhos')
  return {
    dir,
    perfil: (patch) => {
      const atual = readJ(perfilF, {})
      if (patch && Object.keys(patch).length) writeFileSync(perfilF, JSON.stringify({ ...atual, ...patch, atualizadoEm: new Date().toISOString() }, null, 2))
      return readJ(perfilF, {})
    },
    salvar: (d) => {
      const id = idNovo()
      const item = { id, status: 'rascunho', criadoEm: new Date().toISOString(), ...d }
      writeFileSync(join(rascD, `${id}.json`), JSON.stringify(item, null, 2))
      return item
    },
    listar: (status) => readdirSync(rascD).filter((f) => f.endsWith('.json')).map((f) => readJ(join(rascD, f), null)).filter((x) => x && (!status || x.status === status)).sort((a, b) => String(b.criadoEm).localeCompare(String(a.criadoEm))),
    aprovar: (id) => {
      const f = join(rascD, `${String(id).replace(/[^\w-]/g, '')}.json`)
      if (!existsSync(f)) return null
      const x = readJ(f, null)
      x.status = 'aprovado'; x.aprovadoEm = new Date().toISOString()
      writeFileSync(f, JSON.stringify(x, null, 2))
      return x
    },
    aprovarLote: (ids) => ids.map((id) => {
      const f = join(rascD, `${String(id).replace(/[^\w-]/g, '')}.json`)
      const x = existsSync(f) ? readJ(f, null) : null
      if (!x) return { id, ok: false, motivo: 'não encontrado' }
      if (x.status === 'publicado') return { id, ok: false, motivo: 'já publicado' }
      x.status = 'aprovado'; x.aprovadoEm = new Date().toISOString()
      writeFileSync(f, JSON.stringify(x, null, 2))
      return { id, ok: true, titulo: x.titulo, tipo: x.tipo, agendadoPara: x.agendadoPara ?? null, temMidia: Boolean(x.midiaUrls?.length) }
    }),
    anexar: (id, campos) => {
      const f = join(rascD, `${String(id).replace(/[^\w-]/g, '')}.json`)
      const x = existsSync(f) ? readJ(f, null) : null
      if (!x) return null
      Object.assign(x, campos); writeFileSync(f, JSON.stringify(x, null, 2)); return x
    },
    registrarFalha: (id, motivo) => {
      const f = join(rascD, `${String(id).replace(/[^\w-]/g, '')}.json`)
      const x = readJ(f, null)
      if (!x) return null
      x.falhas = (x.falhas ?? 0) + 1; x.ultimaFalha = String(motivo).slice(0, 300); x.falhouEm = new Date().toISOString()
      writeFileSync(f, JSON.stringify(x, null, 2)); return x
    },
    obter: (id) => { const f = join(rascD, `${String(id).replace(/[^\w-]/g, '')}.json`); return existsSync(f) ? readJ(f, null) : null },
    marcarPublicado: (id, resultado) => {
      const f = join(rascD, `${String(id).replace(/[^\w-]/g, '')}.json`)
      const x = readJ(f, null)
      if (!x) return null
      x.status = 'publicado'; x.publicadoEm = new Date().toISOString(); x.idMidia = resultado.idMidia ?? null
      writeFileSync(f, JSON.stringify(x, null, 2)); return x
    },
    metricasF: join(dir, 'metricas.json'),
  }
}

// ---- Métricas: lê a exportação do Instagram Insights (CSV/XLSX) e ranqueia por engajamento ----
const COLS = {
  data: /data|date|publica|posted/i,
  tipo: /tipo|type|formato|format/i,
  alcance: /alcance|reach/i,
  views: /visualiza|views|impress|plays|reprodu/i,
  curtidas: /curtid|likes?/i,
  comentarios: /coment|comment/i,
  salvamentos: /salv|saves?/i,
  compartilhamentos: /compart|shares?/i,
  legenda: /legenda|caption|descri|t[ií]tulo|title/i,
  link: /link|permalink|url/i,
}

export function rankPosts({ headers, rows }, n = 5) {
  const idx = Object.fromEntries(Object.entries(COLS).map(([k, re]) => [k, headers.findIndex((h) => re.test(h))]))
  const num = (r, k) => (idx[k] >= 0 ? toNumber(r[idx[k]]) : null)
  const itens = rows.map((r) => {
    const alcance = num(r, 'alcance') ?? num(r, 'views')
    const curt = num(r, 'curtidas') ?? 0, com = num(r, 'comentarios') ?? 0, sal = num(r, 'salvamentos') ?? 0, comp = num(r, 'compartilhamentos') ?? 0
    const interacoes = curt + com + sal + comp
    // Peso maior para o que o algoritmo valoriza: salvar e compartilhar > comentar > curtir.
    const pontos = curt + 2 * com + 3 * sal + 3 * comp
    return {
      data: idx.data >= 0 ? r[idx.data] : null,
      tipo: idx.tipo >= 0 ? r[idx.tipo] : null,
      legenda: idx.legenda >= 0 ? String(r[idx.legenda] ?? '').slice(0, 140) : null,
      link: idx.link >= 0 ? r[idx.link] : null,
      alcance, curtidas: curt, comentarios: com, salvamentos: sal, compartilhamentos: comp,
      taxaEngajamento: alcance ? Math.round((pontos / alcance) * 10000) / 100 : null,
      interacoes,
    }
  }).filter((x) => x.alcance !== null || x.interacoes > 0)
  const com = itens.filter((x) => x.taxaEngajamento !== null)
  const top = [...com].sort((a, b) => b.taxaEngajamento - a.taxaEngajamento).slice(0, n)
  const porTipo = {}
  for (const x of com) { const t = x.tipo ?? 'sem tipo'; (porTipo[t] ??= []).push(x.taxaEngajamento) }
  const mediaTipo = Object.fromEntries(Object.entries(porTipo).map(([t, v]) => [t, { posts: v.length, taxaMedia: Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 100) / 100 }]))
  return {
    colunasReconhecidas: Object.fromEntries(Object.entries(idx).map(([k, i]) => [k, i >= 0 ? headers[i] : null])),
    posts: itens.length,
    comoCalculado: 'taxa = (curtidas + 2×comentários + 3×salvamentos + 3×compartilhamentos) ÷ alcance (ou visualizações), em %',
    melhores: top,
    pior: [...com].sort((a, b) => a.taxaEngajamento - b.taxaEngajamento)[0] ?? null,
    mediaPorTipo: mediaTipo,
    avisos: [
      ...(idx.alcance < 0 && idx.views < 0 ? ['Sem coluna de alcance/visualizações: não dá para calcular taxa de engajamento.'] : []),
      ...(itens.length < 5 ? ['Poucos posts na amostra: o ranking é indicativo, não conclusivo.'] : []),
    ],
  }
}

export function importarMetricas(arquivo, store, base = join(IG_DIR, 'entrada')) {
  mkdirSync(base, { recursive: true })
  const alvo = isAbsolute(arquivo) ? resolve(arquivo) : resolve(base, arquivo)
  const rel = relative(base, alvo)
  if (rel.startsWith('..') || isAbsolute(rel)) throw new Error(`Por segurança, só leio arquivos dentro de ${base}`)
  const r = rankPosts(readTable(alvo))
  writeFileSync(store.metricasF, JSON.stringify({ ...r, importadoEm: new Date().toISOString(), arquivo: rel }, null, 2))
  return r
}

export function instagramTools(store = createStore()) {
  return [
    tool('instagram_perfil', 'Lê (e, se vierem campos, atualiza) o perfil de marca da Cris no Instagram: @, nicho, público, tom de voz, metas, temas, o que evitar. Use antes de criar conteúdo. Se estiver vazio, pergunte à Cris em UMA pergunta por vez.', {
      arroba: z.string().optional(), nicho: z.string().optional(), publico: z.string().optional(), tom: z.string().optional(),
      metas: z.string().optional(), temas: z.array(z.string()).optional(), evitar: z.string().optional(), observacoes: z.string().optional(),
    }, async (a) => { log('tool', `instagram_perfil ${Object.keys(a).length ? 'update' : 'read'}`); return text(store.perfil(a)) }),
    tool('instagram_rascunho_salvar', 'Guarda um rascunho de conteúdo (post, carrossel, reel ou story) em knowledge/instagram. NÃO publica nada. Reel: gancho nos 3 primeiros segundos, roteiro por cena, texto na tela, CTA. Story: sequência de quadros com interação. Post: legenda, texto da arte, hashtags.', {
      tipo: z.enum(['post', 'carrossel', 'reel', 'story']), titulo: z.string().min(2).max(120), legenda: z.string().max(2200).optional(),
      roteiro: z.string().max(4000).optional(), textoNaArte: z.string().max(1500).optional(), hashtags: z.array(z.string()).max(30).optional(),
      objetivo: z.string().max(300).optional(), campanha: z.string().max(60).optional(), sugestaoDeDia: z.string().max(80).optional(),
      agendadoPara: z.string().max(40).optional().describe('data/hora sugerida para o post sair (ex.: 2026-10-12 18:30). É só sugestão: a publicação só acontece quando a Cris confirma'),
      midiaUrls: z.array(z.string().url()).max(10).optional().describe('URLs https PÚBLICAS da imagem/vídeo, necessárias só para publicar pela API'),
    }, async (d) => { const x = store.salvar(JSON.parse(redact(JSON.stringify(d)))); log('tool', `instagram_rascunho_salvar ${d.tipo}`); return text({ salvo: true, id: x.id, status: x.status, aviso: 'Rascunho guardado. Nada foi publicado.' }) }),
    tool('instagram_rascunhos', 'Lista os rascunhos guardados (opcionalmente por status: rascunho ou aprovado).', { status: z.enum(['rascunho', 'aprovado', 'publicado']).optional() }, async ({ status }) => text(store.listar(status).map(({ id, tipo, titulo, status: s, sugestaoDeDia, agendadoPara, midiaUrls }) => ({ id, tipo, titulo, status: s, sugestaoDeDia, agendadoPara: agendadoPara ?? null, temMidia: Boolean(midiaUrls?.length) })))),
    tool('instagram_aprovar', 'Marca um rascunho como APROVADO pela Cris (só depois de ela dizer que aprova). Aprovar não publica.', { id: z.string() }, async ({ id }) => { const x = store.aprovar(id); log('tool', `instagram_aprovar ${id}`); return text(x ? { aprovado: x.id, titulo: x.titulo, aviso: 'Aprovado para uso. A publicação é feita por você, ou numa etapa futura, com confirmação.' } : 'Não encontrei esse rascunho.') }),
    tool('instagram_aprovar_lote', 'Aprova VÁRIOS rascunhos de uma vez, só depois de a Cris dizer que aprova (ex.: "aprovo todos" do plano da semana). Passe os ids que ela aprovou; se ela disse "todos", use todos=true para os rascunhos ainda pendentes. Aprovar não publica.', { ids: z.array(z.string()).max(20).optional(), todos: z.boolean().optional() }, async ({ ids, todos }) => {
      const alvo = todos ? store.listar('rascunho').map((x) => x.id) : (ids ?? [])
      const r = store.aprovarLote(alvo); log('tool', `instagram_aprovar_lote ${r.filter((x) => x.ok).length}/${r.length}`)
      return text({ resultados: r, aviso: 'Aprovados para a fila. Nada foi publicado.' })
    }),
    tool('instagram_metricas_importar', 'Lê uma exportação do Instagram Insights (CSV/XLSX) que a Cris colocou em knowledge/instagram/entrada e calcula o ranking de engajamento. Só leitura da planilha.', { arquivo: z.string().describe('nome do arquivo dentro de knowledge/instagram/entrada') }, async ({ arquivo }) => {
      try { const r = importarMetricas(arquivo, store); log('tool', 'instagram_metricas_importar'); return text(r) } catch (e) { return text({ erro: String(e.message ?? e) }) }
    }),
    tool('instagram_melhores', 'Devolve o ranking dos melhores posts já calculado (a partir da última importação de métricas). Nunca invente números: se não houver importação, diga "Não tenho esse dado disponível" e peça a exportação do Insights.', {}, async () => {
      const m = readJ(store.metricasF, null)
      return text(m ?? { disponivel: false, motivo: 'Não tenho esse dado disponível.', comoObter: 'No Instagram: Painel profissional → Insights → exportar dados, e salve o arquivo em knowledge/instagram/entrada.' })
    }),
  ]
}
