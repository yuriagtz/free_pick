import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { z } from "zod";
import { getAuthUrl, getTokensFromCode, getCalendarEvents, getCalendarList, calculateAvailableSlots, formatSlotsAsText } from "./googleCalendar";
import { upsertGoogleToken, getGoogleTokenByUserId, deleteGoogleTokenByUserId } from "./db";

export const appRouter = router({
    // if you need to use socket.io, read and register route in server/_core/index.ts, all api should start with '/api/' so that the gateway can route correctly
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
  }),

  calendar: router({
    getAuthUrl: protectedProcedure.query(() => {
      return { url: getAuthUrl() };
    }),

    getConnectionStatus: protectedProcedure.query(async ({ ctx }) => {
      const token = await getGoogleTokenByUserId(ctx.user.id);
      return { connected: !!token };
    }),

    handleCallback: protectedProcedure
      .input(z.object({ code: z.string() }))
      .mutation(async ({ ctx, input }) => {
        const tokens = await getTokensFromCode(input.code);

        if (!tokens.access_token || !tokens.refresh_token || !tokens.expiry_date) {
          throw new Error('Failed to get tokens from Google');
        }

        await upsertGoogleToken({
          userId: ctx.user.id,
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          expiryDate: new Date(tokens.expiry_date),
          scope: tokens.scope || '',
        });

        return { success: true };
      }),

    disconnect: protectedProcedure.mutation(async ({ ctx }) => {
      await deleteGoogleTokenByUserId(ctx.user.id);
      return { success: true };
    }),

    getCalendarList: protectedProcedure.query(async ({ ctx }) => {
      const token = await getGoogleTokenByUserId(ctx.user.id);
      if (!token) {
        throw new Error('Google Calendar not connected');
      }

      const accessToken = token.accessToken;
      const expiryDate = token.expiryDate.getTime();

      try {
        const calendars = await getCalendarList(
          accessToken,
          token.refreshToken,
          expiryDate
        );

        return { calendars };
      } catch (error: any) {
        console.error('Error fetching calendar list:', error);
        throw new Error(`Failed to fetch calendar list: ${error.message}`);
      }
    }),

    getAvailableSlots: protectedProcedure
      .input(
        z.object({
          startDate: z.string(),
          endDate: z.string(),
          workingHoursStart: z.number().min(0).max(23),
          workingHoursEnd: z.number().min(0).max(23),
          slotDurationMinutes: z.number().min(15).max(240),
          calendarIds: z.array(z.string()).optional(),
          bufferMinutes: z.number().min(0).max(120).optional(),
          mergeSlots: z.boolean().optional(),
          excludedDays: z.array(z.number().min(0).max(6)).optional(),
        })
      )
      .query(async ({ ctx, input }) => {
        const token = await getGoogleTokenByUserId(ctx.user.id);

        if (!token) {
          throw new Error('Google Calendar not connected');
        }

        let accessToken = token.accessToken;
        let expiryDate = token.expiryDate.getTime();

        if (expiryDate < Date.now()) {
          const newTokens = await refreshAccessToken(token.refreshToken);
          if (newTokens.access_token && newTokens.expiry_date) {
            accessToken = newTokens.access_token;
            expiryDate = newTokens.expiry_date;

            await upsertGoogleToken({
              userId: ctx.user.id,
              accessToken: newTokens.access_token,
              refreshToken: token.refreshToken,
              expiryDate: new Date(newTokens.expiry_date),
              scope: token.scope,
            });
          }
        }

        const startDate = new Date(input.startDate);
        const endDate = new Date(input.endDate);

        let events = [];
        let apiError = null;
        
        try {
          events = await getCalendarEvents(
            accessToken,
            token.refreshToken,
            expiryDate,
            startDate,
            endDate,
            input.calendarIds || ['primary']
          );
        } catch (error: any) {
          console.error('Error fetching calendar events:', error);
          throw error;
        }

        const availableSlots = calculateAvailableSlots(
          events,
          startDate,
          endDate,
          input.workingHoursStart,
          input.workingHoursEnd,
          input.slotDurationMinutes,
          input.bufferMinutes || 0,
          input.mergeSlots || false,
          input.excludedDays || []
        );

        const formattedText = formatSlotsAsText(availableSlots);

        return {
          slots: availableSlots,
          formattedText,
          totalSlots: availableSlots.length,
        };
      }),
  }),
});

export type AppRouter = typeof appRouter;
