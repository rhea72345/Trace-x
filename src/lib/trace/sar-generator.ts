// SAR (Suspicious Activity Report) auto-draft generator.
//
// Pure, read-only transform: takes an existing TraceCase (already defined in
// ./cases.ts) and produces a structured draft report object, in the general
// shape of an India FIU-IND Suspicious Transaction Report (STR/SAR).
//
// This module does not fetch anything, does not touch Supabase, and does not
// mutate the case. It only reorganises data that is already attached to the
// case's evidence packet into a filing-shaped document for analyst review.
//
// IMPORTANT: this is a DRAFTING AID for a human investigator, not a filed
// regulatory submission. See `SAR_DISCLAIMER` below — surface it wherever
// this draft is shown or exported.

import { PATTERN_META, BAND_GUIDANCE, bandOf, db, type PatternType, type RiskLevel } from "./engine";
import { currency, dateTime } from "./format";
import type { TraceCase } from "./cases";

export const SAR_DISCLAIMER =
  "Auto-generated draft for investigator review — not a filed regulatory submission. " +
  "A qualified compliance officer must verify all fields and grounds for suspicion before any filing with FIU-IND.";

export interface SarSubjectAccount {
  id: string;
  role: string; // e.g. "Central account", "Mule account", "Bridge account", "Involved account"
}

export interface SarTransactionRow {
  transaction_id: string;
  timestamp: string;
  sender_id: string;
  receiver_id: string;
  amount: number;
  transaction_type: string;
}

export interface SarDraft {
  reportId: string;
  generatedAt: string; // ISO timestamp
  reportingEntity: string; // placeholder — filled in by the filing institution
  caseId: string;
  caseTitle: string;
  caseStatus: TraceCase["status"];
  caseDecision: TraceCase["decision"];
  riskScore: number;
  riskLevel: RiskLevel;
  recommendedAction: string;
  subjectAccounts: SarSubjectAccount[];
  transactionSummary: {
    count: number;
    totalValue: number;
    dateRange: { from: string; to: string } | null;
    rows: SarTransactionRow[];
  };
  groundsForSuspicion: string[];
  moneyPath: string[];
  investigatorNarrative: string;
  disclaimer: string;
}

/**
 * Builds an accountId -> role label map. Prefers the live NetworkCluster
 * (which carries real central/mule/bridge tags) when it's still available;
 * falls back to a best-effort guess from the flat evidence lists so the
 * draft still renders sensibly for older cases whose source network has
 * since been pruned or is unavailable in this session.
 */
function buildRoleMap(evidence: TraceCase["attached_evidence"]): Map<string, string> {
  const roles = new Map<string, string>();
  const cluster = evidence.network_id ? db.getCluster(evidence.network_id) : undefined;

  if (cluster) {
    roles.set(cluster.central_account, "Central account");
    cluster.mule_accounts.forEach((id) => roles.set(id, roles.get(id) ?? "Mule account"));
    cluster.bridge_accounts.forEach((id) => roles.set(id, roles.get(id) ?? "Bridge account"));
    return roles;
  }

  // Fallback: no live cluster to consult — infer what we can from the
  // evidence packet itself rather than labelling everything "Involved".
  if (evidence.money_path.length) roles.set(evidence.money_path[0]!, "Origin account (money path)");
  return roles;
}

function roleFor(accountId: string, roleMap: Map<string, string>): string {
  return roleMap.get(accountId) ?? "Involved account";
}

const ROLE_PRIORITY: Record<string, number> = {
  "Central account": 0,
  "Origin account (money path)": 1,
  "Bridge account": 2,
  "Mule account": 3,
  "Involved account": 4,
};

function sortByRolePriority(accounts: SarSubjectAccount[]): SarSubjectAccount[] {
  return [...accounts].sort((a, b) => (ROLE_PRIORITY[a.role] ?? 9) - (ROLE_PRIORITY[b.role] ?? 9));
}

function groundsFromPatternTags(patternTags: string[]): string[] {
  return patternTags.map((tag) => {
    const meta = PATTERN_META[tag as PatternType];
    return meta ? `${meta.label}: ${meta.description}` : tag;
  });
}

export interface SarDraftOverrides {
  reportingEntity?: string;
  investigatorNarrative?: string;
}

