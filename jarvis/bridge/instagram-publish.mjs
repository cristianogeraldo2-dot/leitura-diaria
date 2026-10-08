import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import { log, redact } from './home.mjs'
import { createStore } from './instagram.mjs'

/**
 * Publicação no Instagram pela API OFICIAL (Instagram Graph API). Sem navegador, sem senha.
 * Credenciais só por variáveis de ambiente (jarvis-secrets.cmd): IG_ACCESS_TOKEN e IG_USER_ID.
 * Sem credenciais, tudo roda em SIMULAÇÃO (nenhuma chamada de rede é feita).
 * A ferramenta de publicar fica num servidor MCP à parte (jarvis_social) que NÃO é liberado em decideTool:
 * cada publicação exige a confirmação por voz da Cris, para uma única chamada.
 */
const VERSAO = () => process.env.IG_GRAPH_VERSION || 'v21.0'
const BASE = () => `https://graph.facebook.com/${VERSAO()}`
const cred = () => ({ token: process.env.IG_ACCESS_TOKEN || '', uid: process.env.IG_USER_ID || '' })
export const contaEsperada = () => String(process.env.IG_EXPECTED_USERNAME || 'cristianogeraldo.ofc').replace(/^@/, '').toLowerCase()
export const configurado = () => Boolean(cred().token && cred().uid)

const text = (t) => ({ content: [{ type: 'text', text: typeof t === 'string' ? t : JSON.stringify(t, null, 2) }] })
const https = (u) => { try { return new URL(u).protocol === 'https:' } catch { return false } }

async function graph(fetchFn, method, path, params = {}) {
  const { token } = cred()
  const body = new URLSearchParams({ ...params, access_token: token })
  const url = method === 'GET' ? `${BASE()}${path}?${body}` : `${BASE()}${path}`
  const r = await fetchFn(url, method === 'GET' ? { method } : { method, headers: { 'content-type': 'application/x-www-form-urlencoded' }, body })
  const j = await r.json().catch(() => ({}))
  if (!r.ok || j.error) throw new Error(redact(`Instagram recusou (${r.status}): ${j.error?.message ?? 'erro desconhecido'}`).replaceAll(token, '[REDACTED]'))
  return j
}

export async function verificarConexao(fetchFn = fetch) {
  if (!configurado()) return { configurado: false, comoConfigurar: 'Defina IG_ACCESS_TOKEN e IG_USER_ID em jarvis-secrets.cmd (ver INSTAGRAM.md).' }
  try {
    const j = await graph(fetchFn, 'GET', `/${cred().uid}`, { fields: 'username,account_type' })
    return { configurado: true, ok: true, usuario: j.username ?? null, tipoDeConta: j.account_type ?? null, contaOficial: String(j.username ?? '').toLowerCase() === contaEsperada(), contaEsperada: contaEsperada() }
  } catch (e) { return { configurado: true, ok: false, erro: String(e.message) } }
}

/** Lista as Páginas do Facebook do token e a conta de Instagram ligada a cada uma (só leitura). */
export async function descobrirContas(fetchFn = fetch) {
  if (!cred().token) throw new Error('Defina IG_ACCESS_TOKEN no ambiente antes (nunca cole o token no chat).')
  const pags = await graph(fetchFn, 'GET', '/me/accounts', { fields: 'name,instagram_business_account{id,username}' })
  return (pags.data ?? []).map((p) => ({ pagina: p.name, instagramUserId: p.instagram_business_account?.id ?? null, usuario: p.instagram_business_account?.username ?? null }))
}

async function esperarContainer(fetchFn, id, tentativas = 30, espera = 2000, dormir = (ms) => new Promise((r) => setTimeout(r, ms))) {
  for (let i = 0; i < tentativas; i++) {
    const s = await graph(fetchFn, 'GET', `/${id}`, { fields: 'status_code' })
    if (s.status_code === 'FINISHED') return
    if (s.status_code === 'ERROR' || s.status_code === 'EXPIRED') throw new Error(`O Instagram não processou a mídia (${s.status_code}).`)
    await dormir(espera)
  }
  throw new Error('O Instagram demorou demais para processar a mídia. Tente de novo mais tarde.')
}

