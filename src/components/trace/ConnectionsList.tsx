import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { db } from "@/lib/trace/engine";
import { currency } from "@/lib/trace/format";
import { Mono } from "@/components/trace/primitives";

export interface Connection {
  id: string;
  count: number;
  value: number;
  direction: "in" | "out" | "both";
}

/** Counterparty aggregation for an account, shared by the network drawer and the account profile. */
export function useAccountConnections(accountId: string | null): Connection[] {
  return useMemo(() => {
    if (!accountId) return [];
    const map = new Map<string, Connection>();
    db.accountTransactions(accountId).forEach((t) => {
      const other = t.sender_id === accountId ? t.receiver_id : t.sender_id;
      const dir: "in" | "out" = t.sender_id === accountId ? "out" : "in";
      const prev = map.get(other);
      map.set(other, {
        id: other,
        count: (prev?.count ?? 0) + 1,
        value: (prev?.value ?? 0) + t.amount,
        direction: prev && prev.direction !== dir ? "both" : dir,
      });
    });
    return [...map.values()].sort((a, b) => b.value - a.value);
  }, [accountId]);
}

export function ConnectionsList({ connections }: { connections: Connection[] }) {
  return (
    <ul className="space-y-1">
      {connections.map((c) => (
        <li
          key={c.id}
          className="flex items-center justify-between gap-2 rounded-md border border-border px-2 py-1.5"
        >
          <Link
            to="/accounts/$accountId"
            params={{ accountId: c.id }}
            className="min-w-0 flex-1 truncate hover:underline"
          >
            <Mono className="truncate text-[11px]">{c.id}</Mono>
          </Link>
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{c.direction}</span>
          <span className="mono text-[11px]">{currency(c.value)}</span>
          <span className="text-[10px] text-muted-foreground">{c.count}×</span>
        </li>
      ))}
    </ul>
  );
}
