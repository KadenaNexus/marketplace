import { Link } from "react-router-dom";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { ProfileSummary } from "@/lib/profileApi";
import { cn } from "@/lib/utils";
import { useIsOnline } from "@/hooks/useOnlineStatus";

function shortenAddress(w: string) {
  if (!w || w.length < 14) return w;
  return `${w.slice(0, 10)}…${w.slice(-8)}`;
}

interface ProfileSummaryProps {
  wallet: string;
  summary?: ProfileSummary | null;
  /** Optional: show as inline compact (e.g. in a table cell) */
  size?: "sm" | "md";
  className?: string;
}

export function ProfileSummaryView({ wallet, summary, size = "md", className }: ProfileSummaryProps) {
  const displayName = summary?.username?.trim() || shortenAddress(wallet);
  const href = `/u/${encodeURIComponent(wallet)}`;
  const isSmall = size === "sm";
  
  // Always use real-time hook value - it will update automatically via WebSocket
  const isOnline = useIsOnline(wallet);

  return (
    <Link
      to={href}
      className={cn(
        "inline-flex items-center gap-2 text-foreground hover:text-primary transition-colors",
        isSmall ? "gap-1.5" : "gap-2",
        className
      )}
    >
      <div className="relative">
        <Avatar className={cn(isSmall ? "h-6 w-6" : "h-8 w-8")}>
          <AvatarImage src={summary?.avatar || "/default-avatar.svg"} alt="" />
          <AvatarFallback className="text-xs bg-muted">
            {displayName.slice(0, 2).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        {/* Online status indicator */}
        <span
          className={cn(
            "absolute bottom-0 right-0 rounded-full border-2 border-background",
            isSmall ? "h-2 w-2" : "h-2.5 w-2.5",
            isOnline ? "bg-green-500" : "bg-gray-400"
          )}
          title={isOnline ? "Online" : "Offline"}
        />
      </div>
      <span className={cn("truncate", isSmall ? "text-xs" : "text-sm")}>{displayName}</span>
    </Link>
  );
}