export function buildSarDraft(traceCase: TraceCase, overrides?: SarDraftOverrides): SarDraft {
  const evidence = traceCase.attached_evidence;
  const level = bandOf(traceCase.risk_score);
  const timeline = evidence?.timeline ?? [];
  const roleMap = buildRoleMap(evidence);
  const dateRange =
    timeline.length > 0
      ? {
          from: timeline.reduce((min, t) => (t.timestamp < min ? t.timestamp : min), timeline[0]!.timestamp),
          to: timeline.reduce((max, t) => (t.timestamp > max ? t.timestamp : max), timeline[0]!.timestamp),
        }
      : null;

  const narrative =
    overrides?.investigatorNarrative?.trim() ||
    traceCase.ai_summary?.trim() ||
    traceCase.notes?.trim() ||
    evidence?.narrative?.trim() ||
    "No investigator narrative recorded yet — add case notes before filing.";

  return {
    reportId: `SAR-${traceCase.id}`,
    generatedAt: new Date().toISOString(),
    reportingEntity: overrides?.reportingEntity?.trim() || "[Reporting Entity Name]",
    caseId: traceCase.id,
    caseTitle: traceCase.title,
    caseStatus: traceCase.status,
    caseDecision: traceCase.decision,
    riskScore: traceCase.risk_score,
    riskLevel: level,
    recommendedAction: BAND_GUIDANCE[level],
    subjectAccounts: sortByRolePriority((evidence?.account_ids ?? []).map((id) => ({ id, role: roleFor(id, roleMap) }))),
    transactionSummary: {
      count: evidence?.transaction_ids?.length ?? 0,
      totalValue: evidence?.total_value ?? 0,
      dateRange,
      rows: timeline,
    },
    groundsForSuspicion: groundsFromPatternTags(traceCase.pattern_tags),
    moneyPath: evidence?.money_path ?? [],
    investigatorNarrative: narrative,
    disclaimer: SAR_DISCLAIMER,
  };
}

export function sarDraftMarkdown(draft: SarDraft): string {
  const lines = [
    `# Suspicious Activity Report — Draft`,
    ``,
    `> ${draft.disclaimer}`,
    ``,
    `**Report ID:** ${draft.reportId}`,
    `**Generated:** ${dateTime(draft.generatedAt)}`,
    `**Reporting entity:** ${draft.reportingEntity}`,
    `**Case:** ${draft.caseId} — ${draft.caseTitle}`,
    `**Case status:** ${draft.caseStatus}${draft.caseDecision ? ` · Decision: ${draft.caseDecision}` : ""}`,
    ``,
    `## Risk assessment`,
    `- Risk score: ${draft.riskScore}/100 (${draft.riskLevel})`,
    `- Recommended action: ${draft.recommendedAction}`,
    ``,
    `## Subject account(s)`,
    ...draft.subjectAccounts.map((a) => `- ${a.id} — ${a.role}`),
    ``,
    `## Transaction summary`,
    `- Transactions involved: ${draft.transactionSummary.count}`,
    `- Total value: ${currency(draft.transactionSummary.totalValue)}`,
    `- Date range: ${
      draft.transactionSummary.dateRange
        ? `${dateTime(draft.transactionSummary.dateRange.from)} → ${dateTime(draft.transactionSummary.dateRange.to)}`
        : "Not available"
    }`,
    ``,
    `| Transaction | Sender | Receiver | Amount | When |`,
    `| --- | --- | --- | --- | --- |`,
    ...draft.transactionSummary.rows
      .slice(0, 20)
      .map((t) => `| ${t.transaction_id} | ${t.sender_id} | ${t.receiver_id} | ${currency(t.amount)} | ${dateTime(t.timestamp)} |`),
    ``,
    `## Grounds for suspicion`,
    ...(draft.groundsForSuspicion.length ? draft.groundsForSuspicion.map((g) => `- ${g}`) : ["- Not yet categorised — attach pattern tags to the case."]),
    ``,
    `## Money path`,
    draft.moneyPath.length ? draft.moneyPath.join(" → ") : "No reconstructed multi-hop trail.",
    ``,
    `## Investigator narrative`,
    draft.investigatorNarrative,
    ``,
    `---`,
    `*${draft.disclaimer}*`,
  ];
  return lines.join("\n");
}
