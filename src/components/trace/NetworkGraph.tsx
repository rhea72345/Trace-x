import { useMemo, useRef, useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { db, bandOf, mulberry32, type Transaction } from "@/lib/trace/engine";
import { compactCurrency } from "@/lib/trace/format";

interface Node {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  risk: number;
  degree: number;
  role: string;
}

interface Edge {
  id: string;
  source: string;
  target: string;
  amount: number;
  t: number;
  txn: Transaction;
}

const RISK_STROKE: Record<string, string> = {
  Low: "var(--risk-low)",
  Medium: "var(--risk-medium)",
  High: "var(--risk-high)",
  Critical: "var(--risk-critical)",
};

/** Deterministic force-directed layout (no external sim dependency). */
function layout(nodes: Node[], edges: Edge[], width: number, height: number) {
  const iterations = 320;
  const k = Math.sqrt((width * height) / Math.max(1, nodes.length)) * 0.62;
  const index = new Map(nodes.map((n) => [n.id, n]));

  for (let i = 0; i < iterations; i++) {
    const cooling = 1 - i / iterations;
    for (const a of nodes) {
      let fx = 0;
      let fy = 0;
      for (const b of nodes) {
        if (a === b) continue;
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 1) {
          dx = (a.x % 7) - 3.5 || 1;
          dy = (a.y % 5) - 2.5 || 1;
          d2 = 10;
        }
        const rep = (k * k) / d2;
        fx += dx * rep;
        fy += dy * rep;
      }
      // gentle pull to centre
      fx += (width / 2 - a.x) * 0.012;
      fy += (height / 2 - a.y) * 0.012;
      a.vx = fx;
      a.vy = fy;
    }
    for (const e of edges) {
      const s = index.get(e.source);
      const t = index.get(e.target);
      if (!s || !t) continue;
      const dx = t.x - s.x;
      const dy = t.y - s.y;
      const d = Math.max(1, Math.hypot(dx, dy));
      const attr = (d * d) / k / 12;
      const ux = (dx / d) * attr;
      const uy = (dy / d) * attr;
      s.vx += ux;
      s.vy += uy;
      t.vx -= ux;
      t.vy -= uy;
    }
    for (const n of nodes) {
      const speed = Math.hypot(n.vx, n.vy);
      const max = 22 * cooling + 1;
      const scale = speed > max ? max / speed : 1;
      n.x = Math.max(38, Math.min(width - 38, n.x + n.vx * scale * 0.12));
      n.y = Math.max(38, Math.min(height - 38, n.y + n.vy * scale * 0.12));
    }
  }
}

