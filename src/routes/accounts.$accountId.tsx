import { useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowDownUp, Network as NetworkIcon, UserSearch } from "lucide-react";
import { db, whatChanged } from "@/lib/trace/engine";
import { compactCurrency, currency, dateTime } from "@/lib/trace/format";
import {
  EmptyState,
  Mono,
  PatternBadge,
  RiskBadge,
  ScoreRing,
  SectionTitle,
  StatusPill,
} from "@/components/trace/primitives";
import { ConnectionsList, useAccountConnections } from "@/components/trace/ConnectionsList";
import { useTrace } from "@/lib/trace/context";
import { Button } from "@/components/ui/button";
import { bandOf } from "@/lib/trace/engine";

export const Route = createFileRoute("/accounts/$accountId")({
  head: () => ({
    meta: [
      { title: "Account Profile · TRACE-X" },
      {
        name: "description",
        content:
          "Inspect a synthetic account's baseline behaviour, deviation signals, counterparties and full transaction history inside the TRACE-X investigation cockpit.",
      },
      { property: "og:title", content: "Account Profile · TRACE-X" },
      {
        property: "og:description",
        content: "Baseline vs current behaviour, network role and transaction history for a traced account.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AccountPage,
});

type SortKey = "timestamp" | "amount" | "counterparty" | "direction" | "label";

function AccountPage() {
  const { accountId } = Route.useParams();
  const account = db.getAccount(accountId);
  const connections = useAccountConnections(account ? account.id : null);
  const { setActiveNetworkId } = useTrace();
  const navigate = useNavigate();

  const [sortKey, setSortKey] = useState<SortKey>("timestamp");
  const [desc, setDesc] = useState(true);

  const txns = useMemo(() => {
    if (!account) return [];
    const rows = db.accountTransactions(account.id).map((t) => {
      const out = t.sender_id === account.id;
      return { t, out, other: out ? t.receiver_id : t.sender_id };
    });
    rows.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "amount":
          cmp = a.t.amount - b.t.amount;
          break;
        case "counterparty":
          cmp = a.other.localeCompare(b.other);
          break;
        case "direction":
          cmp = Number(a.out) - Number(b.out);
          break;
        case "label":
          cmp = a.t.label.localeCompare(b.t.label);
          break;
        default:
          cmp = a.t.timestamp.localeCompare(b.t.timestamp);
      }
      return desc ? -cmp : cmp;
    });
    return rows;
  }, [account, sortKey, desc]);

  const memberships = useMemo(
    () => (account ? db.clusters.filter((c) => c.member_account_ids.includes(account.id)) : []),
    [account],
  );

  if (!account) {
    return (
      <EmptyState
        icon={<UserSearch className="size-8" />}
        title="Account not found"
        description={`No synthetic account matches ${accountId}.`}
      />
    );
  }

  const changes = whatChanged(account.id);
  const baseline = account.baseline_behaviour;

  const sortBtn = (key: SortKey, label: string, align = "text-left") => (
    <th className={`px-2 py-2 ${align}`}>
      <button
        type="button"
        className="inline-flex items-center gap-1 hover:text-foreground"
        onClick={() => {
          if (sortKey === key) setDesc((d) => !d);
          else {
            setSortKey(key);
            setDesc(true);
          }
        }}
      >
        {label}
        <ArrowDownUp className={`size-3 ${sortKey === key ? "text-signal" : "opacity-40"}`} />
      </button>
    </th>
  );

  return (
    <div className="space-y-5">
      <header className="panel-surface rounded-lg p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="mono text-[10px] uppercase tracking-[0.28em] text-signal">Account profile</p>
            <h1 className="mt-1 text-xl font-semibold tracking-tight">{account.holder}</h1>
            <p className="mono mt-1 text-xs text-muted-foreground">{account.id}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <StatusPill status={account.current_status} />
              <span className="mono rounded-md border border-border bg-muted/40 px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                {account.role_tag}
              </span>
              <RiskBadge score={account.risk_score} size="sm" />
            </div>
          </div>
          <ScoreRing score={account.risk_score} label={bandOf(account.risk_score)} />
        </div>
        <dl className="mt-4 grid gap-3 sm:grid-cols-4">
          <Stat label="Opened" value={dateTime(account.created_at)} />
          <Stat label="Account age" value={`${account.account_age_days} days`} />
          <Stat label="Home location" value={baseline.home_location} />
          <Stat label="Transactions" value={txns.length.toString()} />
        </dl>
      </header>

      <section className="grid gap-4 xl:grid-cols-[1fr_340px]">
        <div className="space-y-4">
          <div className="panel-surface rounded-lg p-4">
            <SectionTitle
              title="Baseline vs current activity"
              hint="Normal behaviour pattern compared with recent (suspicious-weighted) activity."
            />
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {changes.map((c) => {
                const fmt = (n: number) => (c.unit === "currency" ? compactCurrency(n) : n.toString());
                const up = c.current > c.baseline;
                const pct =
                  c.baseline > 0 ? Math.round(((c.current - c.baseline) / c.baseline) * 100) : null;
                return (
                  <div key={c.metric} className="rounded-md border border-border bg-card/60 p-3">
                    <p className="text-xs text-muted-foreground">{c.metric}</p>
                    <p className="mono mt-1 text-sm">
                      {fmt(c.baseline)} <span className="text-muted-foreground">→</span>{" "}
                      <span className={up ? "text-risk-high" : "text-risk-low"}>{fmt(c.current)}</span>
                    </p>
                    {pct !== null && (
                      <p className={`mono mt-0.5 text-[10px] ${up ? "text-risk-high" : "text-muted-foreground"}`}>
                        {pct > 0 ? "+" : ""}
                        {pct}% vs baseline
                      </p>
                    )}
                  </div>
                );
              })}
              <div className="rounded-md border border-border bg-card/60 p-3">
                <p className="text-xs text-muted-foreground">Typical active hours</p>
                <p className="mono mt-1 text-sm">
                  {String(baseline.typical_hours[0]).padStart(2, "0")}:00 –{" "}
                  {String(baseline.typical_hours[1]).padStart(2, "0")}:00
                </p>
              </div>
            </div>
          </div>

          <div className="panel-surface rounded-lg p-4">
            <SectionTitle title="Transaction history" hint={`${txns.length} synthetic transactions · click a header to sort`} />
            <div className="max-h-[520px] overflow-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 z-10 bg-card text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="px-2 py-2 text-left">Txn</th>
                    {sortBtn("direction", "Direction")}
                    {sortBtn("counterparty", "Counterparty")}
                    {sortBtn("amount", "Amount", "text-right")}
                    <th className="px-2 py-2 text-left">Type</th>
                    {sortBtn("timestamp", "Time")}
                    {sortBtn("label", "Label")}
                  </tr>
                </thead>
                <tbody>
                  {txns.map(({ t, out, other }) => (
                    <tr key={t.transaction_id} className="border-b border-border/50 hover:bg-accent/60">
                      <td className="px-2 py-1.5">
                        <Mono>{t.transaction_id}</Mono>
                      </td>
                      <td className="px-2 py-1.5">{out ? "Outgoing" : "Incoming"}</td>
                      <td className="px-2 py-1.5">
                        <Link to="/accounts/$accountId" params={{ accountId: other }} className="hover:underline">
                          <Mono>{other}</Mono>
                        </Link>
                      </td>
                      <td className="mono px-2 py-1.5 text-right">{currency(t.amount)}</td>
                      <td className="px-2 py-1.5">{t.transaction_type}</td>
                      <td className="px-2 py-1.5 text-muted-foreground">{dateTime(t.timestamp)}</td>
                      <td className="px-2 py-1.5">
                        {t.label === "suspicious" ? (
                          <span className="text-risk-high">suspicious</span>
                        ) : (
                          <span className="text-muted-foreground">normal</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="panel-surface rounded-lg p-4">
            <SectionTitle title="Network role" hint="Clusters this account participates in." />
            {memberships.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">
                Not a member of any reconstructed network — external counterparty only.
              </p>
            ) : (
              <ul className="space-y-2">
                {memberships.map((c) => {
                  const role =
                    c.central_account === account.id
                      ? "Central"
                      : c.mule_accounts.includes(account.id)
                        ? "Mule / layer"
                        : c.bridge_accounts.includes(account.id)
                          ? "Bridge / hub"
                          : "Member";
                  return (
                    <li key={c.id} className="rounded-md border border-border bg-card/60 p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-xs">{c.name}</p>
                          <Mono className="text-[10px] text-muted-foreground">{c.id}</Mono>
                        </div>
                        <RiskBadge score={c.cluster_risk_score} size="sm" />
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <span className="mono rounded-md border border-border px-2 py-0.5 text-[10px] uppercase tracking-wider text-signal">
                          {role}
                        </span>
                        {c.pattern_tags.map((p) => (
                          <PatternBadge key={p} pattern={p} size="sm" />
                        ))}
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="mt-2 h-7 text-[11px]"
                        onClick={() => {
                          setActiveNetworkId(c.id);
                          void navigate({ to: "/network" });
                        }}
                      >
                        <NetworkIcon className="size-3.5" /> Open in Network Investigation
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="panel-surface rounded-lg p-4">
            <SectionTitle title="Connections" hint={`${connections.length} counterparties in the corpus.`} />
            <div className="max-h-[420px] overflow-auto">
              <ConnectionsList connections={connections} />
            </div>
          </div>
        </div>
      </section>
    </div>
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
