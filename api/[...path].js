/**
 * Vercel Serverless Function - Catch-all route for Express API
 * This handles all /api/* routes
 */

import app from "../server/index.js";

// Vercel serverless function handler
export default async function handler(req, res) {
  // Ensure database is initialized
  if (typeof app.ensureDbInitialized === 'function') {
    await app.ensureDbInitialized();
  }
  
  // Preserve the original URL path for Express routing
  // Vercel rewrites might change the path, so we restore it
  const originalUrl = req.url || `/api${req.path || ''}`;
  if (!req.url || !req.url.startsWith('/api')) {
    req.url = originalUrl;
  }
  
  // Pass request to Express app
  return app(req, res);
}
