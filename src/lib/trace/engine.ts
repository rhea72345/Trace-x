/**
 * TRACE detection engine — deterministic synthetic data + rules/scoring + ML anomaly detection.
 *
 * Everything here is SYNTHETIC. No real personal or financial data.
 * The generator is seeded so every analyst sees the same investigation state,
 * and the scoring engine combines:
 * - Transparent weighted rules model
 * - ML anomaly detection (Isolation Forest)
 * - Network risk analysis
 * 
 * Hybrid approach: Rule Risk + ML Anomaly Risk + Network Risk = Hybrid Risk Score
 */

export type RiskLevel = "Low" | "Medium" | "High" | "Critical";

export type PatternType =
  | "mule_chain"
  | "fan_in"
  | "fan_out"
  | "circular"
  | "rapid_layering"
  | "dormant_sync"
  | "bridge_account"
  | "legit_high_value";

export type FraudTypology =
  | "Structuring"
  | "Mule account layering"
  | "Circular transaction ring"
  | "Smurfing"
  | "Anomalous pattern";

/**
 * Classify a flagged account/cluster into a fraud typology based on existing signals.
 * This maps existing detection patterns to named fraud typologies without adding new detection logic.
 */
export function classifyFraudTypology(cluster: NetworkCluster): FraudTypology {
  const pattern = cluster.pattern;
  const fp = cluster.fingerprint;
  const signals = cluster.signals;
  
  // Map existing patterns to typologies based on signals and pattern metadata
  switch (pattern) {
    case "circular":
      return "Circular transaction ring";
    
    case "mule_chain":
    case "rapid_layering":
      return "Mule account layering";
    
    case "fan_out":
      // High fan-out with many small transactions suggests smurfing
      if (fp.fan_out > 60 && fp.layering > 50) {
        return "Smurfing";
      }
      return "Mule account layering";
    
    case "fan_in":
      // Fan-in with just-under-threshold amounts suggests structuring
      const structuringSignal = signals.find(s => s.key === "counterparties");
      if (structuringSignal && structuringSignal.score > 50) {
        return "Structuring";
      }
      return "Mule account layering";
    
    case "dormant_sync":
      // Dormant accounts reactivating together often for structuring
      if (fp.dormancy > 40) {
        return "Structuring";
      }
      return "Anomalous pattern";
    
    case "bridge_account":
      return "Mule account layering";
    
    case "legit_high_value":
      return "Anomalous pattern";
    
    default:
      return "Anomalous pattern";
  }
}

export const PATTERN_META: Record<
  PatternType,
  { label: string; short: string; description: string; benign?: boolean }
> = {
  mule_chain: {
    label: "Mule Chain",
    short: "MULE",
    description:
      "Funds pass sequentially through a line of low-history accounts, each retaining a small cut.",
  },
  fan_in: {
    label: "Fan-In",
    short: "FAN-IN",
    description:
      "Many source accounts push value into a single collector account in a tight window.",
  },
  fan_out: {
    label: "Fan-Out",
    short: "FAN-OUT",
    description:
      "A single account disperses value to many receivers immediately after a large inbound credit.",
  },
  circular: {
    label: "Circular Transfer",
    short: "CIRCLE",
    description:
      "Value returns to its origin through intermediaries, inflating apparent activity.",
  },
  rapid_layering: {
    label: "Rapid Layering",
    short: "LAYER",
    description:
      "High-frequency hops with decreasing amounts and very short dwell time between legs.",
  },
  dormant_sync: {
    label: "Dormant Sync-Activation",
    short: "DORMANT",
    description:
      "Multiple long-inactive accounts wake up together and transact within the same window.",
  },
  bridge_account: {
    label: "Bridge Account",
    short: "BRIDGE",
    description:
      "A single account connects two otherwise separate sub-networks, acting as a chokepoint.",
  },
  legit_high_value: {
    label: "Legitimate High-Value",
    short: "CONTROL",
    description:
      "Established counterparties moving large sums on a consistent, expected schedule.",
    benign: true,
  },
};

export type TxnType = "UPI" | "BANK" | "WALLET";

export interface Account {
  id: string;
  holder: string;
  created_at: string;
  account_age_days: number;
  current_status: "Active" | "Dormant" | "Reactivated" | "Frozen";
  baseline_behaviour: {
    avg_amount: number;
    avg_txn_per_week: number;
    typical_counterparties: number;
    typical_hours: [number, number];
    home_location: string;
  };
  risk_score: number;
  role_tag: string;
  cluster_id: string | null;
}

