import { execFile } from 'node:child_process'
import { closeSync, copyFileSync, existsSync, mkdtempSync, openSync, readSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, extname, join } from 'node:path'
import { redact } from './home.mjs'

/**
 * Preparação de mídia para publicação (ETAPA 1). Só arquivos locais: nada aqui acessa rede,
 * Supabase ou Meta. Valida o tipo REAL pelos primeiros bytes (não confia na extensão), converte
 * PNG para JPEG (formato exigido pelo Instagram para imagens) e NUNCA apaga o original.
 */
export const LIMITES = { imagemBytes: 8 * 1024 * 1024, videoBytes: 300 * 1024 * 1024 }
export const PREFIXO_TMP = 'jarvis-media-'
const EXT_POR_MIME = { 'image/jpeg': ['.jpg', '.jpeg'], 'image/png': ['.png'], 'video/mp4': ['.mp4'] }
export const MIMES_PERMITIDOS = Object.keys(EXT_POR_MIME)

const run = (bin, args, { timeout = 60_000 } = {}) => new Promise((res, rej) => {
  execFile(bin, args, { timeout, windowsHide: true, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
    if (err) rej(new Error(redact(`${bin} falhou: ${String(stderr || err.message).slice(-300)}`)))
    else res(String(stdout))
  })
})

/** Tipo real pelos primeiros bytes. null = não reconhecido. */
export function detectarTipo(arquivo) {
  let fd
  try {
    fd = openSync(arquivo, 'r')
    const b = Buffer.alloc(16)
    const n = readSync(fd, b, 0, 16, 0)
    if (n >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
    if (n >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png'
    if (n >= 12 && b.subarray(4, 8).toString('latin1') === 'ftyp') return b.subarray(8, 12).toString('latin1') === 'qt  ' ? 'video/quicktime' : 'video/mp4'
    return null
  } catch { return null } finally { if (fd !== undefined) try { closeSync(fd) } catch { /* ignore */ } }
}

/** Valida existência, tamanho, tipo real e coerência com a extensão. */
export function validarArquivo(arquivo, { permitidos = MIMES_PERMITIDOS, limites = LIMITES } = {}) {
  const problemas = []
  if (!arquivo || !existsSync(arquivo)) return { ok: false, problemas: ['Arquivo não encontrado.'] }
  const st = statSync(arquivo)
  if (!st.isFile()) return { ok: false, problemas: ['O caminho não é um arquivo.'] }
  if (st.size === 0) return { ok: false, problemas: ['Arquivo vazio.'] }
  const mime = detectarTipo(arquivo)
  if (!mime) return { ok: false, tamanho: st.size, problemas: ['Tipo de arquivo não reconhecido (esperado JPEG, PNG ou MP4).'] }
  if (!permitidos.includes(mime)) problemas.push(`Tipo ${mime} não é permitido aqui.`)
  const exts = EXT_POR_MIME[mime]
  if (exts && !exts.includes(extname(arquivo).toLowerCase())) problemas.push(`A extensão ${extname(arquivo) || '(nenhuma)'} não corresponde ao conteúdo real (${mime}).`)
  const max = mime.startsWith('video/') ? limites.videoBytes : limites.imagemBytes
  if (st.size > max) problemas.push(`Arquivo de ${(st.size / 1048576).toFixed(1)} MB acima do limite de ${(max / 1048576).toFixed(0)} MB.`)
  return { ok: problemas.length === 0, mime, tamanho: st.size, problemas }
}

export async function sondar(arquivo) {
  const j = JSON.parse(await run('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', '-select_streams', 'v:0', arquivo], { timeout: 30_000 }))
  const v = j.streams?.[0]
  if (!v?.width || !v?.height) throw new Error('Sem dimensões de imagem/vídeo legíveis.')
  return { largura: v.width, altura: v.height, codec: v.codec_name }
}

/**
 * Regras do Instagram para imagem: JPEG, até 8 MB; feed e carrossel com proporção entre 4:5 e 1,91:1.
 * Story: 9:16 recomendado (aviso, não bloqueia).
 */
export async function validarImagemInstagram(arquivo, { formato = 'feed', limites = LIMITES } = {}) {
  const v = validarArquivo(arquivo, { permitidos: ['image/jpeg'], limites })
  if (!v.ok) return v
  const problemas = []
  const avisos = []
  let dim
  try { dim = await sondar(arquivo) } catch (e) { return { ...v, ok: false, problemas: [String(e.message)] } }
  const prop = dim.largura / dim.altura
  if (dim.largura < 320) problemas.push(`Largura de ${dim.largura}px abaixo do mínimo de 320px.`)
  if (formato === 'story') { if (Math.abs(prop - 9 / 16) > 0.02) avisos.push('Story fora de 9:16: o Instagram pode cortar.') }
  else if (prop < 0.8 - 0.005 || prop > 1.91 + 0.005) problemas.push(`Proporção ${prop.toFixed(2)} fora de 4:5 a 1,91:1 (exigida para feed e carrossel).`)
  return { ...v, ...dim, ok: problemas.length === 0, problemas, avisos }
}

/**
 * Converte PNG em JPEG. O original nunca é alterado nem apagado; a saída (padrão: ao lado do original,
 * mesmo nome com .jpg) só é gravada depois de validada. Usa um diretório temporário que é sempre removido.
 */
export async function converterParaJpeg(entrada, { saida, limites = LIMITES, sobrescrever = false } = {}) {
  const v = validarArquivo(entrada, { permitidos: ['image/png', 'image/jpeg'], limites: { ...limites, imagemBytes: Math.max(limites.imagemBytes, 64 * 1024 * 1024) } })
  if (!v.ok) return { ok: false, codigo: 'ARQUIVO_INVALIDO', problemas: v.problemas }
  const destino = saida ?? join(dirname(entrada), `${basename(entrada, extname(entrada))}.jpg`)
  if (existsSync(destino) && !sobrescrever) return { ok: false, codigo: 'SAIDA_EXISTE', problemas: [`Já existe ${basename(destino)}; não sobrescrevo.`] }
  const wd = mkdtempSync(join(tmpdir(), PREFIXO_TMP))
  try {
    let gerado = null
    for (const q of [2, 5, 9, 15]) {
      const tmp = join(wd, `saida-${q}.jpg`)
      await run('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-i', entrada, '-vf', 'format=yuv420p', '-q:v', String(q), '-frames:v', '1', tmp])
      if (detectarTipo(tmp) === 'image/jpeg' && statSync(tmp).size <= limites.imagemBytes) { gerado = tmp; break }
    }
    if (!gerado) return { ok: false, codigo: 'JPEG_INVALIDO', problemas: ['Não foi possível gerar um JPEG válido dentro do limite de tamanho.'] }
    const dim = await sondar(gerado)
    copyFileSync(gerado, destino)
    return { ok: true, saida: destino, original: entrada, mime: 'image/jpeg', tamanho: statSync(destino).size, ...dim }
  } catch (e) {
    return { ok: false, codigo: 'CONVERSAO_FALHOU', problemas: [String(e.message ?? e).slice(0, 300)] }
  } finally { rmSync(wd, { recursive: true, force: true }) }
}
