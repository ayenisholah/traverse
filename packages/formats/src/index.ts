const PACKAGE_NAME = /^(?:@[a-z0-9][\w.~-]*\/)?[a-z0-9][\w.~-]*$/i;
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9a-z.-]+)?(?:\+[0-9a-z.-]+)?$/i;
const MAX_NAME_LENGTH = 214;
const MAX_VERSION_LENGTH = 256;

export const isPackageName = (name: unknown): name is string =>
  typeof name === "string" && name.length <= MAX_NAME_LENGTH && PACKAGE_NAME.test(name);

export const isVersion = (version: unknown): version is string =>
  typeof version === "string" && version.length <= MAX_VERSION_LENGTH && SEMVER.test(version);
