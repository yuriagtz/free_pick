export { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";

export const APP_TITLE = import.meta.env.VITE_APP_TITLE || "FreePick";

export const APP_LOGO =
  import.meta.env.VITE_APP_LOGO ||
  "/FreePick_logo.png";

// Generate login URL - now uses Google OAuth directly
export const getLoginUrl = () => {
  return `${window.location.origin}/api/auth/google`;
};