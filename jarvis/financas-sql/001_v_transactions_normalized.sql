-- Camada única de normalização das movimentações. NÃO altera nenhum dado original: só lê public.transactions.
-- security_invoker: respeita as políticas RLS de quem consulta (anon continua sem acesso).
create or replace view public.v_transactions_normalized
with (security_invoker = true) as
with base as (
  select t.id, t.account_id, a.institution_label, a.account_type,
         t.description, t.merchant_name, t.amount,
         t.date as data_transacao, t.occurred_at, t.created_at as data_importacao,
         t.status, t.category_id, c.name as categoria, c.kind as categoria_tipo,
         coalesce(c.is_essential, false) as categoria_essencial,
         t.is_internal_transfer, t.type as tipo_original,
         (t.description ~* '(pagamento (de )?fatura|pagamento cartao|pagamento on ?line|pagamento recebido|pgto fatura|pag total/parcial fat|pagto fatura)') as eh_pagamento_fatura,
         (t.description ~* '^(aplicacao|aplicação|resgate|credito resgate|crédito resgate|credito td|remuneracao aplicacao|remuneração aplicação)') as eh_investimento,
         (a.account_type = 'checking' and exists (
            select 1 from public.transactions o join public.accounts oa on oa.id = o.account_id
            where oa.account_type = 'checking' and o.account_id <> t.account_id
              and o.amount = -t.amount and abs(o.date - t.date) <= 1)) as tem_par_transferencia
  from public.transactions t
  join public.accounts a on a.id = t.account_id
  left join public.categories c on c.id = t.category_id
), n as (
  select b.*,
    case
      when b.is_internal_transfer or b.categoria_tipo = 'transfer' then 'transferencia_interna'
      when b.eh_investimento then 'investimento'
      when b.account_type = 'credit_card' then
        case when b.amount > 0 then 'despesa'
             when b.eh_pagamento_fatura then 'pagamento_fatura'
             else 'estorno' end
      when b.account_type = 'checking' then
        case when b.amount < 0 then
               case when b.eh_pagamento_fatura then 'pagamento_fatura'
                    when b.tem_par_transferencia then 'transferencia_interna'
                    else 'despesa' end
             else
               case when b.tem_par_transferencia then 'transferencia_interna'
                    when b.categoria_tipo = 'expense' then 'estorno'
                    else 'receita' end
        end
      else case when b.amount < 0 then 'despesa' else 'receita' end
    end as natureza
  from base b
)
select n.id, n.account_id, n.institution_label, n.account_type,
       n.description, n.merchant_name,
       n.amount as valor_original, n.tipo_original,
       abs(n.amount) as valor,
       n.natureza,
       case n.natureza when 'despesa' then -abs(n.amount) when 'estorno' then abs(n.amount) when 'receita' then abs(n.amount) else 0 end as efeito_resultado,
       n.data_transacao, n.occurred_at, n.data_importacao,
       (n.data_transacao <= current_date) as realizada,
       (n.data_transacao > current_date) as prevista,
       (n.status = 'pending') as pendente,
       n.categoria, n.categoria_tipo, n.categoria_essencial,
       (n.tem_par_transferencia and n.natureza = 'transferencia_interna' and not coalesce(n.is_internal_transfer,false) and n.categoria_tipo is distinct from 'transfer') as transferencia_inferida,
       (n.description ~* '^compra: fatura de') as fatura_de_cartao_nao_conectado
from n;

revoke all on public.v_transactions_normalized from anon, public;
grant select on public.v_transactions_normalized to authenticated, service_role;
