const POSIX_ENVIRONMENT_KEYS = ["PATH", "TMPDIR", "TMP", "TEMP"];
const WINDOWS_ENVIRONMENT_KEYS = [
  "PATH",
  "SystemRoot",
  "WINDIR",
  "ComSpec",
  "PATHEXT",
  "TEMP",
  "TMP",
];

function readEnvironmentValue(environment, key, caseInsensitive) {
  if (Object.hasOwn(environment, key)) {
    return environment[key];
  }
  if (!caseInsensitive) {
    return undefined;
  }

  const normalizedKey = key.toLowerCase();
  const matchingKey = Object.keys(environment).find(
    (candidate) => candidate.toLowerCase() === normalizedKey,
  );
  return matchingKey === undefined ? undefined : environment[matchingKey];
}

/**
 * Builds the minimal inherited environment needed to launch a child process.
 *
 * Credential, runtime-injection, proxy, and Git-specific variables are
 * deliberately excluded. Scanner-owned Git controls are added by the caller.
 */
export function buildSafeProcessEnv(
  environment = process.env,
  platform = process.platform,
) {
  const safeEnvironment = {};
  const caseInsensitive = platform === "win32";
  const allowedKeys = caseInsensitive
    ? WINDOWS_ENVIRONMENT_KEYS
    : POSIX_ENVIRONMENT_KEYS;

  for (const key of allowedKeys) {
    const value = readEnvironmentValue(environment, key, caseInsensitive);
    if (
      typeof value === "string" &&
      value.length > 0 &&
      !value.includes("\0")
    ) {
      safeEnvironment[key] = value;
    }
  }

  return safeEnvironment;
}
