import { App, type Stack } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import type { IVpc } from "aws-cdk-lib/aws-ec2";
import cdk from "../../cdk.json" with { type: "json" };
import { ENVIRONMENTS, type EnvironmentConfig } from "../../src/config.ts";
import { NetworkStack } from "../../src/network-stack.ts";

/** An app with the feature flags `cdk synth` uses, so tests check the templates it writes. */
export const newApp = () => new App({ context: cdk.context });

/** Each environment's template of a stack built on that environment's network. */
export const onEachNetwork = (
  build: (
    app: App,
    props: { env: { region: string }; config: EnvironmentConfig; vpc: IVpc },
  ) => Stack,
): Map<EnvironmentConfig["name"], Template> =>
  new Map(
    ENVIRONMENTS.map((config) => {
      const app = newApp();
      const env = { region: config.region };
      const { vpc } = new NetworkStack(app, "network", { env, config });
      return [config.name, Template.fromStack(build(app, { env, config, vpc }))];
    }),
  );
