import { useQuery } from "@tanstack/react-query";
import { CHAIN_ID, balanceOnChain } from "@/lib/kadena";
import { V11_CHAINS } from "@/lib/v11";

/** The connected account's KDA on one chain (default: this app's chain), refreshed every 30 s. */
export function useAppChainBalance(account: string | undefined, chain: string = CHAIN_ID) {
  return useQuery({
    queryKey: ["app-chain-balance", account, chain],
    queryFn: () => balanceOnChain(account!, chain),
    enabled: !!account,
    refetchInterval: 30000,
    staleTime: 15000,
  });
}

/** KDA on each escrow v11 chain (1 and 2), for "Chain 1: … KDA · Chain 2: … KDA". */
export function useV11ChainBalances(account: string | undefined) {
  return useQuery({
    queryKey: ["app-chain-balance", account, "v11"],
    queryFn: async () => Promise.all(V11_CHAINS.map(async (chain) => ({ chain, balance: await balanceOnChain(account!, chain).catch(() => 0) }))),
    enabled: !!account,
    refetchInterval: 30000,
    staleTime: 15000,
  });
}
