import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { db, tracePath } from "./engine";

export const CASE_STATUSES = ["Open", "Investigating", "Escalated", "Resolved"] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];

export type CaseDecision = "Confirmed Suspicious" | "False Positive" | "Needs Review";

export interface CaseEvidence {
  network_id: string;
  network_name: string;
  alert_id: string | null;
  account_ids: string[];
  transaction_ids: string[];
  risk_score: number;
  pattern_tags: string[];
  money_path: string[];
  timeline: Array<{
    transaction_id: string;
    timestamp: string;
    sender_id: string;
    receiver_id: string;
    amount: number;
    transaction_type: string;
  }>;
  graph_snapshot: {
    account_ids: string[];
    transaction_ids: string[];
  };
  narrative: string;
  total_value: number;
}

export interface TraceCase {
  id: string;
  alert_id: string | null;
  network_id: string | null;
  title: string;
  status: CaseStatus;
  decision: CaseDecision | null;
  notes: string | null;
  risk_score: number;
  pattern_tags: string[];
  attached_evidence: CaseEvidence;
  ai_summary: string | null;
  created_at: string;
  updated_at: string;
}

const LOCAL_CASES_KEY = "trace.demo.cases";
const BACKEND_TIMEOUT_MS = 5000; // Increased to 5 seconds to give more time for network requests

async function withTimeout<T>(request: PromiseLike<T>, timeoutMs: number = BACKEND_TIMEOUT_MS) {
  return Promise.race([
    request,
    new Promise<never>((_, reject) => {
      window.setTimeout(() => reject(new Error("Backend unavailable in prototype preview")), timeoutMs);
    }),
  ]);
}

function isCaseStatus(value: string): value is CaseStatus {
  return CASE_STATUSES.includes(value as CaseStatus);
}

function normaliseCase(value: {
  id: string;
  title: string;
  alert_id?: string | null;
  network_id?: string | null;
  status?: string | null;
  decision?: string | null;
  notes?: string | null;
  risk_score?: number | null;
  pattern_tags?: string[] | null;
  attached_evidence?: unknown;
  ai_summary?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}): TraceCase {
  return {
    id: value.id,
    alert_id: value.alert_id ?? null,
    network_id: value.network_id ?? null,
    title: value.title,
    status: value.status && isCaseStatus(value.status) ? value.status : "Open",
    decision: value.decision === "Confirmed Suspicious" || value.decision === "False Positive" || value.decision === "Needs Review" ? value.decision : null,
    notes: value.notes ?? null,
    risk_score: value.risk_score ?? 0,
    pattern_tags: value.pattern_tags ?? [],
    attached_evidence: (value.attached_evidence ?? {}) as CaseEvidence,
    ai_summary: value.ai_summary ?? null,
    created_at: value.created_at ?? new Date().toISOString(),
    updated_at: value.updated_at ?? new Date().toISOString(),
  };
}

function readLocalCases() {
  if (typeof window === "undefined") return [];
  try {
    const stored = window.localStorage.getItem(LOCAL_CASES_KEY);
    const parsed: unknown = stored ? JSON.parse(stored) : [];
    return Array.isArray(parsed)
      ? parsed.filter((item): item is Parameters<typeof normaliseCase>[0] =>
          typeof item === "object" && item !== null && "id" in item && "title" in item,
        ).map(normaliseCase)
      : [];
  } catch {
    return [];
  }
}

function writeLocalCases(cases: TraceCase[]) {
  if (typeof window !== "undefined") window.localStorage.setItem(LOCAL_CASES_KEY, JSON.stringify(cases));
}

function buildEvidence(networkId: string, alertId: string | null): CaseEvidence {
  const cluster = db.getCluster(networkId);
  if (!cluster) throw new Error("The selected network is no longer available.");
  const transactions = db.clusterTransactions(networkId);
  const moneyPath = tracePath(networkId).map((transaction) => transaction.transaction_id);
  return {
    network_id: cluster.id,
    network_name: cluster.name,
    alert_id: alertId,
    account_ids: [...cluster.member_account_ids],
    transaction_ids: [...cluster.transaction_ids],
    risk_score: cluster.cluster_risk_score,
    pattern_tags: [...cluster.pattern_tags],
    money_path: moneyPath,
    timeline: transactions.map((transaction) => ({
      transaction_id: transaction.transaction_id,
      timestamp: transaction.timestamp,
      sender_id: transaction.sender_id,
      receiver_id: transaction.receiver_id,
      amount: transaction.amount,
      transaction_type: transaction.transaction_type,
    })),
    graph_snapshot: {
      account_ids: [...cluster.member_account_ids],
      transaction_ids: [...cluster.transaction_ids],
    },
    narrative: cluster.narrative,
    total_value: cluster.total_value,
  };
}

