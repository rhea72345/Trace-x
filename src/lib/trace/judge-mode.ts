// Judge Mode — a scripted, deterministic walkthrough of the product loop
// (DETECT -> CONNECT -> TRACE -> EXPLAIN -> INVESTIGATE -> LEARN -> STRESS-TEST)
// across screens that already exist in the app.
//
// This file is intentionally pure data + one small helper: it does not import
// React, does not navigate anywhere itself, and has no side effects at import
// time. The overlay component (JudgeModeOverlay.tsx) reads this script and
// drives navigation using the app's existing router + trace context.

import { db } from "./engine";

export type JudgeStage =
  | "DETECT"
  | "CONNECT"
  | "TRACE"
  | "EXPLAIN"
  | "INVESTIGATE"
  | "LEARN"
  | "STRESS-TEST";

export interface JudgeStep {
  id: string;
  stage: JudgeStage;
  /** One of the app's existing top-level routes. */
  route: string;
  title: string;
  narration: string;
  durationMs: number;
  /**
   * If true, the overlay should point the shared trace context
   * (activeNetworkId) at the fixed demo network before this step is shown,
   * so Network / Explain / Tracer / AI all stay in sync on one story.
   */
  focusDemoNetwork?: boolean;
}

/**
 * Picks a single, deterministic demo network for the whole walkthrough —
 * the highest-risk cluster currently in the seeded dataset — so every run
 * tells the same clean story instead of a random one.
 */
export function getDemoNetworkId(): string | null {
  if (!db.clusters.length) return null;
  return [...db.clusters].sort((a, b) => b.cluster_risk_score - a.cluster_risk_score)[0]!.id;
}

export const JUDGE_MODE_SCRIPT: JudgeStep[] = [
  {
    id: "detect-dashboard",
    stage: "DETECT",
    route: "/",
    title: "Detect",
    narration:
      "TRACE-X continuously ingests transactions and scores every network 0-100 using six weighted signals: behaviour deviation, network signals, velocity, new counterparties, pattern match, and historical association.",
    durationMs: 13000,
  },
  {
    id: "detect-alerts",
    stage: "DETECT",
    route: "/alerts",
    title: "Alert queue",
    narration:
      "Every suspicious network becomes an alert here — sortable by risk, pattern type and status. This is where an analyst's day starts.",
    durationMs: 11000,
  },
  {
    id: "connect-network",
    stage: "CONNECT",
    route: "/network",
    title: "Network graph",
    narration:
      "This is our fixed demo network for the walkthrough. Nodes are accounts, edges are transactions — they glow and thicken by risk and volume, and suspicious clusters get a highlighted halo.",
    durationMs: 16000,
    focusDemoNetwork: true,
  },
  {
    id: "explain-why",
    stage: "EXPLAIN",
    route: "/explain",
    title: "Why flagged?",
    narration:
      "Every score is explainable. This breakdown shows exactly which signals fired and by how much — in language an analyst, or a regulator, can act on.",
    durationMs: 13000,
    focusDemoNetwork: true,
  },
  {
    id: "trace-money",
    stage: "TRACE",
    route: "/tracer",
    title: "Money tracer",
    narration:
      "The Money Tracer follows funds hop by hop from source to destination, with amounts and timestamps at every leg of the journey.",
    durationMs: 13000,
    focusDemoNetwork: true,
  },
  {
    id: "investigate-ai",
    stage: "INVESTIGATE",
    route: "/ai",
    title: "AI investigation",
    narration:
      "The AI assistant is scoped to this case and grounds every answer in real transaction IDs and timestamps. It explains and drafts — it never declares guilt. That call stays with the analyst.",
    durationMs: 15000,
    focusDemoNetwork: true,
  },
  {
    id: "learn-cases",
    stage: "LEARN",
    route: "/cases",
    title: "Case management",
    narration:
      "Cases attach the full evidence package automatically — graph snapshot, transactions, timeline and AI summary — so every decision is auditable end to end.",
    durationMs: 11000,
  },
  {
    id: "stress-test-lab",
    stage: "STRESS-TEST",
    route: "/lab",
    title: "Detection Lab",
    narration:
      "And here's the differentiator: the Adversarial Fraud Simulator stress-tests our own detection engine with evolving synthetic fraud scenarios — finding blind spots before real criminals do.",
    durationMs: 15000,
  },
];
