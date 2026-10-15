import { useQuery } from "@tanstack/react-query";
import { readAppChainBalance } from "@/lib/kadena";

/** The connected account's KDA on this app's chain (refreshed every 30 s). */
export function useAppChainBalance(account: string | undefined) {
  return useQuery({
    queryKey: ["app-chain-balance", account],
    queryFn: () => readAppChainBalance(account!),
    enabled: !!account,
    refetchInterval: 30000,
    staleTime: 15000,
  });
}
