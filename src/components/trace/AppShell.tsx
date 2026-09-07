import { useMemo, useState } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  Activity,
  Bell,
  Bot,
  Boxes,
  Briefcase,
  ChevronsLeft,
  ChevronsRight,
  FileText,
  FlaskConical,
  Info,
  LayoutDashboard,
  Network,
  Route as RouteIcon,
  Search,
  ShieldAlert,
  Sparkles,
  Clock,
  UserRound,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useTrace } from "@/lib/trace/context";
import { db, detectionStats } from "@/lib/trace/engine";
import { compactCurrency, relative } from "@/lib/trace/format";
import { RiskBadge } from "./primitives";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";

const NAV: { to: string; label: string; icon: typeof LayoutDashboard; group: string }[] = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, group: "Detect" },
  { to: "/alerts", label: "Alerts", icon: ShieldAlert, group: "Detect" },
  { to: "/network", label: "Network Investigation", icon: Network, group: "Connect" },
  { to: "/accounts", label: "Accounts", icon: UserRound, group: "Connect" },
  { to: "/tracer", label: "Money Tracer", icon: RouteIcon, group: "Trace" },
  { to: "/timeline", label: "Timeline", icon: Clock, group: "Trace" },
  { to: "/explain", label: "Why Flagged?", icon: Boxes, group: "Explain" },
  { to: "/ai", label: "AI Investigation", icon: Bot, group: "Explain" },
  { to: "/cases", label: "Cases", icon: Briefcase, group: "Investigate" },
  { to: "/lab", label: "Detection Lab", icon: FlaskConical, group: "Stress-test" },
  { to: "/reports", label: "Reports", icon: FileText, group: "Stress-test" },
];

const LOOP = ["DETECT", "CONNECT", "TRACE", "EXPLAIN", "INVESTIGATE", "LEARN", "STRESS-TEST"];

