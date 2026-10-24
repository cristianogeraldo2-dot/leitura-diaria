import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { basename, dirname, extname, join } from 'node:path'
import { log, redact } from './home.mjs'
import { converterParaJpeg, detectarTipo, validarArquivo, validarImagemInstagram, LIMITES } from './media-prep.mjs'
import { validarVideo } from './video-factory.mjs'

/**
 * Hospedagem de mídia em Supabase Storage (ETAPA 1) — para gerar a URL https que a API da Meta exige.
 * SOMENTE no servidor (ponte): a chave secreta nunca vai para o navegador nem para o repositório.
 * Este módulo NÃO publica nada na Meta e não importa o módulo de publicação.
 *
 * Variáveis (somente nomes; valores ficam em jarvis-secrets.cmd, que o Git ignora):
 *   SUPABASE_URL              https://<projeto>.supabase.co
 *   SUPABASE_SECRET_KEY       chave de SERVIDOR do projeto (nunca no navegador)
 *   SUPABASE_BUCKET           padrão: jarvis-midia (privado)
 *   SUPABASE_MEDIA_ACCESS     "assinada" (padrão, bucket privado + URL temporária) ou "publica"
 *   SUPABASE_MEDIA_TTL_HORAS  validade da URL assinada (padrão 24, de 1 a 168)
 */
const BUCKET_OK = /^[a-z0-9][a-z0-9_-]{1,62}$/
const CHAVES_PROIBIDAS_NA_URL = /(key|secret|apikey|access_token|password|senha|auth|service)/i

export function configStorage(env = process.env) {
  const bruto = String(env.SUPABASE_URL ?? '').trim().replace(/\/+$/, '')
  const chave = String(env.SUPABASE_SECRET_KEY ?? '').trim()
  const bucket = String(env.SUPABASE_BUCKET ?? 'jarvis-midia').trim()
  const acesso = String(env.SUPABASE_MEDIA_ACCESS ?? 'assinada').toLowerCase() === 'publica' ? 'publica' : 'assinada'
  const ttl = Math.min(168, Math.max(1, Number(env.SUPABASE_MEDIA_TTL_HORAS) || 24))
  const faltando = []
  let url = null
  if (!bruto) faltando.push('SUPABASE_URL')
  else {
    try { const u = new URL(bruto); if (u.protocol === 'https:' && !u.username && !u.password) url = u.origin; else faltando.push('SUPABASE_URL (precisa ser https, sem usuário/senha)') } catch { faltando.push('SUPABASE_URL (inválida)') }
  }
  if (!chave) faltando.push('SUPABASE_SECRET_KEY')
  if (!BUCKET_OK.test(bucket)) faltando.push('SUPABASE_BUCKET (nome inválido)')
  return { url, host: url ? new URL(url).host : null, chave, bucket, acesso, ttlHoras: ttl, faltando }
}

/** Resumo seguro para tela e log: só se está definido ou não. Nunca devolve valores. */
export const resumoConfig = (cfg) => ({ configurado: cfg.faltando.length === 0, faltando: cfg.faltando, bucket: cfg.bucket, acesso: cfg.acesso, ttlHoras: cfg.ttlHoras, host: cfg.host })

