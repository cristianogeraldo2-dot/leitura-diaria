import { readFileSync, writeFileSync } from 'node:fs'
import { redact } from './home.mjs'

/**
 * Troca o token curto (Graph API Explorer, ~1 h) por um de longa duração (~60 dias) e grava no
 * jarvis-secrets.cmd. Nunca imprime token nem chave secreta. Só chama o endpoint oficial de troca.
 * Variáveis (jarvis-secrets.cmd): IG_ACCESS_TOKEN (curto), FB_APP_ID, FB_APP_SECRET.
 */
const BASE = () => `https://graph.facebook.com/${process.env.IG_GRAPH_VERSION || 'v21.0'}`

export async function trocarToken({ env = process.env, fetchFn = fetch } = {}) {
  const { IG_ACCESS_TOKEN: curto, FB_APP_ID: id, FB_APP_SECRET: segredo } = env
  const faltam = [['IG_ACCESS_TOKEN', curto], ['FB_APP_ID', id], ['FB_APP_SECRET', segredo]].filter(([, v]) => !v).map(([n]) => n)
  if (faltam.length) return { ok: false, erro: `Faltam no jarvis-secrets.cmd: ${faltam.join(', ')}` }
  const q = new URLSearchParams({ grant_type: 'fb_exchange_token', client_id: id, client_secret: segredo, fb_exchange_token: curto })
  const r = await fetchFn(`${BASE()}/oauth/access_token?${q}`)
  const j = await r.json().catch(() => ({}))
  if (!r.ok || !j.access_token) {
    const msg = String(j.error?.message ?? 'erro desconhecido')
    return { ok: false, erro: redact(`Meta recusou a troca (${r.status}): ${msg}`).replaceAll(curto, '[REDACTED]').replaceAll(segredo, '[REDACTED]') }
  }
  return { ok: true, token: j.access_token, expiraEmDias: j.expires_in ? Math.round(j.expires_in / 86400) : null }
}

/** Troca a linha IG_ACCESS_TOKEN do arquivo (mantém o resto intacto). */
export function gravarToken(arquivo, token) {
  const linhas = readFileSync(arquivo, 'utf8').split(/\r?\n/)
  let achou = false
  const novas = linhas.map((l) => (/^set\s+"?IG_ACCESS_TOKEN=/.test(l) ? (achou = true, `set "IG_ACCESS_TOKEN=${token}"`) : l))
  if (!achou) novas.push(`set "IG_ACCESS_TOKEN=${token}"`)
  writeFileSync(arquivo, novas.join('\r\n'), 'ascii')
}
