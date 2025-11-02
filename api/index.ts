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
  return {
    httpOnly: true,
    path: "/",
    sameSite: "none" as const,
    secure: isSecureRequest(req),
  };
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
    const expiresInSeconds = Math.floor((tokens.expiryDate - Date.now()) / 1000);

    const encryptedToken = await new SignJWT({
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiryDate: tokens.expiryDate,
      scope: tokens.scope || "",
    })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setExpirationTime(expiresInSeconds)
      .sign(secretKey);

    const cookieOptions = getSessionCookieOptions(req);
    res.cookie(GOOGLE_TOKEN_COOKIE_NAME, encryptedToken, {
      ...cookieOptions,
      maxAge: 365 * 24 * 60 * 60 * 1000, // 1 year
    });
  }

  async getTokens(req: Request): Promise<GoogleTokenData | null> {
    const cookies = this.parseCookies(req.headers.cookie);
    const tokenCookie = cookies.get(GOOGLE_TOKEN_COOKIE_NAME);

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
      return false;
    }
    const now = Date.now();
    return tokens.expiryDate > now - 5 * 60 * 1000;
  }
}

const googleTokenCookie = new GoogleTokenCookie();

// ==================== Google OAuth Client ====================
const oauth2Client = new google.auth.OAuth2(
  ENV.googleClientId,
  ENV.googleClientSecret,
  `${ENV.baseUrl || "http://localhost:3000"}/api/auth/google/callback`
);

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
app.get("/api/auth/google", async (req: Request, res: Response) => {
  try {
    if (!ENV.googleClientId || !ENV.googleClientSecret) {
      console.error("[Google Auth] Missing required environment variables");
      return res.status(500).json({
        error: "Google OAuth is not configured. Please set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables.",
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
      details: error instanceof Error ? error.message : String(error),
    });
  }
});

app.get("/api/auth/google/callback", async (req: Request, res: Response) => {
  const code = req.query.code as string;

  if (!code) {
    res.status(400).json({ error: "Authorization code is missing" });
    return;
  }

  try {
    const { tokens } = await oauth2Client.getToken(code);
    if (!tokens.access_token || !tokens.id_token) {
      res.status(400).json({ error: "Failed to get tokens" });
      return;
    }

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

app.get("/api/google/callback", async (req: Request, res: Response) => {
  res.redirect("/api/auth/google/callback");
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
      const connected = await googleTokenCookie.isConnected(ctx.req);
      return { connected };
    }),

    disconnect: publicProcedure.mutation(async ({ ctx }) => {
      googleTokenCookie.clearTokens(ctx.res, ctx.req);
      return { success: true };
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
