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
          ignoreAllDayEvents: z.boolean().optional(),
        })
      )
      .query(async ({ ctx, input }) => {
        const token = await getGoogleTokenByUserId(ctx.user.id);

        if (!token) {
          throw new Error('Google Calendar not connected');
        }

        let accessToken = token.accessToken;
        let expiryDate = token.expiryDate.getTime();

        // Token refresh is handled automatically by the Google Calendar API client

        // Pass date strings directly to avoid timezone issues
        // calculateAvailableSlots will parse them correctly
        const startDateStr = input.startDate; // YYYY-MM-DD
        const endDateStr = input.endDate; // YYYY-MM-DD
        
        // Create Date objects for API calls (need full Date objects for Google Calendar API)
        // For Google Calendar API, we need to fetch events up to the end of the end date
        const [startYear, startMonth, startDay] = startDateStr.split('-').map(Number);
        const [endYear, endMonth, endDay] = endDateStr.split('-').map(Number);
        const startDate = new Date(startYear, startMonth - 1, startDay);
        // Add 1 day to endDate to include the entire end date
        const endDate = new Date(endYear, endMonth - 1, endDay + 1);

        let events = [];
        let apiError = null;
        
        const calendarIds = input.calendarIds || ['primary'];
        console.log('[DEBUG] Calendar IDs:', calendarIds);
        
        try {
          events = await getCalendarEvents(
            accessToken,
            token.refreshToken,
            expiryDate,
            startDate,
            endDate,
            calendarIds
          );
        } catch (error: any) {
          console.error('Error fetching calendar events:', error);
          throw error;
        }

        const result = calculateAvailableSlots(
          events,
          startDateStr,
          endDateStr,
          input.workingHoursStart,
          input.workingHoursEnd,
          input.slotDurationMinutes,
          input.bufferMinutes || 0,
          input.excludedDays || [],
          input.mergeSlots || false,
          input.ignoreAllDayEvents ?? false // Default to false (birthdays are always ignored)
        );
        
        const availableSlots = result.slots;

        const formattedText = formatSlotsAsText(availableSlots);

        // Count slots by date
        const slotsByDate: Record<string, number> = {};
        availableSlots.forEach(slot => {
          const date = new Date(slot.start).toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo' });
          slotsByDate[date] = (slotsByDate[date] || 0) + 1;
        });

        const debugInfo = {
          inputStartDate: input.startDate,
          inputEndDate: input.endDate,
          parsedStartDate: startDate.toISOString(),
          parsedEndDate: endDate.toISOString(),
          totalEvents: events.length,
          startDateComponents: {
            year: startDate.getFullYear(),
            month: startDate.getMonth(),
            day: startDate.getDate()
          },
          endDateComponents: {
            year: endDate.getFullYear(),
            month: endDate.getMonth(),
            day: endDate.getDate()
          },
          startDateNum: result.debug.startDateNum,
          endDateNum: result.debug.endDateNum,
          processedDates: result.debug.processedDates,
          slotsByDate
        };

        return {
          slots: availableSlots,
          formattedText,
          totalSlots: availableSlots.length,
          debug: debugInfo,
        };
      }),
  }),
});

export type AppRouter = typeof appRouter;
