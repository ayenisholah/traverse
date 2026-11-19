import { describe, expect, it } from "vitest";
import { ENVIRONMENTS, environmentConfig, environmentsConfig } from "../src/config.ts";

const environment = (wanted: string) => {
  const found = ENVIRONMENTS.find(({ name }) => name === wanted);
  if (found === undefined) throw new Error(`no ${wanted} environment`);
  return found;
};
const staging = environment("staging");

describe("environment config", () => {
  it("[NFR-7] holds staging and production, with one NAT gateway on staging", () => {
    expect(ENVIRONMENTS.map(({ name, natGateways }) => [name, natGateways])).toEqual([
      ["staging", 1],
      ["production", 3],
    ]);
  });

  it.each([
    [
      "a zone in another Region",
      { availabilityZones: ["eu-north-1a", "eu-north-1b", "eu-west-1c"] },
    ],
    ["the same zone twice", { availabilityZones: ["eu-north-1a", "eu-north-1a", "eu-north-1b"] }],
    ["two zones", { availabilityZones: ["eu-north-1a", "eu-north-1b"] }],
    ["a Region that isn't one", { region: "north" }],
    ["a network outside 10/8", { cidr: "192.168.0.0/16" }],
    ["an address that isn't one", { cidr: "10.999.0.0/16" }],
    ["no NAT gateway", { natGateways: 0 }],
    [
      "a database that would shrink",
      { database: { ...staging.database, maxAllocatedStorageGb: 19 } },
    ],
    ["no backups", { database: { ...staging.database, backupRetentionDays: 0 } }],
    [
      "an instance class with its prefix",
      { database: { ...staging.database, instanceType: "db.t4g.micro" } },
    ],
    ["a cache node that isn't one", { cache: { nodeType: "t4g.micro", nodes: 1 } }],
    ["four cache nodes", { cache: { nodeType: "cache.t4g.micro", nodes: 4 } }],
    ["a log retention CloudWatch wouldn't take", { logRetentionDays: 31 }],
    // The account is the deployment's, never the code's (owner, 2026-11-19).
    ["an account", { account: "000000000000" }],
  ])("[GR-5] refuses %s", (_, change) => {
    expect(environmentConfig.safeParse({ ...staging, ...change }).success).toBe(false);
  });

  it("[NFR-7] holds production to a NAT gateway a zone and a year of logs", () => {
    const production = environment("production");

    expect(environmentConfig.safeParse({ ...production, natGateways: 1 }).success).toBe(false);
    expect(environmentConfig.safeParse({ ...production, logRetentionDays: 30 }).success).toBe(
      false,
    );
    expect(environmentConfig.safeParse({ ...staging, natGateways: 3 }).success).toBe(true);
    const { database, cache } = production;
    for (const change of [
      { database: { ...database, multiAz: false } },
      { database: { ...database, backupRetentionDays: 7 } },
      { cache: { ...cache, nodes: 1 } },
    ]) {
      expect(environmentConfig.safeParse({ ...production, ...change }).success).toBe(false);
    }
  });

  it("[NFR-7] gives each environment its own name and network", () => {
    expect(environmentsConfig.safeParse([staging, staging]).success).toBe(false);
    expect(
      environmentsConfig.safeParse([
        staging,
        { ...staging, name: "production", natGateways: 3, logRetentionDays: 365 },
      ]).success,
    ).toBe(false);
  });
});
