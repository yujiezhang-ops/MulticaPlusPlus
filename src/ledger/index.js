import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { stableHash } from "../spec/index.js";

export const ALLOWED_LEDGER_TRANSITIONS = {
  draft: new Set(["locked"]),
  locked: new Set(["running"]),
  running: new Set(["completed", "amended"]),
  amended: new Set(["locked"]),
  completed: new Set([]),
};

export function createLedgerStore(filePath) {
  async function append(event) {
    await mkdir(dirname(filePath), { recursive: true });
    const current = await readLedgerText(filePath);
    await writeFile(filePath, current + JSON.stringify(event) + "\n", "utf8");
    return event;
  }

  async function latest(specId) {
    const events = await readLedgerEvents(filePath);
    return events.filter((event) => event.specId === specId).at(-1) ?? null;
  }

  async function transition(specId, nextStatus, extra = {}) {
    const current = await latest(specId);
    if (!current) {
      throw new Error(`spec not found in ledger: ${specId}`);
    }
    assertTransition(current.status, nextStatus);
    return append({
      eventId: `lge_${stableHash({ specId, nextStatus, extra, at: Date.now() }).slice(0, 16)}`,
      specId,
      status: nextStatus,
      createdAt: new Date().toISOString(),
      ...extra,
    });
  }

  return {
    async recordDraft(spec) {
      if (spec.status !== "draft") {
        throw new Error(`recordDraft requires draft spec, got ${spec.status}`);
      }
      return append({
        eventId: `lge_${stableHash({ specId: spec.specId, status: "draft" }).slice(0, 16)}`,
        specId: spec.specId,
        status: "draft",
        createdAt: new Date().toISOString(),
        spec,
      });
    },
    lock(specId, approvedBy) {
      return transition(specId, "locked", { approvedBy });
    },
    markRunning(specId) {
      return transition(specId, "running");
    },
    complete(specId, result) {
      return transition(specId, "completed", { result });
    },
    async list(specId) {
      const events = await readLedgerEvents(filePath);
      return specId ? events.filter((event) => event.specId === specId) : events;
    },
  };
}

export function assertTransition(current, next) {
  const allowed = ALLOWED_LEDGER_TRANSITIONS[current];
  if (!allowed?.has(next)) {
    throw new Error(`invalid ledger transition: ${current} -> ${next}`);
  }
}

export async function readLedgerText(filePath) {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      return "";
    }
    throw error;
  }
}

export async function readLedgerEvents(filePath) {
  const text = await readLedgerText(filePath);
  return text.trim() === ""
    ? []
    : text.trim().split("\n").map((line) => JSON.parse(line));
}
