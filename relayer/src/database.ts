import Database from "better-sqlite3";
import type { TransferInput, TransferRow, TransferStatus } from "./types.js";

const TERMINAL: readonly TransferStatus[] = ["SUBMITTED", "FAILED", "PERMANENT_FAILURE"];

export class TransferDatabase {
  private readonly db: Database.Database;

  public constructor(path: string | ":memory:") {
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
  }

  public migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS transfers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        transferHash TEXT NOT NULL UNIQUE,
        eventType TEXT NOT NULL,
        milestoneIndex INTEGER,
        recipient TEXT NOT NULL,
        amount TEXT NOT NULL,
        txHash TEXT NOT NULL,
        blockNumber INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'PENDING'
          CHECK (status IN ('PENDING', 'RETRYING', 'SUBMITTED', 'FAILED', 'PERMANENT_FAILURE')),
        attemptCount INTEGER NOT NULL DEFAULT 0,
        nextRetryAt INTEGER,
        lastAttemptAt INTEGER,
        gatewayResponse TEXT,
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_transfers_retry ON transfers(status, nextRetryAt);
      CREATE INDEX IF NOT EXISTS idx_transfers_created ON transfers(createdAt DESC);
    `);
  }

  /** Inserts once; the UNIQUE constraint is deliberately the sole deduplication boundary. */
  public insert(input: TransferInput, now: number): boolean {
    try {
      this.db
        .prepare(`INSERT INTO transfers
          (transferHash, eventType, milestoneIndex, recipient, amount, txHash, blockNumber, status, createdAt, updatedAt)
          VALUES (@transferHash, @eventType, @milestoneIndex, @recipient, @amount, @txHash, @blockNumber, 'PENDING', @now, @now)`)
        .run({ ...input, now });
      return true;
    } catch (error) {
      if (error instanceof Error && /UNIQUE constraint failed: transfers\.transferHash/.test(error.message)) return false;
      throw error;
    }
  }

  public get(transferHash: string): TransferRow | undefined {
    return this.db.prepare("SELECT * FROM transfers WHERE transferHash = ?").get(transferHash) as TransferRow | undefined;
  }

  public all(): TransferRow[] {
    return this.db.prepare("SELECT * FROM transfers ORDER BY createdAt DESC, id DESC").all() as TransferRow[];
  }

  public nonTerminal(): TransferRow[] {
    return this.db.prepare("SELECT * FROM transfers WHERE status IN ('PENDING', 'RETRYING') ORDER BY id ASC").all() as TransferRow[];
  }

  public due(now: number): TransferRow[] {
    return this.db
      .prepare("SELECT * FROM transfers WHERE status IN ('PENDING', 'RETRYING') AND (nextRetryAt IS NULL OR nextRetryAt <= ?) ORDER BY id ASC")
      .all(now) as TransferRow[];
  }

  public markAttempt(transferHash: string, attemptCount: number, now: number): void {
    this.db
      .prepare("UPDATE transfers SET attemptCount = ?, lastAttemptAt = ?, updatedAt = ? WHERE transferHash = ?")
      .run(attemptCount, now, now, transferHash);
  }

  public markSubmitted(transferHash: string, response: string, now: number): void {
    this.update(transferHash, "SUBMITTED", null, response, now);
  }

  public markPermanentFailure(transferHash: string, response: string, now: number): void {
    this.update(transferHash, "PERMANENT_FAILURE", null, response, now);
  }

  public markRetrying(transferHash: string, nextRetryAt: number, response: string, now: number): void {
    this.update(transferHash, "RETRYING", nextRetryAt, response, now);
  }

  public markFailed(transferHash: string, response: string, now: number): void {
    this.update(transferHash, "FAILED", null, response, now);
  }

  public counts(): Record<"total" | "pending" | "retrying" | "submitted" | "failed" | "permanentFailure", number> {
    const rows = this.db.prepare("SELECT status, COUNT(*) AS count FROM transfers GROUP BY status").all() as Array<{ status: TransferStatus; count: number }>;
    const result = { total: 0, pending: 0, retrying: 0, submitted: 0, failed: 0, permanentFailure: 0 };
    for (const row of rows) {
      result.total += row.count;
      if (row.status === "PENDING") result.pending = row.count;
      if (row.status === "RETRYING") result.retrying = row.count;
      if (row.status === "SUBMITTED") result.submitted = row.count;
      if (row.status === "FAILED") result.failed = row.count;
      if (row.status === "PERMANENT_FAILURE") result.permanentFailure = row.count;
    }
    return result;
  }

  public isTerminal(status: TransferStatus): boolean {
    return TERMINAL.includes(status);
  }

  public close(): void {
    this.db.close();
  }

  private update(transferHash: string, status: TransferStatus, nextRetryAt: number | null, response: string, now: number): void {
    this.db
      .prepare("UPDATE transfers SET status = ?, nextRetryAt = ?, gatewayResponse = ?, updatedAt = ? WHERE transferHash = ?")
      .run(status, nextRetryAt, response, now, transferHash);
  }
}
