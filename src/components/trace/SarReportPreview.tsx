import { useMemo, useState } from "react";
import { Download, FileWarning, Printer } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Mono, RiskBadge, SectionTitle } from "@/components/trace/primitives";
import { buildSarDraft, sarDraftMarkdown } from "@/lib/trace/sar-generator";
import { currency, dateTime } from "@/lib/trace/format";
import type { TraceCase } from "@/lib/trace/cases";
import { toast } from "sonner";

function downloadMarkdown(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  toast.success("SAR draft downloaded", { description: filename });
}

/**
 * Self-contained "Generate SAR Draft" trigger + preview dialog for a case.
 * Read-only: derives everything from the case already loaded by the page.
 * Wiring this into a page is a single <SarReportButton traceCase={item} /> line.
 */
const ROLE_BADGE_CLASS: Record<string, string> = {
  "Central account": "border-signal/40 bg-signal/10 text-signal",
  "Mule account": "border-risk-critical/40 bg-risk-critical/10 text-risk-critical",
  "Bridge account": "border-risk-medium/40 bg-risk-medium/10 text-risk-medium",
  "Origin account (money path)": "border-signal/40 bg-signal/10 text-signal",
};

export function SarReportButton({ traceCase }: { traceCase: TraceCase }) {
  const baseDraft = useMemo(() => buildSarDraft(traceCase), [traceCase]);
  const [reportingEntity, setReportingEntity] = useState("");
  const [narrativeOverride, setNarrativeOverride] = useState("");

  const draft = useMemo(
    () =>
      buildSarDraft(traceCase, {
        reportingEntity: reportingEntity || undefined,
        investigatorNarrative: narrativeOverride || undefined,
      }),
    [traceCase, reportingEntity, narrativeOverride],
  );
  const markdown = useMemo(() => sarDraftMarkdown(draft), [draft]);

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <FileWarning className="size-3.5" /> Generate SAR Draft
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileWarning className="size-4 text-signal" /> Suspicious Activity Report — Draft
          </DialogTitle>
        </DialogHeader>

        <ScrollArea className="max-h-[60vh] pr-4">
          <div className="space-y-5 pb-2">
            <div className="rounded-md border border-risk-medium/35 bg-risk-medium/10 p-3 text-xs text-risk-medium">
              {draft.disclaimer}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Report ID" value={<Mono>{draft.reportId}</Mono>} />
              <Field label="Generated" value={dateTime(draft.generatedAt)} />
              <Field label="Case" value={<Mono>{draft.caseId}</Mono>} />
              <div className="rounded-md border border-border bg-card/50 px-3 py-2">
                <label className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Reporting entity</label>
                <Input
                  value={reportingEntity}
                  onChange={(e) => setReportingEntity(e.target.value)}
                  placeholder={baseDraft.reportingEntity}
                  className="mt-1 h-7 text-xs"
                />
              </div>
            </div>

            <div>
              <SectionTitle title="Risk assessment" />
              <div className="flex flex-wrap items-center gap-3">
                <RiskBadge score={draft.riskScore} level={draft.riskLevel} />
                <p className="text-xs text-muted-foreground">{draft.recommendedAction}</p>
              </div>
            </div>

            <div>
              <SectionTitle title="Subject account(s)" hint="Roles resolved from the live network graph where available." />
              <ul className="space-y-1.5">
                {draft.subjectAccounts.map((a) => (
                  <li key={a.id} className="flex items-center justify-between text-xs">
                    <Mono>{a.id}</Mono>
                    <span
                      className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${
                        ROLE_BADGE_CLASS[a.role] ?? "border-border bg-muted/30 text-muted-foreground"
                      }`}
                    >
                      {a.role}
                    </span>
                  </li>
                ))}
                {draft.subjectAccounts.length === 0 && (
                  <li className="text-xs text-muted-foreground">No accounts attached to this case.</li>
                )}
              </ul>
            </div>

            <div>
              <SectionTitle
                title="Transaction summary"
                hint={`${draft.transactionSummary.count} transactions · ${currency(draft.transactionSummary.totalValue)}`}
              />
              {draft.transactionSummary.dateRange && (
                <p className="mb-2 text-[11px] text-muted-foreground">
                  {dateTime(draft.transactionSummary.dateRange.from)} → {dateTime(draft.transactionSummary.dateRange.to)}
                </p>
              )}
              <div className="overflow-x-auto rounded-md border border-border">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                      <th className="px-2 py-1.5">Transaction</th>
                      <th className="px-2 py-1.5">Flow</th>
                      <th className="px-2 py-1.5">Amount</th>
                      <th className="px-2 py-1.5">When</th>
                    </tr>
                  </thead>
                  <tbody>
                    {draft.transactionSummary.rows.slice(0, 8).map((t) => (
                      <tr key={t.transaction_id} className="border-b border-border/50 last:border-0">
                        <td className="px-2 py-1"><Mono>{t.transaction_id}</Mono></td>
                        <td className="px-2 py-1"><Mono>{t.sender_id} → {t.receiver_id}</Mono></td>
                        <td className="mono px-2 py-1">{currency(t.amount)}</td>
                        <td className="px-2 py-1 text-muted-foreground">{dateTime(t.timestamp)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {draft.transactionSummary.rows.length > 8 && (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  +{draft.transactionSummary.rows.length - 8} more in the full export.
                </p>
              )}
            </div>

            <div>
              <SectionTitle title="Grounds for suspicion" />
              <ul className="list-inside list-disc space-y-1 text-xs text-muted-foreground">
                {draft.groundsForSuspicion.map((g, i) => (
                  <li key={i}>{g}</li>
                ))}
                {draft.groundsForSuspicion.length === 0 && <li>No pattern tags attached to this case yet.</li>}
              </ul>
            </div>

            <div>
              <SectionTitle title="Money path" />
              <p className="mono text-[11px] text-muted-foreground">
                {draft.moneyPath.length ? draft.moneyPath.join(" → ") : "No reconstructed multi-hop trail."}
              </p>
            </div>

            <div>
              <SectionTitle title="Investigator narrative" hint="Edit before export — this text goes into the filed report." />
              <Textarea
                value={narrativeOverride}
                onChange={(e) => setNarrativeOverride(e.target.value)}
                placeholder={baseDraft.investigatorNarrative}
                className="min-h-24 text-xs leading-relaxed"
              />
            </div>
          </div>
        </ScrollArea>

        <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-3">
          <Button size="sm" variant="secondary" onClick={() => window.print()}>
            <Printer className="size-3.5" /> Print / Save as PDF
          </Button>
          <Button size="sm" onClick={() => downloadMarkdown(`${draft.reportId}.md`, markdown)}>
            <Download className="size-3.5" /> Download Markdown
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-md border border-border bg-card/50 px-3 py-2">
      <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-xs">{value}</p>
    </div>
  );
}
