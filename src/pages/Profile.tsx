import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ProfileEdit } from "@/components/ProfileEdit";
import { RatingDisplay } from "@/components/RatingDisplay";
import { useWallet } from "@/hooks/useWallet";
import { fetchProfile } from "@/lib/profileApi";
import { fetchRatingSummary } from "@/lib/ratingApi";
import { useState } from "react";
import { Pencil, ArrowLeft, Loader2 } from "lucide-react";

function shortenAddress(w: string) {
  if (!w || w.length < 14) return w;
  return `${w.slice(0, 12)}…${w.slice(-10)}`;
}

export default function Profile() {
  const { wallet } = useParams<{ wallet: string }>();
  const { account, isConnected } = useWallet();
  const [editOpen, setEditOpen] = useState(false);

  const { data: profile, isLoading, refetch } = useQuery({
    queryKey: ["profile", wallet],
    queryFn: () => fetchProfile(wallet!),
    enabled: !!wallet,
  });

  const { data: ratingSummary } = useQuery({
    queryKey: ["rating-summary", wallet],
    queryFn: () => fetchRatingSummary(wallet!),
    enabled: !!wallet,
  });

  const isOwn = isConnected && !!account && !!wallet && account.account === wallet;

  if (!wallet) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-muted-foreground">Invalid profile address</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const displayName = profile?.username?.trim() || shortenAddress(wallet);

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4 flex items-center gap-4">
          <Link to="/" className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <span className="text-sm text-muted-foreground">Profile</span>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 max-w-lg">
        <Card className="escrow-card">
          <CardHeader>
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
              <Avatar className="h-20 w-20">
                <AvatarImage src={profile?.avatar || "/default-avatar.svg"} alt="" />
                <AvatarFallback className="text-2xl bg-muted">
                  {displayName.slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <CardTitle className="text-xl truncate">{displayName}</CardTitle>
                <CardDescription className="font-mono text-xs break-all">{wallet}</CardDescription>
                <div className="mt-3 pt-3 border-t border-border">
                  <RatingDisplay summary={ratingSummary} variant="full" />
                </div>
                {isOwn && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-2 gap-2"
                    onClick={() => setEditOpen(true)}
                  >
                    <Pencil className="h-4 w-4" />
                    Edit profile
                  </Button>
                )}
              </div>
            </div>
          </CardHeader>
          {profile?.bio && (
            <CardContent className="pt-0">
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">{profile.bio}</p>
            </CardContent>
          )}
        </Card>

        {!profile && !isLoading && (
          <p className="text-center text-muted-foreground mt-6">
            No profile yet.
            {isOwn && (
              <>
                {" "}
                <button
                  type="button"
                  onClick={() => setEditOpen(true)}
                  className="text-primary hover:underline"
                >
                  Create one
                </button>
              </>
            )}
          </p>
        )}
      </main>

      <ProfileEdit
        open={editOpen}
        onOpenChange={setEditOpen}
        onSuccess={() => refetch()}
        initial={profile ? { username: profile.username ?? "", avatar: profile.avatar ?? "", bio: profile.bio ?? "" } : null}
      />
    </div>
  );
}
