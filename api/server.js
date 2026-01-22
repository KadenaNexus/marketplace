/**
 * Vercel Serverless Function wrapper for Express API
 * This wraps the Express server to work with Vercel's serverless functions
 */

import app from "../server/index.js";

// Vercel serverless function handler - catch all routes
export default async function handler(req, res) {
  // Ensure database is initialized
  if (typeof app.ensureDbInitialized === 'function') {
    await app.ensureDbInitialized();
  }
  
  // Pass request to Express app
  return app(req, res);
}
