import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, GitBranch, Route as RouteIcon } from "lucide-react";
import { db, tracePath, bandOf, type Transaction } from "@/lib/trace/engine";
import { compactCurrency, currency, dateTime } from "@/lib/trace/format";
import {
  EmptyState,
  Mono,
  PatternBadge,
  RiskBadge,
  SectionTitle,
} from "@/components/trace/primitives";
import { RISK_CLASSES } from "@/components/trace/primitives";
import { useTrace } from "@/lib/trace/context";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/tracer")({
  head: () => ({
    meta: [
      { title: "Money Tracer · TRACE-X" },
      {
        name: "description",
        content:
          "Follow funds hop by hop from a source account through intermediaries to their destination across the synthetic TRACE-X corpus.",
      },
      { property: "og:title", content: "Money Tracer · TRACE-X" },
      {
        property: "og:description",
        content: "Linear multi-hop money-flow tracing with running totals, hop counts and per-hop risk colouring.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: TracerPage,
});

interface Branch {
  id: string;
  hops: Transaction[];
}

const MAX_BRANCHES = 6;
const MAX_DEPTH = 8;

/** Forward, branching walk from a starting account over suspicious cluster flows. */
function traceForward(start: string, allowed: Set<string>): Branch[] {
  const adj = new Map<string, Transaction[]>();
  db.transactions.forEach((t) => {
    if (!allowed.has(t.transaction_id)) return;
    if (!adj.has(t.sender_id)) adj.set(t.sender_id, []);
    adj.get(t.sender_id)!.push(t);
  });

  const branches: Branch[] = [];
  const walk = (node: string, path: Transaction[], seen: Set<string>) => {
    if (branches.length >= MAX_BRANCHES) return;
    const next = (adj.get(node) ?? [])
      .filter((e) => !seen.has(e.receiver_id))
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    if (next.length === 0 || path.length >= MAX_DEPTH) {
      if (path.length) branches.push({ id: path.map((p) => p.transaction_id).join("-"), hops: path });
      return;
    }
    for (const edge of next) {
      seen.add(edge.receiver_id);
      walk(edge.receiver_id, [...path, edge], seen);
      seen.delete(edge.receiver_id);
    }
  };
  walk(start, [], new Set([start]));
  return branches.sort((a, b) => b.hops.length - a.hops.length);
}

function TracerPage() {
  const { activeNetworkId, setActiveNetworkId } = useTrace();
  const cluster = db.getCluster(activeNetworkId) ?? db.clusters[0]!;
  const [startAccount, setStartAccount] = useState<string>("");

  const clusterTxnIds = useMemo(
    () => new Set(db.clusterTransactions(cluster.id).filter((t) => t.scenario_id).map((t) => t.transaction_id)),
    [cluster.id],
  );

  const canonical = useMemo(() => tracePath(cluster.id), [cluster.id]);
  const defaultStart = canonical[0]?.sender_id ?? cluster.central_account;
  const resolvedStart = startAccount || defaultStart;

  const branches = useMemo(() => {
    const found = traceForward(resolvedStart, clusterTxnIds);
    if (found.length) return found;
    if (canonical.length && resolvedStart === defaultStart)
      return [{ id: "canonical", hops: canonical }];
    return [];
  }, [resolvedStart, clusterTxnIds, canonical, defaultStart]);

  const memberAccounts = useMemo(
    () => cluster.member_account_ids.map((id) => db.getAccount(id)!).filter(Boolean),
    [cluster],
  );

  const totalValue = branches.reduce((s, b) => s + b.hops.reduce((x, h) => x + h.amount, 0), 0);
  const totalHops = branches.reduce((s, b) => s + b.hops.length, 0);

  return (
    <div className="space-y-6 p-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
            <RouteIcon className="size-4 text-signal" /> Money Tracer
          </h1>
          <p className="text-xs text-muted-foreground">
            Follow funds hop by hop from a source account through intermediaries to their exit points.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <label className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Network</label>
            <Select
              value={cluster.id}
              onValueChange={(v) => {
                setActiveNetworkId(v);
                setStartAccount("");
              }}
            >
              <SelectTrigger className="w-60"><SelectValue /></SelectTrigger>
              <SelectContent>
                {db.clusters.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <label className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Start account</label>
            <Select value={resolvedStart} onValueChange={setStartAccount}>
              <SelectTrigger className="w-64"><SelectValue /></SelectTrigger>
              <SelectContent>
                {memberAccounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.id} · {a.role_tag}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button variant="outline" size="sm" onClick={() => setStartAccount("")}>
            Use central account
          </Button>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <PatternBadge pattern={cluster.pattern} />
        <RiskBadge score={cluster.cluster_risk_score} />
        <span className="text-xs text-muted-foreground">{cluster.name}</span>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Total value traced" value={currency(totalValue)} />
        <Stat label="Hops" value={String(totalHops)} />
        <Stat label="Paths" value={String(branches.length)} />
      </div>

      {branches.length === 0 ? (
        <EmptyState
          icon={<GitBranch className="size-6" />}
          title="No outbound flow from this account"
          description="Pick another starting account in this network, or switch networks, to trace funds forward."
        />
      ) : (
        <div className="space-y-6">
          {branches.map((b, i) => (
            <BranchTrace key={b.id} branch={b} index={i} start={resolvedStart} />
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="panel rounded-lg border border-border p-4">
      <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
      <p className="mono mt-1 text-xl font-semibold">{value}</p>
    </div>
  );
}

function BranchTrace({ branch, index, start }: { branch: Branch; index: number; start: string }) {
  const value = branch.hops.reduce((s, h) => s + h.amount, 0);
  let running = 0;
  return (
    <section className="panel rounded-lg border border-border p-4">
      <SectionTitle
        title={`Path ${index + 1} — ${branch.hops.length} hops`}
        hint={`${compactCurrency(value)} moved · ends at ${branch.hops[branch.hops.length - 1]?.receiver_id}`}
      />
      <ol className="space-y-2">
        <li>
          <AccountNode id={start} role="Source" />
        </li>
        {branch.hops.map((h, i) => {
          running += h.amount;
          const last = i === branch.hops.length - 1;
          return (
            <li key={h.transaction_id} className="space-y-2">
              <div className="ml-4 flex flex-wrap items-center gap-3 border-l border-dashed border-border pl-4 text-xs text-muted-foreground">
                <ArrowRight className="size-3 text-signal" />
                <span className="mono font-medium text-foreground">{currency(h.amount)}</span>
                <span>{dateTime(h.timestamp)}</span>
                <span className="mono text-[10px] uppercase tracking-wide">{h.transaction_type}</span>
                {h.label === "suspicious" && (
                  <span className="mono text-[10px] uppercase tracking-wide text-risk-high">suspicious</span>
                )}
                <span className="ml-auto mono text-[11px]">running {currency(running)}</span>
              </div>
              <AccountNode id={h.receiver_id} role={last ? "Destination" : `Hop ${i + 1}`} />
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function AccountNode({ id, role }: { id: string; role: string }) {
  const account = db.getAccount(id);
  const score = account?.risk_score ?? 0;
  const c = RISK_CLASSES[bandOf(score)];
  return (
    <Link
      to="/accounts/$accountId"
      params={{ accountId: id }}
      className={cn(
        "flex flex-wrap items-center gap-3 rounded-md border px-3 py-2 transition-colors hover:bg-muted/40",
        c.border,
        c.bg,
      )}
    >
      <span className={cn("size-2 rounded-full", c.dot)} />
      <Mono className="text-xs font-medium">{id}</Mono>
      <span className="text-xs text-muted-foreground">{account?.holder ?? "Unknown"}</span>
      <span className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{role}</span>
      {account && (
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{account.role_tag}</span>
      )}
      <span className="ml-auto">
        <RiskBadge score={score} size="sm" />
      </span>
    </Link>
  );
}
