import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  BarChart3,
  Briefcase,
  Download,
  Network,
  Printer,
  ShieldCheck,
} from "lucide-react";
import {
  BAND_GUIDANCE,
  PATTERN_META,
  db,
  detectionStats,
  tracePath,
  type NetworkCluster,
  type RiskLevel,
} from "@/lib/trace/engine";
import { listCases, type TraceCase } from "@/lib/trace/cases";
import { compactCurrency, currency, dateTime } from "@/lib/trace/format";
import { EmptyState, Mono, PatternBadge, RiskBadge, SectionTitle, StatusPill } from "@/components/trace/primitives";
import { useTrace } from "@/lib/trace/context";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

export const Route = createFileRoute("/reports")({
  head: () => ({
    meta: [
      { title: "Reports — TRACE-X Investigation Cockpit" },
      { name: "description", content: "Reporting workspace for turning TRACE-X detection and investigation activity into analyst-ready outputs." },
      { property: "og:title", content: "Reports — TRACE-X Investigation Cockpit" },
      { property: "og:description", content: "Build analyst-ready reports from TRACE-X investigation activity." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ReportsPage,
});

type ReportType = "coverage" | "network" | "cases";

const REPORT_TYPES: { id: ReportType; label: string; hint: string; icon: typeof BarChart3 }[] = [
  { id: "coverage", label: "Detection Coverage", hint: "Org-wide KPIs, severity mix and pattern breakdown", icon: ShieldCheck },
  { id: "network", label: "Network Investigation", hint: "Full evidence pack for a single suspicious network", icon: Network },
  { id: "cases", label: "Case Outcomes", hint: "Analyst decisions and case status across the queue", icon: Briefcase },
];

function download(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  toast.success("Report downloaded", { description: filename });
}

/* ------------------------------------------------------------------ */
/* Markdown builders                                                    */
/* ------------------------------------------------------------------ */

function coverageMarkdown() {
  const stats = detectionStats();
  const byPattern = new Map<string, number>();
  db.clusters.forEach((c) => byPattern.set(c.pattern, (byPattern.get(c.pattern) ?? 0) + 1));
  const byStatus = new Map<string, number>();
  db.alerts.forEach((a) => byStatus.set(a.status, (byStatus.get(a.status) ?? 0) + 1));

  const lines = [
    `# TRACE-X Detection Coverage Report`,
    ``,
    `Generated ${dateTime(new Date().toISOString())}`,
    ``,
    `## Summary`,
    `- Accounts monitored: ${stats.accountsMonitored}`,
    `- Transactions ingested: ${stats.transactionsIngested}`,
    `- Networks reconstructed: ${stats.networksMonitored}`,
    `- Engine precision: ${stats.precision}% · recall: ${stats.recall}%`,
    ``,
    `## Alert severity mix`,
    `- Critical: ${stats.criticalCount}`,
    `- High: ${stats.highCount}`,
    `- Medium: ${stats.mediumCount}`,
    `- Low: ${stats.lowCount}`,
    ``,
    `## Alert status`,
    ...[...byStatus.entries()].map(([status, count]) => `- ${status}: ${count}`),
    ``,
    `## Networks by pattern`,
    ...[...byPattern.entries()].map(([pattern, count]) => `- ${PATTERN_META[pattern as keyof typeof PATTERN_META].label}: ${count}`),
  ];
  return lines.join("\n");
}

function networkMarkdown(cluster: NetworkCluster) {
  const txns = db.clusterTransactions(cluster.id).filter((t) => t.label === "suspicious").slice(0, 12);
  const path = tracePath(cluster.id);
  const lines = [
    `# Network Investigation Report — ${cluster.name}`,
    ``,
    `Generated ${dateTime(new Date().toISOString())} · ${cluster.id}`,
    ``,
    `## Overview`,
    `- Risk score: ${cluster.cluster_risk_score}/100 (${cluster.level})`,
    `- Pattern: ${PATTERN_META[cluster.pattern].label}`,
    `- Accounts involved: ${cluster.member_account_ids.length}`,
    `- Transactions: ${cluster.transaction_ids.length}`,
    `- Total value: ${currency(cluster.total_value)}`,
    `- First seen: ${dateTime(cluster.first_seen)} · Last seen: ${dateTime(cluster.last_seen)}`,
    `- Recommended action: ${BAND_GUIDANCE[cluster.level]}`,
    ``,
    `## Narrative`,
    cluster.narrative,
    ``,
    `## Signal breakdown`,
    ...cluster.signals
      .slice()
      .sort((a, b) => b.contribution - a.contribution)
      .map((s) => `- ${s.label}: score ${s.score}, weight ${s.weight}%, contributes +${s.contribution} — ${s.reason}`),
    ``,
    `## Key accounts`,
    `- Central: ${cluster.central_account}`,
    ...(cluster.mule_accounts.length ? [`- Mule accounts: ${cluster.mule_accounts.join(", ")}`] : []),
    ...(cluster.bridge_accounts.length ? [`- Bridge accounts: ${cluster.bridge_accounts.join(", ")}`] : []),
    ``,
    `## Money path`,
    path.length ? `${[path[0]!.sender_id, ...path.map((t) => t.receiver_id)].join(" -> ")} (${currency(path.reduce((s, t) => s + t.amount, 0))})` : "No reconstructed multi-hop trail.",
    ``,
    `## Evidence transactions (top 12 suspicious legs)`,
    `| Transaction | Sender | Receiver | Amount | When |`,
    `| --- | --- | --- | --- | --- |`,
    ...txns.map((t) => `| ${t.transaction_id} | ${t.sender_id} | ${t.receiver_id} | ${currency(t.amount)} | ${dateTime(t.timestamp)} |`),
  ];
  return lines.join("\n");
}

function casesMarkdown(cases: TraceCase[]) {
  const byStatus = new Map<string, number>();
  const byDecision = new Map<string, number>();
  cases.forEach((c) => {
    byStatus.set(c.status, (byStatus.get(c.status) ?? 0) + 1);
    if (c.decision) byDecision.set(c.decision, (byDecision.get(c.decision) ?? 0) + 1);
  });
  const lines = [
    `# Case Outcomes Report`,
    ``,
    `Generated ${dateTime(new Date().toISOString())} · ${cases.length} cases`,
    ``,
    `## Status breakdown`,
    ...[...byStatus.entries()].map(([status, count]) => `- ${status}: ${count}`),
    ``,
    `## Analyst decisions`,
    byDecision.size
      ? [...byDecision.entries()].map(([decision, count]) => `- ${decision}: ${count}`).join("\n")
      : "- No decisions recorded yet.",
    ``,
    `## Case list`,
    `| Case | Title | Status | Decision | Risk | Value |`,
    `| --- | --- | --- | --- | --- | --- |`,
    ...cases.map(
      (c) =>
        `| ${c.id} | ${c.title} | ${c.status} | ${c.decision ?? "—"} | ${c.risk_score} | ${compactCurrency(c.attached_evidence?.total_value ?? 0)} |`,
    ),
  ];
  return lines.join("\n");
}

/* ------------------------------------------------------------------ */
/* UI                                                                    */
/* ------------------------------------------------------------------ */

function ReportsPage() {
  const { activeNetworkId } = useTrace();
  const [type, setType] = useState<ReportType>("coverage");
  const [networkId, setNetworkId] = useState(activeNetworkId);
  const [cases, setCases] = useState<TraceCase[]>([]);
  const [casesLoading, setCasesLoading] = useState(true);

  useEffect(() => {
    if (type !== "cases") return;
    let cancelled = false;
    setCasesLoading(true);
    void listCases().then((result) => {
      if (!cancelled) {
        setCases(result);
        setCasesLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [type]);

  const sortedClusters = useMemo(() => [...db.clusters].sort((a, b) => b.cluster_risk_score - a.cluster_risk_score), []);
  const cluster = db.getCluster(networkId) ?? sortedClusters[0];
  const stats = useMemo(() => detectionStats(), []);

  const markdown = useMemo(() => {
    if (type === "coverage") return coverageMarkdown();
    if (type === "network") return cluster ? networkMarkdown(cluster) : "";
    return casesMarkdown(cases);
  }, [type, cluster, cases]);

  const exportName = useMemo(() => {
    if (type === "coverage") return "trace-x-coverage-report.md";
    if (type === "network") return `trace-x-${cluster?.id ?? "network"}-report.md`;
    return "trace-x-case-outcomes-report.md";
  }, [type, cluster]);

  return (
    <div className="space-y-5">
      <header className="panel-surface relative overflow-hidden rounded-lg p-5 print:hidden">
        <div className="grid-surface pointer-events-none absolute inset-0 opacity-30" />
        <div className="relative">
          <p className="mono text-[10px] uppercase tracking-[0.28em] text-signal">Stress-test / outputs</p>
          <h1 className="mt-1 flex items-center gap-2 text-2xl font-semibold tracking-tight"><BarChart3 className="size-6 text-signal" /> Reports</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">Create clear, repeatable summaries of detection coverage, suspicious networks and investigation outcomes.</p>
        </div>
      </header>

      <div className="grid gap-4 xl:grid-cols-[280px_1fr] print:block">
        <aside className="space-y-4 print:hidden">
          <div className="panel-surface rounded-lg p-4">
            <SectionTitle title="Report type" hint="Choose what this report should cover." />
            <div className="space-y-2">
              {REPORT_TYPES.map((rt) => (
                <button
                  key={rt.id}
                  onClick={() => setType(rt.id)}
                  className={cn(
                    "flex w-full items-start gap-2.5 rounded-md border px-3 py-2.5 text-left transition-colors",
                    type === rt.id ? "border-signal/50 bg-signal/10" : "border-border bg-panel/40 hover:border-signal/30",
                  )}
                >
                  <rt.icon className={cn("mt-0.5 size-4 shrink-0", type === rt.id ? "text-signal" : "text-muted-foreground")} />
                  <div className="min-w-0">
                    <p className="text-xs font-medium">{rt.label}</p>
                    <p className="text-[11px] text-muted-foreground">{rt.hint}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {type === "network" && (
            <div className="panel-surface rounded-lg p-4">
              <SectionTitle title="Network" hint="Pick which network this report covers." />
              <Select value={networkId} onValueChange={setNetworkId}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {sortedClusters.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.id} · {c.name} ({c.cluster_risk_score})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="panel-surface flex flex-col gap-2 rounded-lg p-4">
            <SectionTitle title="Export" hint="Take this report out of the cockpit." />
            <Button size="sm" onClick={() => download(exportName, markdown)} disabled={!markdown}>
              <Download className="size-3.5" /> Download Markdown
            </Button>
            <Button size="sm" variant="secondary" onClick={() => window.print()}>
              <Printer className="size-3.5" /> Print / Save as PDF
            </Button>
          </div>
        </aside>

        <section className="panel-surface rounded-lg p-5 print:border-0 print:p-0 print:shadow-none">
          {type === "coverage" && <CoveragePreview stats={stats} />}
          {type === "network" && (cluster ? <NetworkPreview cluster={cluster} /> : <EmptyState icon={<Network className="size-8" />} title="No network selected" />)}
          {type === "cases" &&
            (casesLoading ? (
              <p className="py-10 text-center text-sm text-muted-foreground">Loading cases…</p>
            ) : (
              <CasesPreview cases={cases} />
            ))}
        </section>
      </div>
    </div>
  );
}

function CoveragePreview({ stats }: { stats: ReturnType<typeof detectionStats> }) {
  const byPattern = new Map<string, number>();
  db.clusters.forEach((c) => byPattern.set(c.pattern, (byPattern.get(c.pattern) ?? 0) + 1));
  const byStatus = new Map<string, number>();
  db.alerts.forEach((a) => byStatus.set(a.status, (byStatus.get(a.status) ?? 0) + 1));
  const levels: RiskLevel[] = ["Critical", "High", "Medium", "Low"];
  const counts: Record<RiskLevel, number> = {
    Critical: stats.criticalCount,
    High: stats.highCount,
    Medium: stats.mediumCount,
    Low: stats.lowCount,
  };
  return (
    <div className="space-y-6">
      <div>
        <p className="mono text-[10px] uppercase tracking-[0.28em] text-signal">Detection Coverage Report</p>
        <h2 className="mt-1 text-xl font-semibold tracking-tight">Org-wide detection coverage</h2>
        <p className="mt-1 text-xs text-muted-foreground">Generated {dateTime(new Date().toISOString())}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Accounts monitored" value={stats.accountsMonitored.toLocaleString()} />
        <Stat label="Transactions ingested" value={stats.transactionsIngested.toLocaleString()} />
        <Stat label="Networks reconstructed" value={String(stats.networksMonitored)} />
        <Stat label="Precision / recall" value={`${stats.precision}% / ${stats.recall}%`} />
      </div>
      <div>
        <SectionTitle title="Alert severity mix" />
        <div className="grid gap-3 sm:grid-cols-4">
          {levels.map((level) => (
            <div key={level} className="rounded-md border border-border bg-panel/40 p-3">
              <RiskBadge level={level} score={level === "Critical" ? 90 : level === "High" ? 70 : level === "Medium" ? 45 : 15} />
              <p className="mono mt-2 text-2xl font-semibold">{counts[level]}</p>
            </div>
          ))}
        </div>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <SectionTitle title="Alert status" />
          <ul className="divide-y divide-border">
            {[...byStatus.entries()].map(([status, count]) => (
              <li key={status} className="flex items-center justify-between py-1.5 text-xs">
                <StatusPill status={status} />
                <span className="mono">{count}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <SectionTitle title="Networks by pattern" />
          <ul className="divide-y divide-border">
            {[...byPattern.entries()].map(([pattern, count]) => (
              <li key={pattern} className="flex items-center justify-between py-1.5 text-xs">
                <PatternBadge pattern={pattern as never} size="sm" />
                <span className="mono">{count}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function NetworkPreview({ cluster }: { cluster: NetworkCluster }) {
  const txns = db.clusterTransactions(cluster.id).filter((t) => t.label === "suspicious").slice(0, 12);
  const path = tracePath(cluster.id);
  const signals = [...cluster.signals].sort((a, b) => b.contribution - a.contribution);
  return (
    <div className="space-y-6">
      <div>
        <p className="mono text-[10px] uppercase tracking-[0.28em] text-signal">Network Investigation Report</p>
        <h2 className="mt-1 text-xl font-semibold tracking-tight">{cluster.name}</h2>
        <p className="mono mt-1 text-xs text-muted-foreground">{cluster.id} · generated {dateTime(new Date().toISOString())}</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <RiskBadge score={cluster.cluster_risk_score} />
          {cluster.pattern_tags.map((p) => <PatternBadge key={p} pattern={p} />)}
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Accounts" value={String(cluster.member_account_ids.length)} />
        <Stat label="Transactions" value={String(cluster.transaction_ids.length)} />
        <Stat label="Total value" value={compactCurrency(cluster.total_value)} />
        <Stat label="Action" value={BAND_GUIDANCE[cluster.level]} />
      </div>
      <div>
        <SectionTitle title="Narrative" />
        <p className="text-xs leading-relaxed text-muted-foreground">{cluster.narrative}</p>
      </div>
      <div>
        <SectionTitle title="Signal breakdown" />
        <ul className="space-y-1.5">
          {signals.map((s) => (
            <li key={s.key} className="flex items-center justify-between gap-3 text-xs">
              <span className="text-muted-foreground">{s.label} <span className="text-[10px]">(weight {s.weight}%)</span></span>
              <span className="mono">+{s.contribution}</span>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <SectionTitle title="Money path" />
        <p className="mono text-[11px] text-muted-foreground">
          {path.length ? `${[path[0]!.sender_id, ...path.map((t) => t.receiver_id)].join(" → ")} (${currency(path.reduce((s, t) => s + t.amount, 0))})` : "No reconstructed multi-hop trail."}
        </p>
      </div>
      <div>
        <SectionTitle title="Evidence transactions" hint="Top 12 suspicious legs by chronology." />
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-y border-border text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="px-2 py-2">Transaction</th>
                <th className="px-2 py-2">Flow</th>
                <th className="px-2 py-2">Amount</th>
                <th className="px-2 py-2">When</th>
              </tr>
            </thead>
            <tbody>
              {txns.map((t) => (
                <tr key={t.transaction_id} className="border-b border-border/50 last:border-0">
                  <td className="px-2 py-1.5"><Mono>{t.transaction_id}</Mono></td>
                  <td className="px-2 py-1.5"><Mono>{t.sender_id} → {t.receiver_id}</Mono></td>
                  <td className="mono px-2 py-1.5">{currency(t.amount)}</td>
                  <td className="px-2 py-1.5 text-muted-foreground">{dateTime(t.timestamp)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function CasesPreview({ cases }: { cases: TraceCase[] }) {
  if (cases.length === 0) {
    return <EmptyState icon={<Briefcase className="size-8" />} title="No cases yet" description="Create a case from an alert or network to see it summarised here." />;
  }
  const byStatus = new Map<string, number>();
  const byDecision = new Map<string, number>();
  cases.forEach((c) => {
    byStatus.set(c.status, (byStatus.get(c.status) ?? 0) + 1);
    if (c.decision) byDecision.set(c.decision, (byDecision.get(c.decision) ?? 0) + 1);
  });
  return (
    <div className="space-y-6">
      <div>
        <p className="mono text-[10px] uppercase tracking-[0.28em] text-signal">Case Outcomes Report</p>
        <h2 className="mt-1 text-xl font-semibold tracking-tight">Investigation case outcomes</h2>
        <p className="mt-1 text-xs text-muted-foreground">Generated {dateTime(new Date().toISOString())} · {cases.length} cases</p>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <SectionTitle title="Status breakdown" />
          <ul className="divide-y divide-border">
            {[...byStatus.entries()].map(([status, count]) => (
              <li key={status} className="flex items-center justify-between py-1.5 text-xs">
                <StatusPill status={status} />
                <span className="mono">{count}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <SectionTitle title="Analyst decisions" />
          {byDecision.size === 0 ? (
            <p className="text-xs text-muted-foreground">No decisions recorded yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {[...byDecision.entries()].map(([decision, count]) => (
                <li key={decision} className="flex items-center justify-between py-1.5 text-xs">
                  <span>{decision}</span>
                  <span className="mono">{count}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <div>
        <SectionTitle title="Case list" />
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-y border-border text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="px-2 py-2">Case</th>
                <th className="px-2 py-2">Title</th>
                <th className="px-2 py-2">Status</th>
                <th className="px-2 py-2">Decision</th>
                <th className="px-2 py-2">Risk</th>
                <th className="px-2 py-2">Value</th>
              </tr>
            </thead>
            <tbody>
              {cases.map((c) => (
                <tr key={c.id} className="border-b border-border/50 last:border-0">
                  <td className="px-2 py-1.5"><Mono>{c.id}</Mono></td>
                  <td className="px-2 py-1.5">{c.title}</td>
                  <td className="px-2 py-1.5"><StatusPill status={c.status} /></td>
                  <td className="px-2 py-1.5 text-muted-foreground">{c.decision ?? "—"}</td>
                  <td className="px-2 py-1.5"><RiskBadge score={c.risk_score} size="sm" /></td>
                  <td className="mono px-2 py-1.5">{compactCurrency(c.attached_evidence?.total_value ?? 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-muted/30 px-3 py-2">
      <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
      <p className="mono text-sm font-semibold">{value}</p>
    </div>
  );
}