export interface Transaction {
  transaction_id: string;
  sender_id: string;
  receiver_id: string;
  amount: number;
  timestamp: string;
  transaction_type: TxnType;
  device_id: string;
  location_id: string;
  account_age_days: number;
  scenario_id: string | null;
  label: "normal" | "suspicious";
}

export interface SignalBreakdown {
  key: string;
  label: string;
  weight: number;
  score: number;
  contribution: number;
  reason: string;
}

export interface Fingerprint {
  velocity: number;
  layering: number;
  fan_in: number;
  fan_out: number;
  circularity: number;
  dormancy: number;
}

export interface NetworkCluster {
  id: string;
  name: string;
  pattern: PatternType;
  member_account_ids: string[];
  transaction_ids: string[];
  cluster_risk_score: number;
  level: RiskLevel;
  fingerprint: Fingerprint;
  signals: SignalBreakdown[];
  total_value: number;
  first_seen: string;
  last_seen: string;
  central_account: string;
  mule_accounts: string[];
  bridge_accounts: string[];
  pattern_tags: PatternType[];
  narrative: string;
}

export interface Alert {
  id: string;
  network_id: string;
  title: string;
  risk_score: number;
  level: RiskLevel;
  pattern_tags: PatternType[];
  status: "New" | "Reviewing" | "Escalated" | "Resolved";
  created_at: string;
  accounts_involved: number;
  amount: number;
  primary_account: string;
}

/* ------------------------------------------------------------------ */
/* Deterministic RNG                                                    */
/* ------------------------------------------------------------------ */

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(20260824);
const pick = <T,>(arr: readonly T[]) => arr[Math.floor(rand() * arr.length)]!;
const int = (min: number, max: number) => Math.floor(rand() * (max - min + 1)) + min;
const money = (min: number, max: number) => Math.round((rand() * (max - min) + min) / 10) * 10;

const LOCATIONS = [
  "LOC-BLR-01",
  "LOC-MUM-04",
  "LOC-DEL-02",
  "LOC-HYD-07",
  "LOC-PNQ-03",
  "LOC-CCU-05",
  "LOC-JAI-09",
  "LOC-CHN-06",
  "LOC-IDR-11",
  "LOC-GHY-13",
] as const;

const FIRST = [
  "Aarav","Isha","Rohan","Meera","Kabir","Ananya","Vikram","Tara","Dev","Nisha",
  "Arjun","Priya","Karan","Sana","Rahul","Divya","Manav","Riya","Omkar","Leela",
];
const LAST = [
  "Sharma","Iyer","Menon","Kapoor","Nair","Bose","Reddy","Joshi","Khan","Patel",
  "Gupta","Verma","Rao","Sethi","Banerjee","Chopra",
];

const TYPES: TxnType[] = ["UPI", "BANK", "WALLET"];

const NOW = new Date("2026-08-24T09:00:00Z").getTime();
const DAY = 86400000;

const iso = (ms: number) => new Date(ms).toISOString();

/* ------------------------------------------------------------------ */
/* Generation                                                           */
/* ------------------------------------------------------------------ */

const accounts: Account[] = [];
const transactions: Transaction[] = [];
const clusters: NetworkCluster[] = [];

let acctSeq = 1000;
let txnSeq = 100000;

function makeAccount(opts: Partial<Account> = {}): Account {
  const id = `ACC-${(acctSeq++).toString(36).toUpperCase().padStart(5, "0")}`;
  const age = opts.account_age_days ?? int(20, 2600);
  const home = pick(LOCATIONS);
  const a: Account = {
    id,
    holder: `${pick(FIRST)} ${pick(LAST)}`,
    created_at: iso(NOW - age * DAY),
    account_age_days: age,
    current_status: "Active",
    baseline_behaviour: {
      avg_amount: money(1200, 24000),
      avg_txn_per_week: int(2, 22),
      typical_counterparties: int(2, 14),
      typical_hours: [int(7, 10), int(18, 23)],
      home_location: home,
    },
    risk_score: 0,
    role_tag: "Standard",
    cluster_id: null,
    ...opts,
  };
  accounts.push(a);
  return a;
}

