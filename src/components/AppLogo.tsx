import { Link } from "react-router-dom";

export function AppLogo({
  className = "",
  subtitle,
  showBack = true,
}: {
  className?: string;
  subtitle?: React.ReactNode;
  showBack?: boolean;
}) {
  return (
    <div className={`flex items-center gap-4 ${className}`}>
      {showBack && (
        <a
          href="https://kadena.ws"
          className="hidden text-sm font-medium text-foreground opacity-70 transition-all hover:opacity-100 lg:block"
        >
          ← Back to Kadena Nexus
        </a>
      )}

      <Link
        to="/"
        className="inline-flex items-center gap-3 no-underline text-foreground hover:opacity-90 transition-opacity"
        aria-label="KadenaEscrow – Decentralized P2P Trading Marketplace — Home"
      >
        <span className="relative flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-primary/15 ring-1 ring-primary/20">
          <svg
            viewBox="0 0 40 40"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className="h-6 w-6 text-primary"
            aria-hidden
          >
            <path
              d="M20 4l14 8v16l-14 8-14-8V12L20 4z"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinejoin="round"
              fill="none"
            />
            <path
              d="M14 12v16M14 12l10 8M14 20l10 8"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M26 26h6M26 22h4"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </span>

        <div className="flex flex-col leading-tight">
          <span className="font-bold text-base sm:text-lg tracking-tight leading-snug">
            KadenaEscrow – Decentralized P2P Trading Marketplace
          </span>

          <p
            className="text-xs text-muted-foreground font-mono leading-tight"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            {subtitle ?? "Secure • Trustless"}
          </p>

          <a href="https://kadena.ws" className="kadena-sub-brand">
            Part of the Kadena Nexus Ecosystem
          </a>
        </div>
      </Link>
    </div>
  );
}
