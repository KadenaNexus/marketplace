import { Link } from "react-router-dom";
import { AppLogo } from "@/components/AppLogo";
import { TermsText } from "@/components/Trust";

/** /terms: the terms and risks every trader accepts once before the first trade. */
export default function Terms() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card/50">
        <div className="container mx-auto flex items-center justify-between gap-3 px-4 py-4">
          <AppLogo />
          <Link to="/" className="text-sm text-primary underline">Back to the Marketplace</Link>
        </div>
      </header>
      <main className="container mx-auto max-w-2xl px-4 py-10">
        <h1 className="font-display text-3xl font-bold">Terms and risks</h1>
        <p className="mt-2 text-sm text-muted-foreground">Version of 13 October 2026. Every trader accepts these once, before the first trade.</p>
        <TermsText className="mt-8" />
      </main>
    </div>
  );
}
