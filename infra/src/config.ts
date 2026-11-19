import { z } from "zod";

const REGION = /^[a-z]{2}(-[a-z]+)+-\d$/;

/** The log retentions CloudWatch Logs accepts that this project uses, in days. */
const retentionDays = z.union([z.literal(30), z.literal(90), z.literal(365)]);

/**
 * What differs between environments, and nothing else: constructs read this, never the
 * environment's name. It names no account and no person, because the code is public and Traverse
 * gets its own account later (owner, 2026-11-19); the account comes from the deployment.
 */
export const environmentConfig = z
  .strictObject({
    name: z.enum(["staging", "production"]),
    region: z.string().regex(REGION),
    // Listed, never looked up, so synthesis needs no account and no network (A-19).
    availabilityZones: z.array(z.string()).length(3),
    cidr: z.string().regex(/^10\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.0\.0\/16$/),
    natGateways: z.int().min(1).max(3),
    logRetentionDays: retentionDays,
  })
  .refine(
    ({ region, availabilityZones }) =>
      availabilityZones.every((zone) => new RegExp(`^${region}[a-z]$`).test(zone)) &&
      new Set(availabilityZones).size === availabilityZones.length,
    "the zones must be three different zones of the Region",
  )
  .refine(
    ({ name, natGateways, logRetentionDays }) =>
      name !== "production" || (natGateways === 3 && logRetentionDays === 365),
    "production needs a NAT gateway in each zone and a year of logs",
  );

/** All environments: each named once, on networks that don't overlap, so they could be peered. */
export const environmentsConfig = z
  .array(environmentConfig)
  .refine(
    (all) =>
      new Set(all.map(({ name }) => name)).size === all.length &&
      new Set(all.map(({ cidr }) => cidr)).size === all.length,
    "each environment needs its own name and network",
  );

export type EnvironmentConfig = z.infer<typeof environmentConfig>;

const zones = ["eu-north-1a", "eu-north-1b", "eu-north-1c"];

/** Staging is the same stacks, smaller, with a single NAT gateway (SPEC). */
export const ENVIRONMENTS: readonly EnvironmentConfig[] = environmentsConfig.parse([
  {
    name: "staging",
    region: "eu-north-1",
    availabilityZones: zones,
    cidr: "10.20.0.0/16",
    natGateways: 1,
    logRetentionDays: 30,
  },
  {
    name: "production",
    region: "eu-north-1",
    availabilityZones: zones,
    cidr: "10.30.0.0/16",
    natGateways: 3,
    logRetentionDays: 365,
  },
]);
