import { readSettings } from "./server/settings.ts";

// Next.js runs this once as the server starts. It only logs an error thrown here and carries on
// serving (W-27), so a missing setting has to end the process itself, before the first visitor.
export const register = (): void => {
  try {
    readSettings(process.env);
  } catch (error) {
    process.stderr.write(`${(error as Error).message}\n`);
    process.exit(1);
  }
};
