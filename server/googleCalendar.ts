import { google } from 'googleapis';
import { ENV } from './_core/env';

const oauth2Client = new google.auth.OAuth2(
  ENV.googleClientId,
  ENV.googleClientSecret,
  `${ENV.baseUrl}/api/google/callback`
);

/**
 * Create a Google Calendar client with the given credentials
 */
function createCalendarClient(accessToken: string, refreshToken: string, expiryDate: number) {
  oauth2Client.setCredentials({
    access_token: accessToken,
    refresh_token: refreshToken,
    expiry_date: expiryDate,
  });

  return google.calendar({ version: 'v3', auth: oauth2Client });
}

/**
 * Get the authorization URL for Google Calendar
 */
export function getAuthUrl() {
  const scopes = [
    'https://www.googleapis.com/auth/calendar.readonly',
    'https://www.googleapis.com/auth/calendar.events.readonly',
  ];

  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: scopes,
    prompt: 'consent',
  });
}

/**
 * Exchange authorization code for tokens
 */
export async function getTokensFromCode(code: string) {
  const { tokens } = await oauth2Client.getToken(code);
  return tokens;
}

/**
 * Get list of user's calendars
 */
export async function getCalendarList(
  accessToken: string,
  refreshToken: string,
  expiryDate: number
) {
  const calendar = createCalendarClient(accessToken, refreshToken, expiryDate);

  const response = await calendar.calendarList.list();
  
  return (response.data.items || []).map(cal => ({
    id: cal.id!,
    summary: cal.summary || cal.id!,
    primary: cal.primary || false,
    backgroundColor: cal.backgroundColor,
  }));
}

/**
 * Get calendar events within a time range
 */
export async function getCalendarEvents(
  accessToken: string,
  refreshToken: string,
  expiryDate: number,
  timeMin: Date,
  timeMax: Date,
  calendarIds: string[] = ['primary']
) {
  const calendar = createCalendarClient(accessToken, refreshToken, expiryDate);

  // Set time to start and end of day in UTC
  const timeMinUTC = new Date(timeMin);
  timeMinUTC.setUTCHours(0, 0, 0, 0);
  
  const timeMaxUTC = new Date(timeMax);
  timeMaxUTC.setUTCHours(23, 59, 59, 999);

  // Fetch events from all selected calendars
  const allEvents = [];
  for (const calendarId of calendarIds) {
    try {
      const response = await calendar.events.list({
        calendarId,
        timeMin: timeMinUTC.toISOString(),
        timeMax: timeMaxUTC.toISOString(),
        singleEvents: true,
        orderBy: 'startTime',
      });
      allEvents.push(...(response.data.items || []));
    } catch (error) {
      console.error(`Error fetching events from calendar ${calendarId}:`, error);
    }
  }

  return allEvents;
}

/**
 * Calculate available time slots from calendar events
 * All times are handled in JST (Asia/Tokyo) timezone
 */
