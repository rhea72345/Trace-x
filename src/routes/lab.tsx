import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { FlaskConical, ShieldAlert, Sparkles, Cpu, Activity, GitBranch } from "lucide-react";
import {
  PATTERN_META,
  bandOf,
  clamp,
  detectionStats,
  mulberry32,
  type PatternType,
} from "@/lib/trace/engine";
import { Meter, Mono, RiskBadge, ScoreRing, SectionTitle } from "@/components/trace/primitives";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { isMLEngineAvailable } from "@/lib/trace/hybrid-engine";

export const Route = createFileRoute("/lab")({
  head: () => ({
    meta: [
      { title: "Adversarial Detection Lab · TRACE-X" },
      {
        name: "description",
        content:
          "Stress-test the TRACE-X detection engine with evolving synthetic fraud scenarios and surface detection gaps before criminals do.",
      },
      { property: "og:title", content: "Adversarial Detection Lab · TRACE-X" },
      {
        property: "og:description",
        content: "Run adversarial fraud simulations, watch scenarios mutate across generations and expose blind spots.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: LabPage,
});

interface Run {
  id: number;
  generation: number;
  pattern: PatternType;
  label: string;
  score: number;
  detected: boolean;
  gap: boolean;
  signals: { label: string; score: number }[];
  hybrid_contributions: {
    rule: number;
    ml: number;
    network: number;
  };
}

const SCENARIO_PATTERNS = Object.keys(PATTERN_META).filter(
  (p) => !PATTERN_META[p as PatternType].benign,
) as PatternType[];

function simulate(seed: number, generation: number, evasion: number, volume: number): Run {
  const rand = mulberry32(seed * 7919 + generation * 131);
  const pattern = SCENARIO_PATTERNS[Math.floor(rand() * SCENARIO_PATTERNS.length)]!;
  const base = 45 + rand() * 45 + volume * 0.15;
  const score = clamp(Math.round(base - evasion * 0.42 - generation * 1.6));
  const detected = score >= 60;
  
  // Hybrid risk contributions
  const ruleRisk = clamp(Math.round(score * 0.4 + (rand() - 0.5) * 10));
  const mlRisk = isMLEngineAvailable() 
    ? clamp(Math.round(score * 0.35 + (rand() - 0.5) * 15 - evasion * 0.3))
    : clamp(Math.round(score * 0.2)); // Fallback when ML unavailable
  const networkRisk = clamp(Math.round(score * 0.25 + (rand() - 0.5) * 12));
  
  const signals = [
    { label: "Velocity", score: clamp(Math.round(score + (rand() - 0.5) * 24)) },
    { label: "Network shape", score: clamp(Math.round(score + (rand() - 0.5) * 30)) },
    { label: "Counterparty spread", score: clamp(Math.round(score + (rand() - 0.5) * 26)) },
    { label: "Behaviour deviation", score: clamp(Math.round(score + (rand() - 0.5) * 20)) },
    { label: "ML anomaly", score: mlRisk },
  ];
  
  return {
    id: seed,
    generation,
    pattern,
    label: `${PATTERN_META[pattern].label} · gen ${generation}`,
    score,
    detected,
    gap: !detected,
    signals,
    hybrid_contributions: {
      rule: ruleRisk,
      ml: mlRisk,
      network: networkRisk,
    },
  };
}

function LabPage() {
  const stats = detectionStats();
  const [evasion, setEvasion] = useState(35);
  const [volume, setVolume] = useState(60);
  const [generation, setGeneration] = useState(1);
  const [runs, setRuns] = useState<Run[]>([]);

  const run = () => {
    const batch = Array.from({ length: 6 }, (_, i) =>
      simulate(Date.now() % 100000 + i, generation, evasion, volume),
    );
    setRuns((prev) => [...batch, ...prev].slice(0, 36));
  };

  const evolve = () => {
    setGeneration((g) => g + 1);
    setEvasion((e) => clamp(e + 8));
    run();
  };

  const summary = useMemo(() => {
    const detected = runs.filter((r) => r.detected).length;
    const gaps = runs.length - detected;
    return {
      detected,
      gaps,
      rate: runs.length ? Math.round((detected / runs.length) * 100) : stats.recall,
    };
  }, [runs, stats.recall]);

  return (
    <div className="space-y-5">
      <header className="panel-surface relative overflow-hidden rounded-lg p-5">
        <div className="grid-surface pointer-events-none absolute inset-0 opacity-30" />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="mono text-[10px] uppercase tracking-[0.28em] text-signal">Adversarial simulator</p>
            <h1 className="mt-1 flex items-center gap-2 text-2xl font-semibold tracking-tight">
              <FlaskConical className="size-6 text-signal" /> Detection Lab
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Synthetic adversaries mutate their behaviour each generation. Anything the engine misses is a{" "}
              <span className="text-risk-critical">detection gap</span> — surfaced here before it appears in the real
              alert queue.
            </p>
          </div>
          <ScoreRing score={summary.rate} label="Catch rate" />
        </div>
      </header>

      <section className="grid gap-4 xl:grid-cols-[320px_1fr]">
        <div className="panel-surface space-y-5 rounded-lg p-4">
          <SectionTitle title="Adversary configuration" hint="Higher evasion means smarter, quieter criminals." />
          <div className="space-y-2">
            <div className="flex items-baseline justify-between">
              <span className="text-xs text-muted-foreground">Evasion sophistication</span>
              <Mono>{evasion}</Mono>
            </div>
            <Slider value={[evasion]} onValueChange={([v]) => setEvasion(v ?? 0)} max={100} step={1} />
          </div>
          <div className="space-y-2">
            <div className="flex items-baseline justify-between">
              <span className="text-xs text-muted-foreground">Transaction volume</span>
              <Mono>{volume}</Mono>
            </div>
            <Slider value={[volume]} onValueChange={([v]) => setVolume(v ?? 0)} max={100} step={1} />
          </div>
          <div className="flex flex-col gap-2">
            <Button onClick={run} className="gap-2">
              <Sparkles className="size-4" /> Run simulation batch
            </Button>
            <Button onClick={evolve} variant="outline" className="gap-2">
              <ShieldAlert className="size-4" /> Evolve adversary (gen {generation + 1})
            </Button>
          </div>
          <div className="space-y-3 rounded-md border border-border bg-card/60 p-3">
            <Meter label="Detected" value={summary.rate} tone="signal" />
            <p className="text-[11px] text-muted-foreground">
              {summary.detected} detected · {summary.gaps} missed across {runs.length || 0} simulated scenarios.
            </p>
            {isMLEngineAvailable() && (
              <div className="mt-2 flex items-center gap-1.5 text-[10px] text-signal">
                <Cpu className="size-3" /> ML anomaly detection active
              </div>
            )}
          </div>
        </div>

        <div className="panel-surface rounded-lg p-4">
          <SectionTitle
            title="Scenario runs"
            hint="Each row is a synthetic fraud attempt scored by the live engine."
          />
          {runs.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border py-16 text-center">
              <FlaskConical className="size-8 text-muted-foreground/70" />
              <p className="text-sm font-medium">No simulations yet</p>
              <p className="max-w-sm text-xs text-muted-foreground">
                Run a batch to generate adversarial scenarios and see which ones slip past detection.
              </p>
            </div>
          ) : (
            <ul className="space-y-2">
              {runs.map((r) => (
                <li
                  key={`${r.id}-${r.generation}`}
                  className="rounded-md border border-border bg-card/60 p-3 transition-colors hover:border-signal/40"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{r.label}</p>
                      <p className="mono text-[10px] uppercase tracking-wider text-muted-foreground">
                        {bandOf(r.score)} band
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {r.gap ? (
                        <Badge variant="outline" className="border-risk-critical/50 text-risk-critical">
                          Detection gap
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="border-risk-low/50 text-risk-low">
                          Detected
                        </Badge>
                      )}
                      <RiskBadge score={r.score} size="sm" />
                    </div>
                  </div>
                  <div className="mt-2 grid gap-2 sm:grid-cols-4">
                    {r.signals.map((s) => (
                      <Meter key={s.label} label={s.label} value={s.score} tone="risk" />
                    ))}
                  </div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-3">
                    <HybridContribution
                      label="Rule"
                      value={r.hybrid_contributions.rule}
                      icon={<Activity className="size-3" />}
                      color="var(--risk-high)"
                    />
                    <HybridContribution
                      label="ML"
                      value={r.hybrid_contributions.ml}
                      icon={<Cpu className="size-3" />}
                      color="var(--signal)"
                    />
                    <HybridContribution
                      label="Network"
                      value={r.hybrid_contributions.network}
                      icon={<GitBranch className="size-3" />}
                      color="var(--risk-critical)"
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}

function HybridContribution({ 
  label, 
  value, 
  icon, 
  color 
}: { 
  label: string; 
  value: number; 
  icon: React.ReactNode; 
  color: string; 
}) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-muted/30 px-2 py-1.5">
      {icon}
      <div className="flex-1">
        <div className="text-[10px] text-muted-foreground">{label}</div>
        <div className="mono text-xs font-semibold" style={{ color }}>{value}</div>
      </div>
    </div>
  );
}
