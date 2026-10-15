import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useWallet } from "@/hooks/useWallet";
import { submitRating } from "@/lib/ratingApi";
import { cn } from "@/lib/utils";
import { Loader2, Star } from "lucide-react";
import { toast } from "sonner";
import { authProof } from "@/lib/session";

interface RatingSubmitDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  offerId: string;
  /** The counterparty to rate (buyer or seller, the other party) */
  ratedWallet: string;
  onSuccess?: () => void;
}

const RATING_OPTIONS = [1, 2, 3, 4, 5];

export function RatingSubmitDialog({
  open,
  onOpenChange,
  offerId,
  ratedWallet,
  onSuccess,
}: RatingSubmitDialogProps) {
  const { account, isConnected } = useWallet();
  const [rating, setRating] = useState<number>(3);
  const [comment, setComment] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!account || !isConnected) {
      toast.error("Connect your wallet first");
      return;
    }
    setLoading(true);
    try {
      const signedCmd = await authProof(account.account, account.publicKey);

      await submitRating({
        offerId,
        ratedWallet,
        rating,
        comment: comment.trim() || undefined,
        wallet: account.account,
        publicKey: account.publicKey,
        signedCmd,
      });
      toast.success("Rating submitted");
      onOpenChange(false);
      setRating(3);
      setComment("");
      onSuccess?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to submit rating");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Star className="h-5 w-5 text-amber-500" />
            Rate this trade
          </DialogTitle>
          <DialogDescription>
            Your rating is tied to this completed trade. You can only rate once per trade.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label>Rating (1–5)</Label>
            <div className="flex gap-2 mt-2">
              {RATING_OPTIONS.map((r) => (
                <Button
                  key={r}
                  type="button"
                  variant={rating === r ? "default" : "outline"}
                  size="sm"
                  className="gap-1"
                  onClick={() => setRating(r)}
                >
                  <Star className={cn("h-4 w-4", rating >= r && "fill-amber-400 text-amber-400")} />
                  {r}
                </Button>
              ))}
            </div>
          </div>
          <div>
            <Label htmlFor="rating-comment">Comment (optional)</Label>
            <Textarea
              id="rating-comment"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="How did the trade go?"
              className="mt-1"
              rows={3}
              maxLength={500}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Submit rating"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