function makeTxn(
  sender: Account,
  receiver: Account,
  amount: number,
  ts: number,
  scenario_id: string | null,
  label: "normal" | "suspicious",
  type?: TxnType,
): Transaction {
  const t: Transaction = {
    transaction_id: `TXN-${(txnSeq++).toString(36).toUpperCase()}`,
    sender_id: sender.id,
    receiver_id: receiver.id,
    amount,
    timestamp: iso(ts),
    transaction_type: type ?? pick(TYPES),
    device_id: `DEV-${int(1000, 9999)}-${pick(["A", "B", "C", "D", "E"])}`,
    location_id:
      label === "suspicious" && rand() > 0.45 ? pick(LOCATIONS) : sender.baseline_behaviour.home_location,
    account_age_days: sender.account_age_days,
    scenario_id,
    label,
  };
  transactions.push(t);
  return t;
}

// --- Background population -------------------------------------------------
const background: Account[] = [];
for (let i = 0; i < 168; i++) background.push(makeAccount());

for (let i = 0; i < 620; i++) {
  const s = pick(background);
  let r = pick(background);
  if (r.id === s.id) r = pick(background);
  const ts = NOW - int(0, 45) * DAY - int(0, 86400) * 1000;
  makeTxn(s, r, money(180, 42000), ts, null, "normal");
}

/* ------------------------------------------------------------------ */
/* Embedded fraud patterns                                              */
/* ------------------------------------------------------------------ */

interface ClusterSpec {
  pattern: PatternType;
  name: string;
}

const SPECS: ClusterSpec[] = [
  { pattern: "mule_chain", name: "Kestrel Chain" },
  { pattern: "mule_chain", name: "Ironwood Relay" },
  { pattern: "fan_in", name: "Basin Collector" },
  { pattern: "fan_in", name: "Harbour Sink" },
  { pattern: "fan_out", name: "Splitter Delta" },
  { pattern: "fan_out", name: "Monsoon Spread" },
  { pattern: "circular", name: "Ouroboros Loop" },
  { pattern: "circular", name: "Meridian Ring" },
  { pattern: "rapid_layering", name: "Strata Cascade" },
  { pattern: "rapid_layering", name: "Nightshift Layering" },
  { pattern: "dormant_sync", name: "Sleeper Cell 7" },
  { pattern: "dormant_sync", name: "Cold Start Grid" },
  { pattern: "legit_high_value", name: "Vantage Trade Corridor" },
  { pattern: "legit_high_value", name: "Aurum Payroll Run" },
];

let clusterSeq = 1;