function localCaseFromNetwork(networkId: string, alertId: string | null) {
  const cluster = db.getCluster(networkId);
  if (!cluster) throw new Error("The selected network is no longer available.");
  const now = new Date().toISOString();
  const item = normaliseCase({
    id: `demo-${globalThis.crypto.randomUUID()}`,
    alert_id: alertId,
    network_id: networkId,
    title: `${cluster.name} investigation`,
    status: "Open",
    risk_score: cluster.cluster_risk_score,
    pattern_tags: cluster.pattern_tags,
    attached_evidence: buildEvidence(networkId, alertId),
    created_at: now,
    updated_at: now,
  });
  const cases = [item, ...readLocalCases()];
  writeLocalCases(cases);
  return item;
}

export async function listCases() {
  try {
    const { data, error } = await withTimeout(supabase.from("cases").select("*").order("updated_at", { ascending: false }), 3000);
    if (error) throw error;
    return (data ?? []).map((item) => normaliseCase(item));
  } catch (err) {
    console.warn("Failed to fetch cases from backend, using local fallback:", err);
    return readLocalCases();
  }
}

export async function getCase(id: string) {
  try {
    const { data, error } = await withTimeout(supabase.from("cases").select("*").eq("id", id).maybeSingle(), 3000);
    if (error) throw error;
    return data ? normaliseCase(data) : readLocalCases().find((item) => item.id === id) ?? null;
  } catch (err) {
    console.warn(`Failed to fetch case ${id} from backend, using local fallback:`, err);
    return readLocalCases().find((item) => item.id === id) ?? null;
  }
}

export async function createCaseFromNetwork(networkId: string, alertId: string | null = null) {
  const cluster = db.getCluster(networkId);
  if (!cluster) throw new Error("The selected network is no longer available.");
  const evidence = buildEvidence(networkId, alertId);
  const payload: {
    alert_id: string | null;
    network_id: string;
    title: string;
    status: CaseStatus;
    risk_score: number;
    pattern_tags: string[];
    attached_evidence: Json;
  } = {
    alert_id: alertId,
    network_id: networkId,
    title: `${cluster.name} investigation`,
    status: "Open",
    risk_score: cluster.cluster_risk_score,
    pattern_tags: cluster.pattern_tags,
    attached_evidence: evidence as unknown as Json,
  };
  try {
    const { data, error } = await withTimeout(supabase.from("cases").insert(payload).select("*").single(), 5000);
    if (error) throw error;
    return normaliseCase(data);
  } catch (err) {
    console.warn("Failed to create case in backend, using local fallback:", err);
    return localCaseFromNetwork(networkId, alertId);
  }
}

export async function updateCase(id: string, changes: { status?: CaseStatus; notes?: string | null; decision?: CaseDecision | null }) {
  try {
    const { data, error } = await withTimeout(supabase.from("cases").update(changes).eq("id", id).select("*").single(), 3000);
    if (error) throw error;
    return normaliseCase(data);
  } catch (err) {
    console.warn(`Failed to update case ${id} in backend, using local fallback:`, err);
    const cases = readLocalCases();
    const updated = cases.map((item) => (item.id === id ? normaliseCase({ ...item, ...changes, updated_at: new Date().toISOString() }) : item));
    writeLocalCases(updated);
    return updated.find((item) => item.id === id) ?? null;
  }
}

export async function addCaseFeedback(caseId: string, outcome: CaseDecision, investigatorNote: string) {
  try {
    const { error } = await withTimeout(supabase.from("case_feedback").insert({
      case_id: caseId,
      outcome,
      investigator_note: investigatorNote || null,
    }));
    if (error) throw error;
  } catch {
    // The local preview fallback has no feedback table; the case decision below remains visible.
  }
  const status: CaseStatus = outcome === "Needs Review" ? "Investigating" : "Resolved";
  return updateCase(caseId, { status, decision: outcome, notes: investigatorNote || null });
}