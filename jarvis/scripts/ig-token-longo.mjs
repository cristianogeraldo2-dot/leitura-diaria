// Uso: cmd /c "call jarvis-secrets.cmd && npm.cmd run ig:token-longo"
import { trocarToken, gravarToken } from '../bridge/instagram-token.mjs'
const r = await trocarToken()
if (!r.ok) { console.error(r.erro); process.exit(1) }
gravarToken(new URL('../jarvis-secrets.cmd', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), r.token)
console.log(`Token de longa duração gravado no jarvis-secrets.cmd (vale ~${r.expiraEmDias ?? '?'} dias). Nada foi exibido.`)
