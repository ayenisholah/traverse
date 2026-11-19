import { App } from "aws-cdk-lib";
import { buildApp } from "./app.ts";
import { ENVIRONMENTS } from "./config.ts";

/** The app `cdk synth` builds. Tests run this, so nothing reaches a template untested. */
export const main = (app: App = new App()) => buildApp(app, ENVIRONMENTS);
