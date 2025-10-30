import { google, Auth } from 'googleapis';
import { ENV } from './_core/env';

const SCOPES = [
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/calendar.events.readonly'
];

/**
 * Create OAuth2 client for Google Calendar API
 */
export function createOAuth2Client(): Auth.OAuth2Client {
  const redirectUri = 'http://localhost:3000/api/google/callback';

  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    redirectUri
  );
}

/**
 * Generate authorization URL for Google Calendar OAuth
 */
export function getAuthUrl(): string {
  const oauth2Client = createOAuth2Client();
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent', // Force consent screen to get refresh token
  });
}

/**
 * Exchange authorization code for tokens
 */
export async function getTokensFromCode(code: string) {
  const oauth2Client = createOAuth2Client();
  const { tokens } = await oauth2Client.getToken(code);
  return tokens;
}

/**
 * Create authenticated calendar client
 */
export function createCalendarClient(accessToken: string, refreshToken: string, expiryDate: number) {
  const oauth2Client = createOAuth2Client();
  oauth2Client.setCredentials({
    access_token: accessToken,
    refresh_token: refreshToken,
    expiry_date: expiryDate,
  });

  return google.calendar({ version: 'v3', auth: oauth2Client });
}

/**
 * Refresh access token if expired
 */
export async function refreshAccessToken(refreshToken: string) {
  const oauth2Client = createOAuth2Client();
  oauth2Client.setCredentials({
    refresh_token: refreshToken,
  });

  const { credentials } = await oauth2Client.refreshAccessToken();
  return credentials;
}

/**
 * Get calendar events within a time range
 */
export async function getCalendarEvents(
  accessToken: string,
  refreshToken: string,
  expiryDate: number,
  timeMin: Date,
  timeMax: Date
) {
  const calendar = createCalendarClient(accessToken, refreshToken, expiryDate);

  const response = await calendar.events.list({
    calendarId: 'primary',
    timeMin: timeMin.toISOString(),
    timeMax: timeMax.toISOString(),
    singleEvents: true,
    orderBy: 'startTime',
  });

  return response.data.items || [];
}

/**
 * Calculate available time slots from calendar events
 */
export function calculateAvailableSlots(
  events: any[],
  startDate: Date,
  endDate: Date,
  workingHoursStart: number = 9, // 9 AM
  workingHoursEnd: number = 18, // 6 PM
  slotDurationMinutes: number = 30
): Array<{ start: Date; end: Date }> {
  const availableSlots: Array<{ start: Date; end: Date }> = [];

  // Iterate through each day in the range
  const currentDate = new Date(startDate);
  while (currentDate <= endDate) {
    // Skip weekends (0 = Sunday, 6 = Saturday)
    if (currentDate.getDay() !== 0 && currentDate.getDay() !== 6) {
      const dayStart = new Date(currentDate);
      dayStart.setHours(workingHoursStart, 0, 0, 0);

      const dayEnd = new Date(currentDate);
      dayEnd.setHours(workingHoursEnd, 0, 0, 0);

      // Get events for this day
      const dayEvents = events.filter(event => {
        const eventStart = event.start?.dateTime ? new Date(event.start.dateTime) : null;
        const eventEnd = event.end?.dateTime ? new Date(event.end.dateTime) : null;

        if (!eventStart || !eventEnd) return false;

        return eventStart < dayEnd && eventEnd > dayStart;
      });

      // Sort events by start time
      dayEvents.sort((a, b) => {
        const aStart = new Date(a.start!.dateTime!);
        const bStart = new Date(b.start!.dateTime!);
        return aStart.getTime() - bStart.getTime();
      });

      // Find gaps between events
      let currentSlotStart = dayStart;

      for (const event of dayEvents) {
        const eventStart = new Date(event.start!.dateTime!);
        const eventEnd = new Date(event.end!.dateTime!);

        // If there's a gap before this event
        if (currentSlotStart < eventStart) {
          const gapEnd = eventStart < dayEnd ? eventStart : dayEnd;
          
          // Split gap into slots
          let slotStart = new Date(currentSlotStart);
          while (slotStart.getTime() + slotDurationMinutes * 60 * 1000 <= gapEnd.getTime()) {
            const slotEnd = new Date(slotStart.getTime() + slotDurationMinutes * 60 * 1000);
            availableSlots.push({
              start: new Date(slotStart),
              end: new Date(slotEnd),
            });
            slotStart = slotEnd;
          }
        }

        // Move current slot start to after this event
        currentSlotStart = eventEnd > currentSlotStart ? eventEnd : currentSlotStart;
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
          slotStart = slotEnd;
        }
      }
    }

    // Move to next day
    currentDate.setDate(currentDate.getDate() + 1);
  }

  return availableSlots;
}

/**
 * Format available slots as copyable text
 */
export function formatSlotsAsText(slots: Array<{ start: Date; end: Date }>): string {
  if (slots.length === 0) {
    return '指定期間内に空き時間はありません。';
  }

  const groupedByDate: { [key: string]: Array<{ start: Date; end: Date }> } = {};

  slots.forEach(slot => {
    const dateKey = slot.start.toLocaleDateString('ja-JP', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'short',
    });

    if (!groupedByDate[dateKey]) {
      groupedByDate[dateKey] = [];
    }
    groupedByDate[dateKey].push(slot);
  });

  let text = '【空き時間一覧】\n\n';

  Object.keys(groupedByDate).forEach(dateKey => {
    text += `■ ${dateKey}\n`;
    groupedByDate[dateKey].forEach(slot => {
      const startTime = slot.start.toLocaleTimeString('ja-JP', {
        hour: '2-digit',
        minute: '2-digit',
      });
      const endTime = slot.end.toLocaleTimeString('ja-JP', {
        hour: '2-digit',
        minute: '2-digit',
      });
      text += `  ${startTime} - ${endTime}\n`;
    });
    text += '\n';
  });

  return text;
}
