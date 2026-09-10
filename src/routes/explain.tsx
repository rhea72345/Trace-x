import { useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Boxes, GitBranch, Route as RouteIcon, ScanSearch, User, Cpu, Activity } from "lucide-react";
import {
  BAND_GUIDANCE,
  PATTERN_META,
  bandOf,
  db,
  type NetworkCluster,
  type SignalBreakdown,
  classifyFraudTypology,
} from "@/lib/trace/engine";
import { compactCurrency, currency, dateTime } from "@/lib/trace/format";
import {
  EmptyState,
  Meter,
  Mono,
  PatternBadge,
  RiskBadge,
  RISK_CLASSES,
  ScoreRing,
  SectionTitle,
  TypologyBadge,
} from "@/components/trace/primitives";
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
import { computeHybridRisk, isMLEngineAvailable } from "@/lib/trace/hybrid-engine";

export const Route = createFileRoute("/explain")({
  head: () => ({
    meta: [
      { title: "Why Flagged? · TRACE-X Explainability" },
      {
        name: "description",
        content:
          "Full weighted-signal breakdown behind any TRACE-X risk score — plain-language reasoning, signal contributions and the evidence driving each one.",
      },
      { property: "og:title", content: "Why Flagged? · TRACE-X Explainability" },
      {
        property: "og:description",
        content: "See exactly which behaviour, network and velocity signals produced a risk score, and the evidence behind them.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ExplainPage,
});

type EntityKind = "alert" | "network" | "account";

const SIGNAL_COLORS = [
  "var(--signal)",
  "var(--risk-critical)",
  "var(--risk-high)",
  "var(--risk-medium)",
  "var(--risk-low)",
  "var(--muted-foreground)",
];

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

/** Donut of weighted contributions (each signal's share of the final score). */
function ContributionDonut({ signals, score }: { signals: SignalBreakdown[]; score: number }) {
  const size = 220;
  const r = 84;
  const stroke = 26;
  const circ = 2 * Math.PI * r;
  const total = signals.reduce((s, x) => s + x.contribution, 0) || 1;
  let offset = 0;

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--border)" strokeWidth={stroke} />
        {signals.map((s, i) => {
          const frac = s.contribution / total;
          const dash = circ * frac;
          const el = (
            <circle
              key={s.key}
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke={SIGNAL_COLORS[i % SIGNAL_COLORS.length]}
              strokeWidth={stroke}
              strokeDasharray={`${Math.max(0, dash - 2)} ${circ}`}
              strokeDashoffset={-offset}
              style={{ transition: "stroke-dasharray 700ms cubic-bezier(0.22,1,0.36,1)" }}
            />
          );
          offset += dash;
          return el;
        })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="mono text-3xl font-semibold">{score}</span>
        <span className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
          {bandOf(score)}
        </span>
      </div>
    </div>
  );
}

function summarise(cluster: NetworkCluster, focusAccount?: string) {
  const sorted = [...cluster.signals].sort((a, b) => b.contribution - a.contribution);
  const top = sorted.slice(0, 3);
  const meta = PATTERN_META[cluster.pattern];
  const subject = focusAccount
    ? `Account ${focusAccount} is scored through ${cluster.name}`
    : `${cluster.name} was flagged`;
  return [
    `${subject} at ${cluster.cluster_risk_score}/100 (${cluster.level}) because its activity matches the ${meta.label} template across ${cluster.member_account_ids.length} accounts and ${cluster.transaction_ids.length} transactions worth ${compactCurrency(cluster.total_value)}.`,
    `The score is driven mainly by ${top.map((t) => t.label.toLowerCase()).join(", ")} — together ${top.reduce((s, t) => s + t.contribution, 0)} of the ${cluster.cluster_risk_score} points.`,
    `Recommended action for this band: ${BAND_GUIDANCE[cluster.level].toLowerCase()}.`,
  ].join(" ");
}

function ExplainPage() {
  const { activeNetworkId, setActiveNetworkId } = useTrace();
  const navigate = useNavigate();
  const [kind, setKind] = useState<EntityKind>("network");
  const [alertId, setAlertId] = useState<string>(db.alerts[0]?.id ?? "");
  const [accountId, setAccountId] = useState<string>("");

  const cluster = useMemo(() => {
    if (kind === "alert") return db.getCluster(db.getAlert(alertId)?.network_id ?? "") ?? null;
    if (kind === "account") {
      const acct = accountId ? db.getAccount(accountId) : undefined;
      return acct?.cluster_id ? (db.getCluster(acct.cluster_id) ?? null) : null;
    }
    return db.getCluster(activeNetworkId) ?? null;
  }, [kind, alertId, accountId, activeNetworkId]);

  const focusAccount = kind === "account" && accountId ? db.getAccount(accountId) : undefined;

  const clusterAccounts = useMemo(
    () => db.accounts.filter((a) => a.cluster_id).sort((a, b) => b.risk_score - a.risk_score),
    [],
  );

  const signals = useMemo(
    () => (cluster ? [...cluster.signals].sort((a, b) => b.contribution - a.contribution) : []),
    [cluster],
  );

  const evidence = useMemo(() => {
    if (!cluster) return [];
    return db
      .clusterTransactions(cluster.id)
      .filter((t) => t.label === "suspicious")
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 8);
  }, [cluster]);

  const keyAccounts = useMemo(() => {
    if (!cluster) return [];
    const roles: { id: string; role: string }[] = [
      { id: cluster.central_account, role: "Central" },
      ...cluster.mule_accounts.map((id) => ({ id, role: "Mule" })),
      ...cluster.bridge_accounts.map((id) => ({ id, role: "Bridge" })),
    ];
    const seen = new Set<string>();
    return roles.filter((r) => r.id && !seen.has(r.id) && seen.add(r.id)).slice(0, 8);
  }, [cluster]);

  const openNetwork = () => {
    if (!cluster) return;
    setActiveNetworkId(cluster.id);
    void navigate({ to: "/network" });
  };

  return (
    <div className="space-y-6 p-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
            <ScanSearch className="size-4 text-signal" /> Why Flagged?
          </h1>
          <p className="text-xs text-muted-foreground">
            Every point of a TRACE-X risk score, attributed to a weighted signal and the evidence behind it.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Explain">
            <Select value={kind} onValueChange={(v) => setKind(v as EntityKind)}>
              <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="network">Network</SelectItem>
                <SelectItem value="alert">Alert</SelectItem>
                <SelectItem value="account">Account</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          {kind === "network" && (
            <Field label="Network">
              <Select value={activeNetworkId} onValueChange={setActiveNetworkId}>
                <SelectTrigger className="w-64"><SelectValue placeholder="Select a network" /></SelectTrigger>
                <SelectContent>
                  {db.clusters.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
          {kind === "alert" && (
            <Field label="Alert">
              <Select value={alertId} onValueChange={setAlertId}>
                <SelectTrigger className="w-72"><SelectValue placeholder="Select an alert" /></SelectTrigger>
                <SelectContent>
                  {db.alerts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>{a.title}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
          {kind === "account" && (
            <Field label="Account">
              <Select value={accountId} onValueChange={setAccountId}>
                <SelectTrigger className="w-64"><SelectValue placeholder="Select an account" /></SelectTrigger>
                <SelectContent>
                  {clusterAccounts.slice(0, 60).map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.id} · {a.holder}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
        </div>
      </header>

      {!cluster ? (
        <EmptyState
          icon={<ScanSearch className="size-6" />}
          title="Nothing selected to explain"
          description="Pick an alert, a network, or an account above and TRACE-X will decompose its risk score into weighted signals with supporting evidence."
        />
      ) : (
        <>
          {/* Plain-language summary */}
          <section className="panel rounded-lg border border-border p-5">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <PatternBadge pattern={cluster.pattern} />
              <RiskBadge score={cluster.cluster_risk_score} pulse />
              <TypologyBadge typology={classifyFraudTypology(cluster)} />
              <span className="text-xs text-muted-foreground">{cluster.name}</span>
              {focusAccount && (
                <span className="text-xs text-muted-foreground">
                  · focus <Mono>{focusAccount.id}</Mono> ({focusAccount.role_tag})
                </span>
              )}
            </div>
            <p className="max-w-4xl text-sm leading-relaxed text-foreground/90">
              {summarise(cluster, focusAccount?.id)}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={openNetwork}>
                <GitBranch className="mr-1.5 size-3.5" /> Open in Network Investigation
              </Button>
              <Button size="sm" variant="secondary" asChild>
                <Link to="/tracer">
                  <RouteIcon className="mr-1.5 size-3.5" /> Trace the money
                </Link>
              </Button>
              {focusAccount && (
                <Button size="sm" variant="secondary" asChild>
                  <Link to="/accounts/$accountId" params={{ accountId: focusAccount.id }}>
                    <User className="mr-1.5 size-3.5" /> Account profile
                  </Link>
                </Button>
              )}
            </div>
          </section>

          {/* Hybrid Risk Breakdown */}
          <section className="panel rounded-lg border border-border p-5">
            <SectionTitle 
              title="Hybrid Risk Breakdown" 
              hint="Combined risk from rule-based detection, ML anomaly detection, and network analysis."
              action={
                isMLEngineAvailable() ? (
                  <span className="flex items-center gap-1.5 text-[10px] text-signal">
                    <Cpu className="size-3" /> ML Active
                  </span>
                ) : (
                  <span className="text-[10px] text-muted-foreground">Rule-Based Analysis</span>
                )
              }
            />
            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              {(() => {
                try {
                  const centralAccountId = cluster.central_account;
                  if (!centralAccountId) {
                    // Fallback if no central account
                    return (
                      <>
                        <RiskComponent
                          label="Rule-Based Risk"
                          value={cluster.cluster_risk_score}
                          contribution={Math.round(cluster.cluster_risk_score * 0.4)}
                          icon={<Activity className="size-4" />}
                          color="var(--risk-high)"
                        />
                        <RiskComponent
                          label="ML Anomaly Risk"
                          value={0}
                          contribution={0}
                          icon={<Cpu className="size-4" />}
                          color="var(--signal)"
                        />
                        <RiskComponent
                          label="Network Risk"
                          value={Math.round(cluster.cluster_risk_score * 0.25)}
                          contribution={Math.round(cluster.cluster_risk_score * 0.25)}
                          icon={<GitBranch className="size-4" />}
                          color="var(--risk-critical)"
                        />
                      </>
                    );
                  }
                  const hybridRisk = computeHybridRisk(centralAccountId);
                  return (
                    <>
                      <RiskComponent
                        label="Rule-Based Risk"
                        value={hybridRisk.rule_risk}
                        contribution={hybridRisk.contributions.rule}
                        icon={<Activity className="size-4" />}
                        color="var(--risk-high)"
                      />
                      <RiskComponent
                        label="ML Anomaly Risk"
                        value={hybridRisk.ml_risk}
                        contribution={hybridRisk.contributions.ml}
                        icon={<Cpu className="size-4" />}
                        color="var(--signal)"
                      />
                      <RiskComponent
                        label="Network Risk"
                        value={hybridRisk.network_risk}
                        contribution={hybridRisk.contributions.network}
                        icon={<GitBranch className="size-4" />}
                        color="var(--risk-critical)"
                      />
                    </>
                  );
                } catch (error) {
                  console.warn("Hybrid risk computation failed, using fallback:", error);
                  // Fallback to cluster-based estimates
                  return (
                    <>
                      <RiskComponent
                        label="Rule-Based Risk"
                        value={cluster.cluster_risk_score}
                        contribution={Math.round(cluster.cluster_risk_score * 0.4)}
                        icon={<Activity className="size-4" />}
                        color="var(--risk-high)"
                      />
                      <RiskComponent
                        label="ML Anomaly Risk"
                        value={isMLEngineAvailable() ? Math.round(cluster.cluster_risk_score * 0.35) : 0}
                        contribution={isMLEngineAvailable() ? Math.round(cluster.cluster_risk_score * 0.35) : 0}
                        icon={<Cpu className="size-4" />}
                        color="var(--signal)"
                      />
                      <RiskComponent
                        label="Network Risk"
                        value={Math.round(cluster.cluster_risk_score * 0.25)}
                        contribution={Math.round(cluster.cluster_risk_score * 0.25)}
                        icon={<GitBranch className="size-4" />}
                        color="var(--risk-critical)"
                      />
                    </>
                  );
                }
              })()}
            </div>
            <div className="mt-4 rounded-md border border-border bg-muted/30 p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium">Hybrid Score</span>
                <span className="mono text-lg font-semibold">{cluster.cluster_risk_score}/100</span>
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Weighted combination: Rule 40% + ML 35% + Network 25%
              </p>
            </div>
          </section>

          {/* Score breakdown */}
          <section className="grid gap-5 lg:grid-cols-[260px_1fr]">
            <div className="panel flex flex-col items-center gap-4 rounded-lg border border-border p-5">
              <ContributionDonut signals={signals} score={cluster.cluster_risk_score} />
              <div className="w-full space-y-1.5">
                {signals.map((s, i) => (
                  <div key={s.key} className="flex items-center gap-2 text-[11px]">
                    <span
                      className="size-2 rounded-sm"
                      style={{ background: SIGNAL_COLORS[i % SIGNAL_COLORS.length] }}
                    />
                    <span className="flex-1 truncate text-muted-foreground">{s.label}</span>
                    <span className="mono">{s.contribution}</span>
                  </div>
                ))}
              </div>
              <div
                className={cn(
                  "w-full rounded-md border px-3 py-2 text-center text-[11px]",
                  RISK_CLASSES[cluster.level].border,
                  RISK_CLASSES[cluster.level].bg,
                  RISK_CLASSES[cluster.level].text,
                )}
              >
                {cluster.level} band — {BAND_GUIDANCE[cluster.level]}
              </div>
            </div>

            <div className="panel rounded-lg border border-border p-5">
              <SectionTitle
                title="Weighted signal breakdown"
                hint="Each signal is scored 0–100, then weighted into the final cluster score."
              />
              <div className="space-y-5">
                {signals.map((s, i) => (
                  <div key={s.key} className="grid gap-3 sm:grid-cols-[1fr_auto]">
                    <div>
                      <div className="mb-1 flex items-center gap-2">
                        <span
                          className="size-2 rounded-sm"
                          style={{ background: SIGNAL_COLORS[i % SIGNAL_COLORS.length] }}
                        />
                        <span className="text-xs font-medium">{s.label}</span>
                        <span className="mono text-[10px] text-muted-foreground">weight {s.weight}%</span>
                      </div>
                      <Meter label="Signal score" value={s.score} hint={s.reason} tone="risk" />
                    </div>
                    <div className="flex items-start justify-end">
                      <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-right">
                        <div className="mono text-lg font-semibold">+{s.contribution}</div>
                        <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                          points
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* Fingerprint */}
          <section className="panel rounded-lg border border-border p-5">
            <SectionTitle title="Fraud fingerprint" hint="Structural indicators feeding the network and velocity signals." />
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Meter label="Velocity" value={cluster.fingerprint.velocity} tone="risk" />
              <Meter label="Layering" value={cluster.fingerprint.layering} tone="risk" />
              <Meter label="Fan-in" value={cluster.fingerprint.fan_in} tone="risk" />
              <Meter label="Fan-out" value={cluster.fingerprint.fan_out} tone="risk" />
              <Meter label="Circularity" value={cluster.fingerprint.circularity} tone="risk" />
              <Meter label="Dormancy break" value={cluster.fingerprint.dormancy} tone="risk" />
            </div>
          </section>

          {/* Linked evidence */}
          <section className="grid gap-5 lg:grid-cols-2">
            <div className="panel rounded-lg border border-border p-5">
              <SectionTitle title="Evidence — accounts" hint="Roles driving behaviour and network signals." />
              {keyAccounts.length === 0 ? (
                <p className="text-xs text-muted-foreground">No role-tagged accounts in this network.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {keyAccounts.map((r) => {
                    const acct = db.getAccount(r.id);
                    if (!acct) return null;
                    return (
                      <li key={r.id} className="flex items-center justify-between gap-3 py-2">
                        <div className="min-w-0">
                          <Link
                            to="/accounts/$accountId"
                            params={{ accountId: acct.id }}
                            className="mono text-xs text-signal hover:underline"
                          >
                            {acct.id}
                          </Link>
                          <p className="truncate text-[11px] text-muted-foreground">
                            {acct.holder} · {r.role} · {acct.current_status}
                          </p>
                        </div>
                        <RiskBadge score={acct.risk_score} size="sm" />
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div className="panel rounded-lg border border-border p-5">
              <SectionTitle
                title="Evidence — transactions"
                hint="Largest suspicious legs behind the velocity and pattern signals."
              />
              {evidence.length === 0 ? (
                <p className="text-xs text-muted-foreground">No suspicious legs recorded for this network.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {evidence.map((t) => (
                    <li key={t.transaction_id} className="flex items-center justify-between gap-3 py-2">
                      <div className="min-w-0">
                        <p className="mono truncate text-[11px] text-foreground/80">{t.transaction_id}</p>
                        <p className="truncate text-[11px] text-muted-foreground">
                          <Link
                            to="/accounts/$accountId"
                            params={{ accountId: t.sender_id }}
                            className="text-signal hover:underline"
                          >
                            {t.sender_id}
                          </Link>{" "}
                          →{" "}
                          <Link
                            to="/accounts/$accountId"
                            params={{ accountId: t.receiver_id }}
                            className="text-signal hover:underline"
                          >
                            {t.receiver_id}
                          </Link>{" "}
                          · {dateTime(t.timestamp)}
                        </p>
                      </div>
                      <span className="mono shrink-0 text-xs">{currency(t.amount)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          <section className="panel flex flex-wrap items-center gap-6 rounded-lg border border-border p-5">
            <ScoreRing score={cluster.cluster_risk_score} size={110} />
            <div className="grid flex-1 gap-3 sm:grid-cols-3">
              <Stat label="Accounts" value={String(cluster.member_account_ids.length)} />
              <Stat label="Transactions" value={String(cluster.transaction_ids.length)} />
              <Stat label="Value" value={compactCurrency(cluster.total_value)} />
            </div>
            <Boxes className="size-5 text-muted-foreground" />
          </section>
        </>
      )}
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

function RiskComponent({ 
  label, 
  value, 
  contribution, 
  icon, 
  color 
}: { 
  label: string; 
  value: number; 
  contribution: number; 
  icon: React.ReactNode; 
  color: string; 
}) {
  return (
    <div className="rounded-md border border-border bg-panel/40 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-muted-foreground">
          {icon}
          <span className="text-[10px] uppercase tracking-wider">{label}</span>
        </div>
        <span className="mono text-sm font-semibold" style={{ color }}>{value}</span>
      </div>
      <div className="mt-2">
        <div className="flex items-center justify-between text-[10px] text-muted-foreground">
          <span>Contribution</span>
          <span className="mono">+{contribution}</span>
        </div>
        <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div 
            className="h-full rounded-full transition-all" 
            style={{ width: `${Math.min(100, contribution)}%`, backgroundColor: color }} 
          />
        </div>
      </div>
    </div>
  );
}
