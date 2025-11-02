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

    getAvailableSlots: publicProcedure
      .input(
        z.object({
          startDate: z.string(),
          endDate: z.string(),
          workingHoursStart: z.number().min(0).max(23),
          workingHoursEnd: z.number().min(0).max(23),
          slotDurationMinutes: z.number().min(15).max(240),
          calendarIds: z.array(z.string()).optional(),
          bufferBeforeMinutes: z.number().min(0).max(120).optional(),
          bufferAfterMinutes: z.number().min(0).max(120).optional(),
          mergeSlots: z.boolean().optional(),
          excludedDays: z.array(z.number().min(0).max(6)).optional(),
          ignoreAllDayEvents: z.boolean().optional(),
        })
      )
      .query(async ({ ctx, input }) => {
        const tokens = await googleTokenCookie.getTokens(ctx.req);

        if (!tokens) {
          throw new Error("Google Calendar not connected");
        }

        try {
          console.log("[tRPC getAvailableSlots] Starting...", { input });
          
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

          // Parse dates
          const startDateStr = input.startDate;
          const endDateStr = input.endDate;
          const [startYear, startMonth, startDay] = startDateStr.split("-").map(Number);
          const [endYear, endMonth, endDay] = endDateStr.split("-").map(Number);
          const startDate = new Date(startYear, startMonth - 1, startDay);
          const endDate = new Date(endYear, endMonth - 1, endDay + 1);

          // Set time to start and end of day in UTC
          const timeMinUTC = new Date(startDate);
          timeMinUTC.setUTCHours(0, 0, 0, 0);
          const timeMaxUTC = new Date(endDate);
          timeMaxUTC.setUTCHours(23, 59, 59, 999);

          // Fetch events from all selected calendars
          const calendarIds = input.calendarIds || ["primary"];
          const allEvents: any[] = [];
          
          for (const calendarId of calendarIds) {
            try {
              const response = await calendar.events.list({
                calendarId,
                timeMin: timeMinUTC.toISOString(),
                timeMax: timeMaxUTC.toISOString(),
                singleEvents: true,
                orderBy: "startTime",
              });
              allEvents.push(...(response.data.items || []));
            } catch (error) {
              console.error(`[tRPC getAvailableSlots] Error fetching events from calendar ${calendarId}:`, error);
            }
          }

          console.log("[tRPC getAvailableSlots] Found", allEvents.length, "events");

          // Calculate available slots (simplified implementation)
          const availableSlots: Array<{ start: Date; end: Date }> = [];

          function createJSTDate(year: number, month: number, day: number, hour: number, minute: number = 0): Date {
            return new Date(Date.UTC(year, month, day, hour - 9, minute, 0, 0));
          }

          function parseEventTime(dateTimeStr: string | undefined, dateStr: string | undefined): Date | null {
            if (dateTimeStr) {
              return new Date(dateTimeStr);
            } else if (dateStr) {
              const [y, m, d] = dateStr.split("-").map(Number);
              return createJSTDate(y, m - 1, d, 0, 0);
            }
            return null;
          }

          const [sYear, sMonth0, sDay] = startDateStr.split("-").map(Number);
          const [eYear, eMonth0, eDay] = endDateStr.split("-").map(Number);
          const sMonth = sMonth0 - 1;
          const eMonth = eMonth0 - 1;
          const startDateNum = sYear * 10000 + (sMonth + 1) * 100 + sDay;
          const endDateNum = eYear * 10000 + (eMonth + 1) * 100 + eDay;

          let currentYear = sYear;
          let currentMonth = sMonth;
          let currentDay = sDay;
          const processedDates: string[] = [];

          while (true) {
            const currentDateNum = currentYear * 10000 + (currentMonth + 1) * 100 + currentDay;
            if (currentDateNum > endDateNum) break;

            const year = currentYear;
            const month = currentMonth;
            const day = currentDay;
            const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
            processedDates.push(dateStr);

            const tempDate = new Date(year, month, day);
            const dayOfWeek = tempDate.getDay();

            if ((input.excludedDays || []).includes(dayOfWeek)) {
              currentDay++;
              const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
              if (currentDay > daysInMonth) {
                currentDay = 1;
                currentMonth++;
                if (currentMonth > 11) {
                  currentMonth = 0;
                  currentYear++;
                }
              }
              continue;
            }

            const dayStart = createJSTDate(year, month, day, input.workingHoursStart);
            const dayEnd = createJSTDate(year, month, day, input.workingHoursEnd);

            const dayEvents = allEvents.filter((event) => {
              const summary = event.summary || "";
              const isAllDayEvent = !!event.start?.date;
              if (isAllDayEvent && (summary.includes("誕生日") || summary.toLowerCase().includes("birthday"))) {
                return false;
              }
              if ((input.ignoreAllDayEvents ?? true) && isAllDayEvent) {
                return false;
              }
              const eventStart = parseEventTime(event.start?.dateTime, event.start?.date);
              const eventEnd = parseEventTime(event.end?.dateTime, event.end?.date);
              if (!eventStart || !eventEnd) return false;
              return eventStart < dayEnd && eventEnd > dayStart;
            });

            dayEvents.sort((a, b) => {
              const aStart = parseEventTime(a.start?.dateTime, a.start?.date);
              const bStart = parseEventTime(b.start?.dateTime, b.start?.date);
              if (!aStart || !bStart) return 0;
              return aStart.getTime() - bStart.getTime();
            });

            let currentSlotStart = new Date(dayStart);

            for (const event of dayEvents) {
              const eventStart = parseEventTime(event.start?.dateTime, event.start?.date);
              const eventEnd = parseEventTime(event.end?.dateTime, event.end?.date);
              if (!eventStart || !eventEnd) continue;

              let adjustedEventStart = new Date(eventStart.getTime() - (input.bufferBeforeMinutes || 0) * 60 * 1000);
              let adjustedEventEnd = new Date(eventEnd.getTime() + (input.bufferAfterMinutes || 0) * 60 * 1000);
              adjustedEventStart = adjustedEventStart < dayStart ? dayStart : adjustedEventStart;
              adjustedEventEnd = adjustedEventEnd > dayEnd ? dayEnd : adjustedEventEnd;

              if (currentSlotStart < adjustedEventStart) {
                if (input.mergeSlots) {
                  availableSlots.push({
                    start: new Date(currentSlotStart),
                    end: new Date(adjustedEventStart),
                  });
                } else {
                  let slotStart = new Date(currentSlotStart);
                  while (slotStart.getTime() + input.slotDurationMinutes * 60 * 1000 <= adjustedEventStart.getTime()) {
                    const slotEnd = new Date(slotStart.getTime() + input.slotDurationMinutes * 60 * 1000);
                    availableSlots.push({
                      start: new Date(slotStart),
                      end: new Date(slotEnd),
                    });
                    slotStart = new Date(slotEnd);
                  }
                }
              }

              currentSlotStart = adjustedEventEnd > currentSlotStart ? new Date(adjustedEventEnd) : currentSlotStart;
            }

            if (currentSlotStart < dayEnd) {
              if (input.mergeSlots) {
                availableSlots.push({
                  start: new Date(currentSlotStart),
                  end: new Date(dayEnd),
                });
              } else {
                let slotStart = new Date(currentSlotStart);
                while (slotStart.getTime() + input.slotDurationMinutes * 60 * 1000 <= dayEnd.getTime()) {
                  const slotEnd = new Date(slotStart.getTime() + input.slotDurationMinutes * 60 * 1000);
                  availableSlots.push({
                    start: new Date(slotStart),
                    end: new Date(slotEnd),
                  });
                  slotStart = new Date(slotEnd);
                }
              }
            }

            currentDay++;
            const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
            if (currentDay > daysInMonth) {
              currentDay = 1;
              currentMonth++;
              if (currentMonth > 11) {
                currentMonth = 0;
                currentYear++;
              }
            }
          }

          // Format slots as text
          let formattedText = "";
          if (availableSlots.length === 0) {
            formattedText = "指定期間に空き時間が見つかりませんでした。";
          } else {
            const slotsByDate = new Map<string, Array<{ start: Date; end: Date }>>();
            for (const slot of availableSlots) {
              const dateKey = slot.start.toLocaleDateString("ja-JP", {
                timeZone: "Asia/Tokyo",
                year: "numeric",
                month: "2-digit",
                day: "2-digit",
                weekday: "short",
              });
              if (!slotsByDate.has(dateKey)) {
                slotsByDate.set(dateKey, []);
              }
              slotsByDate.get(dateKey)!.push(slot);
            }

            for (const [dateKey, dateSlots] of slotsByDate) {
              formattedText += `■ ${dateKey}\n`;
              for (const slot of dateSlots) {
                const startTime = slot.start.toLocaleTimeString("ja-JP", {
                  timeZone: "Asia/Tokyo",
                  hour: "2-digit",
                  minute: "2-digit",
                  hour12: false,
                });
                const endTime = slot.end.toLocaleTimeString("ja-JP", {
                  timeZone: "Asia/Tokyo",
                  hour: "2-digit",
                  minute: "2-digit",
                  hour12: false,
                });
                formattedText += `  ${startTime} - ${endTime}\n`;
              }
              formattedText += "\n";
            }
            formattedText = formattedText.trim();
          }

          const slotsByDate: Record<string, number> = {};
          availableSlots.forEach((slot) => {
            const date = new Date(slot.start).toLocaleDateString("ja-JP", {
              timeZone: "Asia/Tokyo",
            });
            slotsByDate[date] = (slotsByDate[date] || 0) + 1;
          });

          console.log("[tRPC getAvailableSlots] Found", availableSlots.length, "slots");

          return {
            slots: availableSlots,
            formattedText,
            totalSlots: availableSlots.length,
            debug: {
              inputStartDate: input.startDate,
              inputEndDate: input.endDate,
              parsedStartDate: startDate.toISOString(),
              parsedEndDate: endDate.toISOString(),
              totalEvents: allEvents.length,
              startDateComponents: {
                year: startDate.getFullYear(),
                month: startDate.getMonth(),
                day: startDate.getDate(),
              },
              endDateComponents: {
                year: endDate.getFullYear(),
                month: endDate.getMonth(),
                day: endDate.getDate(),
              },
              startDateNum,
              endDateNum,
              processedDates,
              slotsByDate,
            },
          };
        } catch (error: any) {
          console.error("[tRPC getAvailableSlots] Error:", error);
          throw new Error(`Failed to fetch available slots: ${error.message}`);
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
