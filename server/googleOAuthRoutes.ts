import { Express } from 'express';
import { googleTokenCookie } from './_core/googleTokenCookie';

export function registerGoogleOAuthRoutes(app: Express) {
  // This route is now handled by registerGoogleAuthRoutes in googleAuth.ts
  // Keeping this file for backward compatibility but redirecting to new route
  app.get('/api/google/callback', async (req, res) => {
    // Redirect to the new auth callback route
    res.redirect('/api/auth/google/callback');
  });
}
