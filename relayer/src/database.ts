import Database from "better-sqlite3";
import type { SettlementInput, SettlementRow, SettlementStatus } from "./types.js";

const TERMINAL: readonly SettlementStatus[] = ["MINTED", "FAILED", "PERMANENT_FAILURE"];

export class TransferDatabase {
  private readonly db: Database.Database;
  public constructor(path: string | ":memory:") { this.db = new Database(path); this.db.pragma("journal_mode = WAL"); }
  public migrate(): void {
    this.db.exec(`CREATE TABLE IF NOT EXISTS settlements (
      id INTEGER PRIMARY KEY AUTOINCREMENT, settlementKey TEXT NOT NULL UNIQUE, eventType TEXT NOT NULL,
      milestoneIndex INTEGER, recipient TEXT NOT NULL, amount TEXT NOT NULL, txHash TEXT NOT NULL,
      blockNumber INTEGER NOT NULL, logIndex INTEGER, status TEXT NOT NULL DEFAULT 'PENDING',
      attemptCount INTEGER NOT NULL DEFAULT 0, nextRetryAt INTEGER, lastAttemptAt INTEGER,
      gatewayResponse TEXT, authorizationTxHash TEXT, gatewayTransferId TEXT, attestation TEXT,
      operatorSignature TEXT, mintTxHash TEXT, burnIntentHash TEXT, burnIntentJson TEXT,
      createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_settlements_retry ON settlements(status,nextRetryAt);`);
  }
  public insert(input: SettlementInput, now: number): boolean {
    try { this.db.prepare(`INSERT INTO settlements
      (settlementKey,eventType,milestoneIndex,recipient,amount,txHash,blockNumber,logIndex,status,createdAt,updatedAt)
      VALUES (@settlementKey,@eventType,@milestoneIndex,@recipient,@amount,@txHash,@blockNumber,@logIndex,'PENDING',@now,@now)`).run({...input, now}); return true; }
    catch (e) { if (e instanceof Error && /UNIQUE constraint failed: settlements\.settlementKey/.test(e.message)) return false; throw e; }
  }
  public get(key: string): SettlementRow | undefined { return this.db.prepare("SELECT * FROM settlements WHERE settlementKey=?").get(key) as SettlementRow | undefined; }
  public all(): SettlementRow[] { return this.db.prepare("SELECT * FROM settlements ORDER BY createdAt DESC,id DESC").all() as SettlementRow[]; }
  public nonTerminal(): SettlementRow[] { return this.db.prepare("SELECT * FROM settlements WHERE status NOT IN ('MINTED','FAILED','PERMANENT_FAILURE') ORDER BY id").all() as SettlementRow[]; }
  public due(now: number): SettlementRow[] { return this.db.prepare("SELECT * FROM settlements WHERE status IN ('PENDING','RETRYING') AND (nextRetryAt IS NULL OR nextRetryAt<=?) ORDER BY id").all(now) as SettlementRow[]; }
  public markAttempt(k:string,n:number,now:number):void { this.db.prepare("UPDATE settlements SET attemptCount=?,lastAttemptAt=?,updatedAt=? WHERE settlementKey=?").run(n,now,now,k); }
  public update(k:string, fields: Record<string, unknown>, now:number):void { const entries=Object.entries(fields); this.db.prepare(`UPDATE settlements SET ${entries.map(([x])=>`${x}=@${x}`).join(",")},updatedAt=@now WHERE settlementKey=@key`).run({...fields,now,key:k}); }
  public counts(): Record<string,number> { const out:Record<string,number>={total:0}; for(const r of this.db.prepare("SELECT status,COUNT(*) count FROM settlements GROUP BY status").all() as Array<{status:string,count:number}>){out.total+=r.count; out[r.status.toLowerCase()]=r.count;} return out; }
  public isTerminal(s:SettlementStatus):boolean{return TERMINAL.includes(s);}
  public close():void{this.db.close();}
}
