import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  Bot,
  CornerDownLeft,
  GitBranch,
  Route as RouteIcon,
  Sparkles,
  User,
} from "lucide-react";
import {
  BAND_GUIDANCE,
  PATTERN_META,
  bandOf,
  db,
  detectionStats,
  tracePath,
  whatChanged,
  type Account,
  type NetworkCluster,
  type PatternType,
} from "@/lib/trace/engine";
import { compactCurrency, currency, dateTime, relative } from "@/lib/trace/format";
import { Mono, PatternBadge, RiskBadge, SectionTitle } from "@/components/trace/primitives";
import { useTrace } from "@/lib/trace/context";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { processAIQuery, initializeAIAssistant, type AIResponse } from "@/lib/trace/ai-assistant";

export const Route = createFileRoute("/ai")({
  head: () => ({
    meta: [
      { title: "AI Investigation — TRACE-X" },
      { name: "description", content: "AI-assisted investigation workspace for asking questions across TRACE-X evidence and suspicious networks." },
      { property: "og:title", content: "AI Investigation — TRACE-X" },
      { property: "og:description", content: "AI-assisted investigation workspace for TRACE-X analysts." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AIInvestigationPage,
});

/* ------------------------------------------------------------------ */
/* Evidence citations                                                   */
/* ------------------------------------------------------------------ */

type Citation =
  | { kind: "account"; id: string }
  | { kind: "cluster"; id: string }
  | { kind: "alert"; id: string }
  | { kind: "transaction"; id: string };

interface AssistantAnswer {
  text: string;
  citations: Citation[];
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  citations?: string[];
  at: string;
}

/* ------------------------------------------------------------------ */
/* Deterministic, evidence-grounded query engine                        */
/* ------------------------------------------------------------------ */

const PATTERN_KEYWORDS: Array<[PatternType, RegExp]> = [
  ["mule_chain", /mule/i],
  ["fan_in", /fan[\s-]?in/i],
  ["fan_out", /fan[\s-]?out/i],
  ["circular", /circular|circle/i],
  ["rapid_layering", /layer(ing)?/i],
  ["dormant_sync", /dormant/i],
  ["bridge_account", /bridge/i],
  ["legit_high_value", /legit|benign|control/i],
];

function extractIds(query: string) {
  const upper = query.toUpperCase();
  const account = [...new Set(upper.match(/ACC-[A-Z0-9]{4,6}/g) ?? [])];
  const cluster = [...new Set(upper.match(/NET-\d{2,4}/g) ?? [])];
  const alert = [...new Set(upper.match(/ALR-\d{2,5}/g) ?? [])];
  const transaction = [...new Set(upper.match(/TXN-[A-Z0-9]{3,8}/g) ?? [])];
  return { account, cluster, alert, transaction };
}

function resolveCluster(ids: ReturnType<typeof extractIds>, fallbackNetworkId: string): NetworkCluster | undefined {
  if (ids.cluster[0]) return db.getCluster(ids.cluster[0]);
  if (ids.alert[0]) {
    const alert = db.getAlert(ids.alert[0]);
    if (alert) return db.getCluster(alert.network_id);
  }
  if (ids.account[0]) {
    const acct = db.getAccount(ids.account[0]);
    if (acct?.cluster_id) return db.getCluster(acct.cluster_id);
  }
  return db.getCluster(fallbackNetworkId);
}

function explainCluster(cluster: NetworkCluster): AssistantAnswer {
  const meta = PATTERN_META[cluster.pattern];
  const top = [...cluster.signals].sort((a, b) => b.contribution - a.contribution).slice(0, 3);
  const text = [
    `${cluster.name} (${cluster.id}) is scored ${cluster.cluster_risk_score}/100 — ${cluster.level} band. It matches the ${meta.label} template across ${cluster.member_account_ids.length} accounts and ${cluster.transaction_ids.length} transactions worth ${compactCurrency(cluster.total_value)}.`,
    `The score is driven mainly by ${top.map((s) => `${s.label.toLowerCase()} (+${s.contribution})`).join(", ")}. ${top[0]?.reason ?? ""}`,
    `Recommended action for this band: ${BAND_GUIDANCE[cluster.level].toLowerCase()}.`,
  ].join(" ");
  const citations: Citation[] = [
    { kind: "cluster", id: cluster.id },
    { kind: "account", id: cluster.central_account },
    ...cluster.mule_accounts.slice(0, 2).map((id) => ({ kind: "account", id }) as Citation),
  ];
  return { text, citations };
}

function traceMoney(cluster: NetworkCluster): AssistantAnswer {
  const path = tracePath(cluster.id);
  if (path.length === 0) {
    return {
      text: `No connected multi-hop money path was reconstructed for ${cluster.name} (${cluster.id}) — its transactions don't chain sender-to-receiver into a single trail.`,
      citations: [{ kind: "cluster", id: cluster.id }],
    };
  }
  const hops = [path[0]!.sender_id, ...path.map((t) => t.receiver_id)];
  const total = path.reduce((s, t) => s + t.amount, 0);
  const text = `Longest reconstructed money trail through ${cluster.name} (${cluster.id}) has ${path.length} hops moving ${currency(total)}: ${hops.join(" → ")}. It starts at ${dateTime(path[0]!.timestamp)} and ends at ${dateTime(path[path.length - 1]!.timestamp)}.`;
  const citations: Citation[] = [
    { kind: "cluster", id: cluster.id },
    ...hops.slice(0, 5).map((id) => ({ kind: "account", id }) as Citation),
    ...path.slice(0, 3).map((t) => ({ kind: "transaction", id: t.transaction_id }) as Citation),
  ];
  return { text, citations };
}

function accountProfile(acct: Account): AssistantAnswer {
  const cluster = acct.cluster_id ? db.getCluster(acct.cluster_id) : undefined;
  const parts = [
    `${acct.id} (${acct.holder}) is ${acct.account_age_days}d old, currently ${acct.current_status}, scored ${acct.risk_score}/100 (${bandOf(acct.risk_score)}). Role tag: ${acct.role_tag}.`,
  ];
  if (cluster) {
    parts.push(`It sits in ${cluster.name} (${cluster.id}), a ${PATTERN_META[cluster.pattern].label} network scored ${cluster.cluster_risk_score}/100.`);
  } else {
    parts.push("It is not currently attached to any flagged network.");
  }
  return {
    text: parts.join(" "),
    citations: [{ kind: "account", id: acct.id }, ...(cluster ? [{ kind: "cluster", id: cluster.id } as Citation] : [])],
  };
}

function accountChanged(acct: Account): AssistantAnswer {
  const rows = whatChanged(acct.id);
  const deviated = rows.filter((r) => r.baseline > 0 && r.current > r.baseline * 1.4);
  const text = deviated.length
    ? `${acct.id} has drifted from its own baseline on ${deviated.length} metric${deviated.length > 1 ? "s" : ""}: ${deviated
        .map((r) => `${r.metric.toLowerCase()} ${r.unit === "currency" ? currency(r.baseline) : r.baseline} → ${r.unit === "currency" ? currency(r.current) : r.current}`)
        .join("; ")}.`
    : `${acct.id}'s recent activity stays close to its established baseline across amount, frequency, counterparties, locations and devices.`;
  return { text, citations: [{ kind: "account", id: acct.id }] };
}

function topRisk(): AssistantAnswer {
  const top = [...db.clusters].sort((a, b) => b.cluster_risk_score - a.cluster_risk_score).slice(0, 5);
  const text = `Highest-scoring networks right now: ${top
    .map((c) => `${c.name} (${c.id}) — ${c.cluster_risk_score}/100 ${c.level}`)
    .join("; ")}.`;
  return { text, citations: top.map((c) => ({ kind: "cluster", id: c.id }) as Citation) };
}

function patternLookup(pattern: PatternType): AssistantAnswer {
  const matches = db.clusters.filter((c) => c.pattern_tags.includes(pattern)).sort((a, b) => b.cluster_risk_score - a.cluster_risk_score);
  const meta = PATTERN_META[pattern];
  if (matches.length === 0) {
    return { text: `No networks currently carry the ${meta.label} tag.`, citations: [] };
  }
  const text = `${matches.length} network${matches.length > 1 ? "s" : ""} tagged ${meta.label} — ${meta.description} Top match: ${matches[0]!.name} (${matches[0]!.id}) at ${matches[0]!.cluster_risk_score}/100.`;
  return { text, citations: matches.slice(0, 5).map((c) => ({ kind: "cluster", id: c.id }) as Citation) };
}

function alertQueueSummary(): AssistantAnswer {
  const stats = detectionStats();
  const escalated = db.alerts.filter((a) => a.status === "Escalated").slice(0, 3);
  const text = `Alert queue: ${stats.criticalCount} Critical, ${stats.highCount} High, ${stats.mediumCount} Medium, ${stats.lowCount} Low across ${db.alerts.length} alerts. Detection engine is running at ${stats.precision}% precision / ${stats.recall}% recall on the synthetic corpus.${escalated.length ? ` Currently escalated: ${escalated.map((a) => `${a.title} (${a.id})`).join(", ")}.` : ""}`;
  return { text, citations: escalated.map((a) => ({ kind: "alert", id: a.id }) as Citation) };
}

function compareAccounts(idA: string, idB: string): AssistantAnswer | null {
  const a = db.getAccount(idA);
  const b = db.getAccount(idB);
  if (!a || !b) return null;
  const higher = a.risk_score >= b.risk_score ? a : b;
  const text = `${a.id} scores ${a.risk_score}/100 (${bandOf(a.risk_score)}, ${a.current_status}) vs ${b.id} at ${b.risk_score}/100 (${bandOf(b.risk_score)}, ${b.current_status}). ${higher.id} carries the higher risk here${higher.cluster_id ? `, tied to network ${higher.cluster_id}` : ""}.`;
  return {
    text,
    citations: [
      { kind: "account", id: a.id },
      { kind: "account", id: b.id },
    ],
  };
}

function helpAnswer(): AssistantAnswer {
  return {
    text: "I can answer questions grounded in the current detection data. Try: \"why is NET-002 suspicious\", \"trace the money in the highest-risk network\", \"what changed for ACC-1A2B3\", \"compare ACC-1A2B3 and ACC-1A2B4\", \"show fan-out networks\", or \"summarise the alert queue\".",
    citations: [],
  };
}

function answerQuery(raw: string, activeNetworkId: string): AssistantAnswer {
  const query = raw.trim();
  if (!query) return helpAnswer();
  const ids = extractIds(query);
  const lower = query.toLowerCase();

  if (ids.account.length >= 2 && /compare|vs\.?|versus|differ/.test(lower)) {
    const result = compareAccounts(ids.account[0]!, ids.account[1]!);
    if (result) return result;
  }

  if (/what changed|deviat|baseline|behaviour|behavior/.test(lower) && ids.account[0]) {
    const acct = db.getAccount(ids.account[0]!);
    if (acct) return accountChanged(acct);
  }

  if (/trace|money path|follow the money|flow of funds/.test(lower)) {
    const cluster = resolveCluster(ids, activeNetworkId);
    if (cluster) return traceMoney(cluster);
  }

  if (/top|highest|riskiest|worst/.test(lower) && /network|cluster/.test(lower)) {
    return topRisk();
  }

  if (/summar|alert queue|how many alerts|overview/.test(lower)) {
    return alertQueueSummary();
  }

  for (const [pattern, re] of PATTERN_KEYWORDS) {
    if (re.test(lower) && /pattern|network|show|list|which/.test(lower)) {
      return patternLookup(pattern);
    }
  }

  if (ids.account[0] && !/why|suspicious|flag/.test(lower)) {
    const acct = db.getAccount(ids.account[0]!);
    if (acct) return accountProfile(acct);
  }

  if (/why|suspicious|flag|explain|risk/.test(lower)) {
    const cluster = resolveCluster(ids, activeNetworkId);
    if (cluster) return explainCluster(cluster);
  }

  if (ids.cluster[0] || ids.alert[0]) {
    const cluster = resolveCluster(ids, activeNetworkId);
    if (cluster) return explainCluster(cluster);
  }

  return helpAnswer();
}

/* ------------------------------------------------------------------ */
/* UI                                                                    */
/* ------------------------------------------------------------------ */

const QUICK_PROMPTS = [
  "Why is this network suspicious?",
  "Trace the money in this network",
  "Show the riskiest networks right now",
  "Summarise the alert queue",
];

function CitationChips({ citations }: { citations: string[] }) {
  const { setActiveNetworkId } = useTrace();
  const navigate = useNavigate();
  if (citations.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Evidence</span>
      {citations.map((id, i) => {
        // Determine type based on ID prefix
        if (id.startsWith("ACC-")) {
          return (
            <Link
              key={`${id}-${i}`}
              to="/accounts/$accountId"
              params={{ accountId: id }}
              className="mono rounded border border-signal/30 bg-signal/10 px-1.5 py-0.5 text-[10px] text-signal hover:underline"
            >
              {id}
            </Link>
          );
        }
        if (id.startsWith("NET-")) {
          return (
            <button
              key={`${id}-${i}`}
              onClick={() => {
                setActiveNetworkId(id);
                void navigate({ to: "/network" });
              }}
              className="mono rounded border border-signal/30 bg-signal/10 px-1.5 py-0.5 text-[10px] text-signal hover:underline"
            >
              {id}
            </button>
          );
        }
        if (id.startsWith("ALR-")) {
          return (
            <Link
              key={`${id}-${i}`}
              to="/alerts"
              className="mono rounded border border-border bg-muted/40 px-1.5 py-0.5 text-[10px] text-muted-foreground hover:underline"
            >
              {id}
            </Link>
          );
        }
        return (
          <span
            key={`${id}-${i}`}
            className="mono rounded border border-border bg-muted/40 px-1.5 py-0.5 text-[10px] text-muted-foreground"
          >
            {id}
          </span>
        );
      })}
    </div>
  );
}

function AIInvestigationPage() {
  const { activeNetworkId } = useTrace();
  const activeCluster = db.getCluster(activeNetworkId);
  const [messages, setMessages] = useState<ChatMessage[]>(() => [
    {
      id: "welcome",
      role: "assistant",
      text: `I'm ready to help investigate ${activeCluster ? `${activeCluster.name} (${activeCluster.id})` : "the current caseload"}. Ask about why a network was flagged, trace money movement, compare accounts, or get an alert queue overview — every answer cites the accounts, transactions and networks it's grounded in.`,
      at: new Date().toISOString(),
    },
  ]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Initialize AI assistant on mount
  useEffect(() => {
    initializeAIAssistant();
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, thinking]);

  const send = async (text: string) => {
    const query = text.trim();
    if (!query || thinking) return;
    const userMsg: ChatMessage = { id: crypto.randomUUID(), role: "user", text: query, at: new Date().toISOString() };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setThinking(true);
    
    try {
      // Try AI assistant with LLM support
      const aiResponse: AIResponse = await processAIQuery(query, activeNetworkId);
      
      const assistantMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        text: aiResponse.text,
        citations: aiResponse.citations,
        at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch (error) {
      // Use deterministic engine
      const result = answerQuery(query, activeNetworkId);
      const assistantMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        text: result.text,
        citations: result.citations.map(c => c.id),
        at: new Date().toISOString(),
        used_llm: false,
        confidence: 0.6,
      };
      setMessages((prev) => [...prev, assistantMsg]);
    }
    
    setThinking(false);
  };

  const recentClusters = useMemo(
    () => [...db.clusters].sort((a, b) => b.cluster_risk_score - a.cluster_risk_score).slice(0, 4),
    [],
  );

  return (
    <div className="space-y-5">
      <header className="panel-surface relative overflow-hidden rounded-lg p-5">
        <div className="grid-surface pointer-events-none absolute inset-0 opacity-30" />
        <div className="relative">
          <p className="mono text-[10px] uppercase tracking-[0.28em] text-signal">Explain / assisted reasoning</p>
          <h1 className="mt-1 flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Bot className="size-6 text-signal" /> AI Investigation
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Ask focused questions about networks, transactions and evidence without leaving the investigation cockpit.
            Every answer is grounded in detection data with traceable citations.
          </p>
        </div>
      </header>

      <div className="grid gap-4 xl:grid-cols-[1fr_300px]">
        <section className="panel-surface flex h-[600px] flex-col overflow-hidden rounded-lg">
          <div className="border-b border-border px-4 py-3">
            <SectionTitle title="Investigation chat" hint="Answers are grounded in detection data — every claim links back to real evidence." />
          </div>
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4">
            <div className="space-y-4 py-4">
              {messages.map((m) => (
                <div key={m.id} className={cn("flex gap-2.5", m.role === "user" && "flex-row-reverse")}>
                  <div
                    className={cn(
                      "flex size-7 shrink-0 items-center justify-center rounded-md border",
                      m.role === "assistant" ? "border-signal/30 bg-signal/10 text-signal" : "border-border bg-muted text-muted-foreground",
                    )}
                  >
                    {m.role === "assistant" ? <Bot className="size-3.5" /> : <User className="size-3.5" />}
                  </div>
                  <div className={cn("max-w-[85%] rounded-lg border px-3 py-2", m.role === "assistant" ? "border-border bg-panel/50" : "border-signal/30 bg-signal/10")}>
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-xs leading-relaxed">{m.text}</p>
                    </div>
                    {m.citations && <CitationChips citations={m.citations} />}
                    <div className="mt-1.5 flex items-center justify-between">
                      <p className="text-[10px] text-muted-foreground">{relative(m.at)}</p>
                      {m.confidence !== undefined && (
                        <p className="text-[10px] text-muted-foreground">Confidence: {Math.round(m.confidence * 100)}%</p>
                      )}
                    </div>
                  </div>
                </div>
              ))}
              {thinking && (
                <div className="flex items-center gap-2.5">
                  <div className="flex size-7 shrink-0 items-center justify-center rounded-md border border-signal/30 bg-signal/10 text-signal">
                    <Bot className="size-3.5" />
                  </div>
                  <div className="rounded-lg border border-border bg-panel/50 px-3 py-2">
                    <p className="mono text-xs text-muted-foreground">analysing evidence…</p>
                  </div>
                </div>
              )}
            </div>
          </div>
          <div className="border-t border-border p-3">
            <div className="mb-2 flex flex-wrap gap-1.5">
              {QUICK_PROMPTS.map((p) => (
                <button
                  key={p}
                  onClick={() => send(p)}
                  className="rounded-full border border-border bg-muted/40 px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:border-signal/40 hover:text-signal"
                >
                  {p}
                </button>
              ))}
            </div>
            <form
              className="flex items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                send(input);
              }}
            >
              <Textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send(input);
                  }
                }}
                placeholder="Ask about a network, account or transaction… (e.g. why is NET-002 suspicious?)"
                className="min-h-[44px] flex-1 resize-none text-sm"
              />
              <Button type="submit" size="sm" disabled={thinking || !input.trim()}>
                <CornerDownLeft className="size-3.5" /> Ask
              </Button>
            </form>
          </div>
        </section>

        <aside className="space-y-4">
          <div className="panel-surface rounded-lg p-4">
            <SectionTitle title="Active context" hint="Questions default to this network when none is named." />
            {activeCluster ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <Mono>{activeCluster.id}</Mono>
                  <RiskBadge score={activeCluster.cluster_risk_score} size="sm" />
                </div>
                <p className="truncate text-xs font-medium">{activeCluster.name}</p>
                <div className="flex flex-wrap gap-1">
                  {activeCluster.pattern_tags.map((p) => (
                    <PatternBadge key={p} pattern={p} size="sm" />
                  ))}
                </div>
                <div className="flex gap-2 pt-1">
                  <Button size="sm" variant="secondary" asChild>
                    <Link to="/network"><GitBranch className="mr-1 size-3.5" /> Graph</Link>
                  </Button>
                  <Button size="sm" variant="secondary" asChild>
                    <Link to="/tracer"><RouteIcon className="mr-1 size-3.5" /> Tracer</Link>
                  </Button>
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">No active network selected.</p>
            )}
          </div>

          <div className="panel-surface rounded-lg p-4">
            <SectionTitle title="Highest-risk networks" hint="Ask about any of these by name or ID." />
            <div className="space-y-2">
              {recentClusters.map((c) => (
                <button
                  key={c.id}
                  onClick={() => send(`Why is ${c.id} suspicious?`)}
                  className="flex w-full items-center justify-between gap-2 rounded-md border border-border/70 px-2.5 py-1.5 text-left hover:bg-accent"
                >
                  <div className="min-w-0">
                    <p className="truncate text-[11px] font-medium">{c.name}</p>
                    <Mono className="text-[10px]">{c.id}</Mono>
                  </div>
                  <RiskBadge score={c.cluster_risk_score} size="sm" />
                </button>
              ))}
            </div>
          </div>

          <div className="panel-surface flex items-start gap-2 rounded-lg p-4">
            <Sparkles className="mt-0.5 size-4 shrink-0 text-signal" />
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              AI supports investigation — every answer is traceable to underlying data. Final decisions are made by authorised analysts.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