export function AppShell({ children }: { children: React.ReactNode }) {
  const { sidebarCollapsed, toggleSidebar, activeNetworkId, setActiveNetworkId } = useTrace();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const [aboutOpen, setAboutOpen] = useState(false);
  const [query, setQuery] = useState("");
  const stats = useMemo(() => detectionStats(), []);
  const cluster = db.getCluster(activeNetworkId);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return null;
    return {
      accounts: db.accounts
        .filter(
          (a) =>
            a.id.toLowerCase().includes(q) ||
            a.holder.toLowerCase().includes(q) ||
            a.role_tag.toLowerCase().includes(q) ||
            a.current_status.toLowerCase().includes(q),
        )
        .slice(0, 5),
      networks: db.clusters
        .filter(
          (c) =>
            c.id.toLowerCase().includes(q) ||
            c.name.toLowerCase().includes(q) ||
            c.pattern.toLowerCase().includes(q),
        )
        .slice(0, 5),
      transactions: db.transactions.filter((t) => t.transaction_id.toLowerCase().includes(q)).slice(0, 5),
    };
  }, [query]);

  const clearSearch = () => setQuery("");

  const groups = NAV.reduce<Record<string, typeof NAV>>((acc, item) => {
    (acc[item.group] ??= []).push(item);
    return acc;
  }, {});

  const criticalAlerts = db.alerts.filter((a) => a.level === "Critical").slice(0, 6);

  return (
    <div className="flex min-h-screen bg-background">
      <aside
        className={cn(
          "sticky top-0 flex h-screen shrink-0 flex-col border-r border-sidebar-border bg-sidebar transition-[width] duration-200",
          sidebarCollapsed ? "w-[68px]" : "w-[248px]",
        )}
      >
        <div className="flex h-14 items-center gap-2.5 border-b border-sidebar-border px-4">
          <div className="relative grid size-8 shrink-0 place-items-center rounded-md border border-signal/40 bg-signal/10">
            <Activity className="size-4 text-signal" />
            <span className="absolute -right-0.5 -top-0.5 size-1.5 rounded-full bg-risk-critical animate-risk-pulse" />
          </div>
          {!sidebarCollapsed && (
            <div className="min-w-0">
               <p className="mono text-sm font-semibold leading-none tracking-[0.2em]">TRACE-X</p>
              <p className="truncate text-[10px] text-muted-foreground">Risk Analysis &amp; Crime Exploration</p>
            </div>
          )}
        </div>

        <ScrollArea className="flex-1">
          <nav className="space-y-4 px-2 py-4">
            {Object.entries(groups).map(([group, items]) => (
              <div key={group}>
                {!sidebarCollapsed && (
                  <p className="mb-1 px-2 text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground/70">
                    {group}
                  </p>
                )}
                <div className="space-y-0.5">
                  {items.map((item) => {
                    const active = item.to === "/" ? pathname === "/" : pathname.startsWith(item.to);
                    const Icon = item.icon;
                    const link = (
                      <Link
                        key={item.to}
                        to={item.to}
                        className={cn(
                          "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] transition-colors",
                          active
                            ? "bg-signal/12 text-foreground shadow-[inset_0_0_0_1px_var(--signal)]"
                            : "text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                          sidebarCollapsed && "justify-center px-0",
                        )}
                      >
                        <Icon className={cn("size-4 shrink-0", active && "text-signal")} />
                        {!sidebarCollapsed && <span className="truncate">{item.label}</span>}
                        {!sidebarCollapsed && item.to === "/alerts" && (
                          <span className="mono ml-auto rounded bg-risk-critical/15 px-1.5 text-[10px] text-risk-critical">
                            {stats.criticalCount}
                          </span>
                        )}
                      </Link>
                    );
                    return sidebarCollapsed ? (
                      <Tooltip key={item.to}>
                        <TooltipTrigger asChild>{link}</TooltipTrigger>
                        <TooltipContent side="right">{item.label}</TooltipContent>
                      </Tooltip>
                    ) : (
                      link
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>
        </ScrollArea>

        <div className="border-t border-sidebar-border p-2">
          {!sidebarCollapsed && cluster && (
            <div className="mb-2 rounded-md border border-border bg-card/60 p-2.5">
              <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Active investigation</p>
              <p className="mono mt-1 truncate text-xs">{cluster.id}</p>
              <p className="truncate text-[11px] text-muted-foreground">{cluster.name}</p>
              <div className="mt-1.5">
                <RiskBadge score={cluster.cluster_risk_score} size="sm" pulse />
              </div>
            </div>
          )}
          <div className={cn("flex gap-1", sidebarCollapsed && "flex-col")}>
            <Button variant="ghost" size="sm" className="flex-1 justify-center" onClick={toggleSidebar}>
              {sidebarCollapsed ? <ChevronsRight className="size-4" /> : <ChevronsLeft className="size-4" />}
              {!sidebarCollapsed && <span className="ml-1 text-xs">Collapse</span>}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setAboutOpen(true)}>
              <Info className="size-4" />
            </Button>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-background/85 px-4 backdrop-blur">
          <Popover>
            <PopoverTrigger asChild>
              <div className="relative w-full max-w-md">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search accounts, networks, transaction IDs…"
                  className="mono h-9 border-border bg-card pl-9 text-xs placeholder:font-sans placeholder:text-muted-foreground"
                />
              </div>
            </PopoverTrigger>
            <PopoverContent
              align="start"
              className="w-[420px] p-0"
              onOpenAutoFocus={(event) => event.preventDefault()}
            >
              {!results ? (
                <p className="px-3 py-6 text-center text-xs text-muted-foreground">
                  Type at least 2 characters to search the synthetic corpus.
                </p>
              ) : (
                <div className="max-h-80 overflow-y-auto py-1.5 text-xs">
                  <SearchGroup title="Networks">
                    {results.networks.map((c) => (
                      <button
                        key={c.id}
                         onClick={() => {
                          setActiveNetworkId(c.id);
                           clearSearch();
                          navigate({ to: "/network" });
                        }}
                        className="flex w-full items-center justify-between gap-2 px-3 py-1.5 hover:bg-accent"
                      >
                        <span className="mono">{c.id}</span>
                        <span className="truncate text-muted-foreground">{c.name}</span>
                        <RiskBadge score={c.cluster_risk_score} size="sm" showScore={false} />
                      </button>
                    ))}
                  </SearchGroup>
                  <SearchGroup title="Accounts">
                    {results.accounts.map((a) => (
                      <Link
                        key={a.id}
                        to="/accounts/$accountId"
                        params={{ accountId: a.id }}
                         onClick={clearSearch}
                        className="flex w-full items-center justify-between gap-2 px-3 py-1.5 hover:bg-accent"
                      >
                        <span className="mono">{a.id}</span>
                        <span className="truncate text-muted-foreground">{a.holder}</span>
                        <RiskBadge score={a.risk_score} size="sm" showScore={false} />
                      </Link>
                    ))}
                  </SearchGroup>
                  <SearchGroup title="Transactions">
                     {results.transactions.map((t) => (
                       <button
                         key={t.transaction_id}
                         type="button"
                         onClick={() => {
                           const network = db.clusters.find((c) => c.transaction_ids.includes(t.transaction_id));
                           if (network) setActiveNetworkId(network.id);
                           clearSearch();
                           navigate({ to: "/timeline" });
                         }}
                         className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left hover:bg-accent"
                       >
                        <span className="mono">{t.transaction_id}</span>
                        <span className="mono text-muted-foreground">{compactCurrency(t.amount)}</span>
                       </button>
                    ))}
                  </SearchGroup>
                   {!results.accounts.length && !results.networks.length && !results.transactions.length && (
                     <p className="px-3 py-6 text-center text-xs text-muted-foreground">No matching corpus records.</p>
                   )}
                </div>
              )}
            </PopoverContent>
          </Popover>

          <div className="ml-auto flex items-center gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="mono hidden items-center gap-1.5 rounded-md border border-risk-medium/40 bg-risk-medium/10 px-2 py-1 text-[10px] uppercase tracking-wider text-risk-medium md:inline-flex">
                  <Sparkles className="size-3" /> Synthetic / Prototype Data
                </span>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                   All accounts, transactions and networks in TRACE-X are generated synthetic records. No real personal or
                financial data is present.
              </TooltipContent>
            </Tooltip>

            <Popover>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="icon" className="relative">
                  <Bell className="size-4" />
                  <span className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-risk-critical animate-risk-pulse" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-96 p-0">
                <div className="border-b border-border px-3 py-2">
                  <p className="text-xs font-semibold">Critical alert queue</p>
                  <p className="text-[11px] text-muted-foreground">{stats.criticalCount} networks need immediate review</p>
                </div>
                <div className="max-h-72 overflow-y-auto">
                  {criticalAlerts.map((a) => (
                    <button
                      key={a.id}
                      onClick={() => {
                        setActiveNetworkId(a.network_id);
                        navigate({ to: "/network" });
                      }}
                      className="flex w-full flex-col gap-1 border-b border-border/60 px-3 py-2 text-left last:border-0 hover:bg-accent"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="mono text-[11px]">{a.id}</span>
                        <RiskBadge score={a.risk_score} size="sm" pulse />
                      </div>
                      <p className="text-xs">{a.title}</p>
                      <p className="text-[10px] text-muted-foreground">{relative(a.created_at)}</p>
                    </button>
                  ))}
                </div>
              </PopoverContent>
            </Popover>

            <div className="flex items-center gap-2 rounded-md border border-border bg-card px-2 py-1">
              <div className="grid size-6 place-items-center rounded-full bg-signal/15 text-[10px] font-semibold text-signal">
                SS
              </div>
              <div className="hidden leading-tight lg:block">
                <p className="text-[11px] font-medium">S. Sharma</p>
                <p className="text-[9px] text-muted-foreground">Financial Crime Analyst L2</p>
              </div>
            </div>
          </div>
        </header>

        <main className="min-w-0 flex-1 px-4 py-5 lg:px-6">{children}</main>

        <footer className="border-t border-border px-4 py-3 lg:px-6">
          <div className="flex flex-wrap items-center justify-between gap-3 text-[11px] text-muted-foreground">
            <p>
               TRACE-X is an intelligence layer that integrates with existing banking, UPI, wallet and payment systems — not
              a replacement payment app.
            </p>
            <div className="mono flex items-center gap-1.5 text-[9px] tracking-[0.12em]">
              {LOOP.map((s, i) => (
                <span key={s} className="flex items-center gap-1.5">
                  <span className={i === 6 ? "text-signal" : ""}>{s}</span>
                  {i < LOOP.length - 1 && <span className="text-border-strong">›</span>}
                </span>
              ))}
            </div>
          </div>
        </footer>
      </div>

      <Dialog open={aboutOpen} onOpenChange={setAboutOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
             <DialogTitle className="mono tracking-[0.16em]">TRACE-X</DialogTitle>
            <DialogDescription>One transaction can look normal. The network tells the truth.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <p className="rounded-md border border-signal/30 bg-signal/8 p-3 text-[13px]">
               Most fraud systems learn from yesterday's fraud. TRACE-X stress-tests its detection engine with evolving
              synthetic fraud scenarios to discover blind spots before they become real weaknesses.
            </p>
            <p className="text-muted-foreground">
               TRACE-X is an investigation cockpit for financial-crime analysts: it surfaces suspicious networks, traces
              money across accounts, explains why something was flagged, and packages evidence into cases. It is an
              intelligence layer over existing banking, UPI, wallet and payment rails — not a payment app and not a
              standalone fraud/not-fraud classifier.
            </p>
            <p className="text-xs text-muted-foreground">
              Prototype notice: all data shown is synthetic. Risk weights are illustrative prototype weights, not a
              banking standard. AI supports investigation — final decisions are made by authorised analysts.
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SearchGroup({ title, children }: { title: string; children: React.ReactNode }) {
  const arr = Array.isArray(children) ? children : [children];
  if (!arr.flat().filter(Boolean).length) return null;
  return (
    <div className="mb-1">
      <p className="px-3 py-1 text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">{title}</p>
      {children}
    </div>
  );
}
