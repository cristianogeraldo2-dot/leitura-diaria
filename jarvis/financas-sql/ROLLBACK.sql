-- Volta ao estado anterior a 25/10/2026. Não mexe em nenhum lançamento.
-- 1) restaura as duas visões de gasto como eram
create or replace view public.v_daily_spend_today as
 SELECT COALESCE(sum(- t.amount), 0::numeric)::numeric(14,2) AS spent_today
   FROM transactions t
     JOIN categories c ON c.id = t.category_id
  WHERE t.type = 'debit'::text AND t.is_internal_transfer = false AND c.kind = 'expense'::text AND t.date = CURRENT_DATE;

create or replace view public.v_missao_5k_status as
 SELECT mc.id AS cycle_id, mc.start_date, mc.end_date, mc.monthly_income, mc.viver_amount, mc.reserva_amount,
    GREATEST(CURRENT_DATE - mc.start_date + 1, 0) AS days_elapsed,
    mc.end_date - mc.start_date + 1 AS days_total,
    GREATEST(mc.end_date - CURRENT_DATE, 0) AS days_remaining,
    COALESCE(spent.total, 0::numeric)::numeric(14,2) AS spent_so_far,
    (mc.viver_amount - COALESCE(spent.total, 0::numeric))::numeric(14,2) AS viver_remaining,
        CASE
            WHEN (mc.end_date - CURRENT_DATE) > 0 THEN round((mc.viver_amount - COALESCE(spent.total, 0::numeric)) / (mc.end_date - CURRENT_DATE)::numeric, 2)
            ELSE mc.viver_amount - COALESCE(spent.total, 0::numeric)
        END AS suggested_daily_limit
   FROM missao_5k_cycles mc
     LEFT JOIN LATERAL ( SELECT sum(- t.amount) AS total
           FROM transactions t
             JOIN categories c ON c.id = t.category_id
          WHERE t.type = 'debit'::text AND t.is_internal_transfer = false AND c.kind = 'expense'::text AND t.date >= mc.start_date AND t.date <= LEAST(CURRENT_DATE, mc.end_date)) spent ON true
  WHERE mc.status = 'active'::text;

-- 2) só depois remova a visão normalizada
drop view if exists public.v_transactions_normalized;
-- 3) a função dashboard-data volta com dashboard-data.index.OLD.ts (publicar de novo no Supabase)
