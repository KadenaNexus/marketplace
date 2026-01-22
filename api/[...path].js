/**
 * Vercel Serverless Function - Catch-all route for Express API
 * This handles all /api/* routes using Vercel's file-based routing
 */

import app from "../server/index.js";

// Vercel serverless function handler
export default async function handler(req, res) {
  // Ensure database is initialized
  if (typeof app.ensureDbInitialized === 'function') {
    await app.ensureDbInitialized();
  }
  
  // Get the path from Vercel's catch-all parameter
  // For api/[...path].js, when accessing /api/profiles
  // req.query.path will be ['profiles'] or 'profiles'
  let pathSegments = [];
  
  if (req.query && req.query.path !== undefined) {
    if (Array.isArray(req.query.path)) {
      pathSegments = req.query.path;
    } else if (typeof req.query.path === 'string') {
      pathSegments = req.query.path.split('/').filter(Boolean);
    }
  }
  
  // Reconstruct the full API path
  const apiPath = '/api' + (pathSegments.length > 0 ? '/' + pathSegments.join('/') : '');
  
  // Preserve other query parameters (excluding 'path')
  const queryParams = new URLSearchParams();
  for (const [key, value] of Object.entries(req.query || {})) {
    if (key !== 'path') {
      if (Array.isArray(value)) {
        value.forEach(v => queryParams.append(key, v));
      } else {
        queryParams.append(key, value);
      }
    }
  }
  const queryString = queryParams.toString() ? '?' + queryParams.toString() : '';
  
  // Update req.url and req.originalUrl for Express routing
  const fullPath = apiPath + queryString;
  req.url = fullPath;
  req.originalUrl = fullPath;
  
  // Debug logging
  console.log('[API Handler] Method:', req.method);
  console.log('[API Handler] Original req.url:', req.url);
  console.log('[API Handler] req.query.path:', req.query?.path);
  console.log('[API Handler] Reconstructed path:', fullPath);
  
  // Pass request to Express app
  return app(req, res);
}
