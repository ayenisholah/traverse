import { App } from "aws-cdk-lib";
import cdk from "../../cdk.json" with { type: "json" };

/** An app with the feature flags `cdk synth` uses, so tests check the templates it writes. */
export const newApp = () => new App({ context: cdk.context });
