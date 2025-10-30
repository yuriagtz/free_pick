import { Express } from 'express';
import { getTokensFromCode } from './googleCalendar';
import { upsertGoogleToken } from './db';
import { sdk } from './_core/sdk';

export function registerGoogleOAuthRoutes(app: Express) {
  app.get('/api/google/callback', async (req, res) => {
    try {
      const code = req.query.code as string;
      
      if (!code) {
        return res.status(400).send('Authorization code is missing');
      }

      // Get user from session using SDK
      let user;
      try {
        user = await sdk.authenticateRequest(req);
      } catch (error) {
        return res.redirect('/?error=not_authenticated');
      }
      
      if (!user) {
        return res.redirect('/?error=not_authenticated');
      }

      // Exchange code for tokens
      const tokens = await getTokensFromCode(code);

      if (!tokens.access_token || !tokens.refresh_token || !tokens.expiry_date) {
        return res.redirect('/?error=token_exchange_failed');
      }

      // Save tokens to database
      await upsertGoogleToken({
        userId: user.id,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiryDate: new Date(tokens.expiry_date),
        scope: tokens.scope || '',
      });

      // Redirect back to the app
      res.redirect('/?google_connected=true');
    } catch (error) {
      console.error('Google OAuth callback error:', error);
      res.redirect('/?error=callback_failed');
    }
  });
}
