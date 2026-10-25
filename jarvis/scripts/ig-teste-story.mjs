// Teste real de publicação: 1 Story liso (fundo escuro, sem texto). SÓ publica com --confirmo.
//   cmd /c "call jarvis-secrets.cmd && npm.cmd run ig:teste-story -- --confirmo"
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { prepararMidia, enviarMidia, removerMidia, verificarAcesso, mascararUrl } from '../bridge/media-storage.mjs'
import { publicarRascunho, verificarConexao } from '../bridge/instagram-publish.mjs'
import { registrar } from '../bridge/publicacao-log.mjs'

if (!process.argv.includes('--confirmo')) {
  console.log('SIMULAÇÃO: nada foi enviado. Com --confirmo, o JARVIS publica 1 Story liso (fundo escuro, sem texto) em @cristianogeraldo.ofc. O Story some sozinho em 24 h.')
  process.exit(0)
}
const con = await verificarConexao()
if (!con.ok || !con.contaOficial) { console.error('Conexão/conta não confirmada. Nada foi publicado.'); process.exit(1) }
const dir = mkdtempSync(join(tmpdir(), 'jarvis-teste-'))
let caminho
try {
  const img = join(dir, 'teste-story.jpg')
  execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=0x111827:s=1080x1920', '-frames:v', '1', '-pix_fmt', 'yuvj420p', img], { windowsHide: true })
  const prep = await prepararMidia(img, { formato: 'story' })
  if (!prep.ok) throw new Error(`Mídia inválida: ${JSON.stringify(prep.problemas ?? prep)}`)
  const up = await enviarMidia(prep)
  if (!up.ok) throw new Error(`Envio falhou: ${up.codigo ?? ''}`)
  caminho = up.caminho
  const acesso = await verificarAcesso(up.url, { mimeEsperado: prep.mime })
  console.log('Mídia no Supabase, acesso sem credenciais:', acesso.ok ? 'ok' : 'FALHOU', mascararUrl(up.url).slice(0, 60) + '...')
  if (!acesso.ok) throw new Error('A URL não ficou acessível.')
  const r = await publicarRascunho({ id: 'teste-story', status: 'aprovado', tipo: 'story', midiaUrls: [up.url] })
  registrar({ canal: 'instagram', id: 'teste-story', resultado: r.simulado ? 'simulado' : 'publicado', detalhe: r.idMidia ?? '' })
  console.log(r.simulado ? 'Simulado (sem credenciais).' : `STORY PUBLICADO. id=${r.idMidia}. Some em 24 h.`)
} catch (e) {
  registrar({ canal: 'instagram', id: 'teste-story', resultado: 'falhou', detalhe: e.message })
  console.error('FALHOU:', String(e.message).slice(0, 300))
  process.exitCode = 1
} finally {
  if (caminho) console.log('Limpeza no Supabase:', (await removerMidia(caminho)).ok ? 'ok' : 'falhou')
  rmSync(dir, { recursive: true, force: true })
}
