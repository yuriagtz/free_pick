import type { Express, Request, Response } from "express";
import { google } from "googleapis";
import { ENV } from "./env";
import { googleTokenCookie } from "./googleTokenCookie";

const oauth2Client = new google.auth.OAuth2(
  ENV.googleClientId,
  ENV.googleClientSecret,
  `${ENV.baseUrl || "http://localhost:3000"}/api/auth/google/callback`
);

/**
 * Register Google OAuth authentication routes
 * No user authentication - just Google Calendar OAuth
 */
export function registerGoogleAuthRoutes(app: Express) {
  // Start Google OAuth flow
  app.get("/api/auth/google", async (req: Request, res: Response) => {
    try {
      // Validate environment variables
      if (!ENV.googleClientId || !ENV.googleClientSecret) {
        console.error("[Google Auth] Missing required environment variables");
        return res.status(500).json({ 
          error: "Google OAuth is not configured. Please set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables." 
        });
      }

      const scopes = [
        "https://www.googleapis.com/auth/userinfo.email",
        "https://www.googleapis.com/auth/userinfo.profile",
        "https://www.googleapis.com/auth/calendar.readonly",
        "https://www.googleapis.com/auth/calendar.events.readonly",
      ];

      const authUrl = oauth2Client.generateAuthUrl({
        access_type: "offline",
        scope: scopes,
        prompt: "consent",
      });

      res.redirect(302, authUrl);
    } catch (error) {
      console.error("[Google Auth] Failed to generate auth URL:", error);
      res.status(500).json({ 
        error: "Failed to start authentication",
        details: error instanceof Error ? error.message : String(error)
      });
    }
  });

  // Google OAuth callback
  app.get("/api/auth/google/callback", async (req: Request, res: Response) => {
    const code = req.query.code as string;

    if (!code) {
      res.status(400).json({ error: "Authorization code is missing" });
      return;
    }

    try {
      // Exchange code for tokens
      const { tokens } = await oauth2Client.getToken(code);
      if (!tokens.access_token || !tokens.id_token) {
        res.status(400).json({ error: "Failed to get tokens" });
        return;
      }

      // Store Google Calendar tokens in cookie (no DB needed)
      if (tokens.access_token && tokens.refresh_token && tokens.expiry_date) {
        await googleTokenCookie.saveTokens(res, req, {
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          expiryDate: tokens.expiry_date,
          scope: "calendar",
        });
      }

      res.redirect(302, "/?google_connected=true");
    } catch (error) {
      console.error("[Google Auth] Callback failed:", error);
      res.status(500).json({ error: "Authentication failed" });
    }
  });
}
