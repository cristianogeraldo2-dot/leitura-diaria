create or replace view public.v_daily_spend_today as
select coalesce(sum(case n.natureza when 'despesa' then n.valor when 'estorno' then -n.valor else 0 end), 0)::numeric(14,2) as spent_today
from public.v_transactions_normalized n
where n.data_transacao = current_date;

create or replace view public.v_missao_5k_status as
select mc.id as cycle_id, mc.start_date, mc.end_date, mc.monthly_income, mc.viver_amount, mc.reserva_amount,
       greatest(current_date - mc.start_date + 1, 0) as days_elapsed,
       mc.end_date - mc.start_date + 1 as days_total,
       greatest(mc.end_date - current_date, 0) as days_remaining,
       coalesce(spent.total, 0::numeric)::numeric(14,2) as spent_so_far,
       (mc.viver_amount - coalesce(spent.total, 0::numeric))::numeric(14,2) as viver_remaining,
       case when (mc.end_date - current_date) > 0
            then round((mc.viver_amount - coalesce(spent.total, 0::numeric)) / (mc.end_date - current_date)::numeric, 2)
            else mc.viver_amount - coalesce(spent.total, 0::numeric) end as suggested_daily_limit
from public.missao_5k_cycles mc
left join lateral (
  select sum(case n.natureza when 'despesa' then n.valor when 'estorno' then -n.valor else 0 end) as total
  from public.v_transactions_normalized n
  where n.data_transacao >= mc.start_date and n.data_transacao <= least(current_date, mc.end_date)
) spent on true
where mc.status = 'active';