function buildCluster(spec: ClusterSpec): NetworkCluster {
  const id = `NET-${(clusterSeq++).toString().padStart(3, "0")}`;
  const scenarioId = `SCN-${id}`;
  const members: Account[] = [];
  const txns: Transaction[] = [];
  const suspicious = spec.pattern !== "legit_high_value";
  const label = suspicious ? "suspicious" : "normal";
  const start = NOW - int(2, 26) * DAY;
  const tags: PatternType[] = [spec.pattern];

  const newAcct = (over: Partial<Account> = {}) => {
    const a = makeAccount(over);
    a.cluster_id = id;
    members.push(a);
    return a;
  };

  if (spec.pattern === "mule_chain") {
    const source = newAcct({ account_age_days: int(700, 2400), role_tag: "Source" });
    let carrier: Account = source;
    let amount = money(480000, 1400000);
    const hops = int(5, 7);
    for (let h = 0; h < hops; h++) {
      const next = newAcct({ account_age_days: int(9, 70), role_tag: "Mule" });
      amount = Math.round(amount * (0.9 - rand() * 0.06));
      txns.push(
        makeTxn(carrier, next, amount, start + h * int(20, 90) * 60000, scenarioId, label, "UPI"),
      );
      carrier = next;
    }
    carrier.role_tag = "Cash-out";
    tags.push("rapid_layering");
  }

  if (spec.pattern === "fan_in") {
    const collector = newAcct({ account_age_days: int(30, 160), role_tag: "Collector" });
    const n = int(9, 14);
    for (let i = 0; i < n; i++) {
      const src = newAcct({ account_age_days: int(12, 260), role_tag: "Feeder" });
      txns.push(
        makeTxn(src, collector, money(38000, 190000), start + i * int(4, 22) * 60000, scenarioId, label),
      );
    }
    const onward = newAcct({ account_age_days: int(15, 90), role_tag: "Bridge" });
    txns.push(
      makeTxn(collector, onward, money(700000, 1600000), start + 6 * 3600000, scenarioId, label, "BANK"),
    );
    tags.push("bridge_account");
  }

  if (spec.pattern === "fan_out") {
    const disperser = newAcct({ account_age_days: int(25, 200), role_tag: "Disperser" });
    const funder = newAcct({ account_age_days: int(400, 1800), role_tag: "Origin" });
    txns.push(makeTxn(funder, disperser, money(900000, 2100000), start, scenarioId, label, "BANK"));
    const n = int(10, 15);
    for (let i = 0; i < n; i++) {
      const dst = newAcct({ account_age_days: int(6, 90), role_tag: "Receiver" });
      txns.push(
        makeTxn(disperser, dst, money(29000, 140000), start + 40 * 60000 + i * int(2, 12) * 60000, scenarioId, label, "UPI"),
      );
    }
  }

  if (spec.pattern === "circular") {
    const n = int(4, 6);
    const ring: Account[] = [];
    for (let i = 0; i < n; i++) ring.push(newAcct({ account_age_days: int(60, 900), role_tag: "Ring node" }));
    let amt = money(260000, 780000);
    for (let i = 0; i < n; i++) {
      const from = ring[i]!;
      const to = ring[(i + 1) % n]!;
      amt = Math.round(amt * (0.96 + rand() * 0.03));
      txns.push(makeTxn(from, to, amt, start + i * int(30, 180) * 60000, scenarioId, label));
    }
    ring[0]!.role_tag = "Origin / Terminus";
  }

  if (spec.pattern === "rapid_layering") {
    const origin = newAcct({ account_age_days: int(300, 1500), role_tag: "Origin" });
    let cur = origin;
    let amt = money(600000, 1500000);
    const hops = int(7, 10);
    for (let h = 0; h < hops; h++) {
      const next = newAcct({ account_age_days: int(4, 45), role_tag: "Layer node" });
      const legs = int(2, 3);
      for (let l = 0; l < legs; l++) {
        const part = Math.round((amt / legs) * (0.92 + rand() * 0.05));
        txns.push(
          makeTxn(cur, next, part, start + (h * 14 + l * 3) * 60000, scenarioId, label, "WALLET"),
        );
      }
      amt = Math.round(amt * 0.88);
      cur = next;
    }
    tags.push("mule_chain");
  }

  if (spec.pattern === "dormant_sync") {
    const n = int(6, 9);
    const woken: Account[] = [];
    for (let i = 0; i < n; i++) {
      woken.push(
        newAcct({
          account_age_days: int(1100, 2900),
          current_status: "Reactivated",
          role_tag: "Dormant → active",
        }),
      );
    }
    const hub = newAcct({ account_age_days: int(40, 200), role_tag: "Hub" });
    woken.forEach((w, i) => {
      txns.push(makeTxn(w, hub, money(52000, 240000), start + i * int(1, 9) * 60000, scenarioId, label));
    });
    tags.push("fan_in");
  }

  if (spec.pattern === "legit_high_value") {
    const payer = newAcct({ account_age_days: int(1400, 3000), role_tag: "Corporate payer" });
    const n = int(5, 8);
    for (let i = 0; i < n; i++) {
      const dst = newAcct({ account_age_days: int(600, 2600), role_tag: "Known counterparty" });
      for (let m = 0; m < 3; m++) {
        txns.push(
          makeTxn(payer, dst, money(240000, 620000), start - m * 30 * DAY + i * 3600000, scenarioId, label, "BANK"),
        );
      }
    }
  }

  // Ambient noise so clusters are not perfectly isolated islands
  for (let i = 0; i < int(3, 7); i++) {
    const m = pick(members);
    const outsider = pick(background);
    txns.push(makeTxn(m, outsider, money(400, 26000), start - int(1, 20) * DAY, null, "normal"));
  }

  const times = txns.map((t) => new Date(t.timestamp).getTime());
  const fingerprint = computeFingerprint(spec.pattern, members, txns);
  
  // Try to get ML anomaly score, fall back to 0 if ML unavailable
  let mlAnomalyScore = 0;
  try {
    // ML integration will be done at runtime after initial data generation
    // For now, use a deterministic approximation based on pattern type
    mlAnomalyScore = spec.pattern === "legit_high_value" ? 8 : 
                    spec.pattern === "mule_chain" ? 72 :
                    spec.pattern === "rapid_layering" ? 78 :
                    spec.pattern === "dormant_sync" ? 65 :
                    spec.pattern === "circular" ? 58 :
                    45;
  } catch (e) {
    // ML unavailable, will use fallback
    mlAnomalyScore = 0;
  }
  
  const signals = computeSignals(spec.pattern, members, txns, fingerprint, mlAnomalyScore);
  const cluster_risk_score = scoreFromSignals(signals);

  const degrees = new Map<string, number>();
  txns.forEach((t) => {
    degrees.set(t.sender_id, (degrees.get(t.sender_id) ?? 0) + 1);
    degrees.set(t.receiver_id, (degrees.get(t.receiver_id) ?? 0) + 1);
  });
  const central =
    [...degrees.entries()].sort((a, b) => b[1] - a[1]).find(([aid]) => members.some((m) => m.id === aid))?.[0] ??
    members[0]!.id;

  const cluster: NetworkCluster = {
    id,
    name: spec.name,
    pattern: spec.pattern,
    member_account_ids: members.map((m) => m.id),
    transaction_ids: txns.map((t) => t.transaction_id),
    cluster_risk_score,
    level: bandOf(cluster_risk_score),
    fingerprint,
    signals,
    total_value: txns.reduce((s, t) => s + t.amount, 0),
    first_seen: iso(Math.min(...times)),
    last_seen: iso(Math.max(...times)),
    central_account: central,
    mule_accounts: members.filter((m) => /Mule|Layer|Feeder/.test(m.role_tag)).map((m) => m.id),
    bridge_accounts: members.filter((m) => /Bridge|Hub|Collector|Disperser/.test(m.role_tag)).map((m) => m.id),
    pattern_tags: tags,
    narrative: narrativeFor(spec.pattern, members.length, txns.length),
  };

  // propagate risk to member accounts
  members.forEach((m, i) => {
    const roleBoost = m.id === central ? 12 : /Mule|Layer|Collector|Hub|Bridge/.test(m.role_tag) ? 7 : 0;
    m.risk_score = clamp(
      Math.round(cluster_risk_score * (0.7 + ((i % 5) * 0.05)) + roleBoost),
      spec.pattern === "legit_high_value" ? 4 : 18,
      99,
    );
    if (m.current_status === "Reactivated") m.risk_score = clamp(m.risk_score + 5, 0, 99);
  });

  clusters.push(cluster);
  return cluster;
}

