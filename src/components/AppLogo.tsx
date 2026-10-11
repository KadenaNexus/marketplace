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

      <div className="flex flex-col leading-tight">
        <Link
          to="/"
          className="inline-flex items-center gap-3 text-foreground no-underline transition-opacity hover:opacity-90"
          aria-label="Kadena P2P Marketplace — Home"
        >
          <span className="relative flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-primary/10 ring-1 ring-primary/20 sm:h-10 sm:w-10">
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
          <span className="font-display text-base font-bold tracking-tight sm:text-lg">
            Kadena P2P Marketplace
          </span>
        </Link>

        <div className="ms-12 flex flex-wrap items-center gap-x-2 text-xs leading-tight sm:ms-[3.25rem]">
          <a href="https://kadena.ws" className="kadena-sub-brand">
            Part of Kadena Nexus
          </a>
          {subtitle && (
            <span className="font-mono text-muted-foreground" style={{ fontFamily: "var(--font-mono)" }}>
              {subtitle}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
