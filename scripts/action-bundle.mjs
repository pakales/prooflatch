import path from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

export const actionBundlePath = path.join(
  repositoryRoot,
  "action",
  "dist",
  "index.mjs",
);

export async function createActionBundle({ write }) {
  return build({
    absWorkingDir: repositoryRoot,
    banner: {
      js: 'import { createRequire as createProofLatchRequire } from "node:module";\nconst require = createProofLatchRequire(import.meta.url);',
    },
    bundle: true,
    charset: "utf8",
    entryPoints: ["action/src/index.ts"],
    format: "esm",
    legalComments: "none",
    logLevel: "silent",
    minify: true,
    outfile: "action/dist/index.mjs",
    packages: "bundle",
    platform: "node",
    sourcemap: false,
    target: "node24",
    treeShaking: true,
    write,
  });
}
