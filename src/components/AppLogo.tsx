import { Link } from "react-router-dom";

export function AppLogo({ className = "" }: { className?: string }) {
  return (
    <div className={`flex min-w-0 items-center ${className}`}>
      <Link to="/" className="nx-brand" aria-label="Kadena P2P Marketplace — Home">
        <img src="/nexus-mark.png" width="32" height="32" alt="" />
        <span>Kadena P2P Marketplace</span>
      </Link>
      <a className="nx-part-link" href="https://kadena.ws/">
        Part of Kadena Nexus
      </a>
    </div>
  );
}