export function calculateAvailableSlots(
  events: any[],
  startDate: Date,
  endDate: Date,
  workingHoursStart: number = 9, // 9 AM JST
  workingHoursEnd: number = 18, // 6 PM JST
  slotDurationMinutes: number = 30,
  bufferMinutes: number = 0, // Buffer time before/after events
  mergeSlots: boolean = false, // Merge consecutive slots
  excludedDays: number[] = [] // Days to exclude (0=Sunday, 6=Saturday)
): Array<{ start: Date; end: Date }> {
  const availableSlots: Array<{ start: Date; end: Date }> = [];
  const JST_OFFSET = 9 * 60; // JST is UTC+9

  // Helper function to create JST date
  function createJSTDate(year: number, month: number, day: number, hour: number, minute: number = 0): Date {
    // Create date in UTC, then adjust for JST offset
    const date = new Date(Date.UTC(year, month, day, hour - 9, minute, 0, 0));
    return date;
  }

  // Helper function to parse event date/time to JST
  function parseEventTime(dateTimeStr: string | undefined, dateStr: string | undefined): Date | null {
    if (dateTimeStr) {
      // Parse ISO string with timezone (e.g., "2025-10-30T14:00:00+09:00")
      return new Date(dateTimeStr);
    } else if (dateStr) {
      // All-day event (e.g., "2025-11-07")
      const [year, month, day] = dateStr.split('-').map(Number);
      return createJSTDate(year, month - 1, day, 0, 0);
    }
    return null;
  }

  // Iterate through each day in the range
  // Parse dates as YYYY-MM-DD strings to avoid timezone issues
  const startYear = startDate.getFullYear();
  const startMonth = startDate.getMonth();
  const startDay = startDate.getDate();
  const endYear = endDate.getFullYear();
  const endMonth = endDate.getMonth();
  const endDay = endDate.getDate();
  
  const currentDate = new Date(startYear, startMonth, startDay);
  const endDateTime = new Date(endYear, endMonth, endDay, 23, 59, 59);

  while (currentDate <= endDateTime) {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const day = currentDate.getDate();
    const dayOfWeek = currentDate.getDay();

    // Skip excluded days
    if (!excludedDays.includes(dayOfWeek)) {
      // Create working hours in JST
      const dayStart = createJSTDate(year, month, day, workingHoursStart);
      const dayEnd = createJSTDate(year, month, day, workingHoursEnd);

      // Get events for this day
      const dayEvents = events.filter(event => {
        const eventStart = parseEventTime(event.start?.dateTime, event.start?.date);
        const eventEnd = parseEventTime(event.end?.dateTime, event.end?.date);
        
        if (!eventStart || !eventEnd) return false;

        // Check if event overlaps with this day's working hours
        return eventStart < dayEnd && eventEnd > dayStart;
      });

      // Sort events by start time
      dayEvents.sort((a, b) => {
        const aStart = parseEventTime(a.start?.dateTime, a.start?.date);
        const bStart = parseEventTime(b.start?.dateTime, b.start?.date);
        if (!aStart || !bStart) return 0;
        return aStart.getTime() - bStart.getTime();
      });

      // Find gaps between events
      let currentSlotStart = new Date(dayStart);

      for (const event of dayEvents) {
        const eventStart = parseEventTime(event.start?.dateTime, event.start?.date);
        const eventEnd = parseEventTime(event.end?.dateTime, event.end?.date);
        
        if (!eventStart || !eventEnd) continue;

        // Adjust event times to be within working hours and add buffer
        let adjustedEventStart = new Date(eventStart.getTime() - bufferMinutes * 60 * 1000);
        let adjustedEventEnd = new Date(eventEnd.getTime() + bufferMinutes * 60 * 1000);
        
        adjustedEventStart = adjustedEventStart < dayStart ? dayStart : adjustedEventStart;
        adjustedEventEnd = adjustedEventEnd > dayEnd ? dayEnd : adjustedEventEnd;

        // If there's a gap before this event
        if (currentSlotStart < adjustedEventStart) {
          // Split gap into slots
          let slotStart = new Date(currentSlotStart);
          while (slotStart.getTime() + slotDurationMinutes * 60 * 1000 <= adjustedEventStart.getTime()) {
            const slotEnd = new Date(slotStart.getTime() + slotDurationMinutes * 60 * 1000);
            availableSlots.push({
              start: new Date(slotStart),
              end: new Date(slotEnd),
            });
            slotStart = new Date(slotEnd);
          }
        }

        // Move current slot start to after this event
        currentSlotStart = adjustedEventEnd > currentSlotStart ? new Date(adjustedEventEnd) : currentSlotStart;
      }

      // Check if there's time left after the last event
      if (currentSlotStart < dayEnd) {
        let slotStart = new Date(currentSlotStart);
        while (slotStart.getTime() + slotDurationMinutes * 60 * 1000 <= dayEnd.getTime()) {
          const slotEnd = new Date(slotStart.getTime() + slotDurationMinutes * 60 * 1000);
          availableSlots.push({
            start: new Date(slotStart),
            end: new Date(slotEnd),
          });
          slotStart = new Date(slotEnd);
        }
      }
    }

    // Move to next day
    currentDate.setDate(currentDate.getDate() + 1);
  }

  // Merge consecutive slots if requested
  if (mergeSlots) {
    return mergeConsecutiveSlots(availableSlots);
  }

  return availableSlots;
}

/**
 * Merge consecutive time slots into larger blocks
 */
function mergeConsecutiveSlots(slots: Array<{ start: Date; end: Date }>): Array<{ start: Date; end: Date }> {
  if (slots.length === 0) return [];

  const merged: Array<{ start: Date; end: Date }> = [];
  let currentSlot = { start: new Date(slots[0].start), end: new Date(slots[0].end) };

  for (let i = 1; i < slots.length; i++) {
    const slot = slots[i];
    
    // Check if this slot is consecutive (starts exactly when previous ends)
    if (slot.start.getTime() === currentSlot.end.getTime()) {
      // Extend current slot
      currentSlot.end = new Date(slot.end);
    } else {
      // Save current slot and start a new one
      merged.push(currentSlot);
      currentSlot = { start: new Date(slot.start), end: new Date(slot.end) };
    }
  }

  // Don't forget the last slot
  merged.push(currentSlot);

  return merged;
}

/**
 * Format available slots as human-readable text grouped by date
 */
export function formatSlotsAsText(slots: Array<{ start: Date; end: Date }>): string {
  if (slots.length === 0) {
    return '指定期間に空き時間が見つかりませんでした。';
  }

  // Group slots by date
  const slotsByDate = new Map<string, Array<{ start: Date; end: Date }>>();

  for (const slot of slots) {
    // Format date in JST
    const dateKey = slot.start.toLocaleDateString('ja-JP', {
      timeZone: 'Asia/Tokyo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'short',
    });

    if (!slotsByDate.has(dateKey)) {
      slotsByDate.set(dateKey, []);
    }
    slotsByDate.get(dateKey)!.push(slot);
  }

  // Format output
  let output = '';
  for (const [dateKey, dateSlots] of slotsByDate) {
    output += `■ ${dateKey}\n`;
    for (const slot of dateSlots) {
      const startTime = slot.start.toLocaleTimeString('ja-JP', {
        timeZone: 'Asia/Tokyo',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
      const endTime = slot.end.toLocaleTimeString('ja-JP', {
        timeZone: 'Asia/Tokyo',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
      output += `  ${startTime} - ${endTime}\n`;
    }
    output += '\n';
  }

  return output.trim();
}
