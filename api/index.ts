// Vercel serverless function wrapper for Express app
import "dotenv/config";
import express from "express";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerGoogleAuthRoutes } from "../server/_core/googleAuth.js";
import { registerGoogleOAuthRoutes } from "../server/googleOAuthRoutes.js";
import { appRouter } from "../server/routers.js";
import { createContext } from "../server/_core/context.js";

const app = express();

// Error handling middleware (must be before routes)
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error("[API Error]:", err);
  res.status(500).json({
    error: "Internal server error",
    message: process.env.NODE_ENV === "production" ? "An error occurred" : err.message,
  });
});

// Configure body parser
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

try {
  // Google OAuth authentication
  registerGoogleAuthRoutes(app);
  // Google Calendar OAuth callback
  registerGoogleOAuthRoutes(app);

  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
} catch (error) {
  console.error("[API Setup Error]:", error);
}

// Note: Static files are served by Vercel from dist/public
// This handler only processes API routes

// Vercel serverless function handler
// Express app can be used directly as the handler
export default app;