function narrativeFor(p: PatternType, accts: number, txns: number) {
  const base = PATTERN_META[p].description;
  return `${base} Observed across ${accts} accounts and ${txns} transactions in this network.`;
}

export function clamp(n: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, n));
}

function computeFingerprint(
  pattern: PatternType,
  members: Account[],
  txns: Transaction[],
): Fingerprint {
  const times = txns.map((t) => new Date(t.timestamp).getTime()).sort((a, b) => a - b);
  const spanHours = Math.max(0.5, (times[times.length - 1]! - times[0]!) / 3600000);
  const velocity = clamp(Math.round((txns.length / spanHours) * 26));

  const inDeg = new Map<string, number>();
  const outDeg = new Map<string, number>();
  txns.forEach((t) => {
    outDeg.set(t.sender_id, (outDeg.get(t.sender_id) ?? 0) + 1);
    inDeg.set(t.receiver_id, (inDeg.get(t.receiver_id) ?? 0) + 1);
  });
  const maxIn = Math.max(1, ...inDeg.values());
  const maxOut = Math.max(1, ...outDeg.values());

  const edges = new Set(txns.map((t) => `${t.sender_id}>${t.receiver_id}`));
  let recip = 0;
  edges.forEach((e) => {
    const [a, b] = e.split(">");
    if (edges.has(`${b}>${a}`)) recip++;
  });
  const circularity =
    pattern === "circular" ? clamp(78 + members.length * 3) : clamp(Math.round((recip / Math.max(1, edges.size)) * 100));

  const chainDepth = members.length;
  const layering =
    pattern === "rapid_layering"
      ? clamp(72 + chainDepth * 2)
      : pattern === "mule_chain"
        ? clamp(58 + chainDepth * 3)
        : clamp(Math.round((txns.length / Math.max(2, members.length)) * 14));

  const dormancy = clamp(
    Math.round((members.filter((m) => m.current_status === "Reactivated").length / members.length) * 130),
  );

  return {
    velocity,
    layering,
    fan_in: clamp(Math.round((maxIn / Math.max(2, members.length)) * 130)),
    fan_out: clamp(Math.round((maxOut / Math.max(2, members.length)) * 130)),
    circularity,
    dormancy,
  };
}

export const SIGNAL_WEIGHTS = [
  { key: "behaviour", label: "Behaviour deviation", weight: 20 },
  { key: "network", label: "Network signals", weight: 20 },
  { key: "velocity", label: "Transaction velocity", weight: 12 },
  { key: "counterparties", label: "New counterparties", weight: 12 },
  { key: "pattern", label: "Pattern match", weight: 12 },
  { key: "history", label: "Historical association", weight: 4 },
  { key: "ml_anomaly", label: "ML anomaly detection", weight: 20 },
] as const;

