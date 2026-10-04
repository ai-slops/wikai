import { join, resolve } from "node:path";
import { atomicWrite, hash, readOptionalBytes, withLock } from "../fs/index.ts";
import { type Diagnostic, PublisherError } from "../model/index.ts";
import { statePath, writeStateDocument } from "./document.ts";
import { revisionInventory } from "./inventory.ts";
import {
  inspectState,
  parseBindings,
  readMaintenanceFile,
  type SourceBindings,
  type StateMaintenanceInput,
  stateProblem,
} from "./maintenance-input.ts";
import { decodeState } from "./migrations.ts";
import { reconstructState } from "./recovery.ts";
import type { StateDocument } from "./schema.ts";

export type { StateMaintenanceInput } from "./maintenance-input.ts";

async function prepare(input: StateMaintenanceInput) {
  const stateDir = resolve(input.stateDir);
  const current = await readMaintenanceFile(join(stateDir, "state.json"));
  const marker = await readMaintenanceFile(join(stateDir, "initialized"));
  const state = inspectState(current.raw);
  const diagnostics: Diagnostic[] = [];
  const auxiliary: { path: string; digest: string | null }[] = [];
  let backup: StateDocument | null = null;
  let bindings: SourceBindings = {};
  for (const [kind, path] of [
    ["backup", input.backupPath],
    ["bindings", input.bindingsPath],
  ] as const) {
    if (path === undefined) continue;
    const file = await readMaintenanceFile(path);
    auxiliary.push({ path: file.path, digest: file.digest });
    if (file.raw === undefined) {
      diagnostics.push(stateProblem("STATE_INPUT_MISSING", "A recovery input file is missing"));
      continue;
    }
    try {
      switch (kind) {
        case "backup":
          backup = decodeState(file.raw).document;
          break;
        case "bindings":
          bindings = parseBindings(file.raw);
          break;
      }
    } catch (error) {
      if (!(error instanceof PublisherError)) throw error;
      diagnostics.push(stateProblem(error.code, "A recovery input failed validation"));
    }
  }
  let proposedState: StateDocument | null = null;
  let inventory: Awaited<ReturnType<typeof revisionInventory>> = {
    revisions: [],
    diagnostics: [],
    fingerprint: [],
  };
  switch (input.mode) {
    case "migrate":
      if (input.backupPath !== undefined || input.bindingsPath !== undefined) {
        diagnostics.push(
          stateProblem(
            "STATE_MIGRATION_INPUT_INVALID",
            "Migration does not accept recovery inputs",
          ),
        );
      }
      if (state.status !== "valid") {
        diagnostics.push(
          stateProblem(
            "STATE_MIGRATION_REQUIRES_VALID_STATE",
            "Migration requires valid supported state",
          ),
        );
      } else if (state.sourceVersion === 2) {
        diagnostics.push({
          code: "STATE_ALREADY_CURRENT",
          severity: "info",
          message: "State already uses schema version 2",
        });
      } else {
        proposedState = state.document;
      }
      break;
    case "recover": {
      if (state.status === "valid" || state.status === "unsupported") {
        diagnostics.push(
          stateProblem(
            "STATE_RECOVERY_REFUSED",
            "Recovery cannot replace valid or unsupported-version state",
          ),
        );
      }
      inventory = await revisionInventory(stateDir);
      diagnostics.push(...inventory.diagnostics);
      if (inventory.revisions.length === 0 && backup === null) {
        diagnostics.push(
          stateProblem(
            "STATE_RECOVERY_EMPTY",
            "No intact revision evidence or validated backup is available",
          ),
        );
      }
      const reconstructed = reconstructState({ revisions: inventory.revisions, backup, bindings });
      proposedState = reconstructed.document;
      diagnostics.push(...reconstructed.diagnostics);
      diagnostics.push({
        code: "STATE_RECOVERY_PARTIAL",
        severity: "warning",
        message:
          "Recovery adopts restorable artifacts, not an activation audit trail. All publications stay inactive; lost captures and reservations not present in evidence cannot be inferred.",
      });
      break;
    }
    default: {
      const exhaustive: never = input.mode;
      throw new PublisherError(
        "STATE_MAINTENANCE_INVALID",
        `Unsupported state operation: ${exhaustive}`,
      );
    }
  }
  const report = {
    mode: input.mode,
    stateDir,
    stateStatus: state.status,
    sourceVersion: state.sourceVersion,
    targetVersion: 2 as const,
    stateHash: current.digest,
    canApply: proposedState !== null && !diagnostics.some((item) => item.severity === "error"),
    proposedState,
    revisions: inventory.revisions.map((revision) => ({
      publicId: revision.publicId,
      revisionHash: revision.revisionHash,
      exposureHash: revision.exposureHash,
      title: revision.metadata.title,
      slug: revision.metadata.slug,
      approvedAt: revision.approvedAt,
    })),
    diagnostics,
  };
  const planHash = hash(
    JSON.stringify({
      report,
      marker: marker.digest,
      inventory: inventory.fingerprint,
      auxiliary,
    }),
  );
  return { report: { ...report, planHash }, raw: current.raw };
}

export async function planStateMaintenance(input: StateMaintenanceInput) {
  return (await prepare(input)).report;
}

export async function applyStateMaintenance(input: StateMaintenanceInput, expectedHash: string) {
  return withLock(input.stateDir, async () => {
    const { report, raw } = await prepare(input);
    if (report.planHash !== expectedHash) {
      throw new PublisherError(
        "STALE_STATE_PLAN",
        "State recovery evidence changed; inspect a new plan",
      );
    }
    if (!report.canApply || report.proposedState === null) {
      throw new PublisherError(
        "STATE_MAINTENANCE_BLOCKED",
        "State maintenance has no safe applicable plan",
      );
    }
    let backupPath: string | null = null;
    if (raw !== undefined) {
      backupPath = await statePath(
        input.stateDir,
        join("recovery-backups", `${hash(raw).slice(7)}.json`),
      );
      const existing = await readOptionalBytes(backupPath);
      if (existing !== undefined && !existing.equals(raw)) {
        throw new PublisherError(
          "STATE_BACKUP_COLLISION",
          "Existing recovery backup differs from its content hash",
        );
      }
      if (existing === undefined) await atomicWrite(backupPath, raw, null);
    }
    await writeStateDocument(input.stateDir, report.proposedState, report.stateHash);
    return {
      applied: true,
      mode: input.mode,
      planHash: report.planHash,
      schemaVersion: 2,
      backupPath,
    };
  });
}
