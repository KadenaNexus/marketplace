/**
 * Escrow v11 data for the UI: the contract config, the pools (chain merged with the server's off-chain details),
 * the trades, and one pool's details. The chain is the source of truth; the server only adds networks, notes and
 * the admin's hidden flag, and may answer 404 while it does not serve pools yet.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { readConfig, readPools, readTrades, type Pool, type Trade, type V11Config } from "@/lib/v11";
import { getPoolDetails, getPoolsIndex, type PoolDetails, type PoolListing } from "@/lib/poolsApi";
import { FALLBACK_CONFIG } from "@/lib/v11ui";

export function useV11Config() {
  return useQuery<V11Config>({
    queryKey: ["v11-config"],
    queryFn: () => readConfig().catch(() => FALLBACK_CONFIG),
    staleTime: 10 * 60 * 1000,
    placeholderData: FALLBACK_CONFIG,
  });
}

/** Server's pool index (networks, notes, hidden), or null when the route is not there. */
export function usePoolsIndex() {
  return useQuery<PoolListing[] | null>({ queryKey: ["pools-index"], queryFn: getPoolsIndex, staleTime: 30 * 1000, retry: 0 });
}

/** Every pool on the chain, with the server's details merged in when known. */
export function usePools() {
  const chain = useQuery<Pool[]>({ queryKey: ["v11-pools"], queryFn: readPools, staleTime: 10 * 1000, refetchInterval: 30 * 1000 });
  const index = usePoolsIndex();
  const byId = new Map((index.data ?? []).map((p) => [p.poolId, p]));
  const pools: PoolListing[] = (chain.data ?? []).map((p) => {
    const d = byId.get(p.poolId);
    return { ...p, networks: d?.networks ?? [], notes: d?.notes ?? "", hidden: d?.hidden ?? false };
  });
  return { pools, isLoading: chain.isLoading, error: chain.error, refetch: chain.refetch, indexKnown: index.data !== null && index.data !== undefined };
}

/** Every v11 trade on the chain. */
export function useTrades() {
  return useQuery<Trade[]>({ queryKey: ["v11-trades"], queryFn: readTrades, staleTime: 5 * 1000, refetchInterval: 30 * 1000 });
}

/** One pool's networks and notes: from the index when it is loaded, else one request (404 → empty). */
export function usePoolDetails(poolId: string | null | undefined, fallbackNetworks?: string[]) {
  const index = usePoolsIndex();
  const fromIndex = poolId ? index.data?.find((p) => p.poolId === poolId) : undefined;
  const q = useQuery<PoolDetails>({
    queryKey: ["pool-details", poolId],
    queryFn: async () => (await getPoolDetails(poolId!)) ?? { networks: [], notes: "" },
    enabled: !!poolId && !fromIndex,
    staleTime: 60 * 1000,
    retry: 0,
  });
  const details: PoolDetails = fromIndex ? { networks: fromIndex.networks, notes: fromIndex.notes } : q.data ?? { networks: fallbackNetworks ?? [], notes: "" };
  return { details, isLoading: !fromIndex && q.isLoading };
}

/** Reload the pools and trades after a transaction. */
export function useRefreshV11() {
  const qc = useQueryClient();
  return useCallback(() => {
    qc.invalidateQueries({ queryKey: ["v11-pools"] });
    qc.invalidateQueries({ queryKey: ["v11-trades"] });
    qc.invalidateQueries({ queryKey: ["pools-index"] });
    qc.invalidateQueries({ queryKey: ["app-chain-balance"] });
  }, [qc]);
}
