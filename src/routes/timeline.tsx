import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { CalendarClock, Clock } from "lucide-react";
import { db, bandOf, type RiskLevel, type Transaction } from "@/lib/trace/engine";
import { compactCurrency, currency, dateTime, dayOnly, timeOnly } from "@/lib/trace/format";
import {
  EmptyState,
  Mono,
  PatternBadge,
  RiskBadge,
  RISK_CLASSES,
  SectionTitle,
} from "@/components/trace/primitives";
import { useTrace } from "@/lib/trace/context";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/timeline")({
  head: () => ({
    meta: [
      { title: "Investigation Timeline · TRACE-X" },
      {
        name: "description",
        content:
          "Chronological reconstruction of a suspicious network's activity — every transaction and account state change, ordered in time.",
      },
      { property: "og:title", content: "Investigation Timeline · TRACE-X" },
      {
        property: "og:description",
        content: "Scrub through a fraud network's events in order, filtered by time range and risk level.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: TimelinePage,
});

const RANGES: { label: string; hours: number | null }[] = [
  { label: "Last 24h", hours: 24 },
  { label: "Last 7 days", hours: 24 * 7 },
  { label: "Last 30 days", hours: 24 * 30 },
  { label: "All time", hours: null },
];

const LEVELS: RiskLevel[] = ["Low", "Medium", "High", "Critical"];
const LEVEL_RANK: Record<RiskLevel, number> = { Low: 0, Medium: 1, High: 2, Critical: 3 };

interface TimelineEvent {
  id: string;
  timestamp: string;
  kind: "txn" | "status";
  score: number;
  txn?: Transaction;
  accountId: string;
  counterparty?: string;
  title: string;
  detail: string;
}

function TimelinePage() {
  const { activeNetworkId, setActiveNetworkId } = useTrace();
  const cluster = db.getCluster(activeNetworkId) ?? db.clusters[0];
  const [rangeLabel, setRangeLabel] = useState("All time");
  const [minLevel, setMinLevel] = useState<RiskLevel>("Low");
  const [selected, setSelected] = useState<string | null>(null);

  const events = useMemo<TimelineEvent[]>(() => {
    if (!cluster) return [];
    const txnEvents: TimelineEvent[] = db.clusterTransactions(cluster.id).map((t) => {
      const sender = db.getAccount(t.sender_id);
      const receiver = db.getAccount(t.receiver_id);
      const score = Math.max(sender?.risk_score ?? 0, receiver?.risk_score ?? 0);
      return {
        id: t.transaction_id,
        timestamp: t.timestamp,
        kind: "txn",
        score,
        txn: t,
        accountId: t.sender_id,
        counterparty: t.receiver_id,
        title: `${currency(t.amount)} · ${t.transaction_type}`,
        detail: `${t.sender_id} → ${t.receiver_id}`,
      };
    });

    const statusEvents: TimelineEvent[] = cluster.member_account_ids.flatMap((id) => {
      const account = db.getAccount(id);
      if (!account || account.current_status === "Active") return [];
      return [{
        id: `status-${account.id}`,
        timestamp: account.created_at,
        kind: "status" as const,
        score: account.risk_score,
        accountId: account.id,
        title: `Account ${account.current_status.toLowerCase()}`,
        detail: `${account.holder} · ${account.role_tag}`,
      }];
    });

    return [...txnEvents, ...statusEvents].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }, [cluster]);

  const filtered = useMemo(() => {
    const hours = RANGES.find((r) => r.label === rangeLabel)?.hours ?? null;
    const cutoff = hours === null ? null : Date.now() - hours * 3600_000;
    return events.filter((e) => {
      if (cutoff !== null && new Date(e.timestamp).getTime() < cutoff) return false;
      return LEVEL_RANK[bandOf(e.score)] >= LEVEL_RANK[minLevel];
    });
  }, [events, rangeLabel, minLevel]);

  if (!cluster) {
    return (
      <div className="p-6">
        <EmptyState
          icon={<CalendarClock className="size-6" />}
          title="No active investigation"
          description="Pick a network from Alerts or Network Investigation to reconstruct its timeline."
        />
      </div>
    );
  }

  const totalValue = filtered.reduce((s, e) => s + (e.txn?.amount ?? 0), 0);
  const span =
    filtered.length > 1
      ? `${dayOnly(filtered[0]?.timestamp ?? "")} → ${dayOnly(filtered[filtered.length - 1]?.timestamp ?? "")}`
      : filtered.length === 1
        ? dayOnly(filtered[0]?.timestamp ?? "")
        : "—";

  return (
    <div className="space-y-6 p-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
            <Clock className="size-4 text-signal" /> Investigation Timeline
          </h1>
          <p className="text-xs text-muted-foreground">
            Chronological reconstruction of every suspicious event inside this network.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Network">
            <Select value={cluster.id} onValueChange={(v) => { setActiveNetworkId(v); setSelected(null); }}>
              <SelectTrigger className="w-60"><SelectValue /></SelectTrigger>
              <SelectContent>
                {db.clusters.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Time range">
            <Select value={rangeLabel} onValueChange={setRangeLabel}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                {RANGES.map((r) => (
                  <SelectItem key={r.label} value={r.label}>{r.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Min risk">
            <Select value={minLevel} onValueChange={(v) => setMinLevel(v as RiskLevel)}>
              <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
              <SelectContent>
                {LEVELS.map((l) => (
                  <SelectItem key={l} value={l}>{l}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <PatternBadge pattern={cluster.pattern} />
        <RiskBadge score={cluster.cluster_risk_score} />
        <span className="text-xs text-muted-foreground">{cluster.name}</span>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Events" value={String(filtered.length)} />
        <Stat label="Value in window" value={compactCurrency(totalValue)} />
        <Stat label="Span" value={span} />
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<CalendarClock className="size-6" />}
          title="No events in this window"
          description="Widen the time range or lower the minimum risk level to see activity."
        />
      ) : (
        <>
          <section className="panel rounded-lg border border-border p-4">
            <SectionTitle title="Event track" hint="Markers are colour-coded by risk — hover for detail, click to jump." />
            <div className="overflow-x-auto pb-2">
              <div className="relative flex min-w-full items-center gap-2 py-6">
                <div className="absolute inset-x-0 top-1/2 h-px bg-border" />
                {filtered.map((e) => {
                  const c = RISK_CLASSES[bandOf(e.score)];
                  return (
                    <Tooltip key={e.id}>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          onClick={() => setSelected(e.id)}
                          className={cn(
                            "relative z-10 size-3 shrink-0 rounded-full border-2 border-background transition-transform hover:scale-150",
                            c.dot,
                            selected === e.id && "scale-150 ring-2 ring-signal/60",
                          )}
                          aria-label={`${e.title} at ${dateTime(e.timestamp)}`}
                        />
                      </TooltipTrigger>
                      <TooltipContent className="max-w-xs">
                        <p className="font-medium">{e.title}</p>
                        <p className="text-muted-foreground">{e.detail}</p>
                        <p className="text-muted-foreground">{dateTime(e.timestamp)}</p>
                      </TooltipContent>
                    </Tooltip>
                  );
                })}
              </div>
            </div>
          </section>

          <ol className="space-y-3">
            {filtered.map((e) => (
              <EventCard key={e.id} event={e} active={selected === e.id} onSelect={() => setSelected(e.id)} />
            ))}
          </ol>
        </>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{label}</label>
      {children}
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

function EventCard({
  event,
  active,
  onSelect,
}: {
  event: TimelineEvent;
  active: boolean;
  onSelect: () => void;
}) {
  const c = RISK_CLASSES[bandOf(event.score)];
  return (
    <li>
      <div
        onClick={onSelect}
        className={cn(
          "panel flex flex-wrap items-center gap-3 rounded-lg border p-3 transition-colors",
          c.border,
          active ? c.bg : "bg-transparent hover:bg-muted/30",
        )}
      >
        <span className={cn("size-2 shrink-0 rounded-full", c.dot)} />
        <div className="min-w-40">
          <Mono className="text-xs font-medium">{timeOnly(event.timestamp)}</Mono>
          <p className="text-[11px] text-muted-foreground">{dateTime(event.timestamp)}</p>
        </div>
        <div className="min-w-48">
          <p className="text-sm font-medium">{event.title}</p>
          <p className="text-[11px] text-muted-foreground">{event.detail}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Link
            to="/accounts/$accountId"
            params={{ accountId: event.accountId }}
            className="mono rounded border border-border px-1.5 py-0.5 hover:bg-muted/50"
          >
            {event.accountId}
          </Link>
          {event.counterparty && (
            <Link
              to="/accounts/$accountId"
              params={{ accountId: event.counterparty }}
              className="mono rounded border border-border px-1.5 py-0.5 hover:bg-muted/50"
            >
              {event.counterparty}
            </Link>
          )}
        </div>
        {event.txn?.label === "suspicious" && (
          <span className="mono text-[10px] uppercase tracking-wide text-risk-high">suspicious</span>
        )}
        <span className="ml-auto flex items-center gap-2">
          {event.txn && <Mono className="text-xs">{currency(event.txn.amount)}</Mono>}
          <RiskBadge score={event.score} size="sm" />
        </span>
      </div>
    </li>
  );
}
