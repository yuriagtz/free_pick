// Vercel serverless function wrapper for Express app
// Self-contained implementation to avoid module resolution issues
import "dotenv/config";
import express, { type Request, type Response } from "express";
import { parse as parseCookieHeader } from "cookie";
import { SignJWT, jwtVerify } from "jose";
import { google } from "googleapis";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { initTRPC } from "@trpc/server";
import superjson from "superjson";
import { z } from "zod";

// ==================== Environment Variables ====================
const ENV = {
  cookieSecret: process.env.JWT_SECRET ?? "",
  googleClientId: process.env.GOOGLE_CLIENT_ID ?? "",
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
  baseUrl: process.env.BASE_URL ?? "",
};

// ==================== Cookie Helper Functions ====================
function isSecureRequest(req: Request) {
  if (req.protocol === "https") return true;
  const forwardedProto = req.headers["x-forwarded-proto"];
  if (!forwardedProto) return false;
  const protoList = Array.isArray(forwardedProto)
    ? forwardedProto
    : forwardedProto.split(",");
  return protoList.some(proto => proto.trim().toLowerCase() === "https");
}

function getSessionCookieOptions(req: Request) {
  const isSecure = isSecureRequest(req);
  // For Vercel/production, always use secure cookies with sameSite: "none"
  // This allows cross-origin requests
  const options = {
    httpOnly: true,
    path: "/",
    sameSite: (isSecure ? "none" : "lax") as "none" | "lax",
    secure: isSecure,
    // Don't set domain - let browser handle it automatically
  };
  console.log("[Cookie Options] Generated:", options, {
    protocol: req.protocol,
    "x-forwarded-proto": req.headers["x-forwarded-proto"],
    isSecure,
  });
  return options;
}

// ==================== Google Token Cookie Management ====================
const GOOGLE_TOKEN_COOKIE_NAME = "google_calendar_token";

interface GoogleTokenData {
  accessToken: string;
  refreshToken: string;
  expiryDate: number;
  scope?: string;
}

class GoogleTokenCookie {
  private parseCookies(cookieHeader: string | undefined) {
    if (!cookieHeader) {
      return new Map<string, string>();
    }
    const parsed = parseCookieHeader(cookieHeader);
    return new Map(Object.entries(parsed));
  }

  private getTokenSecret() {
    const secret = ENV.cookieSecret || "default-secret-change-in-production";
    if (secret === "default-secret-change-in-production") {
      console.warn(
        "[Google Token] Using default secret! Set JWT_SECRET environment variable in production."
      );
    }
    return new TextEncoder().encode(secret);
  }

  async saveTokens(res: Response, req: Request, tokens: GoogleTokenData): Promise<void> {
    const secretKey = this.getTokenSecret();
    // Set expiration time as Unix timestamp (seconds since epoch)
    // expiryDate is in milliseconds, so divide by 1000 and round down
    const expirationTimestamp = Math.floor(tokens.expiryDate / 1000);
    // Add 1 year to expiry for the cookie itself (refresh token is long-lived)
    const cookieExpirationTimestamp = Math.floor((Date.now() + 365 * 24 * 60 * 60 * 1000) / 1000);

    console.log("[Google Token] saveTokens - expiry details:", {
      expiryDate: tokens.expiryDate,
      expiryDateISO: new Date(tokens.expiryDate).toISOString(),
      expirationTimestamp,
      cookieExpirationTimestamp,
      now: Date.now(),
      nowTimestamp: Math.floor(Date.now() / 1000),
    });

    const encryptedToken = await new SignJWT({
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiryDate: tokens.expiryDate,
      scope: tokens.scope || "",
    })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setExpirationTime(cookieExpirationTimestamp) // Use absolute timestamp, not relative
      .sign(secretKey);

    const cookieOptions = getSessionCookieOptions(req);
    const finalCookieOptions = {
      ...cookieOptions,
      maxAge: 365 * 24 * 60 * 60 * 1000, // 1 year
    };
    console.log("[Google Token] Saving cookie with options:", finalCookieOptions);
    res.cookie(GOOGLE_TOKEN_COOKIE_NAME, encryptedToken, finalCookieOptions);
    console.log("[Google Token] Cookie set successfully");
  }

  async getTokens(req: Request): Promise<GoogleTokenData | null> {
    const cookies = this.parseCookies(req.headers.cookie);
    console.log("[Google Token] Cookie header:", req.headers.cookie ? "present" : "missing");
    console.log("[Google Token] Cookie header length:", req.headers.cookie?.length || 0);
    console.log("[Google Token] Parsed cookie keys:", Array.from(cookies.keys()));
    const tokenCookie = cookies.get(GOOGLE_TOKEN_COOKIE_NAME);
    console.log("[Google Token] Token cookie found:", !!tokenCookie, "Cookie name:", GOOGLE_TOKEN_COOKIE_NAME);

    if (!tokenCookie) {
      return null;
    }

    try {
      const secretKey = this.getTokenSecret();
      const { payload } = await jwtVerify(tokenCookie, secretKey, {
        algorithms: ["HS256"],
      });

      const {
        accessToken,
        refreshToken,
        expiryDate,
        scope,
      } = payload as Record<string, unknown>;

      if (
        typeof accessToken !== "string" ||
        typeof refreshToken !== "string" ||
        typeof expiryDate !== "number"
      ) {
        return null;
      }

      return {
        accessToken,
        refreshToken,
        expiryDate,
        scope: typeof scope === "string" ? scope : undefined,
      };
    } catch (error) {
      console.warn("[Google Token] Failed to decrypt token:", error);
      return null;
    }
  }

