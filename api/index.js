/**
 * Vercel Serverless Function - Main API handler
 * This handles all /api/* routes
 */

import app from "../server/index.js";

// Vercel serverless function handler
export default async function handler(req, res) {
  // Ensure database is initialized
  if (typeof app.ensureDbInitialized === 'function') {
    await app.ensureDbInitialized();
  }
  
  // Get the original request path from Vercel's rewrite
  // Check various possible headers/query params that Vercel might use
  let originalPath = req.url;
  
  // Try to get original path from query parameter (if rewrite added it)
  if (req.query && req.query.path) {
    originalPath = `/api/${req.query.path}`;
  }
  
  // Or check if URL doesn't start with /api, reconstruct it
  if (!originalPath.startsWith('/api')) {
    // Try to get from headers
    const rewritePath = req.headers['x-vercel-rewrite-path'] || 
                       req.headers['x-invoke-path'];
    if (rewritePath) {
      originalPath = rewritePath;
    } else {
      // Fallback: assume it should be /api + current path
      originalPath = `/api${req.path || req.url || ''}`;
    }
  }
  
  // Update req.url and req.originalUrl for Express
  req.url = originalPath;
  req.originalUrl = originalPath;
  
  // Pass request to Express app
  return app(req, res);
}
