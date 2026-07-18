import { mkdir, stat } from "node:fs/promises";
import path from "node:path";

import {
  actionBundlePath,
  createActionBundle,
} from "./action-bundle.mjs";

await mkdir(path.dirname(actionBundlePath), { recursive: true });
await createActionBundle({ write: true });

const bundle = await stat(actionBundlePath);
process.stdout.write(
  `Built ${path.relative(process.cwd(), actionBundlePath)} (${bundle.size} bytes).\n`,
);
