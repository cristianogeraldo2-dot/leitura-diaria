import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { DIRS, redact } from './home.mjs'

/**
 * Registro de publicações (Etapa 2): uma linha JSON por tentativa, sem segredos (tudo passa por redact).
 * Serve também de trava de idempotência: um item já publicado no mesmo canal não é publicado de novo.
 */
export const LOG_PADRAO = join(DIRS.knowledge, 'publicacoes', 'log.jsonl')

export function registrar({ canal, id, resultado, detalhe = '', arquivo = LOG_PADRAO }) {
  mkdirSync(dirname(arquivo), { recursive: true })
  const linha = { em: new Date().toISOString(), canal, id, resultado, detalhe: redact(String(detalhe)).slice(0, 300) }
  appendFileSync(arquivo, JSON.stringify(linha) + '\n')
  return linha
}

export function ler(arquivo = LOG_PADRAO) {
  if (!existsSync(arquivo)) return []
  return readFileSync(arquivo, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
}

/** true se já existe publicação concluída (resultado "publicado") deste item neste canal. */
export const jaPublicado = (canal, id, arquivo = LOG_PADRAO) => ler(arquivo).some((x) => x.canal === canal && x.id === id && x.resultado === 'publicado')
