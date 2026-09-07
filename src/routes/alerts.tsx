import { useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { BriefcaseBusiness, Filter, Search, Telescope } from "lucide-react";
import { PATTERN_META, db, type PatternType, type RiskLevel } from "@/lib/trace/engine";
import { compactCurrency, dateTime, relative } from "@/lib/trace/format";
import { EmptyState, PatternBadge, RiskBadge, StatusPill } from "@/components/trace/primitives";
import { useTrace } from "@/lib/trace/context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createCaseFromNetwork } from "@/lib/trace/cases";
import { toast } from "sonner";

export const Route = createFileRoute("/alerts")({
  head: () => ({
    meta: [
      { title: "Alert Queue — TRACE-X" },
      {
        name: "description",
        content:
          "Filter and triage suspicious network alerts by risk level, pattern type, amount, time range and investigation status.",
      },
      { property: "og:title", content: "Alert Queue — TRACE-X" },
      { property: "og:description", content: "Triage suspicious network alerts by risk, pattern and status." },
    ],
  }),
  component: Alerts,
});

const LEVELS: (RiskLevel | "All")[] = ["All", "Critical", "High", "Medium", "Low"];
const STATUSES = ["All", "New", "Reviewing", "Escalated", "Resolved"];
const WINDOWS = [
  { label: "Last 24 hours", days: 1 },
  { label: "Last 7 days", days: 7 },
  { label: "Last 30 days", days: 30 },
  { label: "All time", days: 3650 },
];

function Alerts() {
  const { setActiveNetworkId, setActiveAlertId } = useTrace();
  const navigate = useNavigate();
  const [level, setLevel] = useState("All");
  const [status, setStatus] = useState("All");
  const [pattern, setPattern] = useState("All");
  const [win, setWin] = useState("30");
  const [minAmount, setMinAmount] = useState(0);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"score" | "recent" | "amount">("score");

  const maxAmount = useMemo(() => Math.max(...db.alerts.map((a) => a.amount)), []);

  const rows = useMemo(() => {
    const cutoff = Date.now() - Number(win) * 86400000;
    const list = db.alerts.filter((a) => {
      if (level !== "All" && a.level !== level) return false;
      if (status !== "All" && a.status !== status) return false;
      if (pattern !== "All" && !a.pattern_tags.includes(pattern as PatternType)) return false;
      if (a.amount < minAmount) return false;
      if (new Date(a.created_at).getTime() < cutoff) return false;
      if (q && !`${a.id} ${a.title} ${a.network_id} ${a.primary_account}`.toLowerCase().includes(q.toLowerCase()))
        return false;
      return true;
    });
    return list.sort((a, b) =>
      sort === "score"
        ? b.risk_score - a.risk_score
        : sort === "amount"
          ? b.amount - a.amount
          : b.created_at.localeCompare(a.created_at),
    );
  }, [level, status, pattern, win, minAmount, q, sort]);

  const investigate = (networkId: string) => {
    setActiveNetworkId(networkId);
    navigate({ to: "/network" });
  };

  const createCase = async (alertId: string, networkId: string) => {
    setActiveNetworkId(networkId);
    setActiveAlertId(alertId);
    try {
      const item = await createCaseFromNetwork(networkId, alertId);
      toast.success("Case created", { description: item.title });
      navigate({ to: "/cases/$caseId", params: { caseId: item.id } });
    } catch (error) {
      toast.error("Could not create case", { description: error instanceof Error ? error.message : "Try again." });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Alert queue</h1>
          <p className="text-sm text-muted-foreground">
            {rows.length} of {db.alerts.length} network alerts match the current filters.
          </p>
        </div>
        <Select value={sort} onValueChange={(v) => setSort(v as typeof sort)}>
          <SelectTrigger className="w-[190px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="score">Sort: risk score</SelectItem>
            <SelectItem value="recent">Sort: most recent</SelectItem>
            <SelectItem value="amount">Sort: value at risk</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="panel-surface rounded-lg p-3">
        <div className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
          <Filter className="size-3.5" /> Filters
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Alert / network / account"
              className="mono h-9 pl-8 text-xs"
            />
          </div>
          <FilterSelect label="Risk level" value={level} onChange={setLevel} options={LEVELS as string[]} />
          <FilterSelect label="Status" value={status} onChange={setStatus} options={STATUSES} />
          <FilterSelect
            label="Pattern"
            value={pattern}
            onChange={setPattern}
            options={["All", ...Object.keys(PATTERN_META)]}
            render={(v) => (v === "All" ? "All patterns" : PATTERN_META[v as PatternType].label)}
          />
          <FilterSelect
            label="Time range"
            value={win}
            onChange={setWin}
            options={WINDOWS.map((w) => String(w.days))}
            render={(v) => WINDOWS.find((w) => String(w.days) === v)?.label ?? v}
          />
        </div>
        <div className="mt-3 flex items-center gap-3">
          <span className="w-28 shrink-0 text-[11px] text-muted-foreground">Min. value</span>
          <Slider
            value={[minAmount]}
            max={maxAmount}
            step={10000}
            onValueChange={([v]) => setMinAmount(v ?? 0)}
            className="max-w-md"
          />
          <span className="mono text-xs">{compactCurrency(minAmount)}</span>
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={<Telescope className="size-8" />}
          title="No alerts match these filters"
          description="Widen the time range or lower the minimum value threshold to see more of the queue."
          action={
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setLevel("All");
                setStatus("All");
                setPattern("All");
                setWin("3650");
                setMinAmount(0);
                setQ("");
              }}
            >
              Reset filters
            </Button>
          }
        />
      ) : (
        <div className="panel-surface overflow-hidden rounded-lg">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="px-3 py-2 font-medium">Alert</th>
                <th className="px-3 py-2 font-medium">Risk</th>
                <th className="px-3 py-2 font-medium">Patterns</th>
                <th className="px-3 py-2 font-medium">Accounts</th>
                <th className="px-3 py-2 text-right font-medium">Value</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Raised</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id} className="border-b border-border/50 transition-colors last:border-0 hover:bg-accent/40">
                  <td className="px-3 py-2.5">
                    <p className="mono text-[11px] text-muted-foreground">{a.id}</p>
                    <p className="text-[13px] font-medium">{a.title}</p>
                    <p className="mono text-[10px] text-muted-foreground">
                      {a.network_id} · central {a.primary_account}
                    </p>
                  </td>
                  <td className="px-3 py-2.5">
                    <RiskBadge score={a.risk_score} pulse />
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex flex-wrap gap-1">
                      {a.pattern_tags.map((p) => (
                        <PatternBadge key={p} pattern={p} size="sm" />
                      ))}
                    </div>
                  </td>
                  <td className="mono px-3 py-2.5 text-xs">{a.accounts_involved}</td>
                  <td className="mono px-3 py-2.5 text-right text-xs">{compactCurrency(a.amount)}</td>
                  <td className="px-3 py-2.5">
                    <StatusPill status={a.status} />
                  </td>
                  <td className="px-3 py-2.5">
                    <p className="text-xs">{relative(a.created_at)}</p>
                    <p className="mono text-[10px] text-muted-foreground">{dateTime(a.created_at)}</p>
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <div className="flex justify-end gap-2">
                      <Button size="sm" variant="outline" className="gap-1.5" onClick={() => investigate(a.network_id)}>
                        <Telescope className="size-3.5" /> Investigate
                      </Button>
                      <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => void createCase(a.id, a.network_id)}>
                        <BriefcaseBusiness className="size-3.5" /> Case
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
  render,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
  render?: (v: string) => string;
}) {
  return (
    <div>
      <label className="mb-1 block text-[10px] uppercase tracking-wider text-muted-foreground">{label}</label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-9 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o} value={o} className="text-xs">
              {render ? render(o) : o}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
