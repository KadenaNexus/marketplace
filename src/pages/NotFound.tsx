import { useEffect } from "react";

// nginx serves the app for every path, so unknown URLs return HTTP 200.
// Mark them noindex so search engines don't list them as pages (a soft 404).
const NotFound = () => {
  useEffect(() => {
    const prevTitle = document.title;
    document.title = "Page not found | Kadena P2P Marketplace";
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex";
    document.head.appendChild(meta);
    return () => {
      meta.remove();
      document.title = prevTitle;
    };
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted">
      <div className="text-center">
        <h1 className="mb-4 text-4xl font-bold">404</h1>
        <p className="mb-4 text-xl text-muted-foreground">Oops! Page not found</p>
        <a href="/" className="text-primary underline hover:text-primary/90">
          Return to Home
        </a>
      </div>
    </div>
  );
};

export default NotFound;
