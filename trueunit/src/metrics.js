// src/metrics.js — 운영 지표: 자동 통과율, 검수 비율, AI-검수사 일치도, 감사 표본 오통과, 손해율, 처리 시간
import { lossRatios } from "./guarantee.js";

function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : null);

export function tenantMetrics(store, tenant) {
  const cases = store.list("cases", (c) => c.tenant_id === tenant.id);
  const assessed = cases.filter((c) => c.assessment);
  const byStatus = {};
  for (const c of cases) byStatus[c.status] = (byStatus[c.status] || 0) + 1;
  const passed = assessed.filter((c) => c.assessment.recommendation === "pass").length;
  const priority = assessed.filter((c) => c.assessment.recommendation === "escalate_priority").length;

  const verdicts = store.list("verdicts", (v) => v.tenant_id === tenant.id);
  const fakes = verdicts.filter((v) => v.verdict === "counterfeit");
  const reals = verdicts.filter((v) => v.verdict === "authentic");
  const audits = verdicts.filter((v) => v.audit_sample);

  const turnaroundMin = cases.filter((c) => c.submitted_at && c.decided_at).map((c) => (new Date(c.decided_at) - new Date(c.submitted_at)) / 60000);
  const tokens = assessed.reduce((s, c) => { const u = c.assessment.ai_meta?.usage; return u ? { input: s.input + u.input_tokens, output: s.output + u.output_tokens } : s; }, { input: 0, output: 0 });

  const units = store.list("units", (u) => u.tenant_id === tenant.id);
  const checks = store.list("unit_checks", (k) => k.checker_tenant_id === tenant.id);

  return {
    cases: { total: cases.length, by_status: byStatus, assessed: assessed.length },
    routing: {
      auto_pass_rate_pct: pct(passed, assessed.length),
      escalation_rate_pct: pct(assessed.length - passed, assessed.length),
      priority_rate_pct: pct(priority, assessed.length),
      ai_unavailable: assessed.filter((c) => !c.assessment.ai_assessed).length,
    },
    quality: {
      verdicts: verdicts.length,
      counterfeit_caught_in_medium_or_high_pct: pct(fakes.filter((v) => v.ai_band && v.ai_band !== "low").length, fakes.length),
      authentic_flagged_high_pct: pct(reals.filter((v) => v.ai_band === "high").length, reals.length),
      audit_samples: audits.length,
      audit_false_pass: audits.filter((v) => v.verdict === "counterfeit").length,
      note: "가품 포착률은 사람이 본 건만으로 계산됩니다. 자동 통과 건의 실제 오통과율은 감사 표본(audit)과 보증 청구로만 추정할 수 있습니다.",
    },
    turnaround_minutes_median: median(turnaroundMin),
    ai_tokens: tokens,
    guarantee: { by_category: lossRatios(store, tenant.id), suspended_categories: tenant.settings.guarantee.suspended_categories },
    units: { registered: units.length, checks: checks.length, match_rate_pct: pct(checks.filter((k) => k.match).length, checks.length) },
  };
}
