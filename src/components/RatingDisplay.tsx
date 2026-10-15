import type { RatingSummary } from "@/lib/ratingApi";
import { Star, ShoppingBag, CheckCircle, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

interface RatingDisplayProps {
  summary: RatingSummary | null | undefined;
  /** "compact" for cards/lists, "full" for profile/trade pages */
  variant?: "compact" | "full";
  className?: string;
}

export function RatingDisplay({
  summary,
  variant = "compact",
  className,
}: RatingDisplayProps) {
  const hasAny = summary && (summary.totalRatings > 0 || summary.completedTrades > 0 || summary.disputedCount > 0);

  if (!summary) {
    return variant === "full" ? (
      <div className={cn("text-sm text-muted-foreground", className)}>
        <span className="font-medium text-foreground/80">Rating &amp; reputation</span>
        <p className="mt-1">—</p>
      </div>
    ) : (
      <div className={cn("text-xs text-muted-foreground", className)}>Rating: —</div>
    );
  }

  const { averageRating, totalRatings, completedTrades, disputedCount, completionRate } = summary;

  if (!hasAny && variant === "compact") {
    return (
      <div className={cn("flex items-center gap-1.5 text-xs text-muted-foreground", className)}>
        <Star className="h-3.5 w-3.5 text-muted-foreground/60" />
        <span>No ratings yet</span>
      </div>
    );
  }
  if (!hasAny && variant === "full") {
    return (
      <div className={cn("space-y-1", className)}>
        <span className="text-xs font-medium text-foreground/80">Rating &amp; reputation</span>
        <p className="text-sm text-muted-foreground">No trades or ratings yet.</p>
      </div>
    );
  }

  const stars = (
    <span className="inline-flex items-center gap-0.5" title={`${averageRating} / 5 (${totalRatings} ratings)`}>
      <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
      <span className="font-medium tabular-nums">{averageRating.toFixed(1)}</span>
      {totalRatings > 0 && (
        <span className="text-muted-foreground text-xs">({totalRatings})</span>
      )}
    </span>
  );

  if (variant === "compact") {
    return (
      <div className={cn("flex items-center gap-2 text-sm", className)}>
        {stars}
        {completedTrades > 0 && (
          <span className="text-muted-foreground flex items-center gap-1" title="Completed trades">
            <ShoppingBag className="h-3.5 w-3.5" />
            {completedTrades}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className={cn("space-y-2", className)}>
      <span className="text-xs font-medium text-foreground/80">Rating &amp; reputation</span>
      <div className="flex flex-wrap items-center gap-4">
        {stars}
        {completedTrades > 0 && (
          <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <CheckCircle className="h-4 w-4 text-green-600" />
            {completedTrades} completed trade{completedTrades !== 1 ? "s" : ""}
          </span>
        )}
        {disputedCount > 0 && (
          <span className="flex items-center gap-1.5 text-sm text-amber-600" title="Disputed trades">
            <AlertTriangle className="h-4 w-4" />
            {disputedCount} disputed
          </span>
        )}
      </div>
      {(completedTrades > 0 || disputedCount > 0) && (
        <div className="text-xs text-muted-foreground">
          Completion rate: <span className="font-medium text-foreground">{(completionRate * 100).toFixed(0)}%</span>
        </div>
      )}
    </div>
  );
}
