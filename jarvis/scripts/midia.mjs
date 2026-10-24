import { configStorage, resumoConfig, prepararMidia, enviarMidia, verificarAcesso, removerMidia, limparAntigos, mascararUrl } from '../bridge/media-storage.mjs'

/**
 * Mídia para publicação (Supabase Storage). Nenhum comando publica nada na Meta.
 *   npm run midia -- verificar                      (só confere quais variáveis estão definidas; sem rede)
 *   npm run midia -- preparar <arquivo> [--formato feed|story]   (local: valida/converte; sem rede)
 *   npm run midia -- enviar <arquivo> [--formato ...] [--mostrar-url]   (ENVIO REAL ao seu Supabase)
 *   npm run midia -- limpar [--dias 2] [--apagar]   (lista antigos; só apaga com --apagar)
 *   npm run midia -- remover <bucket/AAAA-MM/uuid.ext>
 */
const [cmd, ...resto] = process.argv.slice(2)
const flag = (n) => resto.includes(`--${n}`)
const valor = (n) => { const i = resto.indexOf(`--${n}`); return i >= 0 ? resto[i + 1] : undefined }
const arq = resto.find((a) => !a.startsWith('--') && a !== valor('formato') && a !== valor('dias'))
const out = (o) => console.log(JSON.stringify(o, null, 2))

if (cmd === 'verificar') out(resumoConfig(configStorage()))
else if (cmd === 'preparar' && arq) out(await prepararMidia(arq, { formato: valor('formato') ?? 'feed' }))
else if (cmd === 'enviar' && arq) {
  const prep = await prepararMidia(arq, { formato: valor('formato') ?? 'feed' })
  if (!prep.ok) { out(prep); process.exit(1) }
  const r = await enviarMidia(prep)
  if (!r.ok) { out(r); process.exit(1) }
  const acesso = await verificarAcesso(r.url, { mimeEsperado: prep.mime })
  out({ ok: r.ok && acesso.ok, caminho: r.caminho, acesso: r.acesso, expiraEm: r.expiraEm, urlSemCredenciais: flag('mostrar-url') ? r.url : mascararUrl(r.url), verificacaoSemCredenciais: acesso })
  if (!flag('mostrar-url')) console.error('A URL assinada contém um token temporário e foi ocultada. Use --mostrar-url só se precisar vê-la.')
} else if (cmd === 'limpar') out(await limparAntigos({ dias: Number(valor('dias')) || 2, dryRun: !flag('apagar') }))
else if (cmd === 'remover' && arq) out(await removerMidia(arq))
else { console.error('Uso: npm run midia -- verificar | preparar <arquivo> | enviar <arquivo> | limpar | remover <caminho>'); process.exit(2) }
