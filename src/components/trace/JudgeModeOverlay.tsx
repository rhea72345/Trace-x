import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Pause, Play, SkipForward, SkipBack, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTrace } from "@/lib/trace/context";
import { JUDGE_MODE_SCRIPT, getDemoNetworkId } from "@/lib/trace/judge-mode";
import { cn } from "@/lib/utils";

const STAGE_LABEL: Record<string, string> = {
  DETECT: "Detect",
  CONNECT: "Connect",
  TRACE: "Trace",
  EXPLAIN: "Explain",
  INVESTIGATE: "Investigate",
  LEARN: "Learn",
  "STRESS-TEST": "Stress-test",
};

/**
 * Self-contained "Judge Mode" walkthrough. Renders its own floating trigger
 * when closed, and a floating control bar + narration caption when open.
 * Mount this once, anywhere inside the router + TraceProvider tree — e.g.
 * a single `<JudgeModeOverlay />` line in __root.tsx. It does not require
 * any changes to the pages it walks through.
 */
export function JudgeModeOverlay() {
  const navigate = useNavigate();
  const { setActiveNetworkId } = useTrace();
  const demoNetworkId = useMemo(() => getDemoNetworkId(), []);

  const [active, setActive] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const timerRef = useRef<number | null>(null);

  const step = JUDGE_MODE_SCRIPT[stepIndex];
  const isLast = stepIndex === JUDGE_MODE_SCRIPT.length - 1;

  const goToStep = (index: number) => {
    const clamped = Math.max(0, Math.min(JUDGE_MODE_SCRIPT.length - 1, index));
    setStepIndex(clamped);
  };

  const start = () => {
    setStepIndex(0);
    setPlaying(true);
    setActive(true);
  };

  const exit = () => {
    setActive(false);
    setPlaying(false);
    if (timerRef.current) window.clearTimeout(timerRef.current);
  };

  // Apply the current step: navigate, and sync the shared network context
  // so Network / Explain / Tracer / AI all stay on the same demo story.
  useEffect(() => {
    if (!active || !step) return;
    if (step.focusDemoNetwork && demoNetworkId) setActiveNetworkId(demoNetworkId);
    void navigate({ to: step.route });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, stepIndex]);

  // Auto-advance while playing.
  useEffect(() => {
    if (!active || !playing || !step) return;
    if (isLast) {
      setPlaying(false);
      return;
    }
    timerRef.current = window.setTimeout(() => goToStep(stepIndex + 1), step.durationMs);
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, [active, playing, stepIndex]);

  if (!active) {
    return (
      <div className="fixed bottom-5 right-5 z-[100]">
        <Button onClick={start} className="gap-2 shadow-lg">
          <Sparkles className="size-3.5" /> Judge Mode
        </Button>
      </div>
    );
  }

  if (!step) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-[100] flex justify-center px-4 pb-4">
      <div className="pointer-events-auto w-full max-w-2xl rounded-lg border border-signal/30 bg-background/95 p-4 shadow-2xl backdrop-blur">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="mono rounded border border-signal/40 bg-signal/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-signal">
              {STAGE_LABEL[step.stage] ?? step.stage}
            </span>
            <p className="text-xs font-semibold">{step.title}</p>
          </div>
          <Button variant="ghost" size="sm" onClick={exit} aria-label="Exit Judge Mode">
            <X className="size-3.5" />
          </Button>
        </div>

        <p className="mt-2 text-sm leading-relaxed text-foreground/90">{step.narration}</p>

        <div className="mt-3 flex items-center justify-between gap-3">
          <div className="flex gap-1">
            {JUDGE_MODE_SCRIPT.map((s, i) => (
              <span
                key={s.id}
                className={cn(
                  "h-1 w-5 rounded-full transition-colors",
                  i === stepIndex ? "bg-signal" : i < stepIndex ? "bg-signal/40" : "bg-border",
                )}
              />
            ))}
          </div>
          <div className="flex items-center gap-1.5">
            <Button variant="outline" size="sm" onClick={() => goToStep(stepIndex - 1)} disabled={stepIndex === 0}>
              <SkipBack className="size-3.5" />
            </Button>
            <Button variant="outline" size="sm" onClick={() => setPlaying((p) => !p)}>
              {playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
            </Button>
            <Button variant="outline" size="sm" onClick={() => goToStep(stepIndex + 1)} disabled={isLast}>
              <SkipForward className="size-3.5" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
