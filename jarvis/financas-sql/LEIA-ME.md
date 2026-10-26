# Correção financeira de 25/10/2026

Aplicada no Supabase do app financeiro (projeto cris-cfo). Nenhum lançamento original foi alterado.

- `001_v_transactions_normalized.sql`: cria a visão que dá significado a cada lançamento por tipo de conta
  (conta corrente: negativo = saída; cartão: positivo = compra, negativo = pagamento de fatura ou estorno).
  Pagamento de fatura, transferência entre contas (inclusive as inferidas por par de mesmo valor em contas diferentes até 1 dia) e investimento ficam fora do gasto.
- `002_views_gasto.sql`: v_daily_spend_today e v_missao_5k_status passam a ler da visão normalizada.
- `dashboard-data.index.ts`: função do painel do app, com a divisão essencial/não essencial pela mesma visão.
- `ROLLBACK.sql` e `dashboard-data.index.OLD.ts`: para voltar ao estado anterior.
- `teste-agregacao.mjs`: teste da regra de soma usada na tela do app.
