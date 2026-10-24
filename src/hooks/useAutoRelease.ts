/**
 * Auto-release in the UI: whether the platform offers it (the chain's config names an agent and the server runs that
 * same agent), which networks it watches, and one trade's live state.
 */
import { useQuery } from "@tanstack/react-query";
import { useWallet } from "@/hooks/useWallet";
import { useV11Config } from "@/hooks/useV11";
import { authProof, useSignedIn } from "@/lib/session";
import { getAutoReleaseInfo, getTradeAuto, type TradeAuto } from "@/lib/autoReleaseApi";
import type { V11Escrow } from "@/lib/v11ui";

export function useAutoRelease() {
  const { data: cfg } = useV11Config();
  const { data: info } = useQuery({ queryKey: ["auto-release-info"], queryFn: getAutoReleaseInfo, staleTime: 5 * 60 * 1000, retry: 0 });
  const chainAgent = cfg?.agent ?? "";
  const available = !!chainAgent && !!info?.enabled && info.agent === chainAgent;
  const agent = available ? chainAgent : "";
  return {
    available,
    /** the account an offer names as its agent to get auto-release ("" when not offered) */
    agent,
    /** watched network ids, e.g. ["USDT:TRC20"] */
    networks: available ? info!.networks : [],
    /** a pool or trade on the automatic path */
    isAuto: (p: { agent?: string; token?: string } | null | undefined) => available && !!p?.agent && p.agent === agent && !p.token,
  };
}

const LIVE = ["watching", "matched", "releasing"];

/** One trade's auto-release state for the person looking (a side or the arbiter); polls while it is in progress. */
export function useTradeAuto(e: V11Escrow | null | undefined) {
  const { account, isConnected } = useWallet();
  const { isAuto } = useAutoRelease();
  const t = e?.trade;
  const me = account?.account;
  const involved = !!me && !!t && (me === t.seller || me === t.buyer || me === e?.arbiter);
  const candidate = !!t && isAuto(t) && t.price > 0 && ["FUNDED", "PAID", "COMPLETED"].includes(t.state);
  const signedIn = useSignedIn(me);
  return useQuery<TradeAuto | null>({
    queryKey: ["trade-auto", t?.tradeId, me],
    queryFn: async () => {
      const signedCmd = await authProof(account!.account, account!.publicKey);
      return getTradeAuto(t!.tradeId, { wallet: account!.account, publicKey: account!.publicKey, signedCmd });
    },
    enabled: isConnected && involved && candidate && signedIn,
    staleTime: 5 * 1000,
    retry: 0,
    refetchInterval: (q) => (q.state.data?.status && LIVE.includes(q.state.data.status) ? 8000 : false),
  });
}
