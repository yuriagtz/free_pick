// Vercel serverless function wrapper for Express app
import express, { type Request, type Response } from "express";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerGoogleAuthRoutes } from "../server/_core/googleAuth";
import { registerGoogleOAuthRoutes } from "../server/googleOAuthRoutes";
import { appRouter } from "../server/routers";
import { createContext } from "../server/_core/context";
import path from "path";
import fs from "fs";
// Vercel automatically provides types for req and res

const app = express();

// Configure body parser
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

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

// Note: Static files are served by Vercel from dist/public
// This handler only processes API routes

// Vercel serverless function handler
// Express app can be used directly as the handler
export default app;

