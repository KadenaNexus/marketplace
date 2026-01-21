import { Link } from "react-router-dom";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { ProfileSummary } from "@/lib/profileApi";
import { cn } from "@/lib/utils";

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

  return (
    <Link
      to={href}
      className={cn(
        "inline-flex items-center gap-2 text-foreground hover:text-primary transition-colors",
        isSmall ? "gap-1.5" : "gap-2",
        className
      )}
    >
      <Avatar className={cn(isSmall ? "h-6 w-6" : "h-8 w-8")}>
        <AvatarImage src={summary?.avatar || "/default-avatar.svg"} alt="" />
        <AvatarFallback className="text-xs bg-muted">
          {displayName.slice(0, 2).toUpperCase()}
        </AvatarFallback>
      </Avatar>
      <span className={cn("truncate", isSmall ? "text-xs" : "text-sm")}>{displayName}</span>
    </Link>
  );
}
