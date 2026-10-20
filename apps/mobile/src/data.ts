import * as SQLite from "expo-sqlite";
import { randomUUID } from "expo-crypto";
import type { Kind } from "./definitions";
import { Repository as BaseRepository, type RecordData } from "./repository";
export type { RecordData, LocalRecord, Stored, Pending } from "./repository";
export class Repository extends BaseRepository {
  constructor(userId: string) {
    super(userId, SQLite.openDatabaseSync, randomUUID);
  }
}

export function blank(kind: Kind): RecordData {
  const now = new Date().toISOString();
  const statuses: Partial<Record<Kind, string>> = {
    NOTE: "INBOX",
    ACTION: "TODO",
    ISSUE: "CLARIFY",
    PUBLICATION: "DRAFT",
    CHANNEL: "DRAFT",
  };
  const fields: Record<string, unknown> =
    kind === "ACTION"
      ? { repeat: "NONE", priority: 2 }
      : kind === "TRANSACTION"
        ? { direction: "OUT", occurredAt: now }
        : kind === "ACCOUNT"
          ? { openingCents: 0 }
          : kind === "ITEM"
            ? { quantity: 1 }
            : {};
  return {
    id: randomUUID(),
    kind,
    title: "",
    body: "",
    status: statuses[kind] || "ACTIVE",
    fields,
    tags: [],
    links: [],
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    deletedAt: null,
    version: 0,
  };
}
