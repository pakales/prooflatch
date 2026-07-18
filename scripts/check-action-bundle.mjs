import { readFile } from "node:fs/promises";

import {
  actionBundlePath,
  createActionBundle,
} from "./action-bundle.mjs";

const result = await createActionBundle({ write: false });
const generated = result.outputFiles?.find(
  (output) => output.path === actionBundlePath,
);
if (!generated) {
  throw new Error("esbuild did not produce the expected Action bundle.");
}

let checkedIn;
try {
  checkedIn = await readFile(actionBundlePath);
} catch {
  throw new Error(
    "The Action bundle is missing. Run `npm run build:action`.",
  );
}

if (!checkedIn.equals(generated.contents)) {
  throw new Error(
    "The Action bundle is stale. Run `npm run build:action`.",
  );
}

process.stdout.write("Action bundle is present and up to date.\n");
