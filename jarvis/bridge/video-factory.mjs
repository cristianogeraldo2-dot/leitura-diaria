import { tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync, copyFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, relative, isAbsolute } from 'node:path'
import { log, redact } from './home.mjs'
import { createStore, IG_DIR } from './instagram.mjs'

/**
 * VIDEO_FACTORY — monta MP4 vertical (1080x1920, H.264/AAC, 30 fps) para Reels a partir de cenas
 * (texto na tela sobre cor ou imagem) com FFmpeg local. Gera também capa (PNG), legendas (.srt) e
 * manifesto. NUNCA diz que gerou: só devolve o que existe em disco e foi validado com ffprobe.
 * Sem FFmpeg instalado, devolve ok:false com o que fazer. Nenhuma rede, nenhum token.
 */
export const VIDEOS_DIR = join(IG_DIR, 'videos')
const W = 1080, H = 1920, FPS = 30
const text = (t) => ({ content: [{ type: 'text', text: typeof t === 'string' ? t : JSON.stringify(t, null, 2) }] })
const slug = (s) => String(s ?? 'geral').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'geral'

const run = (bin, args, { cwd, timeout = 180_000 } = {}) => new Promise((res, rej) => {
  execFile(bin, args, { cwd, timeout, windowsHide: true, maxBuffer: 20 * 1024 * 1024 }, (err, stdout, stderr) => {
    if (err) rej(new Error(redact(`${bin} falhou: ${String(stderr || err.message).slice(-400)}`)))
    else res({ stdout: String(stdout), stderr: String(stderr) })
  })
})

export async function detectarFfmpeg() {
  try {
    const v = await run('ffmpeg', ['-version'], { timeout: 15_000 })
    await run('ffprobe', ['-version'], { timeout: 15_000 })
    return { ok: true, versao: v.stdout.split('\n')[0].slice(0, 80) }
  } catch {
    return { ok: false, comoInstalar: 'Instale o FFmpeg (ex.: winget install Gyan.FFmpeg ou ffmpeg.org) e reabra o terminal. Não é instalado automaticamente.' }
  }
}

const FONTES = [
  process.env.JARVIS_FONT,
  'C:\\Windows\\Fonts\\segoeuib.ttf', 'C:\\Windows\\Fonts\\arialbd.ttf', 'C:\\Windows\\Fonts\\arial.ttf',
  '/System/Library/Fonts/Supplemental/Arial Bold.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
].filter(Boolean)
export const acharFonte = () => FONTES.find((f) => existsSync(f)) ?? null
const esc = (p) => p.replace(/\\/g, '/').replace(/:/g, '\\:')

/** Quebra o texto em linhas curtas para caber em 1080 px. */
export function quebrar(t, max = 20) {
  const linhas = []
  let atual = ''
  for (const p of String(t).replace(/\s+/g, ' ').trim().split(' ')) {
    if (atual && (atual + ' ' + p).length > max) { linhas.push(atual); atual = p } else atual = atual ? `${atual} ${p}` : p
  }
  if (atual) linhas.push(atual)
  return linhas.slice(0, 8)
}

function filtroTexto(linhas, fonte, wd, { tam = 76, y0 = 0.42, nome = 't' } = {}) {
  const passo = Math.round(tam * 1.35)
  const total = linhas.length * passo
  return linhas.map((l, i) => {
    const arq = `${nome}${i}.txt`
    writeFileSync(join(wd, arq), l, 'utf8')
    return `drawtext=fontfile='${esc(fonte)}':textfile='${arq}':fontsize=${tam}:fontcolor=white:borderw=4:bordercolor=black@0.55:x=(w-text_w)/2:y=${Math.round(H * y0 - total / 2 + i * passo)}`
  }).join(',')
}

