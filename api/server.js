/**
 * Vercel Serverless Function wrapper for Express API
 * This wraps the Express server to work with Vercel's serverless functions
 */

// Import the Express app from server/index.js
// Note: We need to modify server/index.js to export the app instead of starting the server
import app from "../server/index.js";

export default app;
