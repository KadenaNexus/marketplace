/**
 * Vercel Serverless Function - Catch-all route for Express API
 * This handles all /api/* routes using Vercel's file-based routing
 */

import app from "../server/index.js";

// Vercel serverless function handler
export default async function handler(req, res) {
  // Debug logging first to see what we receive
  console.log('[API Handler] ====== START ======');
  console.log('[API Handler] Method:', req.method);
  console.log('[API Handler] Original req.url:', req.url);
  console.log('[API Handler] req.path:', req.path);
  console.log('[API Handler] req.query:', JSON.stringify(req.query));
  console.log('[API Handler] req.query.path:', req.query?.path);
  console.log('[API Handler] req.query.path type:', typeof req.query?.path);
  console.log('[API Handler] req.query.path isArray:', Array.isArray(req.query?.path));
  
  // Ensure database is initialized
  if (typeof app.ensureDbInitialized === 'function') {
    await app.ensureDbInitialized();
  }
  
  // Get the path from Vercel's catch-all parameter
  // For api/[...path].js, when accessing /api/profiles/k:wallet
  // req.query.path will be ['profiles', 'k:wallet'] or 'profiles/k:wallet'
  let apiPath = '/api';
  
  if (req.query && req.query.path !== undefined) {
    if (Array.isArray(req.query.path)) {
      // Array of path segments - join them, preserving colons and special chars
      const decodedSegments = req.query.path.map(segment => 
        decodeURIComponent(String(segment))
      );
      apiPath = '/api/' + decodedSegments.join('/');
    } else if (typeof req.query.path === 'string') {
      // String path - decode it and use as-is
      const decodedPath = decodeURIComponent(req.query.path);
      apiPath = '/api/' + decodedPath;
    }
  } else {
    // Fallback: try to get from req.url or req.path
    // Vercel might pass the path differently
    const urlPath = req.url || req.path || '';
    if (urlPath.startsWith('/api/')) {
      // Decode the URL-encoded path
      const decoded = decodeURIComponent(urlPath.split('?')[0]);
      apiPath = decoded;
    } else if (urlPath.startsWith('/')) {
      // Decode and add /api prefix
      const decoded = decodeURIComponent(urlPath.split('?')[0]);
      apiPath = '/api' + decoded;
    }
  }
  
  console.log('[API Handler] pathSegments/reconstructed:', apiPath);
  
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
  // Make sure the path is properly decoded
  const fullPath = apiPath + queryString;
  req.url = fullPath;
  req.originalUrl = fullPath;
  
  // Also update req.path if it exists
  if (req.path !== undefined) {
    req.path = apiPath;
  }
  
  console.log('[API Handler] Reconstructed apiPath:', apiPath);
  console.log('[API Handler] Final req.url:', fullPath);
  console.log('[API Handler] ====== END ======');
  
  // Pass request to Express app
  return app(req, res);
}
