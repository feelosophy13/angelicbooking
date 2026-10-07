/** Which social providers are configured. Server-only; pass the booleans to client components. */
export const googleEnabled = !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