  clearTokens(res: Response, req: Request): void {
    const cookieOptions = getSessionCookieOptions(req);
    res.clearCookie(GOOGLE_TOKEN_COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
  }

  async isConnected(req: Request): Promise<boolean> {
    const tokens = await this.getTokens(req);
    if (!tokens) {
      console.log("[Google Token] isConnected: No tokens found");
      return false;
    }
    // If tokens exist (even if expired), we consider it connected
    // The token will be refreshed when needed
    const now = Date.now();
    const isExpired = tokens.expiryDate < now;
    console.log("[Google Token] isConnected: true (tokens exist)", {
      hasAccessToken: !!tokens.accessToken,
      hasRefreshToken: !!tokens.refreshToken,
      expiryDate: new Date(tokens.expiryDate).toISOString(),
      now: new Date(now).toISOString(),
      isExpired,
      timeUntilExpiry: tokens.expiryDate - now,
    });
    return true; // Tokens exist = connected (refresh token can be used to get new access token)
  }
}

const googleTokenCookie = new GoogleTokenCookie();

// ==================== Google OAuth Client ====================
// Get base URL from request or environment
function getBaseUrl(req?: Request): string {
  if (ENV.baseUrl) {
    return ENV.baseUrl;
  }
  // Try to get from request headers (for Vercel)
  if (req) {
    const origin = req.headers.origin;
    if (typeof origin === "string" && origin) {
      return origin;
    }
    const host = req.headers.host;
    const proto = req.headers["x-forwarded-proto"] || "https";
    if (typeof host === "string" && host) {
      return `${proto}://${host}`;
    }
  }
  // Fallback
  return "http://localhost:3000";
}

// OAuth client will be initialized per request with correct redirect URI
// Use /api/google/callback to match the original Manus setup
function createOAuth2Client(redirectUri: string) {
  return new google.auth.OAuth2(
    ENV.googleClientId,
    ENV.googleClientSecret,
    redirectUri
  );
}

// ==================== Express App Setup ====================
const app = express();

// Error handling middleware
app.use((err: Error, req: Request, res: Response, next: express.NextFunction) => {
  console.error("[API Error]:", err);
  res.status(500).json({
    error: "Internal server error",
    message: process.env.NODE_ENV === "production" ? "An error occurred" : err.message,
  });
});

// Body parser
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// ==================== Google OAuth Routes ====================
// Start OAuth flow
app.get("/api/auth/google", async (req: Request, res: Response) => {
  try {
    if (!ENV.googleClientId || !ENV.googleClientSecret) {
      console.error("[Google Auth] Missing required environment variables");
      return res.status(500).json({
        error: "Google OAuth is not configured. Please set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables.",
      });
    }

    const baseUrl = getBaseUrl(req);
    // Use /api/google/callback to match the original Manus setup
    const redirectUri = `${baseUrl}/api/google/callback`;
    console.log("[Google Auth] Base URL:", baseUrl);
    console.log("[Google Auth] Redirect URI:", redirectUri);
    console.log("[Google Auth] Headers:", {
      origin: req.headers.origin,
      host: req.headers.host,
      "x-forwarded-proto": req.headers["x-forwarded-proto"],
    });
    
    const oauth2Client = createOAuth2Client(redirectUri);

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
      details: error instanceof Error ? error.message : String(error),
    });
  }
});

