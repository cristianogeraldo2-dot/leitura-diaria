// Endpoint somente-leitura consumido pelo painel PWA (tools/../app). Agrega
// tudo que a tela principal precisa numa única chamada: gasto de hoje
// (essencial x não-essencial), status da Missão 5K, "posso gastar hoje" e
// alertas em aberto. Nunca grava nada — protegido por APP_DASHBOARD_SECRET,
// um segredo próprio e de baixo privilégio (não é o APP_ADMIN_SECRET, que
// autoriza ações administrativas/escrita).
//
// Versão anterior a 25/10/2026 (para voltar atrás).
import { isAuthorizedDashboard } from "../_shared/env.ts";
import { getSupabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { dashboardCorsHeaders, handleDashboardPreflight } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  const preflight = handleDashboardPreflight(req);
  if (preflight) return preflight;

  if (req.method !== "GET") {
    return new Response("Method not allowed", { status: 405, headers: dashboardCorsHeaders });
  }
  if (!isAuthorizedDashboard(req.headers.get("x-dashboard-secret"))) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...dashboardCorsHeaders, "Content-Type": "application/json" },
    });
  }

  const db = getSupabaseAdmin();
  const today = new Date().toISOString().slice(0, 10);

  try {
    const [dailySpendRes, missao5kRes, todayTxRes, alertsRes, syncRunsRes, accountsRes] = await Promise.all([
      db.from("v_daily_spend_today").select("spent_today").single(),
      db.from("v_missao_5k_status").select("*").maybeSingle(),
      db
        .from("transactions")
        .select("amount, categories(is_essential, kind)")
        .eq("date", today)
        .eq("type", "debit")
        .eq("is_internal_transfer", false),
      db
        .from("alerts")
        .select("id, type, severity, title, message, created_at")
        .is("dismissed_at", null)
        .order("created_at", { ascending: false })
        .limit(10),
      db
        .from("sync_runs")
        .select("source, status, items_processed, started_at, finished_at, error")
        .order("started_at", { ascending: false })
        .limit(10),
      db.from("accounts").select("balance, is_active").eq("is_active", true),
    ]);

    if (dailySpendRes.error) throw dailySpendRes.error;
    if (missao5kRes.error) throw missao5kRes.error;
    if (todayTxRes.error) throw todayTxRes.error;
    if (alertsRes.error) throw alertsRes.error;
    if (syncRunsRes.error) throw syncRunsRes.error;
    if (accountsRes.error) throw accountsRes.error;

    const spentToday = Number(dailySpendRes.data?.spent_today ?? 0);

    let essentialToday = 0;
    let nonEssentialToday = 0;
    for (const tx of todayTxRes.data ?? []) {
      const category = (tx as { categories: { is_essential: boolean; kind: string } | null }).categories;
      if (category?.kind === "transfer") continue;
      const amount = Number(tx.amount ?? 0);
      const isEssential = category?.is_essential ?? false;
      if (isEssential) essentialToday += -amount;
      else nonEssentialToday += -amount;
    }

    const missao5k = missao5kRes.data;
    const dailyLimit = missao5k ? Number(missao5k.suggested_daily_limit) : null;
    const remainingToday = dailyLimit !== null ? Math.round((dailyLimit - spentToday) * 100) / 100 : null;

    const lastSyncBySource: Record<string, unknown> = {};
    for (const run of syncRunsRes.data ?? []) {
      if (!lastSyncBySource[run.source]) lastSyncBySource[run.source] = run;
    }

    const totalBalance = (accountsRes.data ?? []).reduce((sum, a) => sum + Number(a.balance ?? 0), 0);

    const payload = {
      generatedAt: new Date().toISOString(),
      today: {
        date: today,
        spentToday: Math.round(spentToday * 100) / 100,
        essentialToday: Math.round(essentialToday * 100) / 100,
        nonEssentialToday: Math.round(nonEssentialToday * 100) / 100,
      },
      canSpendToday: {
        dailyLimit,
        remainingToday,
        allowed: remainingToday === null ? null : remainingToday > 0,
      },
      missao5k: missao5k
        ? {
            cycleId: missao5k.cycle_id,
            startDate: missao5k.start_date,
            endDate: missao5k.end_date,
            daysElapsed: missao5k.days_elapsed,
            daysTotal: missao5k.days_total,
            daysRemaining: missao5k.days_remaining,
            viverAmount: Number(missao5k.viver_amount),
            reservaAmount: Number(missao5k.reserva_amount),
            spentSoFar: Number(missao5k.spent_so_far),
            viverRemaining: Number(missao5k.viver_remaining),
            suggestedDailyLimit: Number(missao5k.suggested_daily_limit),
          }
        : null,
      accounts: { totalBalance: Math.round(totalBalance * 100) / 100, count: (accountsRes.data ?? []).length },
      alerts: alertsRes.data ?? [],
      lastSync: lastSyncBySource,
    };

    return new Response(JSON.stringify(payload), {
      headers: { ...dashboardCorsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : JSON.stringify(err);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...dashboardCorsHeaders, "Content-Type": "application/json" },
    });
  }
});