/** Publica um rascunho APROVADO. Retorna { simulado } sem credenciais. */
export async function publicarRascunho(item, { fetchFn = fetch, dormir } = {}) {
  if (!item) throw new Error('Rascunho não encontrado.')
  if (item.status !== 'aprovado') throw new Error('Só publico rascunhos APROVADOS pela Cris.')
  const urls = item.midiaUrls ?? []
  if (!urls.length) throw new Error('Este rascunho não tem mídia. A API do Instagram exige uma URL pública (https) da imagem ou do vídeo.')
  if (!urls.every(https)) throw new Error('Todas as mídias precisam ser URLs https públicas.')
  const legenda = [item.legenda ?? '', (item.hashtags ?? []).map((h) => (h.startsWith('#') ? h : `#${h}`)).join(' ')].filter(Boolean).join('\n\n')
  const ehVideo = (u) => /\.(mp4|mov)(\?|$)/i.test(u)
  if (item.tipo === 'carrossel' && urls.length < 2) throw new Error('Carrossel precisa de pelo menos 2 mídias.')
  if (!configurado()) return { simulado: true, tipo: item.tipo, midias: urls.length, aviso: 'Sem IG_ACCESS_TOKEN/IG_USER_ID: nada foi enviado ao Instagram.' }
  const uid = cred().uid
  // Nunca publicar em outra conta: confere o @ do token com a conta oficial ANTES de criar qualquer mídia.
  const quem = await graph(fetchFn, 'GET', `/${uid}`, { fields: 'username' })
  if (String(quem.username ?? '').toLowerCase() !== contaEsperada()) throw new Error(`Conta incorreta: o token pertence a @${quem.username ?? 'desconhecida'}, mas só publico em @${contaEsperada()}. Nada foi enviado.`)
  let container
  if (item.tipo === 'carrossel') {
    if (urls.length < 2) throw new Error('Carrossel precisa de pelo menos 2 mídias.')
    const filhos = []
    for (const u of urls) {
      const c = await graph(fetchFn, 'POST', `/${uid}/media`, { is_carousel_item: 'true', ...(ehVideo(u) ? { media_type: 'VIDEO', video_url: u } : { image_url: u }) })
      if (ehVideo(u)) await esperarContainer(fetchFn, c.id, undefined, undefined, dormir)
      filhos.push(c.id)
    }
    container = await graph(fetchFn, 'POST', `/${uid}/media`, { media_type: 'CAROUSEL', children: filhos.join(','), caption: legenda })
  } else if (item.tipo === 'reel') {
    container = await graph(fetchFn, 'POST', `/${uid}/media`, { media_type: 'REELS', video_url: urls[0], caption: legenda, share_to_feed: 'true' })
    await esperarContainer(fetchFn, container.id, undefined, undefined, dormir)
  } else if (item.tipo === 'story') {
    container = await graph(fetchFn, 'POST', `/${uid}/media`, { media_type: 'STORIES', ...(ehVideo(urls[0]) ? { video_url: urls[0] } : { image_url: urls[0] }) })
    if (ehVideo(urls[0])) await esperarContainer(fetchFn, container.id, undefined, undefined, dormir)
  } else {
    container = await graph(fetchFn, 'POST', `/${uid}/media`, { image_url: urls[0], caption: legenda })
  }
  const pub = await graph(fetchFn, 'POST', `/${uid}/media_publish`, { creation_id: container.id })
  return { simulado: false, tipo: item.tipo, idMidia: pub.id }
}

/** Servidor MCP separado: NÃO entra na lista liberada de decideTool, então exige confirmação por voz. */
export function socialServer(store = createStore()) {
  return createSdkMcpServer({
    name: 'jarvis_social',
    version: '1.0.0',
    instructions: 'Publicação no Instagram da Cris. Exige confirmação explícita por voz a cada publicação.',
    alwaysLoad: true,
    tools: [
      tool('instagram_publicar', 'PUBLICA no Instagram da Cris um rascunho APROVADO que tenha mídia (URL pública https). Isso fica PÚBLICO e é difícil de desfazer. Antes de chamar: diga em UMA frase o tipo, a legenda e a mídia, e pergunte "Confirma, Cris?". Só chame depois do "confirmo".', { id: z.string().describe('id do rascunho aprovado') }, async ({ id }) => {
        try {
          const item = store.obter(id)
          const r = await publicarRascunho(item)
          if (!r.simulado) store.marcarPublicado(id, r)
          log('instagram', `publicar ${id} simulado=${r.simulado}`)
          return text(r)
        } catch (e) { log('instagram', `publicar falhou ${id}`); return text({ erro: String(e.message ?? e) }) }
      }),
    ],
  })
}
