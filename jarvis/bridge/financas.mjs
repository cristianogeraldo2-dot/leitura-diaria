import { redact } from './home.mjs'

/**
 * Leitura do app financeiro (Supabase próprio, protegido por login). SOMENTE LEITURA.
 * Entra com o e-mail e a senha da Cris (RLS do app continua valendo) e só emite GET em tabelas permitidas.
 * Credenciais só por ambiente (jarvis-secrets.cmd): FIN_SUPABASE_URL, FIN_SUPABASE_KEY (chave pública do app),
 * FIN_EMAIL, FIN_PASSWORD. Nunca testado contra o Supabase real: só com respostas simuladas.
 */
export const TABELAS = ['accounts', 'transactions', 'categories', 'alerts', 'pluggy_items', 'v_transactions_normalized']
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
 * Resumo a partir de v_transactions_normalized (25/10/2026): o significado do sinal já vem resolvido por tipo de conta
 * (conta corrente: negativo = saída; cartão: positivo = compra, negativo = pagamento de fatura ou estorno).
 * Gasto = despesas − estornos; pagamento de fatura, transferência entre contas e investimento ficam fora; previstos (data futura) ficam à parte.
 */
export async function resumoFinanceiro({ env = process.env, fetchFn = fetch, agora = new Date() } = {}) {
  const cfg = configFin(env)
  if (cfg.faltando.length) return { conectado: false, motivo: 'sem credenciais', faltando: cfg.faltando }
  try {
    const token = await entrar(cfg, fetchFn)
    const q = (t, s) => consultar(cfg, token, t, s, fetchFn)
    const ini = mesIni(agora), prox = mesIni(agora, 1), ini3 = mesIni(agora, -3)
    const campos = 'select=valor,natureza,categoria,data_transacao&realizada=eq.true&natureza=in.(despesa,estorno,receita)'
    const [contas, mes, ant, prev, sinc] = await Promise.all([
      q('accounts', 'select=balance,account_type,is_active,name,institution_label&is_active=eq.true'),
      q('v_transactions_normalized', `${campos}&data_transacao=gte.${ini}&data_transacao=lt.${prox}`),
      q('v_transactions_normalized', `${campos}&data_transacao=gte.${ini3}&data_transacao=lt.${ini}`),
      q('v_transactions_normalized', 'select=valor,natureza,data_transacao&prevista=eq.true&order=data_transacao.asc'),
      q('pluggy_items', 'select=connector_name,institution_label,last_synced_at,status&order=last_synced_at.desc'),
    ])
    const resumir = (l) => {
      const porCat = new Map()
      let despesas = 0, estornos = 0, receitas = 0
      for (const t of l) {
        const v = Number(t.valor) || 0
        if (t.natureza === 'despesa') { despesas += v; const n = t.categoria ?? 'Sem categoria'; porCat.set(n, (porCat.get(n) ?? 0) + v) }
        else if (t.natureza === 'estorno') { estornos += v; const n = t.categoria ?? 'Sem categoria'; porCat.set(n, (porCat.get(n) ?? 0) - v) }
        else if (t.natureza === 'receita') receitas += v
      }
      return { lancamentos: l.length, despesas, estornos, gastoLiquido: despesas - estornos, receitas, porCategoria: [...porCat].map(([categoria, total]) => ({ categoria, total })).sort((a, b) => b.total - a.total) }
    }
    return {
      conectado: true, geradoEm: agora.toISOString(),
      saldoContas: { contas: contas.length, porTipo: Object.fromEntries([...new Set(contas.map((c) => c.account_type))].map((t) => [t, soma(contas.filter((c) => c.account_type === t), 'balance')])), observacao: 'No cartão, balance é a dívida total. Não some conta corrente com cartão.' },
      mesAtual: resumir(mes), tresMesesAnteriores: resumir(ant),
      previstos: { lancamentos: prev.length, total: soma(prev, 'valor') },
      sincronizacao: sinc,
      convencaoDoSinal: 'conta corrente: negativo = saida; cartao: positivo = compra, negativo = pagamento de fatura ou estorno (resolvido em v_transactions_normalized)',
    }
  } catch (e) { return { conectado: false, motivo: 'erro', erro: limpar(e.message ?? e, cfg) } }
}
