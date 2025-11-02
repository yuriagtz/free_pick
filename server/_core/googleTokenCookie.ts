import { parse as parseCookieHeader } from "cookie";
import type { Request, Response } from "express";
import { SignJWT, jwtVerify } from "jose";
import { ENV } from "./env";
import { getSessionCookieOptions } from "./cookies";

const GOOGLE_TOKEN_COOKIE_NAME = "google_calendar_token";

export interface GoogleTokenData {
  accessToken: string;
  refreshToken: string;
  expiryDate: number; // timestamp
  scope?: string;
}

/**
 * Google Calendar tokens stored in encrypted Cookie (no DB needed)
 */
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

  /**
   * Save Google tokens to encrypted cookie
   */
  async saveTokens(
    res: Response,
    req: Request,
    tokens: GoogleTokenData
  ): Promise<void> {
    const secretKey = this.getTokenSecret();
    const expiresInSeconds = Math.floor(
      (tokens.expiryDate - Date.now()) / 1000
    );

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
    // Set longer expiry for refresh token (1 year)
    res.cookie(GOOGLE_TOKEN_COOKIE_NAME, encryptedToken, {
      ...cookieOptions,
      maxAge: 365 * 24 * 60 * 60 * 1000, // 1 year
    });
  }

  /**
   * Get Google tokens from cookie
   */
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

  /**
   * Clear Google tokens cookie
   */
  clearTokens(res: Response, req: Request): void {
    const cookieOptions = getSessionCookieOptions(req);
    res.clearCookie(GOOGLE_TOKEN_COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
  }

  /**
   * Check if tokens are available and valid
   */
  async isConnected(req: Request): Promise<boolean> {
    const tokens = await this.getTokens(req);
    if (!tokens) {
      return false;
    }
    // Check if token is expired (with 5 minute buffer)
    const now = Date.now();
    return tokens.expiryDate > now - 5 * 60 * 1000;
  }
}

export const googleTokenCookie = new GoogleTokenCookie();

