/**
 * Vercel entry point.
 *
 * Vercel imports this module and calls the default export per request; nothing
 * here may bind a port or arm a timer. `src/app.ts` is the same app `npm start`
 * serves, so the two deployments cannot drift.
 */
import app from '../src/app';

export default app;
