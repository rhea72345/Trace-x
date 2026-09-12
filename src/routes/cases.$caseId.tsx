import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Check, ClipboardList, ExternalLink, FileText, GitBranch, Save, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState, Mono, PatternBadge, RiskBadge, SectionTitle, StatusPill } from "@/components/trace/primitives";
import { SarReportButton } from "@/components/trace/SarReportPreview";
import { PrecedentMatches } from "@/components/trace/PrecedentMatches";
import { addCaseFeedback, CASE_STATUSES, getCase, updateCase, type CaseDecision, type CaseStatus, type TraceCase } from "@/lib/trace/cases";
import { db } from "@/lib/trace/engine";
import { compactCurrency, dateTime } from "@/lib/trace/format";
import { toast } from "sonner";

export const Route = createFileRoute("/cases/$caseId")({
  head: () => ({
    meta: [
      { title: "Case Detail — TRACE-X" },
      { name: "description", content: "Review attached evidence, analyst decisions and notes for a TRACE-X investigation case." },
      { property: "og:title", content: "Case Detail — TRACE-X" },
      { property: "og:description", content: "Review financial-crime evidence and record an analyst case outcome." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: CaseDetailPage,
});

function CaseDetailPage() {
  const { caseId } = Route.useParams();
  const navigate = useNavigate();
  const [item, setItem] = useState<TraceCase | null>(null);
  const [loading, setLoading] = useState(true);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    const result = await getCase(caseId);
    setItem(result);
    setNotes(result?.notes ?? "");
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, [caseId]);

  const evidence = item?.attached_evidence;
  const timeline = useMemo(() => evidence?.timeline ?? [], [evidence]);

  if (loading) return <div className="panel-surface rounded-lg px-4 py-12 text-center text-sm text-muted-foreground">Loading case…</div>;
  if (!item || !evidence) return <EmptyState icon={<ClipboardList className="size-8" />} title="Case not found" description="This case may have been removed or is not available in the current workspace." action={<Button asChild variant="outline"><Link to="/cases"><ArrowLeft className="size-3.5" /> Back to cases</Link></Button>} />;

  const saveNotes = async () => {
    setSaving(true);
    const updated = await updateCase(item.id, { notes: notes || null });
    if (updated) setItem(updated);
    setSaving(false);
    toast.success("Notes saved");
  };

  const setStatus = async (next: CaseStatus) => {
    const updated = await updateCase(item.id, { status: next });
    if (updated) setItem(updated);
    toast.success(`Case moved to ${next}`);
  };

  const decide = async (decision: CaseDecision) => {
    const updated = await addCaseFeedback(item.id, decision, notes);
    if (updated) setItem(updated);
    toast.success("Analyst decision recorded", { description: decision });
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button asChild variant="ghost" size="sm"><Link to="/cases"><ArrowLeft className="size-3.5" /> All cases</Link></Button>
        <div className="flex items-center gap-2"><StatusPill status={item.status} /><RiskBadge score={item.risk_score} /></div>
      </div>

      <header className="panel-surface rounded-lg p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="mono text-[10px] uppercase tracking-[0.28em] text-signal">Case file</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">{item.title}</h1>
            <p className="mono mt-1 text-xs text-muted-foreground">{item.id} · created {dateTime(item.created_at)}</p>
            <div className="mt-3 flex flex-wrap gap-1.5">{item.pattern_tags.map((pattern) => <PatternBadge key={pattern} pattern={pattern as never} />)}</div>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Status</span>
              <Select value={item.status} onValueChange={(value) => void setStatus(value as CaseStatus)}>
                <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                <SelectContent>{CASE_STATUSES.map((status) => <SelectItem key={status} value={status}>{status}</SelectItem>)}</SelectContent>
              </Select>
            </label>
            <SarReportButton traceCase={item} />
          </div>
        </div>
        <dl className="mt-5 grid gap-3 sm:grid-cols-4">
          <Stat label="Network" value={evidence.network_id} />
          <Stat label="Accounts" value={String(evidence.account_ids.length)} />
          <Stat label="Transactions" value={String(evidence.transaction_ids.length)} />
          <Stat label="Value" value={compactCurrency(evidence.total_value)} />
        </dl>
      </header>

      <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
        <div className="space-y-4">
          <section className="panel-surface rounded-lg p-4">
            <SectionTitle title="Evidence package" hint="Snapshot captured when this case was created." />
            <div className="grid gap-3 sm:grid-cols-2">
              <EvidenceCard icon={<GitBranch className="size-4" />} label="Graph snapshot" value={`${evidence.graph_snapshot.account_ids.length} accounts · ${evidence.graph_snapshot.transaction_ids.length} edges`} />
              <EvidenceCard icon={<ShieldCheck className="size-4" />} label="Detection score" value={`${evidence.risk_score}/100 · ${item.pattern_tags.length} pattern tags`} />
              <EvidenceCard icon={<ExternalLink className="size-4" />} label="Money path" value={`${evidence.money_path.length} linked transactions`} />
              <EvidenceCard icon={<FileText className="size-4" />} label="Network narrative" value={evidence.narrative} />
            </div>
            {item.network_id && <Button asChild variant="outline" size="sm" className="mt-4"><Link to="/network" onClick={() => undefined}>Open network investigation</Link></Button>}
          </section>

          <section className="panel-surface overflow-hidden rounded-lg">
            <div className="p-4"><SectionTitle title="Attached timeline" hint={`${timeline.length} transactions captured in chronological order.`} /></div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="border-y border-border text-left text-[10px] uppercase tracking-wider text-muted-foreground"><th className="px-4 py-2">Transaction</th><th className="px-4 py-2">Flow</th><th className="px-4 py-2">Amount</th><th className="px-4 py-2">When</th></tr></thead>
                <tbody>{timeline.slice(0, 16).map((transaction) => <tr key={transaction.transaction_id} className="border-b border-border/50 last:border-0"><td className="px-4 py-2"><Mono>{transaction.transaction_id}</Mono></td><td className="px-4 py-2"><Mono>{transaction.sender_id} → {transaction.receiver_id}</Mono></td><td className="mono px-4 py-2">{compactCurrency(transaction.amount)}</td><td className="px-4 py-2 text-muted-foreground">{dateTime(transaction.timestamp)}</td></tr>)}</tbody>
              </table>
            </div>
          </section>
        </div>

        <aside className="space-y-4">
          <PrecedentMatches traceCase={item} />
          <section className="panel-surface rounded-lg p-4">
            <SectionTitle title="Analyst decision" hint="Record the outcome in case feedback." />
            <div className="grid gap-2">
              <Button variant={item.decision === "Confirmed Suspicious" ? "default" : "outline"} onClick={() => void decide("Confirmed Suspicious")}><Check className="size-3.5" /> Confirmed Suspicious</Button>
              <Button variant={item.decision === "False Positive" ? "secondary" : "outline"} onClick={() => void decide("False Positive")}>False Positive</Button>
              <Button variant={item.decision === "Needs Review" ? "secondary" : "outline"} onClick={() => void decide("Needs Review")}>Needs Review</Button>
            </div>
            {item.decision && <p className="mt-3 text-xs text-muted-foreground">Current decision: <span className="font-medium text-foreground">{item.decision}</span></p>}
          </section>
          <section className="panel-surface rounded-lg p-4">
            <SectionTitle title="Investigator notes" hint="Keep rationale and follow-up context with the case." />
            <Textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Add a concise rationale or next step…" className="min-h-32 text-sm" />
            <Button className="mt-3 w-full" onClick={() => void saveNotes()} disabled={saving}><Save className="size-3.5" /> {saving ? "Saving…" : "Save notes"}</Button>
          </section>
        </aside>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div className="rounded-md border border-border bg-card/60 px-3 py-2"><dt className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{label}</dt><dd className="mono mt-0.5 text-sm">{value}</dd></div>;
}

function EvidenceCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return <div className="rounded-md border border-border bg-card/50 p-3"><div className="flex items-center gap-2 text-xs font-medium"><span className="text-signal">{icon}</span>{label}</div><p className="mt-2 text-xs leading-relaxed text-muted-foreground">{value}</p></div>;
}