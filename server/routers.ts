import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { z } from "zod";
import {
  getAuthUrl,
  getTokensFromCode,
  getCalendarEvents,
  getCalendarList,
  calculateAvailableSlots,
  formatSlotsAsText,
} from "./googleCalendar";
import { googleTokenCookie } from "./_core/googleTokenCookie";

export const appRouter = router({
  // if you need to use socket.io, read and register route in server/_core/index.ts, all api should start with '/api/' so that the gateway can route correctly
  system: systemRouter,

  calendar: router({
    getAuthUrl: publicProcedure.query(({ ctx }) => {
      try {
        // Use the same route as the direct link - /api/auth/google
        const baseUrl = process.env.BASE_URL || 
                       (typeof ctx.req.headers.origin === 'string' ? ctx.req.headers.origin : null) ||
                       (typeof ctx.req.headers.host === 'string' ? `${ctx.req.headers['x-forwarded-proto'] || 'https'}://${ctx.req.headers.host}` : null) ||
                       'http://localhost:3000';
        return { url: `${baseUrl}/api/auth/google` };
      } catch (error) {
        console.error('[getAuthUrl] Error:', error);
        // Fallback to relative URL
        return { url: '/api/auth/google' };
      }
    }),

    getConnectionStatus: publicProcedure.query(async ({ ctx }) => {
      const connected = await googleTokenCookie.isConnected(ctx.req);
      return { connected };
    }),

    handleCallback: publicProcedure
      .input(z.object({ code: z.string() }))
      .mutation(async ({ ctx, input }) => {
        const tokens = await getTokensFromCode(input.code);

        if (!tokens.access_token || !tokens.refresh_token || !tokens.expiry_date) {
          throw new Error("Failed to get tokens from Google");
        }

        // Save tokens to cookie (no DB needed)
        await googleTokenCookie.saveTokens(ctx.res, ctx.req, {
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          expiryDate: tokens.expiry_date,
          scope: tokens.scope || "",
        });

        return { success: true };
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
        const calendars = await getCalendarList(
          tokens.accessToken,
          tokens.refreshToken,
          tokens.expiryDate
        );

        return { calendars };
      } catch (error: any) {
        console.error("Error fetching calendar list:", error);
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

        // Pass date strings directly to avoid timezone issues
        const startDateStr = input.startDate; // YYYY-MM-DD
        const endDateStr = input.endDate; // YYYY-MM-DD

        // Create Date objects for API calls
        const [startYear, startMonth, startDay] = startDateStr.split("-").map(Number);
        const [endYear, endMonth, endDay] = endDateStr.split("-").map(Number);
        const startDate = new Date(startYear, startMonth - 1, startDay);
        const endDate = new Date(endYear, endMonth - 1, endDay + 1);

        let events = [];

        const calendarIds = input.calendarIds || ["primary"];
        console.log("[DEBUG] Calendar IDs:", calendarIds);

        try {
          events = await getCalendarEvents(
            tokens.accessToken,
            tokens.refreshToken,
            tokens.expiryDate,
            startDate,
            endDate,
            calendarIds
          );
        } catch (error: any) {
          console.error("Error fetching calendar events:", error);
          throw error;
        }

        const result = calculateAvailableSlots(
          events,
          startDateStr,
          endDateStr,
          input.workingHoursStart,
          input.workingHoursEnd,
          input.slotDurationMinutes,
          input.bufferBeforeMinutes || 0,
          input.bufferAfterMinutes || 0,
          input.excludedDays || [],
          input.mergeSlots || false,
          input.ignoreAllDayEvents ?? false
        );

        const availableSlots = result.slots;

        const formattedText = formatSlotsAsText(availableSlots);

        // Count slots by date
        const slotsByDate: Record<string, number> = {};
        availableSlots.forEach((slot) => {
          const date = new Date(slot.start).toLocaleDateString("ja-JP", {
            timeZone: "Asia/Tokyo",
          });
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
            day: startDate.getDate(),
          },
          endDateComponents: {
            year: endDate.getFullYear(),
            month: endDate.getMonth(),
            day: endDate.getDate(),
          },
          startDateNum: result.debug.startDateNum,
          endDateNum: result.debug.endDateNum,
          processedDates: result.debug.processedDates,
          slotsByDate,
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
