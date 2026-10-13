import { useMemo, useState } from "react";
import { TradeCode } from "./TradeCode";
import { AlertTriangle, Bell, BellOff, Check, CheckCheck, Clock, Loader2, Lock, MessageSquare, Plus, Share, Star, Undo2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useNotifications, useOpenOffer } from "@/hooks/useNotifications";
import type { FeedItem } from "@/lib/notificationsApi";
import { cn } from "@/lib/utils";

type Filter = "all" | "trade" | "offer";

const ago = (iso: string) => {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.round(s / 60)} min`;
  if (s < 86400) return `${Math.round(s / 3600)} h`;
  const d = Math.round(s / 86400);
  return d === 1 ? "Yesterday" : `${d} days`;
};
const isToday = (iso: string) => new Date(iso).toDateString() === new Date().toDateString();

function KindIcon({ kind }: { kind: string }) {
  const cls = "h-4 w-4";
  if (kind === "accepted" || kind === "paid") return <Check className={cls} />;
  if (kind === "funded") return <Lock className={cls} />;
  if (kind === "completed") return <Star className={cls} />;
  if (kind === "disputed" || kind.startsWith("expired")) return <AlertTriangle className={cls} />;
  if (kind === "refunded") return <Undo2 className={cls} />;
  if (kind === "closed") return <XCircle className={cls} />;
  if (kind.startsWith("due")) return <Clock className={cls} />;
  if (kind === "message") return <MessageSquare className={cls} />;
  return <Plus className={cls} />;
}

function Item({ i, unread, onOpen }: { i: FeedItem; unread: boolean; onOpen: (i: FeedItem) => void }) {
  const tone = i.urgent ? "bg-orange-100 text-orange-800 dark:bg-orange-500/20 dark:text-orange-200" : "bg-primary/10 text-primary";
  const closedOffer = i.scope === "offer" && i.open === false;
  return (
    <button
      type="button"
      onClick={() => onOpen(i)}
      className={cn(
        "flex w-full gap-3 rounded-xl border p-3 text-left transition-colors hover:border-primary/60",
        unread ? "border-border bg-card" : "border-transparent bg-muted/40",
        unread && i.urgent && "shadow-[inset_4px_0_0_theme(colors.orange.500)]",
        unread && !i.urgent && "shadow-[inset_4px_0_0_hsl(var(--primary))]",
      )}
    >
      <span className={cn("mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full", tone)}><KindIcon kind={i.kind} /></span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className={cn("text-sm", unread ? "font-semibold" : "font-medium")}>{i.title}</span>
          <span className="shrink-0 text-xs text-muted-foreground">{ago(i.createdAt)}</span>
        </span>
        <span className="mt-0.5 block text-sm leading-snug text-muted-foreground">{i.body}</span>
        {i.offerId && <TradeCode offerId={i.offerId} className="mt-1.5" />}
        {closedOffer && <span className="mt-1 block text-xs text-muted-foreground">No longer open</span>}
      </span>
    </button>
  );
}

function PushPanel() {
  const { push, pushOffers, turnOnPush, turnOffPush } = useNotifications();
  const [offers, setOffers] = useState(pushOffers);
  if (push === "unsupported") return null;
  return (
    <div className="rounded-xl border border-border bg-muted/40 p-4 text-sm">
      {push === "on" ? (
        <div className="space-y-3">
          <p className="flex items-center gap-2 font-medium"><Bell className="h-4 w-4 text-primary" />Notifications are on for this device</p>
          <label className="flex items-center gap-2">
            <Checkbox checked={pushOffers} onCheckedChange={(c) => turnOnPush(c === true)} />
            Also tell me about new offers
          </label>
          <Button variant="ghost" size="sm" className="gap-2 px-2 text-muted-foreground" onClick={turnOffPush}><BellOff className="h-4 w-4" />Turn off on this device</Button>
        </div>
      ) : push === "needs-install" ? (
        <div className="space-y-2">
          <p className="font-medium">Get notifications on your iPhone</p>
          <p className="text-muted-foreground">iPhone only allows them for sites on your Home Screen:</p>
          <ol className="list-decimal space-y-1 pl-5">
            <li>Tap <Share className="inline h-4 w-4 align-text-bottom" aria-label="Share" /> Share in Safari</li>
            <li>Choose <b>Add to Home Screen</b></li>
            <li>Open the Marketplace from your Home Screen and turn notifications on here</li>
          </ol>
        </div>
      ) : push === "denied" ? (
        <p className="text-muted-foreground"><BellOff className="mr-1 inline h-4 w-4 align-text-bottom" />Notifications are blocked for this site. Allow them in your browser or phone settings, then come back.</p>
      ) : (
        <div className="space-y-3">
          <p className="font-medium">Get notified when a trade needs you</p>
          <p className="text-muted-foreground">Even with this page closed: accepted, funded, paid, deadlines.</p>
          <label className="flex items-center gap-2">
            <Checkbox checked={offers} onCheckedChange={(c) => setOffers(c === true)} />
            Also tell me about new offers
          </label>
          <Button className="w-full gap-2" disabled={push === "working"} onClick={() => turnOnPush(offers)}>
            {push === "working" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bell className="h-4 w-4" />}
            Turn on notifications
          </Button>
        </div>
      )}
    </div>
  );
}

/** Bell with unread count; opens the notification list. Renders nothing when the server feed is off. */
export function NotificationBell() {
  const { enabled, items, unread, isUnread, markAllRead } = useNotifications();
  const openOffer = useOpenOffer();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const shown = useMemo(() => items.filter((i) => filter === "all" || i.scope === filter), [items, filter]);
  const today = shown.filter((i) => isToday(i.createdAt));
  const earlier = shown.filter((i) => !isToday(i.createdAt));
  if (!enabled) return null;

  const onOpen = (i: FeedItem) => { setOpen(false); if (i.offerId) openOffer(i.offerId); };
  const chip = (f: Filter, label: string) => (
    <button type="button" role="tab" aria-selected={filter === f} onClick={() => setFilter(f)}
      className={cn("h-8 rounded-full border px-3 text-sm", filter === f ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground hover:text-foreground")}>
      {label}
    </button>
  );

  return (
    <Sheet open={open} onOpenChange={(o) => { setOpen(o); if (!o) markAllRead(); }}>
      <SheetTrigger asChild>
        <button type="button" aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
          className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-foreground hover:bg-muted">
          <Bell className="h-5 w-5" />
          {unread > 0 && (
            <span className="absolute -right-0.5 -top-0.5 min-w-[18px] rounded-full bg-orange-600 px-1 text-center text-[11px] font-bold leading-[18px] text-white">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </button>
      </SheetTrigger>
      <SheetContent side="right" className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-md">
        <SheetHeader className="flex-row items-center justify-between space-y-0 border-b border-border px-4 py-3 pr-12 text-left">
          <SheetTitle className="font-display text-xl">Notifications</SheetTitle>
          <SheetDescription className="sr-only">Trade updates and new offers</SheetDescription>
          {unread > 0 && (
            <Button variant="ghost" size="sm" className="gap-1.5 text-primary" onClick={markAllRead}><CheckCheck className="h-4 w-4" />Mark all read</Button>
          )}
        </SheetHeader>
        <div role="tablist" className="flex gap-2 px-4 pt-3">
          {chip("all", "All")}{chip("trade", "My trades")}{chip("offer", "New offers")}
        </div>
        <div className="flex flex-1 flex-col gap-2 px-4 py-3">
          {shown.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">Nothing yet. Trade updates and new offers will show here.</p>
          )}
          {today.length > 0 && <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Today</p>}
          {today.map((i) => <Item key={i.id} i={i} unread={isUnread(i)} onOpen={onOpen} />)}
          {earlier.length > 0 && <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Earlier</p>}
          {earlier.map((i) => <Item key={i.id} i={i} unread={isUnread(i)} onOpen={onOpen} />)}
        </div>
        <div className="border-t border-border px-4 py-4"><PushPanel /></div>
      </SheetContent>
    </Sheet>
  );
}