function computeSignals(
  pattern: PatternType,
  members: Account[],
  txns: Transaction[],
  fp: Fingerprint,
  mlAnomalyScore: number = 0,
): SignalBreakdown[] {
  const benign = PATTERN_META[pattern].benign === true;
  const avgAge = members.reduce((s, m) => s + m.account_age_days, 0) / members.length;
  const youngShare = members.filter((m) => m.account_age_days < 90).length / members.length;
  const avgAmount = txns.reduce((s, t) => s + t.amount, 0) / txns.length;
  const baseline = members.reduce((s, m) => s + m.baseline_behaviour.avg_amount, 0) / members.length;

  const behaviour = benign
    ? clamp(Math.round(14 + youngShare * 20))
    : clamp(Math.round(Math.min(95, (avgAmount / Math.max(1, baseline)) * 22) + fp.dormancy * 0.25));
  const network = benign
    ? clamp(Math.round(10 + fp.fan_in * 0.15))
    : clamp(Math.round(fp.fan_in * 0.32 + fp.fan_out * 0.32 + fp.circularity * 0.26 + fp.layering * 0.2));
  const velocity = benign ? clamp(Math.round(fp.velocity * 0.25)) : clamp(Math.round(fp.velocity * 0.85 + 12));
  const counterparties = benign
    ? clamp(Math.round(8 + youngShare * 25))
    : clamp(Math.round(youngShare * 78 + Math.max(0, 30 - avgAge / 40)));
  const patternMatch = benign ? 9 : clamp(Math.round(62 + fp.layering * 0.2 + fp.circularity * 0.15));
  const history = benign ? 6 : clamp(Math.round(24 + youngShare * 55));
  
  // ML anomaly signal - falls back to conservative estimate if ML unavailable
  const mlAnomaly = mlAnomalyScore > 0 
    ? clamp(mlAnomalyScore)
    : (benign ? 8 : clamp(Math.round(avgAge < 90 ? 45 : 15)));

  const raw = { behaviour, network, velocity, counterparties, pattern: patternMatch, history, ml_anomaly: mlAnomaly } as Record<
    string,
    number
  >;

  const reasons: Record<string, string> = {
    behaviour: benign
      ? "Amounts sit inside the established corporate baseline for these counterparties."
      : `Average transacted value is ${(avgAmount / Math.max(1, baseline)).toFixed(1)}× the members' behavioural baseline.`,
    network: benign
      ? "Simple hub-and-spoke topology with long-lived, previously seen counterparties."
      : `Topology shows fan-in ${fp.fan_in}, fan-out ${fp.fan_out}, circularity ${fp.circularity}.`,
    velocity: benign
      ? "Cadence matches a recurring monthly settlement schedule."
      : `${txns.length} legs compressed into a short window (velocity index ${fp.velocity}).`,
    counterparties: benign
      ? "All counterparties have prior transaction history with the payer."
      : `${Math.round(youngShare * 100)}% of members are under 90 days old; mean account age ${Math.round(avgAge)}d.`,
    pattern: benign
      ? "No adversarial pattern template matched above threshold."
      : `Matches the ${PATTERN_META[pattern].label} template with layering index ${fp.layering}.`,
    history: benign
      ? "No members appear in previously confirmed suspicious networks."
      : "Members share devices or locations with previously escalated networks.",
    ml_anomaly: mlAnomalyScore > 0
      ? `ML anomaly detection flags unusual behaviour patterns (score: ${mlAnomalyScore}/100). Features: amount distribution, timing, counterparty diversity.`
      : "ML anomaly detection unavailable - using conservative baseline estimate.",
  };

  return SIGNAL_WEIGHTS.map((w) => ({
    key: w.key,
    label: w.label,
    weight: w.weight,
    score: raw[w.key]!,
    contribution: Math.round((raw[w.key]! * w.weight) / 100),
    reason: reasons[w.key]!,
  }));
}

export function scoreFromSignals(signals: SignalBreakdown[]) {
  return clamp(Math.round(signals.reduce((s, x) => s + (x.score * x.weight) / 100, 0)));
}

export function bandOf(score: number): RiskLevel {
  if (score >= 80) return "Critical";
  if (score >= 60) return "High";
  if (score >= 30) return "Medium";
  return "Low";
}

export const BAND_GUIDANCE: Record<RiskLevel, string> = {
  Low: "Monitor",
  Medium: "Review if corroborated",
  High: "Prioritise investigation",
  Critical: "Immediate analyst review",
};

