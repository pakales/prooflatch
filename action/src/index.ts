import * as core from "@actions/core";

import { runAction } from "./runtime";

try {
  await runAction();
} catch {
  core.setFailed(
    "ProofLatch could not produce a trustworthy repository baseline.",
  );
}