/** Remove a chave e padrões de segredo de qualquer texto de erro. */
export const limpar = (texto, cfg) => {
  let t = redact(String(texto ?? ''))
  if (cfg?.chave) t = t.split(cfg.chave).join('[REDACTED]')
  return t.replace(/token=[^&\s"']+/gi, 'token=[REDACTED]').slice(0, 300)
}

/** Esconde o token de URLs assinadas para exibição. */
export const mascararUrl = (url) => String(url).replace(/([?&]token=)[^&#\s]+/i, '$1<oculto>')

const cabecalhosAuth = (chave) => (chave.startsWith('sb_')
  ? { apikey: chave }
  : { apikey: chave, Authorization: `Bearer ${chave}` })

/** A URL que vai para a Meta: https, sem credenciais embutidas, do nosso projeto, e só o parâmetro token (se assinada). */
export function validarUrlMidia(url, cfg) {
  const problemas = []
  let u
  try { u = new URL(url) } catch { return { ok: false, problemas: ['URL inválida.'] } }
  if (u.protocol !== 'https:') problemas.push('A URL precisa ser https.')
  if (u.username || u.password) problemas.push('A URL contém usuário ou senha.')
  if (cfg?.host && u.host !== cfg.host) problemas.push('A URL não pertence ao projeto configurado.')
  if (!/^\/storage\/v1\/object\/(sign|public)\//.test(u.pathname)) problemas.push('Caminho fora do armazenamento de objetos.')
  const assinada = /^\/storage\/v1\/object\/sign\//.test(u.pathname)
  for (const k of u.searchParams.keys()) {
    if (assinada && k === 'token') continue
    problemas.push(`Parâmetro "${k}" não é permitido na URL${CHAVES_PROIBIDAS_NA_URL.test(k) ? ' (parece credencial)' : ''}.`)
  }
  if (assinada && !u.searchParams.get('token')) problemas.push('URL assinada sem token.')
  return { ok: problemas.length === 0, problemas, assinada }
}

/** Valida e, se for PNG, converte para JPEG. Só arquivo local; não envia nada. */
export async function prepararMidia(arquivo, { formato = 'feed', limites = LIMITES } = {}) {
  const v = validarArquivo(arquivo, { limites })
  if (!v.ok) return { ok: false, codigo: 'ARQUIVO_INVALIDO', problemas: v.problemas }
  if (v.mime === 'video/mp4') {
    const r = await validarVideo(arquivo)
    if (!r.ok) return { ok: false, codigo: 'VIDEO_INVALIDO', problemas: r.problemas }
    return { ok: true, arquivo, origem: arquivo, mime: 'video/mp4', tamanho: v.tamanho, tipo: 'video', duracaoSeg: r.duracaoSeg, resolucao: r.resolucao }
  }
  let alvo = arquivo
  let convertido = false
  let reaproveitado = false
  if (v.mime === 'image/png') {
    const irmao = join(dirname(arquivo), `${basename(arquivo, extname(arquivo))}.jpg`)
    if (existsSync(irmao)) { alvo = irmao; reaproveitado = true } // JPEG já gerado antes: valida e reutiliza, sem sobrescrever
    else {
      const c = await converterParaJpeg(arquivo, { limites })
      if (!c.ok) return { ok: false, codigo: c.codigo, problemas: c.problemas }
      alvo = c.saida
      convertido = true
    }
  }
  const img = await validarImagemInstagram(alvo, { formato, limites })
  if (!img.ok) return { ok: false, codigo: 'IMAGEM_INVALIDA', problemas: img.problemas }
  return { ok: true, arquivo: alvo, origem: arquivo, mime: 'image/jpeg', tamanho: img.tamanho, tipo: 'imagem', convertido, reaproveitado, largura: img.largura, altura: img.altura, avisos: img.avisos }
}

const comTimeout = async (fetchFn, url, opt, ms = 120_000) => {
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), ms)
  try { return await fetchFn(url, { ...opt, signal: ac.signal }) } finally { clearTimeout(t) }
}

/** Nome imprevisível: AAAA-MM/uuid.ext (nunca o nome original do arquivo). */
export const nomeObjeto = (mime, agora = new Date()) => `${agora.toISOString().slice(0, 7)}/${randomUUID()}.${mime === 'video/mp4' ? 'mp4' : 'jpg'}`

/**
 * Envia a mídia já preparada. Sem credenciais, devolve SEM_CREDENCIAIS (só nomes das variáveis).
 * Erros nunca contêm a chave. A URL devolvida deve ser tratada como credencial temporária: não registrar em log.
 */
export async function enviarMidia(prep, { env = process.env, fetchFn = fetch, agora = new Date() } = {}) {
  const cfg = configStorage(env)
  if (cfg.faltando.length) return { ok: false, codigo: 'SEM_CREDENCIAIS', faltando: cfg.faltando }
  if (!prep?.ok || !prep.arquivo) return { ok: false, codigo: 'MIDIA_NAO_PREPARADA', problemas: ['Prepare e valide a mídia antes de enviar.'] }
  if (detectarTipo(prep.arquivo) !== prep.mime) return { ok: false, codigo: 'TIPO_MUDOU', problemas: ['O conteúdo do arquivo não corresponde ao tipo validado.'] }
  const nome = nomeObjeto(prep.mime, agora)
  const base = `${cfg.url}/storage/v1`
  let r
  try {
    r = await comTimeout(fetchFn, `${base}/object/${cfg.bucket}/${nome}`, {
      method: 'POST',
      headers: { ...cabecalhosAuth(cfg.chave), 'content-type': prep.mime, 'x-upsert': 'false', 'cache-control': 'max-age=3600' },
      body: readFileSync(prep.arquivo),
    })
  } catch (e) {
    log('midia', `upload rede falhou: ${limpar(e.message, cfg)}`)
    return { ok: false, codigo: 'REDE', mensagem: limpar(e.message, cfg) }
  }
  if (!r.ok) {
    const corpo = await r.text().catch(() => '')
    log('midia', `upload recusado status=${r.status}`)
    return { ok: false, codigo: r.status === 401 || r.status === 403 ? 'NAO_AUTORIZADO' : 'UPLOAD_FALHOU', status: r.status, mensagem: limpar(corpo, cfg) }
  }
  const caminho = `${cfg.bucket}/${nome}`
  let url
  if (cfg.acesso === 'publica') url = `${base}/object/public/${caminho}`
  else {
    let s
    try {
      s = await comTimeout(fetchFn, `${base}/object/sign/${caminho}`, {
        method: 'POST',
        headers: { ...cabecalhosAuth(cfg.chave), 'content-type': 'application/json' },
        body: JSON.stringify({ expiresIn: cfg.ttlHoras * 3600 }),
      }, 30_000)
    } catch (e) { return { ok: false, codigo: 'REDE', caminho, mensagem: limpar(e.message, cfg) } }
    if (!s.ok) return { ok: false, codigo: 'ASSINATURA_FALHOU', caminho, status: s.status, mensagem: limpar(await s.text().catch(() => ''), cfg) }
    const j = await s.json().catch(() => ({}))
    const rel = String(j.signedURL ?? j.signedUrl ?? '')
    if (!rel) return { ok: false, codigo: 'ASSINATURA_VAZIA', caminho }
    url = rel.startsWith('http') ? rel : `${base}${rel.startsWith('/') ? '' : '/'}${rel}`
  }
  const val = validarUrlMidia(url, cfg)
  if (!val.ok) return { ok: false, codigo: 'URL_INVALIDA', caminho, problemas: val.problemas }
  log('midia', `enviado ${caminho} acesso=${cfg.acesso}`)
  return { ok: true, caminho, url, acesso: cfg.acesso, expiraEm: cfg.acesso === 'assinada' ? new Date(agora.getTime() + cfg.ttlHoras * 3600_000).toISOString() : null, mime: prep.mime, tamanho: prep.tamanho }
}

/** Confirma, SEM credenciais (como a Meta faria), que a URL entrega o arquivo esperado. */
export async function verificarAcesso(url, { fetchFn = fetch, mimeEsperado } = {}) {
  try {
    const r = await comTimeout(fetchFn, url, { method: 'GET', headers: { range: 'bytes=0-0' } }, 30_000)
    const tipo = r.headers?.get?.('content-type') ?? null
    const ok = (r.status === 200 || r.status === 206) && (!mimeEsperado || String(tipo ?? '').startsWith(mimeEsperado))
    return { ok, status: r.status, tipo }
  } catch (e) { return { ok: false, status: 0, mensagem: limpar(e.message) } }
}

/** Apaga um objeto (use depois de publicar). caminho = "bucket/AAAA-MM/uuid.ext". */
export async function removerMidia(caminho, { env = process.env, fetchFn = fetch } = {}) {
  const cfg = configStorage(env)
  if (cfg.faltando.length) return { ok: false, codigo: 'SEM_CREDENCIAIS', faltando: cfg.faltando }
  const [bucket, ...resto] = String(caminho).split('/')
  const objeto = resto.join('/')
  if (bucket !== cfg.bucket || !/^\d{4}-\d{2}\/[0-9a-f-]{36}\.(jpg|mp4)$/.test(objeto)) return { ok: false, codigo: 'CAMINHO_INVALIDO', problemas: ['Só removo objetos criados por este módulo, no bucket configurado.'] }
  try {
    const r = await comTimeout(fetchFn, `${cfg.url}/storage/v1/object/${cfg.bucket}`, { method: 'DELETE', headers: { ...cabecalhosAuth(cfg.chave), 'content-type': 'application/json' }, body: JSON.stringify({ prefixes: [objeto] }) }, 30_000)
    return r.ok ? { ok: true } : { ok: false, codigo: 'REMOCAO_FALHOU', status: r.status, mensagem: limpar(await r.text().catch(() => ''), cfg) }
  } catch (e) { return { ok: false, codigo: 'REDE', mensagem: limpar(e.message, cfg) } }
}

/** Lista objetos criados por este módulo com mais de N dias. Por padrão apenas LISTA (dryRun). */
export async function limparAntigos({ dias = 2, dryRun = true, env = process.env, fetchFn = fetch, agora = new Date() } = {}) {
  const cfg = configStorage(env)
  if (cfg.faltando.length) return { ok: false, codigo: 'SEM_CREDENCIAIS', faltando: cfg.faltando }
  const limite = agora.getTime() - Math.max(1, dias) * 86_400_000
  const meses = [agora, new Date(agora.getTime() - 31 * 86_400_000)].map((d) => d.toISOString().slice(0, 7))
  const antigos = []
  for (const prefixo of [...new Set(meses)]) {
    let r
    try {
      r = await comTimeout(fetchFn, `${cfg.url}/storage/v1/object/list/${cfg.bucket}`, { method: 'POST', headers: { ...cabecalhosAuth(cfg.chave), 'content-type': 'application/json' }, body: JSON.stringify({ prefix: prefixo, limit: 1000, sortBy: { column: 'created_at', order: 'asc' } }) }, 30_000)
    } catch (e) { return { ok: false, codigo: 'REDE', mensagem: limpar(e.message, cfg) } }
    if (!r.ok) return { ok: false, codigo: 'LISTAGEM_FALHOU', status: r.status, mensagem: limpar(await r.text().catch(() => ''), cfg) }
    for (const o of await r.json().catch(() => [])) {
      if (/^[0-9a-f-]{36}\.(jpg|mp4)$/.test(o.name ?? '') && Date.parse(o.created_at ?? '') < limite) antigos.push(`${prefixo}/${o.name}`)
    }
  }
  if (dryRun || !antigos.length) return { ok: true, dryRun: true, encontrados: antigos.length, objetos: antigos }
  const r = await comTimeout(fetchFn, `${cfg.url}/storage/v1/object/${cfg.bucket}`, { method: 'DELETE', headers: { ...cabecalhosAuth(cfg.chave), 'content-type': 'application/json' }, body: JSON.stringify({ prefixes: antigos }) }, 60_000).catch(() => null)
  return r?.ok ? { ok: true, dryRun: false, removidos: antigos.length } : { ok: false, codigo: 'REMOCAO_FALHOU', status: r?.status ?? 0 }
}
