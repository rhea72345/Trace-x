// Cross-Case Precedent Matching.
//
// Compares a network's fraud fingerprint (velocity, layering, fan-in/out,
// circularity, dormancy — already computed by the detection engine for
// every cluster) against every other known network using cosine
// similarity, surfacing the closest matches. Where a match is already
// attached to a case, that case's status/decision is shown too — turning
// "this looks like a mule chain" into "this looks like Case #142, which
// we already confirmed as suspicious."
//
// Pure, read-only, synchronous except for the one optional helper that
// cross-references against the case list (which is itself already async
// elsewhere in the app via listCases()).

import { db, PATTERN_META, type Fingerprint, type PatternType } from "./engine";
import type { TraceCase } from "./cases";

export interface PrecedentMatch {
  networkId: string;
  networkName: string;
  pattern: PatternType;
  similarity: number; // 0..1, cosine similarity of fingerprint vectors
  riskScore: number;
  firstSeen: string;
}

export interface PrecedentMatchWithCase extends PrecedentMatch {
  caseId: string | null;
  caseStatus: TraceCase["status"] | null;
  caseDecision: TraceCase["decision"] | null;
}

function magnitude(fp: Fingerprint): number {
  return Math.sqrt(
    fp.velocity ** 2 + fp.layering ** 2 + fp.fan_in ** 2 + fp.fan_out ** 2 + fp.circularity ** 2 + fp.dormancy ** 2,
  );
}

export function fingerprintSimilarity(a: Fingerprint, b: Fingerprint): number {
  const dot =
    a.velocity * b.velocity +
    a.layering * b.layering +
    a.fan_in * b.fan_in +
    a.fan_out * b.fan_out +
    a.circularity * b.circularity +
    a.dormancy * b.dormancy;
  const magA = magnitude(a);
  const magB = magnitude(b);
  if (magA === 0 || magB === 0) return 0;
  return dot / (magA * magB);
}

/**
 * Finds the most fingerprint-similar networks to `networkId`, excluding
 * itself and excluding benign/control networks (e.g. "Legitimate
 * High-Value") — those share numeric fingerprint traits with real fraud
 * patterns often enough to be noisy here, and matching a suspicious
 * network against a known-legitimate one isn't a useful precedent.
 * Returns an empty array if the network is unknown or nothing clears the
 * similarity threshold.
 */
export function findPrecedents(
  networkId: string,
  options: { limit?: number; minSimilarity?: number } = {},
): PrecedentMatch[] {
  const { limit = 5, minSimilarity = 0.55 } = options;
  const subject = db.getCluster(networkId);
  if (!subject) return [];

  return db.clusters
    .filter((c) => c.id !== networkId)
    .filter((c) => !PATTERN_META[c.pattern].benign)
    .map((c) => ({
      networkId: c.id,
      networkName: c.name,
      pattern: c.pattern,
      similarity: fingerprintSimilarity(subject.fingerprint, c.fingerprint),
      riskScore: c.cluster_risk_score,
      firstSeen: c.first_seen,
    }))
    .filter((m) => m.similarity >= minSimilarity)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);
}

/**
 * Cross-references precedent matches against an already-loaded case list,
 * so a match that's already been investigated shows its case ID, status
 * and decision instead of just the raw network.
 */
export function attachCaseInfo(matches: PrecedentMatch[], cases: TraceCase[]): PrecedentMatchWithCase[] {
  const byNetwork = new Map<string, TraceCase>();
  cases.forEach((c) => {
    if (c.network_id) byNetwork.set(c.network_id, c);
  });

  return matches.map((m) => {
    const found = byNetwork.get(m.networkId);
    return {
      ...m,
      caseId: found?.id ?? null,
      caseStatus: found?.status ?? null,
      caseDecision: found?.decision ?? null,
    };
  });
}
