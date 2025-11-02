// Vercel serverless function wrapper for Express app
import express, { type Request, type Response } from "express";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerGoogleAuthRoutes } from "../server/_core/googleAuth";
import { registerGoogleOAuthRoutes } from "../server/googleOAuthRoutes";
import { appRouter } from "../server/routers";
import { createContext } from "../server/_core/context";
import path from "path";
import fs from "fs";

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

// Serve static files in production
const distPath = path.resolve(process.cwd(), "dist", "public");
if (process.env.NODE_ENV === "production" && fs.existsSync(distPath)) {
  app.use(express.static(distPath));

  // Fallback to index.html for SPA routing
  app.get("*", (req: Request, res: Response) => {
    // Don't serve index.html for API routes
    if (req.path.startsWith("/api/")) {
      return res.status(404).json({ error: "Not found" });
    }
    const indexPath = path.join(distPath, "index.html");
    if (fs.existsSync(indexPath)) {
      let template = fs.readFileSync(indexPath, "utf-8");
      
      // Replace environment variables
      const appLogo = process.env.VITE_APP_LOGO || "https://placehold.co/128x128/E1E7EF/1F2937?text=App";
      const appTitle = process.env.VITE_APP_TITLE || "App";
      template = template.replace(/__VITE_APP_LOGO__/g, appLogo);
      template = template.replace(/__VITE_APP_TITLE__/g, appTitle);
      
      // Handle analytics
      const analyticsEndpoint = process.env.VITE_ANALYTICS_ENDPOINT || "";
      const analyticsWebsiteId = process.env.VITE_ANALYTICS_WEBSITE_ID || "";
      if (analyticsEndpoint && analyticsWebsiteId) {
        template = template.replace(
          /<script id="analytics-script"[^>]*><\/script>/,
          `<script defer src="${analyticsEndpoint}/umami" data-website-id="${analyticsWebsiteId}"></script>`
        );
      } else {
        template = template.replace(
          /<script id="analytics-script"[^>]*><\/script>/,
          ""
        );
      }
      
      res.status(200).set({ "Content-Type": "text/html" }).end(template);
    } else {
      res.status(404).json({ error: "index.html not found" });
    }
  });
}

// Export as Vercel serverless function
export default app;

