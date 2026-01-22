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
  
  // Reconstruct the API path from Vercel's catch-all route
  // When using [...path].js, Vercel passes path segments in req.query.path
  let apiPath = '/api';
  
  if (req.query && req.query.path) {
    // req.query.path is an array of path segments
    const pathSegments = Array.isArray(req.query.path) 
      ? req.query.path 
      : typeof req.query.path === 'string' 
        ? req.query.path.split('/').filter(Boolean)
        : [];
    
    if (pathSegments.length > 0) {
      apiPath = '/api/' + pathSegments.join('/');
    }
  }
  
  // Preserve query string (excluding the path parameter)
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
  req.url = apiPath + queryString;
  req.originalUrl = req.url;
  
  // Pass request to Express app
  return app(req, res);
}