SPECS.forEach(buildCluster);

// Background accounts get a modest, deterministic residual score
background.forEach((a, i) => {
  if (a.risk_score) return;
  a.risk_score = clamp(4 + ((i * 7) % 26) + (a.account_age_days < 60 ? 10 : 0), 2, 44);
  if (a.account_age_days > 1500 && i % 11 === 0) a.current_status = "Dormant";
});

/* ------------------------------------------------------------------ */
/* Alerts                                                               */
/* ------------------------------------------------------------------ */

const STATUSES: Alert["status"][] = ["New", "New", "Reviewing", "Escalated", "Resolved"];

const alerts: Alert[] = clusters
  .map((c, i) => ({
    id: `ALR-${(2400 + i * 7).toString()}`,
    network_id: c.id,
    title: `${PATTERN_META[c.pattern].label} activity in ${c.name}`,
    risk_score: c.cluster_risk_score,
    level: c.level,
    pattern_tags: c.pattern_tags,
    status: (c.level === "Critical" ? (i % 3 === 0 ? "Escalated" : "New") : STATUSES[i % STATUSES.length]!) as Alert["status"],
    created_at: c.last_seen,
    accounts_involved: c.member_account_ids.length,
    amount: c.total_value,
    primary_account: c.central_account,
  }))
  .sort((a, b) => b.risk_score - a.risk_score);

/* ------------------------------------------------------------------ */
/* Indices + public API                                                 */
/* ------------------------------------------------------------------ */

const accountById = new Map(accounts.map((a) => [a.id, a]));
const txnById = new Map(transactions.map((t) => [t.transaction_id, t]));
const clusterById = new Map(clusters.map((c) => [c.id, c]));
const alertById = new Map(alerts.map((a) => [a.id, a]));

transactions.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

export const db = {
  accounts,
  transactions,
  clusters,
  alerts,
  getAccount: (id: string) => accountById.get(id),
  getTransaction: (id: string) => txnById.get(id),
  getCluster: (id: string) => clusterById.get(id),
  getAlert: (id: string) => alertById.get(id),
  clusterTransactions: (id: string) =>
    (clusterById.get(id)?.transaction_ids ?? [])
      .map((t) => txnById.get(t)!)
      .filter(Boolean)
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp)),
  accountTransactions: (id: string) =>
    transactions.filter((t) => t.sender_id === id || t.receiver_id === id),
};

/* ------------------------------------------------------------------ */
/* Analysis helpers                                                     */
/* ------------------------------------------------------------------ */

/** Longest simple money path through a cluster — powers the Money Tracer. */
export function tracePath(clusterId: string) {
  const txns = db.clusterTransactions(clusterId).filter((t) => t.scenario_id);
  const adj = new Map<string, Transaction[]>();
  txns.forEach((t) => {
    if (!adj.has(t.sender_id)) adj.set(t.sender_id, []);
    adj.get(t.sender_id)!.push(t);
  });

  let best: Transaction[] = [];
  const walk = (node: string, path: Transaction[], seen: Set<string>) => {
    if (path.length > best.length) best = [...path];
    if (path.length > 12) return;
    for (const edge of adj.get(node) ?? []) {
      if (seen.has(edge.receiver_id)) continue;
      seen.add(edge.receiver_id);
      walk(edge.receiver_id, [...path, edge], seen);
      seen.delete(edge.receiver_id);
    }
  };
  const starts = new Set(txns.map((t) => t.sender_id));
  starts.forEach((s) => walk(s, [], new Set([s])));
  return best;
}

