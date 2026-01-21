import { useState, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useWallet } from "@/hooks/useWallet";
import { buildProfileAuthTx, signTransaction } from "@/lib/kadena";
import { 
  getDispute, 
  getEvidence, 
  submitEvidence, 
  sendMessage,
  getMessages,
  closeDispute,
  type Dispute, 
  type Evidence,
  type DisputeMessage
} from "@/lib/disputeApi";
import { AlertCircle, FileText, Image, Upload, Loader2, Send, MessageSquare, X, Shield } from "lucide-react";
import { toast } from "sonner";
import type { Escrow } from "@/lib/kadena";

interface DisputeViewProps {
  escrow: Escrow;
  onClose?: () => void;
}

export function DisputeView({ escrow, onClose }: DisputeViewProps) {
  const { account, isConnected } = useWallet();
  const [explanation, setExplanation] = useState("");
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [messageText, setMessageText] = useState("");
  const [isSendingMessage, setIsSendingMessage] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: dispute, refetch: refetchDispute } = useQuery({
    queryKey: ["dispute", escrow.offerId],
    queryFn: () => getDispute(escrow.offerId),
    enabled: !!escrow.offerId,
  });

  const { data: evidenceList = [], refetch: refetchEvidence } = useQuery({
    queryKey: ["evidence", escrow.offerId, account?.account],
    queryFn: () => getEvidence(escrow.offerId, account?.account || undefined),
    enabled: !!dispute && !!account,
  });

  const { data: messages = [], refetch: refetchMessages } = useQuery({
    queryKey: ["dispute-messages", escrow.offerId],
    queryFn: () => getMessages(escrow.offerId),
    enabled: !!dispute,
    refetchInterval: 5000, // Poll every 5 seconds
  });

  const isBuyer = account?.account === escrow.buyer;
  const isSeller = account?.account === escrow.seller;
  const isArbiter = account?.account === escrow.arbiter;
  const canViewEvidence = (isBuyer || isSeller || isArbiter) && !!dispute;
  const canSubmitEvidence = (isBuyer || isSeller) && dispute?.status === "OPEN" && !!account;
  const canSendMessage = (isBuyer || isSeller || isArbiter) && dispute?.status === "OPEN" && !!account;
  const canCloseDispute = isArbiter && dispute?.status === "OPEN" && !!account;

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    const validFiles = files.filter((f) => {
      const isImage = f.type.startsWith("image/");
      const isPDF = f.type === "application/pdf";
      const maxSize = 10 * 1024 * 1024; // 10MB
      return (isImage || isPDF) && f.size <= maxSize;
    });
    if (validFiles.length !== files.length) {
      toast.error("Some files were rejected. Only images and PDFs up to 10MB are allowed.");
    }
    setSelectedFiles((prev) => [...prev, ...validFiles].slice(0, 10)); // Max 10 files
  };

  const removeFile = (index: number) => {
    setSelectedFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmitEvidence = async () => {
    if (!account || !isConnected || !dispute) return;
    if (selectedFiles.length === 0 && !explanation.trim()) {
      toast.error("Please provide evidence files or an explanation");
      return;
    }

    setIsSubmitting(true);
    try {
      const tx = buildProfileAuthTx(account.account, account.publicKey);
      let signedCmd = await signTransaction(tx);
      if (signedCmd?.signedCmd && !signedCmd.cmd) signedCmd = signedCmd.signedCmd;
      const sigs = Array.isArray(signedCmd?.sigs) ? signedCmd.sigs : [];
      if (sigs[0] && !sigs[0].pubKey) sigs[0] = { ...sigs[0], pubKey: account.publicKey };
      if (sigs[0]?.signature && !sigs[0].sig) sigs[0] = { ...sigs[0], sig: sigs[0].signature };

      await submitEvidence({
        offerId: escrow.offerId,
        files: selectedFiles,
        explanation: explanation.trim(),
        wallet: account.account,
        publicKey: account.publicKey,
        signedCmd,
      });

      toast.success("Evidence submitted successfully");
      setExplanation("");
      setSelectedFiles([]);
      refetchEvidence();
    } catch (err) {
      toast.error("Failed to submit evidence", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSendMessage = async () => {
    if (!account || !isConnected || !dispute || !messageText.trim()) return;

    setIsSendingMessage(true);
    try {
      const tx = buildProfileAuthTx(account.account, account.publicKey);
      let signedCmd = await signTransaction(tx);
      if (signedCmd?.signedCmd && !signedCmd.cmd) signedCmd = signedCmd.signedCmd;
      const sigs = Array.isArray(signedCmd?.sigs) ? signedCmd.sigs : [];
      if (sigs[0] && !sigs[0].pubKey) sigs[0] = { ...sigs[0], pubKey: account.publicKey };
      if (sigs[0]?.signature && !sigs[0].sig) sigs[0] = { ...sigs[0], sig: sigs[0].signature };

      await sendMessage({
        offerId: escrow.offerId,
        message: messageText.trim(),
        wallet: account.account,
        publicKey: account.publicKey,
        signedCmd,
      });

      setMessageText("");
      refetchMessages();
    } catch (err) {
      toast.error("Failed to send message", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setIsSendingMessage(false);
    }
  };

  const handleCloseDispute = async () => {
    if (!account || !isConnected || !dispute) return;

    if (!confirm("Are you sure you want to close this dispute? This action cannot be undone.")) {
      return;
    }

    setIsClosing(true);
    try {
      const tx = buildProfileAuthTx(account.account, account.publicKey);
      let signedCmd = await signTransaction(tx);
      if (signedCmd?.signedCmd && !signedCmd.cmd) signedCmd = signedCmd.signedCmd;
      const sigs = Array.isArray(signedCmd?.sigs) ? signedCmd.sigs : [];
      if (sigs[0] && !sigs[0].pubKey) sigs[0] = { ...sigs[0], pubKey: account.publicKey };
      if (sigs[0]?.signature && !sigs[0].sig) sigs[0] = { ...sigs[0], sig: sigs[0].signature };

      await closeDispute({
        offerId: escrow.offerId,
        wallet: account.account,
        publicKey: account.publicKey,
        signedCmd,
      });

      toast.success("Dispute closed successfully");
      refetchDispute();
    } catch (err) {
      toast.error("Failed to close dispute", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setIsClosing(false);
    }
  };

  if (!dispute) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-muted-foreground" />
            No Dispute
          </CardTitle>
          <CardDescription>No dispute has been opened for this offer.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const getRoleLabel = (wallet: string) => {
    if (wallet === escrow.buyer) return "Buyer";
    if (wallet === escrow.seller) return "Seller";
    if (wallet === escrow.arbiter) return "Arbiter";
    return "User";
  };

  return (
    <div className="space-y-4">
      {/* Dispute Header */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <AlertCircle className="h-5 w-5 text-destructive" />
                Dispute #{dispute.offerId.slice(-8)}
              </CardTitle>
              <CardDescription className="mt-1">
                Opened by {dispute.openedBy} on {new Date(dispute.createdAt).toLocaleDateString()}
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant={dispute.status === "OPEN" ? "destructive" : "secondary"}>
                {dispute.status}
              </Badge>
              {canCloseDispute && (
                <Button
                  onClick={handleCloseDispute}
                  disabled={isClosing}
                  variant="outline"
                  size="sm"
                  className="gap-2"
                >
                  {isClosing ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <X className="h-4 w-4" />
                  )}
                  Close Dispute
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <Label>Reason</Label>
            <p className="text-sm text-muted-foreground">{dispute.reason || "No reason provided"}</p>
          </div>
        </CardContent>
      </Card>

      {/* Messages */}
      {canViewEvidence && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MessageSquare className="h-5 w-5" />
              Messages ({messages.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-3 max-h-64 overflow-y-auto">
              {messages.length === 0 ? (
                <p className="text-center py-4 text-muted-foreground text-sm">No messages yet.</p>
              ) : (
                messages.map((msg) => (
                  <div
                    key={msg._id || msg.createdAt}
                    className={`p-3 rounded-lg ${
                      msg.from === account?.account
                        ? "bg-primary/10 ml-auto max-w-[80%]"
                        : "bg-muted"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-semibold">
                        {getRoleLabel(msg.from)}
                        {msg.from === escrow.arbiter && (
                          <Shield className="h-3 w-3 inline ml-1 text-primary" />
                        )}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {new Date(msg.createdAt).toLocaleTimeString()}
                      </span>
                    </div>
                    <p className="text-sm">{msg.message}</p>
                  </div>
                ))
              )}
            </div>
            {canSendMessage && (
              <div className="space-y-2 pt-2 border-t">
                <Textarea
                  value={messageText}
                  onChange={(e) => setMessageText(e.target.value)}
                  placeholder="Type your message..."
                  rows={2}
                  maxLength={2000}
                  className="resize-none"
                />
                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">{messageText.length}/2000</p>
                  <Button
                    onClick={handleSendMessage}
                    disabled={isSendingMessage || !messageText.trim()}
                    size="sm"
                    className="gap-2"
                  >
                    {isSendingMessage ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4" />
                    )}
                    Send
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Submit Evidence */}
      {canSubmitEvidence && (
        <Card>
          <CardHeader>
            <CardTitle>Submit Evidence</CardTitle>
            <CardDescription>Upload files and provide explanation</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="evidence-explanation">Explanation</Label>
              <Textarea
                id="evidence-explanation"
                value={explanation}
                onChange={(e) => setExplanation(e.target.value)}
                placeholder="Describe your evidence..."
                rows={3}
                maxLength={2000}
                className="resize-none"
              />
              <p className="text-xs text-muted-foreground">{explanation.length}/2000</p>
            </div>

            <div className="space-y-2">
              <Label>Files (Images or PDFs, max 10MB each, up to 10 files)</Label>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,application/pdf"
                multiple
                className="hidden"
                onChange={handleFileSelect}
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
                className="gap-2 w-full"
              >
                <Upload className="h-4 w-4" />
                Add Files
              </Button>
              {selectedFiles.length > 0 && (
                <div className="space-y-2">
                  {selectedFiles.map((file, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between p-2 border rounded-lg"
                    >
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        {file.type.startsWith("image/") ? (
                          <Image className="h-4 w-4 text-primary flex-shrink-0" />
                        ) : (
                          <FileText className="h-4 w-4 text-primary flex-shrink-0" />
                        )}
                        <span className="text-sm truncate">{file.name}</span>
                        <span className="text-xs text-muted-foreground">
                          ({(file.size / 1024 / 1024).toFixed(2)} MB)
                        </span>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => removeFile(idx)}
                        className="h-7 w-7 p-0"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <Button
              onClick={handleSubmitEvidence}
              disabled={isSubmitting || (selectedFiles.length === 0 && !explanation.trim())}
              className="w-full"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Submitting...
                </>
              ) : (
                <>
                  <Upload className="h-4 w-4 mr-2" />
                  Submit Evidence
                </>
              )}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Evidence List */}
      {canViewEvidence && evidenceList.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Evidence ({evidenceList.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {evidenceList.map((evidence, idx) => (
                <div key={idx} className="border rounded-lg p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="font-semibold text-sm">
                      {getRoleLabel(evidence.submittedBy)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(evidence.submittedAt).toLocaleString()}
                    </p>
                  </div>
                  {evidence.explanation && (
                    <p className="text-sm text-muted-foreground">{evidence.explanation}</p>
                  )}
                  {evidence.files.length > 0 && (
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                      {evidence.files.map((file, fileIdx) => (
                        <div key={fileIdx} className="border rounded-lg p-2">
                          {file.mimeType.startsWith("image/") ? (
                            <img
                              src={file.url}
                              alt={file.originalName}
                              className="w-full h-24 object-cover rounded cursor-pointer hover:opacity-80"
                              onClick={() => window.open(file.url, "_blank")}
                            />
                          ) : (
                            <a
                              href={file.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex flex-col items-center justify-center h-24 border rounded hover:bg-muted"
                            >
                              <FileText className="h-6 w-6 text-primary mb-1" />
                              <span className="text-xs text-center truncate w-full px-1">
                                {file.originalName}
                              </span>
                            </a>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
