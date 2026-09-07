import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowDownUp, Search, Users } from "lucide-react";
import { db, type RiskLevel } from "@/lib/trace/engine";
import { compactCurrency } from "@/lib/trace/format";
import { EmptyState, Mono, RiskBadge, StatusPill } from "@/components/trace/primitives";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const Route = createFileRoute("/accounts")({
  head: () => ({
    meta: [
      { title: "Accounts — TRACE-X Investigation Cockpit" },
      {
        name: "description",
        content: "Browse, filter and sort every synthetic account monitored by the TRACE-X financial-crime investigation cockpit.",
      },
      { property: "og:title", content: "Accounts — TRACE-X Investigation Cockpit" },
      { property: "og:description", content: "Browse synthetic accounts by role, status and risk score." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AccountsPage,
});

type SortKey = "id" | "holder" | "role" | "status" | "risk";
const LEVELS: (RiskLevel | "All")[] = ["All", "Critical", "High", "Medium", "Low"];

function AccountsPage() {
  const [query, setQuery] = useState("");
  const [level, setLevel] = useState<RiskLevel | "All">("All");
  const [sortKey, setSortKey] = useState<SortKey>("risk");
  const [descending, setDescending] = useState(true);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = db.accounts.filter((account) => {
      if (level !== "All" && account.risk_score < ({ Critical: 80, High: 60, Medium: 30, Low: 0 }[level] ?? 0)) return false;
      if (!needle) return true;
      return `${account.id} ${account.holder} ${account.role_tag} ${account.current_status}`.toLowerCase().includes(needle);
    });
    return [...filtered].sort((a, b) => {
      const left = sortKey === "risk" ? a.risk_score : sortKey === "id" ? a.id : sortKey === "holder" ? a.holder : sortKey === "role" ? a.role_tag : a.current_status;
      const right = sortKey === "risk" ? b.risk_score : sortKey === "id" ? b.id : sortKey === "holder" ? b.holder : sortKey === "role" ? b.role_tag : b.current_status;
      const comparison = typeof left === "number" ? left - (right as number) : left.localeCompare(right as string);
      return descending ? -comparison : comparison;
    });
  }, [level, query, sortKey, descending]);

  const sortButton = (key: SortKey, label: string) => (
    <button
      type="button"
      className="inline-flex items-center gap-1.5 hover:text-foreground"
      onClick={() => {
        if (sortKey === key) setDescending((value) => !value);
        else {
          setSortKey(key);
          setDescending(true);
        }
      }}
    >
      {label}
      <ArrowDownUp className={`size-3 ${sortKey === key ? "text-signal" : "opacity-40"}`} />
    </button>
  );

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mono text-[10px] uppercase tracking-[0.28em] text-signal">Connect / corpus</p>
          <h1 className="mt-1 flex items-center gap-2 text-xl font-semibold tracking-tight">
            <Users className="size-5 text-signal" /> Accounts
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{rows.length} of {db.accounts.length} synthetic accounts in the monitored corpus.</p>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="mono">{db.accounts.length}</span> records
        </div>
      </header>

      <section className="panel-surface rounded-lg p-3">
        <div className="grid gap-3 md:grid-cols-[1fr_180px]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search id, holder, role or status" className="mono h-9 pl-9 text-xs" />
          </div>
          <Select value={level} onValueChange={(value) => setLevel(value as RiskLevel | "All")}>
            <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>{LEVELS.map((value) => <SelectItem key={value} value={value}>{value === "All" ? "All risk levels" : `${value} risk`}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </section>

      {rows.length === 0 ? (
        <EmptyState icon={<Users className="size-8" />} title="No accounts match" description="Try a different search term or risk level." />
      ) : (
        <div className="panel-surface overflow-hidden rounded-lg">
          <div className="max-h-[640px] overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-card text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="px-3 py-2 font-medium">{sortButton("id", "Account")}</th>
                  <th className="px-3 py-2 font-medium">{sortButton("holder", "Holder")}</th>
                  <th className="px-3 py-2 font-medium">{sortButton("role", "Role")}</th>
                  <th className="px-3 py-2 font-medium">{sortButton("status", "Status")}</th>
                  <th className="px-3 py-2 text-right font-medium">{sortButton("risk", "Risk")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((account) => (
                  <tr key={account.id} className="border-b border-border/50 transition-colors last:border-0 hover:bg-accent/40">
                    <td className="px-3 py-2.5"><Link to="/accounts/$accountId" params={{ accountId: account.id }} className="hover:text-signal hover:underline"><Mono>{account.id}</Mono></Link></td>
                    <td className="px-3 py-2.5"><Link to="/accounts/$accountId" params={{ accountId: account.id }} className="font-medium hover:underline">{account.holder}</Link></td>
                    <td className="px-3 py-2.5"><span className="mono rounded-md border border-border bg-muted/40 px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">{account.role_tag}</span></td>
                    <td className="px-3 py-2.5"><StatusPill status={account.current_status} /></td>
                    <td className="px-3 py-2.5 text-right"><RiskBadge score={account.risk_score} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="border-t border-border px-3 py-2 text-[10px] text-muted-foreground">Synthetic corpus · values are illustrative and contain no real personal or financial data.</p>
        </div>
      )}
    </div>
  );
}