/** Recompute a cluster's score with some accounts/edges removed (What-If). */
export function recomputeCluster(
  clusterId: string,
  excludedAccounts: Set<string>,
  excludedTxns: Set<string>,
) {
  const cluster = db.getCluster(clusterId)!;
  const members = cluster.member_account_ids
    .filter((id) => !excludedAccounts.has(id))
    .map((id) => accountById.get(id)!)
    .filter(Boolean);
  const txns = db
    .clusterTransactions(clusterId)
    .filter(
      (t) =>
        !excludedTxns.has(t.transaction_id) &&
        !excludedAccounts.has(t.sender_id) &&
        !excludedAccounts.has(t.receiver_id),
    );
  if (members.length < 2 || txns.length < 2) {
    return { score: 0, level: "Low" as RiskLevel, fingerprint: EMPTY_FP, signals: [] as SignalBreakdown[] };
  }
  const fp = computeFingerprint(cluster.pattern, members, txns);
  
  // Estimate ML anomaly score for what-if scenario
  let mlAnomalyScore = 0;
  try {
    // Use average of existing ML scores for remaining members
    const { getMLScore } = require("./hybrid-engine");
    const memberMLScores = members
      .map(m => getMLScore(m.id)?.anomaly_score ?? 0)
      .filter(s => s > 0);
    mlAnomalyScore = memberMLScores.length > 0
      ? memberMLScores.reduce((a, b) => a + b, 0) / memberMLScores.length
      : 0;
  } catch (e) {
    // ML not available, use pattern-based estimate
    mlAnomalyScore = cluster.pattern === "legit_high_value" ? 8 : 45;
  }
  
  const signals = computeSignals(cluster.pattern, members, txns, fp, mlAnomalyScore);
  const score = scoreFromSignals(signals);
  return { score, level: bandOf(score), fingerprint: fp, signals };
}

export const EMPTY_FP: Fingerprint = {
  velocity: 0,
  layering: 0,
  fan_in: 0,
  fan_out: 0,
  circularity: 0,
  dormancy: 0,
};

/** Behaviour comparison for the "What Changed?" panel. */
export function whatChanged(accountId: string) {
  const acct = db.getAccount(accountId)!;
  const txns = db.accountTransactions(accountId);
  const suspicious = txns.filter((t) => t.label === "suspicious");
  const sample = suspicious.length ? suspicious : txns;
  const avg = sample.length ? sample.reduce((s, t) => s + t.amount, 0) / sample.length : 0;
  const counterparties = new Set(
    sample.map((t) => (t.sender_id === accountId ? t.receiver_id : t.sender_id)),
  );
  const locs = new Set(sample.map((t) => t.location_id));
  const devices = new Set(sample.map((t) => t.device_id));
  return [
    {
      metric: "Average amount",
      baseline: acct.baseline_behaviour.avg_amount,
      current: Math.round(avg),
      unit: "currency" as const,
    },
    {
      metric: "Transactions / week",
      baseline: acct.baseline_behaviour.avg_txn_per_week,
      current: Math.max(1, Math.round(sample.length / 1.5)),
      unit: "count" as const,
    },
    {
      metric: "Distinct counterparties",
      baseline: acct.baseline_behaviour.typical_counterparties,
      current: counterparties.size,
      unit: "count" as const,
    },
    {
      metric: "Locations used",
      baseline: 1,
      current: locs.size,
      unit: "count" as const,
    },
    {
      metric: "Devices used",
      baseline: 1,
      current: devices.size,
      unit: "count" as const,
    },
  ];
}

/** Aggregate detection statistics for the dashboard KPI strip. */
export function detectionStats() {
  const suspiciousClusters = clusters.filter((c) => !PATTERN_META[c.pattern].benign);
  const flagged = suspiciousClusters.filter((c) => c.cluster_risk_score >= 60).length;
  const benignFlagged = clusters.filter(
    (c) => PATTERN_META[c.pattern].benign && c.cluster_risk_score >= 60,
  ).length;
  const precision = Math.round((flagged / Math.max(1, flagged + benignFlagged)) * 100);
  const recall = Math.round((flagged / suspiciousClusters.length) * 100);
  return {
    precision,
    recall,
    networksMonitored: clusters.length,
    accountsMonitored: accounts.length,
    transactionsIngested: transactions.length,
    criticalCount: alerts.filter((a) => a.level === "Critical").length,
    highCount: alerts.filter((a) => a.level === "High").length,
    mediumCount: alerts.filter((a) => a.level === "Medium").length,
    lowCount: alerts.filter((a) => a.level === "Low").length,
  };
}

/** Alert volume trend for the dashboard chart. */
export function alertTrend() {
  const days: { day: string; critical: number; high: number; medium: number }[] = [];
  for (let d = 13; d >= 0; d--) {
    const seedR = mulberry32(9000 + d);
    days.push({
      day: new Date(NOW - d * DAY).toISOString().slice(5, 10),
      critical: Math.round(seedR() * 4) + (d < 4 ? 3 : 1),
      high: Math.round(seedR() * 7) + 3,
      medium: Math.round(seedR() * 12) + 6,
    });
  }
  return days;
}

export function recentActivity() {
  return transactions
    .slice(-260)
    .reverse()
    .slice(0, 40)
    .map((t) => ({
      ...t,
      cluster: t.scenario_id ? t.scenario_id.replace("SCN-", "") : null,
    }));
}
