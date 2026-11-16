import { readSettings } from "./server/settings.ts";

// Next.js runs this once as the server starts, so a missing setting stops it there and not on the
// first visitor's request.
export const register = (): void => {
  readSettings(process.env);
};