export function NetworkGraph({
  clusterId,
  selected,
  onSelect,
  onEdgeSelect,
  excludedAccounts = new Set<string>(),
  excludedTxns = new Set<string>(),
  storyCursor = null,
  minAmount = 0,
  amountCeiling = Number.POSITIVE_INFINITY,
  className,
  height = 560,
}: {
  clusterId: string;
  selected?: string | null;
  onSelect?: (id: string) => void;
  onEdgeSelect?: (txn: Transaction) => void;
  excludedAccounts?: Set<string>;
  excludedTxns?: Set<string>;
  /** 0..1 chronological reveal for Fraud Story Mode; null = show everything */
  storyCursor?: number | null;
  minAmount?: number;
  amountCeiling?: number;
  className?: string;
  height?: number;
}) {

  const width = 980;
  const [hover, setHover] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const { nodes, edges } = useMemo(() => {
    const cluster = db.getCluster(clusterId);
    if (!cluster) return { nodes: [] as Node[], edges: [] as Edge[] };
    const txns = db.clusterTransactions(clusterId);
    const members = new Set(cluster.member_account_ids);
    const rel = txns.filter((t) => members.has(t.sender_id) || members.has(t.receiver_id));

    const ids = new Set<string>();
    rel.forEach((t) => {
      ids.add(t.sender_id);
      ids.add(t.receiver_id);
    });

    const r = mulberry32(parseInt(clusterId.replace(/\D/g, ""), 10) * 977 + 13);
    const degree = new Map<string, number>();
    rel.forEach((t) => {
      degree.set(t.sender_id, (degree.get(t.sender_id) ?? 0) + 1);
      degree.set(t.receiver_id, (degree.get(t.receiver_id) ?? 0) + 1);
    });

    const ns: Node[] = [...ids].map((id) => {
      const acct = db.getAccount(id);
      return {
        id,
        x: width / 2 + (r() - 0.5) * width * 0.7,
        y: height / 2 + (r() - 0.5) * height * 0.7,
        vx: 0,
        vy: 0,
        risk: acct?.risk_score ?? 10,
        degree: degree.get(id) ?? 1,
        role: acct?.role_tag ?? "External",
      };
    });

    const times = rel.map((t) => new Date(t.timestamp).getTime());
    const min = Math.min(...times);
    const max = Math.max(...times);
    const es: Edge[] = rel.map((t) => ({
      id: t.transaction_id,
      source: t.sender_id,
      target: t.receiver_id,
      amount: t.amount,
      t: max === min ? 1 : (new Date(t.timestamp).getTime() - min) / (max - min),
      txn: t,
    }));

    layout(ns, es, width, height);
    return { nodes: ns, edges: es };
  }, [clusterId, height]);

  const nodeMap = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const maxAmount = Math.max(1, ...edges.map((e) => e.amount));

  const visibleEdges = edges.filter(
    (e) =>
      !excludedTxns.has(e.id) &&
      !excludedAccounts.has(e.source) &&
      !excludedAccounts.has(e.target) &&
      e.amount >= minAmount &&
      e.amount <= amountCeiling &&

      (storyCursor === null || e.t <= storyCursor),
  );
  const activeNodeIds = new Set<string>();
  visibleEdges.forEach((e) => {
    activeNodeIds.add(e.source);
    activeNodeIds.add(e.target);
  });

  useEffect(() => {
    setHover(null);
  }, [clusterId]);

  return (
    <div ref={wrapRef} className={cn("relative overflow-hidden rounded-lg border border-border bg-background", className)}>
      <div className="grid-surface pointer-events-none absolute inset-0 opacity-40" />
      <svg viewBox={`0 0 ${width} ${height}`} className="relative w-full" style={{ height }}>
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
          </marker>
          <filter id="nodeglow" x="-80%" y="-80%" width="260%" height="260%">
            <feGaussianBlur stdDeviation="6" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* cluster halo */}
        {nodes.length > 0 && (
          <ellipse
            cx={nodes.reduce((s, n) => s + n.x, 0) / nodes.length}
            cy={nodes.reduce((s, n) => s + n.y, 0) / nodes.length}
            rx={width * 0.42}
            ry={height * 0.42}
            fill="none"
            stroke="var(--risk-critical)"
            strokeOpacity={0.14}
            strokeDasharray="4 10"
          />
        )}

        {visibleEdges.map((e) => {
          const s = nodeMap.get(e.source)!;
          const t = nodeMap.get(e.target)!;
          if (!s || !t) return null;
          const highlighted = hover === e.source || hover === e.target || selected === e.source || selected === e.target;
          const suspicious = e.txn.label === "suspicious";
          const dx = t.x - s.x;
          const dy = t.y - s.y;
          const d = Math.hypot(dx, dy) || 1;
          const pad = 15;
          const x1 = s.x + (dx / d) * pad;
          const y1 = s.y + (dy / d) * pad;
          const x2 = t.x - (dx / d) * pad;
          const y2 = t.y - (dy / d) * pad;
          return (
            <g
              key={e.id}
              className={cn(
                suspicious ? "text-risk-high" : "text-muted-foreground",
                onEdgeSelect && "cursor-pointer",
              )}
              onClick={onEdgeSelect ? () => onEdgeSelect(e.txn) : undefined}
            >
              {onEdgeSelect && (
                <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="transparent" strokeWidth={12} />
              )}
              <line
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke="currentColor"
                strokeOpacity={highlighted ? 0.95 : suspicious ? 0.45 : 0.2}
                strokeWidth={1 + (e.amount / maxAmount) * 4}
                markerEnd="url(#arrow)"
                className={highlighted && suspicious ? "animate-flow" : undefined}
              />

              {highlighted && (
                <text
                  x={(x1 + x2) / 2}
                  y={(y1 + y2) / 2 - 5}
                  textAnchor="middle"
                  className="mono fill-foreground text-[9px]"
                >
                  {compactCurrency(e.amount)}
                </text>
              )}
            </g>
          );
        })}

        {nodes.map((n) => {
          if (excludedAccounts.has(n.id)) return null;
          if (storyCursor !== null && !activeNodeIds.has(n.id)) return null;
          const band = bandOf(n.risk);
          const color = RISK_STROKE[band]!;
          const radius = 8 + Math.min(12, n.degree * 1.1);
          const isSel = selected === n.id;
          return (
            <g
              key={n.id}
              transform={`translate(${n.x},${n.y})`}
              onMouseEnter={() => setHover(n.id)}
              onMouseLeave={() => setHover(null)}
              onClick={() => onSelect?.(n.id)}
              className="cursor-pointer"
            >
              {(band === "Critical" || isSel) && (
                <circle r={radius + 10} fill={color} opacity={0.12} className={band === "Critical" ? "animate-risk-pulse" : ""} />
              )}
              <circle
                r={radius}
                fill="var(--card)"
                stroke={color}
                strokeWidth={isSel ? 3 : 2}
                filter={band === "Critical" ? "url(#nodeglow)" : undefined}
                opacity={0.98}
              />
              <circle r={radius * 0.42} fill={color} opacity={0.85} />
              {(hover === n.id || isSel) && (
                <g>
                  <rect x={-72} y={radius + 6} width={144} height={30} rx={4} fill="var(--popover)" stroke="var(--border-strong)" />
                  <text x={0} y={radius + 18} textAnchor="middle" className="mono fill-foreground text-[9px]">
                    {n.id}
                  </text>
                  <text x={0} y={radius + 30} textAnchor="middle" className="fill-muted-foreground text-[9px]">
                    {n.role} · risk {n.risk}
                  </text>
                </g>
              )}
            </g>
          );
        })}
      </svg>

      <div className="pointer-events-none absolute bottom-3 left-3 flex flex-wrap items-center gap-3 rounded-md border border-border bg-card/85 px-3 py-2 text-[10px] text-muted-foreground backdrop-blur">
        {(["Low", "Medium", "High", "Critical"] as const).map((b) => (
          <span key={b} className="inline-flex items-center gap-1.5">
            <span className="size-2 rounded-full" style={{ background: RISK_STROKE[b] }} />
            {b}
          </span>
        ))}
        <span className="ml-2 border-l border-border pl-3">edge width = value · arrow = direction</span>
      </div>
    </div>
  );
}
