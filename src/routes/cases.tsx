import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { BriefcaseBusiness, ClipboardList, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState, PatternBadge, RiskBadge, StatusPill } from "@/components/trace/primitives";
import { CASE_STATUSES, createCaseFromNetwork, listCases, type CaseStatus, type TraceCase } from "@/lib/trace/cases";
import { db } from "@/lib/trace/engine";
import { useTrace } from "@/lib/trace/context";
import { compactCurrency, relative } from "@/lib/trace/format";
import { toast } from "sonner";

export const Route = createFileRoute("/cases")({
  head: () => ({
    meta: [
      { title: "Cases — TRACE-X Investigation Cockpit" },
      { name: "description", content: "Package suspicious-network findings into reviewable TRACE-X analyst cases." },
      { property: "og:title", content: "Cases — TRACE-X Investigation Cockpit" },
      { property: "og:description", content: "Create, investigate, decide and document financial-crime cases." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: CasesPage,
});

function CasesPage() {
  const { activeNetworkId, activeAlertId } = useTrace();
  const navigate = useNavigate();
  const [cases, setCases] = useState<TraceCase[]>([]);
  const [status, setStatus] = useState<CaseStatus | "All">("All");
  const [query, setQuery] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  const reload = async () => {
    setLoading(true);
    try {
      setCases(await listCases());
    } catch (error) {
      console.error("Failed to load cases:", error);
      // Don't set loading to false on error, let the user see the error state
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void reload();
  }, []);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return cases.filter((item) => {
      if (status !== "All" && item.status !== status) return false;
      if (!needle) return true;
      return `${item.id} ${item.title} ${item.network_id ?? ""} ${item.pattern_tags.join(" ")}`.toLowerCase().includes(needle);
    });
  }, [cases, query, status]);

  const createFromNetwork = async (networkId: string, alertId: string | null) => {
    try {
      const item = await createCaseFromNetwork(networkId, alertId);
      setCreateOpen(false);
      await reload();
      toast.success("Case created", { description: `${item.title} is ready for investigation.` });
      navigate({ to: "/cases/$caseId", params: { caseId: item.id } });
    } catch (error) {
      toast.error("Could not create case", { description: error instanceof Error ? error.message : "Try again." });
    }
  };

  return (
    <div className="space-y-5">
      <header className="panel-surface relative overflow-hidden rounded-lg p-5">
        <div className="grid-surface pointer-events-none absolute inset-0 opacity-30" />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="mono text-[10px] uppercase tracking-[0.28em] text-signal">Investigate / evidence</p>
            <h1 className="mt-1 flex items-center gap-2 text-2xl font-semibold tracking-tight">
              <BriefcaseBusiness className="size-6 text-signal" /> Cases
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Turn network findings into reviewable case files with evidence, notes and analyst outcomes.
            </p>
          </div>
          <Button onClick={() => setCreateOpen(true)} className="gap-1.5">
            <Plus className="size-4" /> New case
          </Button>
        </div>
      </header>

      <div className="panel-surface rounded-lg p-3">
        <div className="grid gap-3 md:grid-cols-[1fr_220px]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search cases, networks or patterns" className="mono h-9 pl-8 text-xs" />
          </div>
          <Select value={status} onValueChange={(value) => setStatus(value as CaseStatus | "All")}>
            <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="All">All statuses</SelectItem>
              {CASE_STATUSES.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {loading ? (
        <div className="panel-surface rounded-lg px-4 py-12 text-center text-sm text-muted-foreground">Loading case workspace…</div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<ClipboardList className="size-8" />}
          title={cases.length ? "No cases match these filters" : "No cases yet"}
          description={cases.length ? "Try a different status or search term." : "Create a case from the active network or an alert to package its evidence."}
          action={<Button variant="outline" size="sm" onClick={() => setCreateOpen(true)}><Plus className="size-3.5" /> Create from network</Button>}
        />
      ) : (
        <div className="panel-surface overflow-hidden rounded-lg">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <p className="text-xs text-muted-foreground">{rows.length} of {cases.length} cases</p>
            <p className="mono text-[10px] text-muted-foreground">Owner-scoped workspace</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-3 py-2 font-medium">Case</th>
                  <th className="px-3 py-2 font-medium">Risk</th>
                  <th className="px-3 py-2 font-medium">Patterns</th>
                  <th className="px-3 py-2 font-medium">Evidence</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Updated</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map((item) => (
                  <tr key={item.id} className="border-b border-border/50 last:border-0 hover:bg-accent/40">
                    <td className="px-3 py-3">
                      <Link to="/cases/$caseId" params={{ caseId: item.id }} className="font-medium hover:text-signal">{item.title}</Link>
                      <p className="mono mt-0.5 text-[10px] text-muted-foreground">{item.id} · {item.network_id ?? "unlinked"}</p>
                    </td>
                    <td className="px-3 py-3"><RiskBadge score={item.risk_score} /></td>
                    <td className="px-3 py-3"><div className="flex flex-wrap gap-1">{item.pattern_tags.map((pattern) => <PatternBadge key={pattern} pattern={pattern as never} size="sm" />)}</div></td>
                    <td className="px-3 py-3">
                      <p className="mono text-xs">{item.attached_evidence.account_ids?.length ?? 0} accounts</p>
                      <p className="mono text-[10px] text-muted-foreground">{compactCurrency(item.attached_evidence.total_value ?? 0)}</p>
                    </td>
                    <td className="px-3 py-3"><StatusPill status={item.status} /></td>
                    <td className="px-3 py-3 text-xs text-muted-foreground">{relative(item.updated_at)}</td>
                    <td className="px-3 py-3 text-right"><Button asChild size="sm" variant="outline"><Link to="/cases/$caseId" params={{ caseId: item.id }}>Open</Link></Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <CreateCaseDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        activeNetworkId={activeNetworkId}
        activeAlertId={activeAlertId}
        onCreate={createFromNetwork}
      />
    </div>
  );
}

function CreateCaseDialog({
  open,
  onOpenChange,
  activeNetworkId,
  activeAlertId,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activeNetworkId: string;
  activeAlertId: string | null;
  onCreate: (networkId: string, alertId: string | null) => void;
}) {
  const [networkId, setNetworkId] = useState(activeNetworkId);
  const [source, setSource] = useState<"network" | "alert">("network");

  useEffect(() => {
    if (open) setNetworkId(activeNetworkId);
  }, [open, activeNetworkId]);

  const alert = db.alerts.find((item) => item.id === activeAlertId);
  const selectedAlert = source === "alert" ? alert : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create investigation case</DialogTitle>
          <DialogDescription>Snapshot the selected network's current graph, money flow and detection evidence.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            <Button variant={source === "network" ? "secondary" : "outline"} onClick={() => setSource("network")}>Active network</Button>
            <Button variant={source === "alert" ? "secondary" : "outline"} onClick={() => setSource("alert")} disabled={!alert}>Active alert</Button>
          </div>
          <label className="block">
            <span className="mb-1 block text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Network</span>
            <Select value={networkId} onValueChange={setNetworkId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{db.clusters.map((item) => <SelectItem key={item.id} value={item.id}>{item.id} · {item.name}</SelectItem>)}</SelectContent>
            </Select>
          </label>
          {selectedAlert && <p className="rounded-md border border-signal/30 bg-signal/10 p-3 text-xs">Linked alert: <span className="mono">{selectedAlert.id}</span> · {selectedAlert.title}</p>}
          <Button className="w-full" onClick={() => onCreate(networkId, selectedAlert?.id ?? null)}>Create case</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}