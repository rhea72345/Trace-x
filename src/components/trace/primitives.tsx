import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { BAND_GUIDANCE, PATTERN_META, bandOf, type PatternType, type RiskLevel, type FraudTypology } from "@/lib/trace/engine";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export const RISK_CLASSES: Record<RiskLevel, { text: string; bg: string; border: string; dot: string }> = {
  Low: {
    text: "text-risk-low",
    bg: "bg-risk-low/10",
    border: "border-risk-low/35",
    dot: "bg-risk-low",
  },
  Medium: {
    text: "text-risk-medium",
    bg: "bg-risk-medium/10",
    border: "border-risk-medium/35",
    dot: "bg-risk-medium",
  },
  High: {
    text: "text-risk-high",
    bg: "bg-risk-high/10",
    border: "border-risk-high/35",
    dot: "bg-risk-high",
  },
  Critical: {
    text: "text-risk-critical",
    bg: "bg-risk-critical/12",
    border: "border-risk-critical/45",
    dot: "bg-risk-critical",
  },
};

export function RiskBadge({
  score,
  level,
  size = "md",
  showScore = true,
  pulse = false,
}: {
  score?: number;
  level?: RiskLevel;
  size?: "sm" | "md";
  showScore?: boolean;
  pulse?: boolean;
}) {
  const band = level ?? bandOf(score ?? 0);
  const c = RISK_CLASSES[band];
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md border font-medium",
            c.text,
            c.bg,
            c.border,
            size === "sm" ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-0.5 text-xs",
          )}
        >
          <span className={cn("size-1.5 rounded-full", c.dot, pulse && band === "Critical" && "animate-risk-pulse")} />
          {band}
          {showScore && score !== undefined && <span className="mono opacity-80">{score}</span>}
        </span>
      </TooltipTrigger>
      <TooltipContent>
        {band} band — {BAND_GUIDANCE[band]}
      </TooltipContent>
    </Tooltip>
  );
}

export function PatternBadge({ pattern, size = "md" }: { pattern: PatternType; size?: "sm" | "md" }) {
  const meta = PATTERN_META[pattern];
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            "mono inline-flex items-center rounded border uppercase tracking-wider",
            meta.benign
              ? "border-risk-low/30 bg-risk-low/10 text-risk-low"
              : "border-signal/30 bg-signal/10 text-signal",
            size === "sm" ? "px-1.5 py-px text-[9px]" : "px-1.5 py-0.5 text-[10px]",
          )}
        >
          {meta.short}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">
        <p className="font-medium">{meta.label}</p>
        <p className="text-muted-foreground">{meta.description}</p>
      </TooltipContent>
    </Tooltip>
  );
}

export function TypologyBadge({ typology, size = "md" }: { typology: FraudTypology; size?: "sm" | "md" }) {
  const isAnomalous = typology === "Anomalous pattern";
  const descriptions: Record<FraudTypology, string> = {
    "Structuring": "Multiple transactions just under reporting thresholds",
    "Mule account layering": "Rapid pass-through of funds through intermediary accounts",
    "Circular transaction ring": "Funds cycle back to origin through intermediaries",
    "Smurfing": "Funds split across many small transfers to avoid detection",
    "Anomalous pattern": "Unusual activity not matching specific typology patterns",
  };
  
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            "inline-flex items-center rounded border font-medium",
            isAnomalous
              ? "border-muted-foreground/30 bg-muted/40 text-muted-foreground"
              : "border-signal/30 bg-signal/10 text-signal",
            size === "sm" ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-0.5 text-xs",
          )}
        >
          {typology}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">
        <p className="font-medium">{typology}</p>
        <p className="text-muted-foreground">{descriptions[typology]}</p>
      </TooltipContent>
    </Tooltip>
  );
}

export function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    New: "border-signal/40 bg-signal/10 text-signal",
    Reviewing: "border-risk-medium/40 bg-risk-medium/10 text-risk-medium",
    Escalated: "border-risk-critical/40 bg-risk-critical/10 text-risk-critical",
    Resolved: "border-risk-low/40 bg-risk-low/10 text-risk-low",
    Open: "border-signal/40 bg-signal/10 text-signal",
    Investigating: "border-risk-medium/40 bg-risk-medium/10 text-risk-medium",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium",
        map[status] ?? "border-border bg-muted text-muted-foreground",
      )}
    >
      {status}
    </span>
  );
}

/** Count-up number used for risk scores and KPIs. */
export function CountUp({
  value,
  duration = 700,
  className,
  decimals = 0,
  suffix = "",
}: {
  value: number;
  duration?: number;
  className?: string;
  decimals?: number;
  suffix?: string;
}) {
  const [display, setDisplay] = useState(0);
  const from = useRef(0);

  useEffect(() => {
    const start = performance.now();
    const initial = from.current;
    let frame = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setDisplay(initial + (value - initial) * eased);
      if (p < 1) frame = requestAnimationFrame(tick);
      else from.current = value;
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, duration]);

  return (
    <span className={className}>
      {display.toFixed(decimals)}
      {suffix}
    </span>
  );
}

/** Circular risk gauge. */
export function ScoreRing({ score, size = 132, label }: { score: number; size?: number; label?: string }) {
  const band = bandOf(score);
  const r = size / 2 - 10;
  const circ = 2 * Math.PI * r;
  const colorVar = {
    Low: "var(--risk-low)",
    Medium: "var(--risk-medium)",
    High: "var(--risk-high)",
    Critical: "var(--risk-critical)",
  }[band];

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--border)" strokeWidth={8} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={colorVar}
          strokeWidth={8}
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={circ - (circ * score) / 100}
          style={{ transition: "stroke-dashoffset 800ms cubic-bezier(0.22,1,0.36,1)" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <CountUp value={score} className="mono text-3xl font-semibold" />
        <span className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
          {label ?? band}
        </span>
      </div>
    </div>
  );
}

/** Horizontal meter used across fingerprints and signal breakdowns. */
export function Meter({
  label,
  value,
  hint,
  tone = "signal",
}: {
  label: string;
  value: number;
  hint?: string;
  tone?: "signal" | "risk";
}) {
  const band = bandOf(value);
  const color =
    tone === "risk"
      ? { Low: "bg-risk-low", Medium: "bg-risk-medium", High: "bg-risk-high", Critical: "bg-risk-critical" }[band]
      : "bg-signal";
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className="mono text-xs font-medium">{value}</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={cn("h-full rounded-full transition-all duration-700", color)}
          style={{ width: `${Math.max(2, value)}%` }}
        />
      </div>
      {hint && <p className="text-[11px] leading-snug text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function SectionTitle({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-3 flex items-end justify-between gap-4">
      <div>
        <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      {action}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border px-6 py-14 text-center">
      {icon && <div className="text-muted-foreground/70">{icon}</div>}
      <div>
        <p className="text-sm font-medium">{title}</p>
        {description && <p className="mt-1 max-w-sm text-xs text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function Mono({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn("mono text-xs text-foreground/80", className)}>{children}</span>;
}
