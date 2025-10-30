import { getAuthUrl } from './server/googleCalendar';

console.log('Testing OAuth URL generation...');
console.log('BASE_URL:', process.env.BASE_URL);
console.log('GOOGLE_CLIENT_ID:', process.env.GOOGLE_CLIENT_ID ? 'Set' : 'Not set');
console.log('GOOGLE_CLIENT_SECRET:', process.env.GOOGLE_CLIENT_SECRET ? 'Set' : 'Not set');

try {
  const authUrl = getAuthUrl();
  console.log('\nGenerated Auth URL:');
  console.log(authUrl);
} catch (error) {
  console.error('Error generating auth URL:', error);
}
