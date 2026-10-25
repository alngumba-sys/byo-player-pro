// Shared billing helpers: country -> payment methods and prices.
import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export function methodsFor(country: string): string[] {
  const c = (country || "").toUpperCase();
  if (c === "ET") return ["telebirr"];
  if (c === "KE") return ["mpesa", "card"];
  return ["card"];
}

export async function pricesFor(db: SupabaseClient, country: string) {
  const c = (country || "").toUpperCase();
  const { data } = await db.from("prices")
    .select("plan_code,country,currency,amount_minor,label,plans!inner(name,duration_days,sort_order)")
    .eq("active", true).in("country", [c, "*"]);
  const rows = (data ?? []) as any[];
  const local = rows.filter((r) => r.country === c);
  const use = local.length ? local : rows.filter((r) => r.country === "*");
  use.sort((a, b) => (a.plans.sort_order ?? 0) - (b.plans.sort_order ?? 0));
  return {
    currency: use[0]?.currency ?? "USD",
    plans: use.map((r) => ({ code: r.plan_code, name: r.plans.name, days: r.plans.duration_days, amount: r.amount_minor / 100, tag: r.label ?? undefined })),
  };
}

export async function priceOf(db: SupabaseClient, country: string, plan_code: string) {
  const p = await pricesFor(db, country);
  const plan = p.plans.find((x) => x.code === plan_code);
  return plan ? { currency: p.currency, amount_minor: Math.round(plan.amount * 100) } : null;
}