const srtTempo = (s) => {
  const ms = Math.round(s * 1000)
  const p = (n, l = 2) => String(n).padStart(l, '0')
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`
}

export async function validarVideo(arquivo) {
  const problemas = []
  if (!existsSync(arquivo)) return { ok: false, existe: false, problemas: ['O arquivo não existe.'] }
  const tam = statSync(arquivo).size
  let info = null
  try {
    const r = await run('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', arquivo], { timeout: 30_000 })
    info = JSON.parse(r.stdout)
  } catch (e) { return { ok: false, existe: true, problemas: [String(e.message)] } }
  const v = info.streams.find((s) => s.codec_type === 'video')
  const a = info.streams.find((s) => s.codec_type === 'audio')
  const dur = Number(info.format?.duration ?? 0)
  if (!v) problemas.push('Sem faixa de vídeo.')
  else {
    if (v.codec_name !== 'h264') problemas.push(`Codec ${v.codec_name}: o Instagram espera H.264.`)
    if (v.pix_fmt && v.pix_fmt !== 'yuv420p') problemas.push(`Formato de pixel ${v.pix_fmt}: use yuv420p.`)
    if (v.width * 16 !== v.height * 9) problemas.push(`Proporção ${v.width}x${v.height}: Reels pedem 9:16.`)
  }
  if (!a) problemas.push('Sem áudio (recomendado ter faixa de áudio).')
  if (dur < 3) problemas.push('Menos de 3 s.')
  if (dur > 90) problemas.push('Mais de 90 s: acima do limite de Reels.')
  if (tam > 300 * 1024 * 1024) problemas.push('Arquivo acima de 300 MB.')
  return { ok: problemas.length === 0, existe: true, tamanhoMB: Math.round((tam / 1048576) * 100) / 100, duracaoSeg: Math.round(dur * 10) / 10, resolucao: v ? `${v.width}x${v.height}` : null, codec: v?.codec_name ?? null, audio: Boolean(a), problemas }
}

/**
 * cenas: [{ texto, duracao?, imagem?, cor? }]  ·  cta?: texto final  ·  trilha?: arquivo de áudio local
 * Imagens/trilha só são lidas de dentro de knowledge/instagram/entrada (ou de uma pasta passada em baseMidia).
 */
export async function produzirVideo({ titulo, campanha = 'geral', cenas, cta, capaTexto, trilha, base = VIDEOS_DIR, baseMidia = join(IG_DIR, 'entrada'), data = new Date() }) {
  const ff = await detectarFfmpeg()
  if (!ff.ok) return { ok: false, motivo: 'FFmpeg não encontrado.', ...ff }
  const fonte = acharFonte()
  if (!fonte) return { ok: false, motivo: 'Nenhuma fonte encontrada para o texto na tela. Defina JARVIS_FONT com o caminho de um .ttf.' }
  const lista = [...(cenas ?? [])]
  if (cta) lista.push({ texto: cta, duracao: 3.5, cor: '0x0e5a4a' })
  if (!lista.length) return { ok: false, motivo: 'Sem cenas.' }
  if (lista.length > 20) return { ok: false, motivo: 'No máximo 20 cenas.' }

  const seguro = (p) => {
    const alvo = isAbsolute(p) ? resolve(p) : resolve(baseMidia, p)
    const rel = relative(baseMidia, alvo)
    if (rel.startsWith('..') || isAbsolute(rel)) throw new Error(`Por segurança, só uso arquivos dentro de ${baseMidia}`)
    if (!existsSync(alvo)) throw new Error(`Arquivo não encontrado: ${p}`)
    return alvo
  }

  const dia = data.toISOString().slice(0, 10)
  const nome = `${slug(titulo)}-${Math.random().toString(36).slice(2, 6)}`
  const pasta = join(base, dia, slug(campanha))
  mkdirSync(pasta, { recursive: true })
  const wd = mkdtempSync(join(tmpdir(), 'jarvis-vf-'))
  const cores = ['0x0b1f2a', '0x14213d', '0x1b263b', '0x102a43']
  try {
    const clipes = []
    const srt = []
    let t = 0
    for (let i = 0; i < lista.length; i++) {
      const c = lista[i]
      const dur = Math.min(12, Math.max(1.5, Number(c.duracao) || 3.5))
      const linhas = quebrar(c.texto, 20)
      const texto = filtroTexto(linhas, fonte, wd, { nome: `c${i}_` })
      const fade = `fade=t=in:st=0:d=0.3,fade=t=out:st=${(dur - 0.3).toFixed(2)}:d=0.3`
      const saida = `clip${i}.mp4`
      const entrada = c.imagem
        ? ['-loop', '1', '-t', String(dur), '-i', seguro(c.imagem)]
        : ['-f', 'lavfi', '-t', String(dur), '-i', `color=c=${c.cor ?? cores[i % cores.length]}:s=${W}x${H}:r=${FPS}`]
      const base0 = c.imagem ? `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},eq=brightness=-0.18,setsar=1,fps=${FPS}` : 'setsar=1'
      await run('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...entrada, '-f', 'lavfi', '-t', String(dur), '-i', 'anullsrc=r=44100:cl=stereo',
        '-vf', `${base0},${texto},${fade}`, '-map', '0:v', '-map', '1:a', '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-r', String(FPS), '-c:a', 'aac', '-shortest', saida], { cwd: wd })
      clipes.push(saida)
      srt.push(`${i + 1}\n${srtTempo(t)} --> ${srtTempo(t + dur)}\n${linhas.join(' ')}\n`)
      t += dur
    }
    writeFileSync(join(wd, 'lista.txt'), clipes.map((c) => `file '${c}'`).join('\n'))
    const mp4 = join(pasta, `${nome}.mp4`)
    await run('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', 'lista.txt', '-c', 'copy', '-movflags', '+faststart', 'final.mp4'], { cwd: wd })
    if (trilha) {
      await run('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-i', 'final.mp4', '-stream_loop', '-1', '-i', seguro(trilha), '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-shortest', '-movflags', '+faststart', 'comtrilha.mp4'], { cwd: wd })
      copyFileSync(join(wd, 'comtrilha.mp4'), mp4)
    } else copyFileSync(join(wd, 'final.mp4'), mp4)

    // Capa 9:16 com o título (ou capaTexto)
    const capa = join(pasta, `${nome}-capa.png`)
    const linhasCapa = filtroTexto(quebrar(capaTexto ?? titulo, 16), fonte, wd, { tam: 92, nome: 'capa_' })
    await run('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `color=c=0x0b1f2a:s=${W}x${H}`, '-vf', linhasCapa, '-frames:v', '1', 'capa.png'], { cwd: wd })
    copyFileSync(join(wd, 'capa.png'), capa)
    const legendas = join(pasta, `${nome}.srt`)
    writeFileSync(legendas, srt.join('\n'), 'utf8')

    const validacao = await validarVideo(mp4)
    const manifesto = { titulo, campanha, criadoEm: new Date().toISOString(), cenas: lista.length, duracaoSeg: validacao.duracaoSeg ?? null, arquivos: { video: mp4, capa, legendas }, validacao, publicado: false, aviso: 'Arquivo local. Para publicar pela API é preciso uma URL https pública; ou suba o MP4 manualmente no Meta Business Suite.' }
    writeFileSync(join(pasta, `${nome}.json`), JSON.stringify(manifesto, null, 2))
    log('video', `produzido ${nome} ok=${validacao.ok}`)
    return { ok: validacao.ok, existe: existsSync(mp4) && existsSync(capa) && existsSync(legendas), ...manifesto }
  } catch (e) {
    return { ok: false, motivo: String(e.message ?? e).slice(0, 400) }
  } finally { rmSync(wd, { recursive: true, force: true }) }
}

export function videoTools(store = createStore()) {
  return [
    tool('video_ffmpeg', 'Verifica (só leitura) se o FFmpeg e a fonte de texto existem neste computador, para a VIDEO_FACTORY. Não instala nada.', {}, async () => text({ ffmpeg: await detectarFfmpeg(), fonte: acharFonte() ? 'ok' : 'não encontrada' })),
    tool('video_produzir', 'VIDEO_FACTORY: monta um MP4 vertical 9:16 (H.264/AAC) com cenas de texto na tela, CTA final, capa PNG e legendas SRT, salvos em knowledge/instagram/videos/AAAA-MM-DD/campanha. Só LOCAL: não publica nada. Cada cena: { texto curto, duracao em s (1,5–12), imagem opcional (arquivo em knowledge/instagram/entrada) }. Só diga que o vídeo foi gerado se o retorno trouxer existe=true e ok=true; relate os problemas da validação. Use texto autoral e sem dados internos da empresa, clientes ou funcionários.', {
      titulo: z.string().min(2).max(120), campanha: z.string().max(60).optional(), capaTexto: z.string().max(80).optional(), cta: z.string().max(80).optional(),
      cenas: z.array(z.object({ texto: z.string().min(1).max(160), duracao: z.number().min(1.5).max(12).optional(), imagem: z.string().max(200).optional() })).min(1).max(20),
      trilha: z.string().max(200).optional().describe('arquivo de áudio em knowledge/instagram/entrada (opcional)'),
      rascunhoId: z.string().optional().describe('se informado, vincula o arquivo ao rascunho'),
    }, async ({ rascunhoId, ...p }) => {
      const r = await produzirVideo(p)
      if (r.existe && rascunhoId) {
        const x = store.obter(rascunhoId)
        if (x) store.anexar(rascunhoId, { videoLocal: r.arquivos.video, capaLocal: r.arquivos.capa })
      }
      return text(r)
    }),
    tool('video_validar', 'Valida um MP4 local para Reels (9:16, H.264, áudio, 3–90 s). Só leitura; o arquivo precisa estar em knowledge/instagram.', { arquivo: z.string().max(300) }, async ({ arquivo }) => {
      const alvo = resolve(isAbsolute(arquivo) ? arquivo : join(IG_DIR, arquivo))
      const rel = relative(IG_DIR, alvo)
      if (rel.startsWith('..') || isAbsolute(rel)) return text({ erro: `Por segurança, só valido arquivos dentro de ${IG_DIR}` })
      return text(await validarVideo(alvo))
    }),
  ]
}
