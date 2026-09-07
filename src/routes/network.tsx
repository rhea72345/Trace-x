import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { BriefcaseBusiness, Network, Pause, Play, RotateCcw, X } from "lucide-react";
import {
  PATTERN_META,
  db,
  recomputeCluster,
  bandOf,
  BAND_GUIDANCE,
  type PatternType,
  type RiskLevel,
  type Transaction,
} from "@/lib/trace/engine";
import { compactCurrency, dateTime } from "@/lib/trace/format";
import { Meter, Mono, PatternBadge, RiskBadge, ScoreRing, SectionTitle } from "@/components/trace/primitives";
import { NetworkGraph } from "@/components/trace/NetworkGraph";
import { ConnectionsList, useAccountConnections } from "@/components/trace/ConnectionsList";
import { useTrace } from "@/lib/trace/context";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createCaseFromNetwork } from "@/lib/trace/cases";
import { toast } from "sonner";

export const Route = createFileRoute("/network")({
  head: () => ({
    meta: [
      { title: "Network Investigation · TRACE-X" },
      {
        name: "description",
        content:
          "Reconstruct suspicious money-movement networks, replay them chronologically and run what-if analysis on the active TRACE-X investigation.",
      },
      { property: "og:title", content: "Network Investigation · TRACE-X" },
      {
        property: "og:description",
        content: "Graph-first view of mule chains, layering and circular flows across the synthetic TRACE-X corpus.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: NetworkPage,
});

const RISK_ORDER: RiskLevel[] = ["Low", "Medium", "High", "Critical"];
const TIME_WINDOWS = [
  { key: "all", label: "Full history", days: null },
  { key: "30", label: "Last 30 days", days: 30 },
  { key: "7", label: "Last 7 days", days: 7 },
  { key: "1", label: "Last 24 hours", days: 1 },
] as const;

function NetworkPage() {
  const { activeNetworkId, setActiveNetworkId, activeAlertId } = useTrace();
  const cluster = db.getCluster(activeNetworkId)!;

  const [selected, setSelected] = useState<string | null>(cluster.central_account);
  const [drawerAccount, setDrawerAccount] = useState<string | null>(null);
  const [excludedAccounts, setExcludedAccounts] = useState<Set<string>>(new Set());
  const [excludedTxnIds, setExcludedTxnIds] = useState<Set<string>>(new Set());

  const [story, setStory] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);

  const [patternFilter, setPatternFilter] = useState<PatternType | "all">("all");
  const [windowKey, setWindowKey] = useState<string>("all");
  const [minBand, setMinBand] = useState<RiskLevel>("Low");
  const [amountPct, setAmountPct] = useState<[number, number]>([0, 100]);

  const txns = useMemo(() => db.clusterTransactions(cluster.id), [cluster.id]);
  const amountMax = useMemo(() => Math.max(1, ...txns.map((t) => t.amount)), [txns]);
  const amountRange = useMemo<[number, number]>(
    () => [(amountPct[0] / 100) * amountMax, (amountPct[1] / 100) * amountMax],
    [amountPct, amountMax],
  );

  /* ---------- filter → exclusion sets ---------- */
  const filteredOutTxns = useMemo(() => {
    const win = TIME_WINDOWS.find((w) => w.key === windowKey)!;
    const out = new Set<string>();
    if (win.days === null) return out;
    const cutoff = new Date(cluster.last_seen).getTime() - win.days * 86400000;
    txns.forEach((t) => {
      if (new Date(t.timestamp).getTime() < cutoff) out.add(t.transaction_id);
    });
    return out;
  }, [windowKey, txns, cluster.last_seen]);

  const filteredOutAccounts = useMemo(() => {
    const out = new Set<string>();
    const floor = RISK_ORDER.indexOf(minBand);
    if (floor === 0) return out;
    const ids = new Set<string>();
    txns.forEach((t) => {
      ids.add(t.sender_id);
      ids.add(t.receiver_id);
    });
    ids.forEach((id) => {
      const a = db.getAccount(id);
      if (!a) return;
      if (RISK_ORDER.indexOf(bandOf(a.risk_score)) < floor) out.add(id);
    });
    return out;
  }, [minBand, txns]);

  const effectiveAccounts = useMemo(
    () => new Set<string>([...excludedAccounts, ...filteredOutAccounts]),
    [excludedAccounts, filteredOutAccounts],
  );
  const effectiveTxns = useMemo(() => {
    const s = new Set<string>([...excludedTxnIds, ...filteredOutTxns]);
    txns.forEach((t) => {
      if (t.amount < amountRange[0] || t.amount > amountRange[1]) s.add(t.transaction_id);
    });
    return s;
  }, [excludedTxnIds, filteredOutTxns, txns, amountRange]);

  /* ---------- what-if recompute ---------- */
  const whatIf = useMemo(
    () => recomputeCluster(cluster.id, effectiveAccounts, effectiveTxns),
    [cluster.id, effectiveAccounts, effectiveTxns],
  );
  const baseline = cluster.cluster_risk_score;
  const delta = whatIf.score - baseline;
  const manualExclusions = excludedAccounts.size + excludedTxnIds.size;

  /* ---------- story mode playback ---------- */
  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => {
      setStory((c) => {
        const next = (c ?? 0) + 0.02;
        if (next >= 1) {
          setPlaying(false);
          return 1;
        }
        return next;
      });
    }, 120);
    return () => window.clearInterval(id);
  }, [playing]);

  useEffect(() => {
    setSelected(cluster.central_account);
    setExcludedAccounts(new Set());
    setExcludedTxnIds(new Set());
    setStory(null);
    setPlaying(false);
  }, [cluster.id, cluster.central_account]);

  const toggleAccount = (id: string) =>
    setExcludedAccounts((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const onEdgeSelect = (t: Transaction) =>
    setExcludedTxnIds((prev) => {
      const next = new Set(prev);
      next.has(t.transaction_id) ? next.delete(t.transaction_id) : next.add(t.transaction_id);
      return next;
    });

  const networkOptions = db.clusters.filter(
    (c) => patternFilter === "all" || c.pattern_tags.includes(patternFilter),
  );

  const fingerprint = whatIf.fingerprint.velocity ? whatIf.fingerprint : cluster.fingerprint;

  const createCase = async () => {
    try {
      const item = await createCaseFromNetwork(cluster.id, activeAlertId);
      toast.success("Case created", { description: item.title });
      window.location.assign(`/cases/${item.id}`);
    } catch (error) {
      toast.error("Could not create case", { description: error instanceof Error ? error.message : "Try again." });
    }
  };

  return (
    <div className="space-y-5">
      <header className="panel-surface rounded-lg p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="mono text-[10px] uppercase tracking-[0.28em] text-signal">Network investigation</p>
            <h1 className="mt-1 flex items-center gap-2 text-xl font-semibold tracking-tight">
              <Network className="size-5 text-signal" /> {cluster.name}
            </h1>
            <p className="mono mt-1 text-xs text-muted-foreground">{cluster.id}</p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {cluster.pattern_tags.map((p) => (
                <PatternBadge key={p} pattern={p} size="sm" />
              ))}
            </div>
            <p className="mt-3 max-w-2xl text-sm text-muted-foreground">{cluster.narrative}</p>
          </div>
          <div className="flex items-center gap-4">
            <ScoreRing score={whatIf.score || baseline} label={whatIf.level ?? cluster.level} />
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => void createCase()}>
              <BriefcaseBusiness className="size-3.5" /> Create case
            </Button>
          </div>
        </div>
        <dl className="mt-4 grid gap-3 sm:grid-cols-4">
          <Stat label="Accounts" value={cluster.member_account_ids.length.toString()} />
          <Stat label="Transactions" value={cluster.transaction_ids.length.toString()} />
          <Stat label="Total value" value={compactCurrency(cluster.total_value)} />
          <Stat label="Last activity" value={dateTime(cluster.last_seen)} />
        </dl>
      </header>

      {/* Filters */}
      <section className="panel-surface rounded-lg p-4">
        <SectionTitle title="Filters" hint="Client-side filtering of the synthetic corpus — the score reacts live." />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Field label="Pattern type">
            <Select
              value={patternFilter}
              onValueChange={(v) => setPatternFilter(v as PatternType | "all")}
            >
              <SelectTrigger className="h-9 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All patterns</SelectItem>
                {(Object.keys(PATTERN_META) as PatternType[]).map((p) => (
                  <SelectItem key={p} value={p}>
                    {PATTERN_META[p].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Network">
            <Select value={cluster.id} onValueChange={setActiveNetworkId}>
              <SelectTrigger className="h-9 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {networkOptions.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Time range">
            <Select value={windowKey} onValueChange={setWindowKey}>
              <SelectTrigger className="h-9 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIME_WINDOWS.map((w) => (
                  <SelectItem key={w.key} value={w.key}>
                    {w.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Minimum risk level">
            <Select value={minBand} onValueChange={(v) => setMinBand(v as RiskLevel)}>
              <SelectTrigger className="h-9 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RISK_ORDER.map((b) => (
                  <SelectItem key={b} value={b}>
                    {b} and above
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>

        <div className="mt-4">
          <Field
            label={`Amount range · ${compactCurrency(Math.round(amountRange[0]))} – ${compactCurrency(
              Math.round(amountRange[1]),
            )}`}
          >
            <Slider
              value={amountPct}
              onValueChange={(v) => setAmountPct([v[0] ?? 0, v[1] ?? 100])}
              max={100}
              step={1}
              className="mt-2"
            />
          </Field>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1fr_340px]">
        <div className="panel-surface rounded-lg p-3">
          <SectionTitle
            title="Reconstructed network"
            hint="Click a node for its profile. Click an edge to exclude that transaction. Story Mode replays the flow chronologically."
            action={
              <div className="flex gap-1.5">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    if (story === null) setStory(0);
                    setPlaying((p) => !p);
                  }}
                >
                  {playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />} Story mode
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setExcludedAccounts(new Set());
                    setExcludedTxnIds(new Set());
                    setStory(null);
                    setPlaying(false);
                  }}
                >
                  <RotateCcw className="size-3.5" /> Reset
                </Button>
              </div>
            }
          />
          <NetworkGraph
            clusterId={cluster.id}
            selected={selected}
            onSelect={(id) => {
              setSelected(id);
              setDrawerAccount(id);
            }}
            onEdgeSelect={onEdgeSelect}
            excludedAccounts={effectiveAccounts}
            excludedTxns={effectiveTxns}
            storyCursor={story}
            minAmount={amountRange[0]}
            amountCeiling={amountRange[1]}
            height={520}
          />
          {story !== null && (
            <div className="px-2 py-3">
              <Slider
                value={[Math.round(story * 100)]}
                onValueChange={([v]) => {
                  setPlaying(false);
                  setStory((v ?? 0) / 100);
                }}
                max={100}
                step={1}
              />
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                Chronological reveal — {Math.round(story * 100)}% of the network timeline shown.
              </p>
            </div>
          )}
        </div>

        <div className="space-y-4">
          {/* What-if */}
          <div className="panel-surface rounded-lg p-4">
            <SectionTitle title="What-if simulator" hint="Excluded nodes and edges are removed from scoring." />
            <div className="grid grid-cols-3 items-end gap-2">
              <Stat label="Before" value={baseline.toString()} />
              <Stat label="After" value={(whatIf.score || 0).toString()} />
              <Stat
                label="Delta"
                value={`${delta > 0 ? "+" : ""}${delta}`}
              />
            </div>
            <p className="mt-3 text-[11px] text-muted-foreground">
              {manualExclusions === 0
                ? "Exclude an account or transaction to simulate a disruption."
                : `${excludedAccounts.size} account(s) and ${excludedTxnIds.size} transaction(s) excluded manually.`}
            </p>
            {excludedTxnIds.size > 0 && (
              <ul className="mt-2 space-y-1">
                {[...excludedTxnIds].map((id) => (
                  <li key={id} className="flex items-center justify-between gap-2 text-[11px]">
                    <Mono>{id}</Mono>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 px-2 text-[10px]"
                      onClick={() =>
                        setExcludedTxnIds((prev) => {
                          const next = new Set(prev);
                          next.delete(id);
                          return next;
                        })
                      }
                    >
                      <X className="size-3" /> restore
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 rounded-md border border-border bg-muted/40 p-2.5 text-[11px] leading-snug text-muted-foreground">
              {BAND_GUIDANCE[whatIf.level ?? cluster.level]}
            </p>
          </div>

          {/* Fingerprint */}
          <div className="panel-surface rounded-lg p-4">
            <SectionTitle title="Network DNA / fraud fingerprint" hint="Normalised 0–100 per dimension." />
            <div className="space-y-3">
              <Meter label="velocity" value={fingerprint.velocity} />
              <Meter label="layering" value={fingerprint.layering} />
              <Meter label="fan in" value={fingerprint.fan_in} />
              <Meter label="fan out" value={fingerprint.fan_out} />
              <Meter label="circularity" value={fingerprint.circularity} />
              <Meter label="dormancy" value={fingerprint.dormancy} />
            </div>
          </div>

          {/* Key roles */}
          <div className="panel-surface rounded-lg p-4">
            <SectionTitle title="Key accounts" hint="Central, mule and bridge roles in this network." />
            <RoleGroup
              title="Central"
              ids={[cluster.central_account]}
              onOpen={setDrawerAccount}
              excluded={excludedAccounts}
              onToggle={toggleAccount}
            />
            <RoleGroup
              title="Mule / layer"
              ids={cluster.mule_accounts}
              onOpen={setDrawerAccount}
              excluded={excludedAccounts}
              onToggle={toggleAccount}
            />
            <RoleGroup
              title="Bridge / hub"
              ids={cluster.bridge_accounts}
              onOpen={setDrawerAccount}
              excluded={excludedAccounts}
              onToggle={toggleAccount}
            />
          </div>

          <div className="panel-surface rounded-lg p-4">
            <SectionTitle title="Why this scored high" hint="Weighted signal contributions." />
            <div className="space-y-3">
              {(whatIf.signals.length ? whatIf.signals : cluster.signals).map((s) => (
                <Meter key={s.key} label={`${s.label} · ${s.weight}%`} value={s.score} hint={s.reason} tone="risk" />
              ))}
            </div>
          </div>
        </div>
      </section>

      <AccountDrawer
        accountId={drawerAccount}
        onClose={() => setDrawerAccount(null)}
        excluded={excludedAccounts}
        onToggle={toggleAccount}
      />
    </div>
  );
}

function AccountDrawer({
  accountId,
  onClose,
  excluded,
  onToggle,
}: {
  accountId: string | null;
  onClose: () => void;
  excluded: Set<string>;
  onToggle: (id: string) => void;
}) {
  const account = accountId ? db.getAccount(accountId) : undefined;
  const connections = useAccountConnections(accountId);

  return (
    <Sheet open={!!account} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        {account && (
          <>
            <SheetHeader>
              <SheetTitle className="mono text-sm">
                <Link
                  to="/accounts/$accountId"
                  params={{ accountId: account.id }}
                  className="text-signal underline-offset-2 hover:underline"
                >
                  {account.id}
                </Link>
              </SheetTitle>
            </SheetHeader>
            <div className="mt-4 space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm">{account.holder}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {account.role_tag} · {account.current_status}
                  </p>
                </div>
                <RiskBadge score={account.risk_score} />
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant={excluded.has(account.id) ? "secondary" : "outline"}
                  onClick={() => onToggle(account.id)}
                >
                  {excluded.has(account.id) ? "Include in scoring" : "Exclude from scoring"}
                </Button>
                <Button size="sm" variant="ghost" asChild>
                  <Link to="/accounts/$accountId" params={{ accountId: account.id }}>
                    Open account profile
                  </Link>
                </Button>
              </div>

              <div>
                <SectionTitle title="Connections" hint={`${connections.length} counterparties in the corpus.`} />
                <ConnectionsList connections={connections} />
              </div>
            </div>

          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function RoleGroup({
  title,
  ids,
  onOpen,
  excluded,
  onToggle,
}: {
  title: string;
  ids: string[];
  onOpen: (id: string) => void;
  excluded: Set<string>;
  onToggle: (id: string) => void;
}) {
  if (!ids.length) return null;
  return (
    <div className="mb-3">
      <p className="mb-1 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{title}</p>
      <ul className="space-y-1">
        {ids.map((id) => {
          const a = db.getAccount(id);
          if (!a) return null;
          const off = excluded.has(id);
          return (
            <li key={id} className="flex items-center justify-between gap-2 rounded-md px-1.5 py-1 hover:bg-accent">
              <button type="button" className="min-w-0 flex-1 truncate text-left" onClick={() => onOpen(id)}>
                <Mono className={off ? "line-through opacity-50" : ""}>{id}</Mono>
                <span className="ml-2 truncate text-[11px] text-muted-foreground">{a.holder}</span>
              </button>
              <RiskBadge score={a.risk_score} size="sm" showScore={false} />
              <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]" onClick={() => onToggle(id)}>
                {off ? "Include" : "Exclude"}
              </Button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-card/60 px-3 py-2">
      <dt className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{label}</dt>
      <dd className="mono mt-0.5 text-sm">{value}</dd>
    </div>
  );
}