// Main callback handler - use /api/google/callback to match original Manus setup
app.get("/api/google/callback", async (req: Request, res: Response) => {
  const code = req.query.code as string;

  if (!code) {
    res.status(400).json({ error: "Authorization code is missing" });
    return;
  }

  try {
    const baseUrl = getBaseUrl(req);
    const redirectUri = `${baseUrl}/api/google/callback`;
    console.log("[Google Auth Callback] Using redirect URI:", redirectUri);
    console.log("[Google Auth Callback] Authorization code received");
    
    const oauth2Client = createOAuth2Client(redirectUri);
    
    const { tokens } = await oauth2Client.getToken(code);
    console.log("[Google Auth Callback] Tokens received:", {
      hasAccessToken: !!tokens.access_token,
      hasRefreshToken: !!tokens.refresh_token,
      hasExpiryDate: !!tokens.expiry_date,
    });
    
    if (!tokens.access_token || !tokens.id_token) {
      console.error("[Google Auth Callback] Missing required tokens");
      res.status(400).json({ error: "Failed to get tokens" });
      return;
    }

    if (tokens.access_token && tokens.refresh_token && tokens.expiry_date) {
      console.log("[Google Auth Callback] Saving tokens to cookie...");
      await googleTokenCookie.saveTokens(res, req, {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiryDate: tokens.expiry_date,
        scope: "calendar",
      });
      console.log("[Google Auth Callback] Tokens saved to cookie successfully");
      
      // Verify cookie was set by checking response headers
      const setCookieHeader = res.getHeader("Set-Cookie");
      console.log("[Google Auth Callback] Set-Cookie header:", setCookieHeader);
      
      // Also verify immediately by reading the cookie back
      const savedTokens = await googleTokenCookie.getTokens(req);
      console.log("[Google Auth Callback] Verification - tokens readable:", !!savedTokens);
    } else {
      console.error("[Google Auth Callback] Missing tokens:", {
        hasAccessToken: !!tokens.access_token,
        hasRefreshToken: !!tokens.refresh_token,
        hasExpiryDate: !!tokens.expiry_date,
      });
    }

    console.log("[Google Auth Callback] Redirecting to /?google_connected=true");
    // Use 303 See Other instead of 302 to ensure cookie is sent
    res.redirect(303, "/?google_connected=true");
  } catch (error) {
    console.error("[Google Auth] Callback failed:", error);
    res.status(500).json({ error: "Authentication failed" });
  }
});

// Keep /api/auth/google/callback as an alias for backward compatibility
app.get("/api/auth/google/callback", async (req: Request, res: Response) => {
  // Redirect to the main callback handler
  const code = req.query.code;
  res.redirect(`/api/google/callback?code=${code}`);
});

// ==================== tRPC Setup ====================
const t = initTRPC.context<{ req: Request; res: Response }>().create({
  transformer: superjson,
});

const router = t.router;
const publicProcedure = t.procedure;

// Import the full router from server (this will need to work differently)
// For now, create a minimal router that works
const appRouter = router({
  system: router({
    health: publicProcedure
      .input(z.object({ timestamp: z.number().min(0) }))
      .query(() => ({ ok: true })),
  }),

  calendar: router({
    getAuthUrl: publicProcedure.query(({ ctx }) => {
      try {
        const baseUrl =
          process.env.BASE_URL ||
          (typeof ctx.req.headers.origin === "string" ? ctx.req.headers.origin : null) ||
          (typeof ctx.req.headers.host === "string"
            ? `${ctx.req.headers["x-forwarded-proto"] || "https"}://${ctx.req.headers.host}`
            : null) ||
          "http://localhost:3000";
        return { url: `${baseUrl}/api/auth/google` };
      } catch (error) {
        console.error("[getAuthUrl] Error:", error);
        return { url: "/api/auth/google" };
      }
    }),

    getConnectionStatus: publicProcedure.query(async ({ ctx }) => {
      try {
        console.log("[tRPC getConnectionStatus] Request headers:", {
          cookie: ctx.req.headers.cookie?.substring(0, 100) + "...",
          host: ctx.req.headers.host,
        });
        const connected = await googleTokenCookie.isConnected(ctx.req);
        console.log("[tRPC getConnectionStatus] Result:", { connected });
        return { connected };
      } catch (error) {
        console.error("[tRPC getConnectionStatus] Error:", error);
        return { connected: false };
      }
    }),

    disconnect: publicProcedure.mutation(async ({ ctx }) => {
      googleTokenCookie.clearTokens(ctx.res, ctx.req);
      return { success: true };
    }),

    getCalendarList: publicProcedure.query(async ({ ctx }) => {
      const tokens = await googleTokenCookie.getTokens(ctx.req);

      if (!tokens) {
        throw new Error("Google Calendar not connected");
      }

      try {
        console.log("[tRPC getCalendarList] Fetching calendars...");
        
        // Create OAuth2 client
        const baseUrl = getBaseUrl(ctx.req);
        const redirectUri = `${baseUrl}/api/google/callback`;
        const oauth2Client = createOAuth2Client(redirectUri);
        
        // Set credentials
        oauth2Client.setCredentials({
          access_token: tokens.accessToken,
          refresh_token: tokens.refreshToken,
          expiry_date: tokens.expiryDate,
        });

        // Create Calendar client
        const calendar = google.calendar({ version: "v3", auth: oauth2Client });
        
        // Fetch calendar list
        const response = await calendar.calendarList.list();
        
        const calendars = (response.data.items || []).map((cal) => ({
          id: cal.id || "",
          summary: cal.summary || cal.id || "",
          primary: cal.primary || false,
          backgroundColor: cal.backgroundColor,
        }));

        console.log("[tRPC getCalendarList] Found", calendars.length, "calendars");
        return { calendars };
      } catch (error: any) {
        console.error("[tRPC getCalendarList] Error:", error);
        throw new Error(`Failed to fetch calendar list: ${error.message}`);
      }
    }),
  }),
});

// tRPC API
app.use(
  "/api/trpc",
  createExpressMiddleware({
    router: appRouter,
    createContext: ({ req, res }) => ({ req, res }),
  })
);

// Export as Vercel serverless function
export default app;
