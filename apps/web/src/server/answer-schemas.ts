import { z } from "zod";

// The parts the shipped operations share. Each operation's own schema is strict, so a field
// nobody selected, such as a maintainer's email, can't pass through (GR-16).

export const repositorySchema = z
  .strictObject({
    url: z.string(),
    stars: z.number(),
    owner: z.string(),
    latestRelease: z.string().nullable(),
  })
  .nullable();

const advisoryFields = { id: z.string(), summary: z.string(), severity: z.string().nullable() };

export const advisoriesSchema = z.array(z.strictObject(advisoryFields)).nullable();

export const advisoriesWithFixesSchema = z
  .array(z.strictObject({ ...advisoryFields, fixedIn: z.string().nullable() }))
  .nullable();
