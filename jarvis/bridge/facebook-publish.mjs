import { redact } from './home.mjs'
import { jaPublicado, registrar, LOG_PADRAO } from './publicacao-log.mjs'

/**
 * Publicação na Página do Facebook pela API OFICIAL (Graph API). Sem navegador, sem senha.
 * Credenciais só por ambiente (jarvis-secrets.cmd): FB_PAGE_TOKEN e FB_PAGE_ID. Sem elas, tudo é SIMULAÇÃO.
 * Só publica rascunho APROVADO, no máximo 1 vez por item (idempotência pelo log) e só na Página esperada.
 * Nunca foi validado contra a Meta real.
 */
const BASE = () => `https://graph.facebook.com/${process.env.FB_GRAPH_VERSION || 'v21.0'}`
const cred = () => ({ token: process.env.FB_PAGE_TOKEN || '', pid: process.env.FB_PAGE_ID || '' })
export const configurado = () => Boolean(cred().token && cred().pid)
const https = (u) => { try { return new URL(u).protocol === 'https:' } catch { return false } }
const ehVideo = (u) => /\.(mp4|mov)(\?|$)/i.test(u)

async function graph(fetchFn, method, path, params = {}) {
  const { token } = cred()
  const body = new URLSearchParams({ ...params, access_token: token })
  const url = method === 'GET' ? `${BASE()}${path}?${body}` : `${BASE()}${path}`
  const r = await fetchFn(url, method === 'GET' ? { method } : { method, headers: { 'content-type': 'application/x-www-form-urlencoded' }, body })
  const j = await r.json().catch(() => ({}))
  if (!r.ok || j.error) throw new Error(redact(`Facebook recusou (${r.status}): ${j.error?.message ?? 'erro desconhecido'}`).replaceAll(token, '[REDACTED]'))
  return j
}

export async function publicarNaPagina(item, { fetchFn = fetch, logArquivo = LOG_PADRAO } = {}) {
  if (!item) throw new Error('Rascunho não encontrado.')
  if (item.status !== 'aprovado' && item.status !== 'publicado') throw new Error('Só publico rascunhos APROVADOS pela Cris.')
  if (jaPublicado('facebook', item.id, logArquivo)) return { simulado: false, duplicado: true, aviso: 'Já publicado no Facebook; nada foi enviado.' }
  const urls = item.midiaUrls ?? []
  if (!urls.length || !urls.every(https)) throw new Error('A mídia precisa de URLs https.')
  const legenda = [item.legenda ?? '', (item.hashtags ?? []).map((h) => (h.startsWith('#') ? h : `#${h}`)).join(' ')].filter(Boolean).join('\n\n')
  if (!configurado()) { registrar({ canal: 'facebook', id: item.id, resultado: 'simulado', arquivo: logArquivo }); return { simulado: true, aviso: 'Sem FB_PAGE_TOKEN/FB_PAGE_ID: nada foi enviado ao Facebook.' } }
  const { pid } = cred()
  try {
    const pag = await graph(fetchFn, 'GET', `/${pid}`, { fields: 'id' })
    if (String(pag.id) !== String(pid)) throw new Error('Página incorreta: o token não pertence à Página configurada. Nada foi enviado.')
    const r = ehVideo(urls[0])
      ? await graph(fetchFn, 'POST', `/${pid}/videos`, { file_url: urls[0], description: legenda })
      : await graph(fetchFn, 'POST', `/${pid}/photos`, { url: urls[0], caption: legenda, published: 'true' })
    registrar({ canal: 'facebook', id: item.id, resultado: 'publicado', detalhe: r.post_id ?? r.id ?? '', arquivo: logArquivo })
    return { simulado: false, idMidia: r.post_id ?? r.id ?? null }
  } catch (e) {
    registrar({ canal: 'facebook', id: item.id, resultado: 'falhou', detalhe: e.message, arquivo: logArquivo })
    throw e
  }
}
