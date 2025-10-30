import { google, Auth } from 'googleapis';
import { ENV } from './_core/env';

const SCOPES = [
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/calendar.events.readonly'
];

/**
 * Get the redirect URI based on the current environment
 */
function getRedirectUri(): string {
  // In production or when BASE_URL is set, use the full URL
  if (process.env.BASE_URL) {
    return `${process.env.BASE_URL}/api/google/callback`;
  }
  
  // Default to localhost for development
  return 'http://localhost:3000/api/google/callback';
}

/**
 * Create OAuth2 client for Google Calendar API
 */
export function createOAuth2Client(): Auth.OAuth2Client {
  const redirectUri = getRedirectUri();
  
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

  // Set time to start and end of day in UTC
  const timeMinUTC = new Date(timeMin);
  timeMinUTC.setUTCHours(0, 0, 0, 0);
  
  const timeMaxUTC = new Date(timeMax);
  timeMaxUTC.setUTCHours(23, 59, 59, 999);

  const response = await calendar.events.list({
    calendarId: 'primary',
    timeMin: timeMinUTC.toISOString(),
    timeMax: timeMaxUTC.toISOString(),
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
  currentDate.setHours(0, 0, 0, 0);
  
  const endDateTime = new Date(endDate);
  endDateTime.setHours(23, 59, 59, 999);

  while (currentDate <= endDateTime) {
    // Skip weekends (0 = Sunday, 6 = Saturday)
    if (currentDate.getDay() !== 0 && currentDate.getDay() !== 6) {
      const dayStart = new Date(currentDate);
      dayStart.setHours(workingHoursStart, 0, 0, 0);

      const dayEnd = new Date(currentDate);
      dayEnd.setHours(workingHoursEnd, 0, 0, 0);

      // Get events for this day
      const dayEvents = events.filter(event => {
        // Handle both dateTime and date formats
        const eventStartStr = event.start?.dateTime || event.start?.date;
        const eventEndStr = event.end?.dateTime || event.end?.date;
        
        if (!eventStartStr || !eventEndStr) return false;

        const eventStart = new Date(eventStartStr);
        const eventEnd = new Date(eventEndStr);

        // Check if event overlaps with this day's working hours
        return eventStart < dayEnd && eventEnd > dayStart;
      });

      // Sort events by start time
      dayEvents.sort((a, b) => {
        const aStartStr = a.start?.dateTime || a.start?.date;
        const bStartStr = b.start?.dateTime || b.start?.date;
        const aStart = new Date(aStartStr!);
        const bStart = new Date(bStartStr!);
        return aStart.getTime() - bStart.getTime();
      });

      // Find gaps between events
      let currentSlotStart = new Date(dayStart);

      for (const event of dayEvents) {
        const eventStartStr = event.start?.dateTime || event.start?.date;
        const eventEndStr = event.end?.dateTime || event.end?.date;
        
        const eventStart = new Date(eventStartStr!);
        const eventEnd = new Date(eventEndStr!);

        // Adjust event times to be within working hours
        const adjustedEventStart = eventStart < dayStart ? dayStart : eventStart;
        const adjustedEventEnd = eventEnd > dayEnd ? dayEnd : eventEnd;

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
    currentDate.setHours(0, 0, 0, 0);
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
