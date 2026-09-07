import { useMemo } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ArrowUpRight, Radar, ShieldAlert, Activity, Target, FlaskConical } from "lucide-react";
import {
  PATTERN_META,
  alertTrend,
  db,
  detectionStats,
  recentActivity,
} from "@/lib/trace/engine";
import { compactCurrency, relative, timeOnly } from "@/lib/trace/format";
import { CountUp, Mono, PatternBadge, RiskBadge, SectionTitle, StatusPill } from "@/components/trace/primitives";
import { useTrace } from "@/lib/trace/context";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "TRACE-X Dashboard — Financial Crime Command Center" },
      {
        name: "description",
        content:
          "Live overview of suspicious networks, alert severity, detection KPIs and emerging fraud clusters across the synthetic TRACE-X corpus.",
      },
      { property: "og:title", content: "TRACE-X Dashboard — Financial Crime Command Center" },
      {
        property: "og:description",
        content: "Active alerts, critical networks, detection statistics and emerging clusters in one cockpit view.",
      },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const stats = useMemo(() => detectionStats(), []);
  const trend = useMemo(() => alertTrend(), []);
  const activity = useMemo(() => recentActivity(), []);
  const { setActiveNetworkId } = useTrace();
  const navigate = useNavigate();

  const critical = db.clusters
    .filter((c) => c.level === "Critical" || c.level === "High")
    .sort((a, b) => b.cluster_risk_score - a.cluster_risk_score);

  const emerging = [...db.clusters]
    .sort((a, b) => b.last_seen.localeCompare(a.last_seen))
    .slice(0, 5);

  const open = (id: string) => {
    setActiveNetworkId(id);
    navigate({ to: "/network" });
  };

  return (
    <div className="space-y-5">
      <header className="panel-surface relative overflow-hidden rounded-lg p-5">
        <div className="grid-surface pointer-events-none absolute inset-0 opacity-30" />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="mono text-[10px] uppercase tracking-[0.28em] text-signal">Command Center</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">
              One transaction can look normal. The network tells the truth.
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Monitoring{" "}
              <Mono>{stats.accountsMonitored.toLocaleString()}</Mono> accounts ·{" "}
              <Mono>{stats.transactionsIngested.toLocaleString()}</Mono> transactions ·{" "}
              <Mono>{stats.networksMonitored}</Mono> reconstructed networks.
            </p>
          </div>
          <Button onClick={() => navigate({ to: "/lab" })} className="gap-2">
            <FlaskConical className="size-4" /> Open Detection Lab
          </Button>
        </div>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SeverityCard label="Critical" count={stats.criticalCount} tone="critical" hint="Immediate analyst review" />
        <SeverityCard label="High" count={stats.highCount} tone="high" hint="Prioritise investigation" />
        <SeverityCard label="Medium" count={stats.mediumCount} tone="medium" hint="Review if corroborated" />
        <SeverityCard label="Low" count={stats.lowCount} tone="low" hint="Monitor" />
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.6fr_1fr]">
        <div className="panel-surface rounded-lg p-4">
          <SectionTitle
            title="Alert volume by severity"
            hint="Rolling 14-day detection output across all monitored rails"
          />
          <div className="h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trend} margin={{ left: -22, right: 6, top: 6 }}>
                <defs>
                  {(["critical", "high", "medium"] as const).map((k, i) => (
                    <linearGradient key={k} id={`g-${k}`} x1="0" y1="0" x2="0" y2="1">
                      <stop
                        offset="0%"
                        stopColor={`var(--risk-${k})`}
                        stopOpacity={0.45 - i * 0.1}
                      />
                      <stop offset="100%" stopColor={`var(--risk-${k})`} stopOpacity={0.02} />
                    </linearGradient>
                  ))}
                </defs>
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 6" vertical={false} />
                <XAxis dataKey="day" tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} tickLine={false} axisLine={false} />
                <RTooltip
                  contentStyle={{
                    background: "var(--popover)",
                    border: "1px solid var(--border-strong)",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                />
                <Area dataKey="medium" stackId="1" stroke="var(--risk-medium)" fill="url(#g-medium)" strokeWidth={1.5} />
                <Area dataKey="high" stackId="1" stroke="var(--risk-high)" fill="url(#g-high)" strokeWidth={1.5} />
                <Area dataKey="critical" stackId="1" stroke="var(--risk-critical)" fill="url(#g-critical)" strokeWidth={1.5} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="panel-surface rounded-lg p-4">
          <SectionTitle title="Detection statistics" hint="Prototype metrics from the rules + scoring engine" />
          <div className="grid grid-cols-2 gap-3">
            <Kpi icon={Target} label="Precision" value={stats.precision} suffix="%" />
            <Kpi icon={Radar} label="Recall" value={stats.recall} suffix="%" />
            <Kpi icon={FlaskConical} label="Scenarios today" value={12} />
            <Kpi icon={ShieldAlert} label="Detection gaps" value={3} tone="critical" />
          </div>
          <div className="mt-4 space-y-2 rounded-md border border-border bg-panel/40 p-3">
            <p className="text-xs font-medium">Signal weights (prototype)</p>
            {[
              ["Behaviour deviation", 25],
              ["Network signals", 25],
              ["Transaction velocity", 15],
              ["New counterparties", 15],
              ["Pattern match", 15],
              ["Historical association", 5],
            ].map(([label, w]) => (
              <div key={label as string} className="flex items-center gap-2">
                <span className="w-40 shrink-0 text-[11px] text-muted-foreground">{label}</span>
                <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-signal" style={{ width: `${(w as number) * 4}%` }} />
                </div>
                <span className="mono w-8 text-right text-[11px]">{w}%</span>
              </div>
            ))}
            <Tooltip>
              <TooltipTrigger asChild>
                <p className="cursor-help pt-1 text-[10px] text-muted-foreground underline decoration-dotted">
                  Illustrative prototype weights — not a banking standard
                </p>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                These weights are chosen to make scoring explainable in a demo. A production deployment would calibrate
                them against labelled outcomes and regulatory guidance.
              </TooltipContent>
            </Tooltip>
          </div>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
        <div className="panel-surface rounded-lg p-4">
          <SectionTitle title="Critical networks" hint="Clusters scoring 60+ on the weighted engine" />
          <div className="space-y-2">
            {critical.map((c) => (
              <button
                key={c.id}
                onClick={() => open(c.id)}
                className="group flex w-full items-center gap-3 rounded-md border border-border bg-panel/40 px-3 py-2.5 text-left transition-colors hover:border-signal/40 hover:bg-signal/6"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="mono text-xs text-muted-foreground">{c.id}</span>
                    <span className="truncate text-sm font-medium">{c.name}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    {c.pattern_tags.map((p) => (
                      <PatternBadge key={p} pattern={p} size="sm" />
                    ))}
                    <span className="mono text-[10px] text-muted-foreground">
                      {c.member_account_ids.length} accts · {compactCurrency(c.total_value)}
                    </span>
                  </div>
                </div>
                <RiskBadge score={c.cluster_risk_score} pulse />
                <ArrowUpRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:text-signal" />
              </button>
            ))}
          </div>
        </div>

        <div className="panel-surface flex flex-col rounded-lg p-4">
          <SectionTitle title="Emerging clusters" hint="Most recent network formation" />
          <div className="space-y-2">
            {emerging.map((c) => (
              <button
                key={c.id}
                onClick={() => open(c.id)}
                className="flex w-full items-center justify-between gap-2 rounded-md border border-border/70 px-3 py-2 text-left hover:bg-accent"
              >
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium">{c.name}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {PATTERN_META[c.pattern].label} · {relative(c.last_seen)}
                  </p>
                </div>
                <RiskBadge score={c.cluster_risk_score} size="sm" />
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="panel-surface rounded-lg p-4">
        <SectionTitle
          title="Live activity feed"
          hint="Streaming ingest from UPI, bank and wallet rails (synthetic)"
          action={
            <span className="mono inline-flex items-center gap-1.5 text-[10px] text-risk-low">
              <span className="size-1.5 rounded-full bg-risk-low animate-risk-pulse" /> LIVE
            </span>
          }
        />
        <ScrollArea className="h-64">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-card">
              <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="py-1.5 pr-3 font-medium">Time</th>
                <th className="py-1.5 pr-3 font-medium">Transaction</th>
                <th className="py-1.5 pr-3 font-medium">Flow</th>
                <th className="py-1.5 pr-3 font-medium">Rail</th>
                <th className="py-1.5 pr-3 text-right font-medium">Amount</th>
                <th className="py-1.5 text-right font-medium">Signal</th>
              </tr>
            </thead>
            <tbody>
              {activity.map((t) => (
                <tr key={t.transaction_id} className="border-t border-border/50">
                  <td className="mono py-1.5 pr-3 text-muted-foreground">{timeOnly(t.timestamp)}</td>
                  <td className="mono py-1.5 pr-3">{t.transaction_id}</td>
                  <td className="mono py-1.5 pr-3 text-muted-foreground">
                    {t.sender_id} → {t.receiver_id}
                  </td>
                  <td className="mono py-1.5 pr-3 text-muted-foreground">{t.transaction_type}</td>
                  <td className="mono py-1.5 pr-3 text-right">{compactCurrency(t.amount)}</td>
                  <td className="py-1.5 text-right">
                    {t.label === "suspicious" ? (
                      <span className="mono rounded border border-risk-critical/40 bg-risk-critical/10 px-1.5 py-px text-[9px] uppercase text-risk-critical">
                        flagged
                      </span>
                    ) : (
                      <span className="mono text-[9px] uppercase text-muted-foreground">clear</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollArea>
      </section>
    </div>
  );
}

function SeverityCard({
  label,
  count,
  tone,
  hint,
}: {
  label: string;
  count: number;
  tone: "critical" | "high" | "medium" | "low";
  hint: string;
}) {
  const color = `text-risk-${tone}`;
  return (
    <div className="panel-surface relative overflow-hidden rounded-lg p-4">
      <div className={`absolute inset-x-0 top-0 h-0.5 bg-risk-${tone}`} />
      <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{label} alerts</p>
      <p className={`mono mt-1.5 text-3xl font-semibold ${color}`}>
        <CountUp value={count} />
      </p>
      <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>
    </div>
  );
}

function Kpi({
  icon: Icon,
  label,
  value,
  suffix = "",
  tone,
}: {
  icon: typeof Activity;
  label: string;
  value: number;
  suffix?: string;
  tone?: "critical";
}) {
  return (
    <div className="rounded-md border border-border bg-panel/40 p-3">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <Icon className="size-3.5" />
        <span className="text-[10px] uppercase tracking-wider">{label}</span>
      </div>
      <p className={`mono mt-1 text-xl font-semibold ${tone === "critical" ? "text-risk-critical" : ""}`}>
        <CountUp value={value} suffix={suffix} />
      </p>
    </div>
  );
}
