import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useWallet } from "@/hooks/useWallet";
import { uploadAvatar, putProfile } from "@/lib/profileApi";
import { Loader2, ImagePlus, X } from "lucide-react";
import { toast } from "sonner";
import { authProof } from "@/lib/session";

const DEFAULT_AVATAR = "/default-avatar.svg";

interface ProfileEditProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
  /** Initial values when editing */
  initial?: { username?: string; avatar?: string; bio?: string } | null;
}

export function ProfileEdit({ open, onOpenChange, onSuccess, initial }: ProfileEditProps) {
  const { account, isConnected } = useWallet();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [username, setUsername] = useState(initial?.username ?? "");
  const [bio, setBio] = useState(initial?.bio ?? "");
  const [loading, setLoading] = useState(false);
  /** New image file chosen by user, or 'CLEAR' to remove, or null to keep existing. */
  const [selectedFile, setSelectedFile] = useState<File | "CLEAR" | null>(null);

  useEffect(() => {
    if (open) {
      setUsername(initial?.username ?? "");
      setBio(initial?.bio ?? "");
      setSelectedFile(null);
    }
  }, [open, initial?.username, initial?.bio, initial?.avatar]);

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  useEffect(() => {
    if (selectedFile instanceof File) {
      const u = URL.createObjectURL(selectedFile);
      setPreviewUrl(u);
      return () => URL.revokeObjectURL(u);
    }
    setPreviewUrl(null);
  }, [selectedFile]);

  const displayAvatar =
    previewUrl || (selectedFile === "CLEAR" ? null : initial?.avatar || null) || DEFAULT_AVATAR;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!account || !isConnected) {
      toast.error("Connect your wallet first");
      return;
    }
    setLoading(true);
    try {
      const signedCmd = await authProof(account.account, account.publicKey);

      let avatarToSend: string | null;
      if (selectedFile === "CLEAR") {
        avatarToSend = null;
      } else if (selectedFile instanceof File) {
        const { url } = await uploadAvatar({
          image: selectedFile,
          wallet: account.account,
          publicKey: account.publicKey,
          signedCmd,
        });
        avatarToSend = url;
      } else {
        avatarToSend = initial?.avatar ?? null;
      }

      await putProfile({
        username: username.trim(),
        avatar: avatarToSend,
        bio: bio.trim(),
        wallet: account.account,
        publicKey: account.publicKey,
        signedCmd,
      });
      toast.success("Profile saved");
      onOpenChange(false);
      onSuccess?.();
    } catch (err) {
      toast.error("Failed to save profile", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit profile</DialogTitle>
          <DialogDescription>
            Prove wallet ownership by signing a message. You cannot edit by entering an address.
          </DialogDescription>
        </DialogHeader>
        {!isConnected ? (
          <p className="text-sm text-muted-foreground py-4">
            Connect your wallet to create or edit your profile.
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label>Avatar</Label>
              <div className="flex items-center gap-4">
                <Avatar className="h-16 w-16">
                  <AvatarImage src={displayAvatar || undefined} alt="" />
                  <AvatarFallback className="text-lg bg-muted">?</AvatarFallback>
                </Avatar>
                <div className="flex flex-col gap-2">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/gif,image/webp"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      setSelectedFile(f || null);
                    }}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="gap-2"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <ImagePlus className="h-4 w-4" />
                    Choose image
                  </Button>
                  {(initial?.avatar || selectedFile) && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="gap-2 text-muted-foreground"
                      onClick={() => setSelectedFile("CLEAR")}
                    >
                      <X className="h-4 w-4" />
                      Remove photo
                    </Button>
                  )}
                </div>
              </div>
              <p className="text-xs text-muted-foreground">JPG, PNG, GIF or WebP. Max 2MB.</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="profile-username">Display name</Label>
              <Input
                id="profile-username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Your display name"
                maxLength={64}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="profile-bio">Bio (optional)</Label>
              <Textarea
                id="profile-bio"
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                placeholder="A short bio..."
                rows={3}
                maxLength={500}
                className="resize-none"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Wallet: <span className="font-mono">{account?.account?.slice(0, 12)}…</span> (proven by
              signature)
            </p>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={loading}>
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Sign & save
                  </>
                ) : (
                  "Sign & save"
                )}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
