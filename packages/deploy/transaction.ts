import { open, rename } from "node:fs/promises";
import { dirname } from "node:path";

export type DeploymentFileOperations = {
  readonly rename: (source: string, target: string) => Promise<void>;
  readonly syncDirectory: (path: string) => Promise<void>;
};

export const defaultDeploymentFileOperations: DeploymentFileOperations = {
  rename,
  syncDirectory: async (path) => {
    const directory = await open(path, "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  },
};

type SwapGenerationsInput = {
  readonly current: string;
  readonly previous: string;
  readonly temporary: string;
  readonly operations: DeploymentFileOperations;
};

export async function swapGenerations(input: SwapGenerationsInput): Promise<void> {
  let currentMoved = false;
  let previousPromoted = false;
  try {
    await input.operations.rename(input.current, input.temporary);
    currentMoved = true;
    await input.operations.rename(input.previous, input.current);
    previousPromoted = true;
    await input.operations.rename(input.temporary, input.previous);
  } catch (error) {
    if (previousPromoted) await input.operations.rename(input.current, input.previous);
    if (currentMoved) await input.operations.rename(input.temporary, input.current);
    await input.operations.syncDirectory(dirname(input.current));
    throw error;
  }
}
