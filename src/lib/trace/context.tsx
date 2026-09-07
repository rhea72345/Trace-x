import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { db } from "./engine";

interface TraceContextValue {
  /** Network currently under investigation across Network / Tracer / Timeline / AI screens. */
  activeNetworkId: string;
  setActiveNetworkId: (id: string) => void;
  activeAlertId: string | null;
  setActiveAlertId: (id: string | null) => void;
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
}

const TraceContext = createContext<TraceContextValue | null>(null);
const STORAGE_KEY = "trace.active.network";

export function TraceProvider({ children }: { children: React.ReactNode }) {
  const fallback = db.alerts[0]!.network_id;
  const [activeNetworkId, setActive] = useState(fallback);
  const [activeAlertId, setActiveAlertId] = useState<string | null>(db.alerts[0]!.id);
  const [sidebarCollapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored && db.getCluster(stored)) setActive(stored);
  }, []);

  const setActiveNetworkId = useCallback((id: string) => {
    setActive(id);
    window.localStorage.setItem(STORAGE_KEY, id);
    const alert = db.alerts.find((a) => a.network_id === id);
    setActiveAlertId(alert?.id ?? null);
  }, []);

  const value = useMemo(
    () => ({
      activeNetworkId,
      setActiveNetworkId,
      activeAlertId,
      setActiveAlertId,
      sidebarCollapsed,
      toggleSidebar: () => setCollapsed((c) => !c),
    }),
    [activeNetworkId, setActiveNetworkId, activeAlertId, sidebarCollapsed],
  );

  return <TraceContext.Provider value={value}>{children}</TraceContext.Provider>;
}

export function useTrace() {
  const ctx = useContext(TraceContext);
  if (!ctx) throw new Error("useTrace must be used inside TraceProvider");
  return ctx;
}
