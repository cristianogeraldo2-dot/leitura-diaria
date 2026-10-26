import { redact } from './home.mjs'

/**
 * Leitura do app financeiro (Supabase próprio, protegido por login). SOMENTE LEITURA.
 * Entra com o e-mail e a senha da Cris (RLS do app continua valendo) e só emite GET em tabelas permitidas.
 * Credenciais só por ambiente (jarvis-secrets.cmd): FIN_SUPABASE_URL, FIN_SUPABASE_KEY (chave pública do app),
 * FIN_EMAIL, FIN_PASSWORD. Nunca testado contra o Supabase real: só com respostas simuladas.
 */
export const TABELAS = ['accounts', 'transactions', 'categories', 'alerts', 'pluggy_items']
const VARS = ['FIN_SUPABASE_URL', 'FIN_SUPABASE_KEY', 'FIN_EMAIL', 'FIN_PASSWORD']

export const configFin = (env = process.env) => {
  const faltando = VARS.filter((v) => !env[v])
  return { faltando, url: String(env.FIN_SUPABASE_URL ?? '').replace(/\/+$/, ''), key: env.FIN_SUPABASE_KEY ?? '', email: env.FIN_EMAIL ?? '', senha: env.FIN_PASSWORD ?? '' }
}

const limpar = (txt, cfg) => {
  let t = redact(String(txt))
  for (const s of [cfg.senha, cfg.key, cfg.email]) if (s) t = t.replaceAll(s, '[REDACTED]')
  return t.slice(0, 300)
}

export async function entrar(cfg, fetchFn = fetch) {
  const r = await fetchFn(`${cfg.url}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: cfg.key, 'content-type': 'application/json' },
    body: JSON.stringify({ email: cfg.email, password: cfg.senha }),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok || !j.access_token) throw new Error(limpar(`Login recusado (${r.status}): ${j.error_description ?? j.msg ?? 'erro'}`, cfg))
  return j.access_token
}

/** GET em tabela permitida. Nenhum outro método existe neste módulo. */
export async function consultar(cfg, token, tabela, query = '', fetchFn = fetch) {
  if (!TABELAS.includes(tabela)) throw new Error(`Tabela não permitida: ${tabela}`)
  const r = await fetchFn(`${cfg.url}/rest/v1/${tabela}?${query}`, { method: 'GET', headers: { apikey: cfg.key, authorization: `Bearer ${token}` } })
  const j = await r.json().catch(() => null)
  if (!r.ok || !Array.isArray(j)) throw new Error(limpar(`Consulta a ${tabela} falhou (${r.status}): ${j?.message ?? 'erro'}`, cfg))
  return j
}

const soma = (a, k) => a.reduce((s, x) => s + (Number(x[k]) || 0), 0)
const mesIni = (d, off = 0) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + off, 1)).toISOString().slice(0, 10)

/**
 * Resumo: saldo das contas ativas, movimento do mês e dos 3 meses anteriores por categoria, avisos e sincronização.
 * O sinal dos valores de `transactions` NÃO é presumido: devolve entradas e saídas pelo sinal e marca a convenção como a confirmar.
 */
export async function resumoFinanceiro({ env = process.env, fetchFn = fetch, agora = new Date() } = {}) {
  const cfg = configFin(env)
  if (cfg.faltando.length) return { conectado: false, motivo: 'sem credenciais', faltando: cfg.faltando }
  try {
    const token = await entrar(cfg, fetchFn)
    const q = (t, s) => consultar(cfg, token, t, s, fetchFn)
    const ini = mesIni(agora), prox = mesIni(agora, 1), ini3 = mesIni(agora, -3)
    const [contas, mes, ant, cats, avisos, sinc] = await Promise.all([
      q('accounts', 'select=balance,account_type,is_active,name,institution_label&is_active=eq.true'),
      q('transactions', `select=amount,category_id,date&date=gte.${ini}&date=lt.${prox}`),
      q('transactions', `select=amount,category_id,date&date=gte.${ini3}&date=lt.${ini}`),
      q('categories', 'select=id,name'),
      q('alerts', 'select=id,type,severity,title,message,created_at&dismissed_at=is.null&order=created_at.desc&limit=8'),
      q('pluggy_items', 'select=connector_name,institution_label,last_synced_at,status&order=last_synced_at.desc'),
    ])
    const nome = new Map(cats.map((c) => [c.id, c.name]))
    const porCat = (lista) => {
      const m = new Map()
      for (const t of lista) { const n = nome.get(t.category_id) ?? 'Sem categoria'; m.set(n, (m.get(n) ?? 0) + (Number(t.amount) || 0)) }
      return [...m].map(([categoria, total]) => ({ categoria, total })).sort((a, b) => Math.abs(b.total) - Math.abs(a.total))
    }
    const pos = (l) => soma(l.filter((t) => Number(t.amount) > 0), 'amount'), neg = (l) => soma(l.filter((t) => Number(t.amount) < 0), 'amount')
    return {
      conectado: true, geradoEm: agora.toISOString(),
      saldoContas: { total: soma(contas, 'balance'), contas: contas.length, porTipo: Object.fromEntries([...new Set(contas.map((c) => c.account_type))].map((t) => [t, soma(contas.filter((c) => c.account_type === t), 'balance')])) },
      mesAtual: { lancamentos: mes.length, valoresPositivos: pos(mes), valoresNegativos: neg(mes), porCategoria: porCat(mes) },
      tresMesesAnteriores: { lancamentos: ant.length, valoresPositivos: pos(ant), valoresNegativos: neg(ant), porCategoria: porCat(ant) },
      avisosAbertos: avisos, sincronizacao: sinc,
      convencaoDoSinal: 'a confirmar: nao presumo se saida e positiva ou negativa',
    }
  } catch (e) { return { conectado: false, motivo: 'erro', erro: limpar(e.message ?? e, cfg) } }
}
