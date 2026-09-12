import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { GitCompareArrows } from "lucide-react";
import { PatternBadge, SectionTitle, StatusPill } from "@/components/trace/primitives";
import { attachCaseInfo, findPrecedents } from "@/lib/trace/precedent-matching";
import { listCases, type TraceCase } from "@/lib/trace/cases";

/**
 * Self-contained "precedent matches" panel for a case. Fetches the case
 * list itself and compares this case's network fingerprint against every
 * other known network — no props beyond the case, no wiring beyond one
 * <PrecedentMatches traceCase={item} /> line on the page.
 */
export function PrecedentMatches({ traceCase }: { traceCase: TraceCase }) {
  const [cases, setCases] = useState<TraceCase[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void listCases().then((result) => {
      if (!cancelled) {
        setCases(result);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const matches = useMemo(() => {
    if (!traceCase.network_id) return [];
    const raw = findPrecedents(traceCase.network_id);
    return attachCaseInfo(raw, cases);
  }, [traceCase.network_id, cases]);

  if (!traceCase.network_id) return null;

  return (
    <section className="panel-surface rounded-lg p-4">
      <SectionTitle
        title="Precedent matches"
        hint="Other networks with a similar fraud fingerprint (velocity, layering, fan-in/out, circularity, dormancy)."
      />
      {loading ? (
        <p className="text-xs text-muted-foreground">Comparing against known networks…</p>
      ) : matches.length === 0 ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <GitCompareArrows className="size-3.5 shrink-0" /> No sufficiently similar networks found yet.
        </p>
      ) : (
        <ul className="space-y-2">
          {matches.map((m) => (
            <li key={m.networkId} className="rounded-md border border-border bg-card/50 p-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="mono text-sm font-semibold text-signal">{Math.round(m.similarity * 100)}%</span>
                  <span className="text-xs font-medium">{m.networkName}</span>
                  <PatternBadge pattern={m.pattern} size="sm" />
                </div>
                {m.caseStatus && <StatusPill status={m.caseStatus} />}
              </div>
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                {m.caseId ? (
                  <>
                    Filed as{" "}
                    <Link
                      to="/cases/$caseId"
                      params={{ caseId: m.caseId }}
                      className="text-signal underline underline-offset-2"
                    >
                      {m.caseId}
                    </Link>
                    {m.caseDecision ? ` — ${m.caseDecision}` : ""}
                  </>
                ) : (
                  "Not yet attached to a case."
                )}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
