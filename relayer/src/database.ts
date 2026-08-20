import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { SettlementInput, SettlementRow, SettlementStatus } from "./types.js";
import { companySlug, type CompanyRecord, type ProposalRecord, type ProposalStatus, type ProposalVisibility } from "./registry-types.js";

const TERMINAL: readonly SettlementStatus[] = ["MINTED", "FAILED", "PERMANENT_FAILURE"];

export class TransferDatabase {
  private readonly db: Database.Database;
  public constructor(path: string | ":memory:") {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
  }
  public migrate(): void {
    this.db.exec(`CREATE TABLE IF NOT EXISTS settlements (
      id INTEGER PRIMARY KEY AUTOINCREMENT, settlementKey TEXT NOT NULL UNIQUE, eventType TEXT NOT NULL,
      logicalSettlementKey TEXT NOT NULL,
      escrowAddress TEXT NOT NULL DEFAULT '', milestoneIndex INTEGER, recipient TEXT NOT NULL, amount TEXT NOT NULL, txHash TEXT NOT NULL,
      blockNumber INTEGER NOT NULL, logIndex INTEGER, status TEXT NOT NULL DEFAULT 'PENDING',
      attemptCount INTEGER NOT NULL DEFAULT 0, nextRetryAt INTEGER, lastAttemptAt INTEGER,
      gatewayResponse TEXT, authorizationTxHash TEXT, gatewayTransferId TEXT, attestation TEXT,
      operatorSignature TEXT, mintTxHash TEXT, burnIntentHash TEXT, burnIntentJson TEXT,
      createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_settlements_retry ON settlements(status,nextRetryAt);`);
    this.db.exec(`CREATE TABLE IF NOT EXISTS companies (
      slug TEXT PRIMARY KEY, name TEXT NOT NULL, walletAddress TEXT NOT NULL UNIQUE,
      createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS proposals (
      id TEXT PRIMARY KEY, proposerCompany TEXT NOT NULL, proposerAddress TEXT NOT NULL,
      recipientCompany TEXT, visibility TEXT NOT NULL, status TEXT NOT NULL,
      title TEXT NOT NULL, description TEXT NOT NULL, totalUSDC TEXT NOT NULL,
      sellerCommitmentWindow INTEGER NOT NULL, buyerResponseWindow INTEGER NOT NULL,
      disputeWindow INTEGER NOT NULL, proposalExpiresAt INTEGER NOT NULL,
      milestonesJson TEXT NOT NULL, agreementId TEXT, escrowAddress TEXT,
      acceptedByCompany TEXT, acceptedByAddress TEXT,
      createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_proposals_public ON proposals(visibility,status,proposalExpiresAt);
      CREATE INDEX IF NOT EXISTS idx_proposals_proposer ON proposals(proposerCompany);
      CREATE INDEX IF NOT EXISTS idx_proposals_recipient ON proposals(recipientCompany);`);
    const columns = this.db.prepare("PRAGMA table_info(settlements)").all() as Array<{name:string}>;
    if (!columns.some((column) => column.name === "escrowAddress")) this.db.exec("ALTER TABLE settlements ADD COLUMN escrowAddress TEXT NOT NULL DEFAULT ''");
    if (!columns.some((column) => column.name === "logicalSettlementKey")) this.db.exec("ALTER TABLE settlements ADD COLUMN logicalSettlementKey TEXT");
    this.db.exec("UPDATE settlements SET logicalSettlementKey = lower(escrowAddress) || ':' || coalesce(cast(milestoneIndex as text), 'reclaim') WHERE logicalSettlementKey IS NULL OR logicalSettlementKey = ''");
    this.db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_settlements_logical_key ON settlements(logicalSettlementKey)");
    const proposalColumns = this.db.prepare("PRAGMA table_info(proposals)").all() as Array<{name:string}>;
    if (!proposalColumns.some((column) => column.name === "acceptedByCompany")) this.db.exec("ALTER TABLE proposals ADD COLUMN acceptedByCompany TEXT");
    if (!proposalColumns.some((column) => column.name === "acceptedByAddress")) this.db.exec("ALTER TABLE proposals ADD COLUMN acceptedByAddress TEXT");
  }
  public insert(input: SettlementInput, now: number): boolean {
    try { this.db.prepare(`INSERT INTO settlements
      (settlementKey,logicalSettlementKey,escrowAddress,eventType,milestoneIndex,recipient,amount,txHash,blockNumber,logIndex,status,createdAt,updatedAt)
      VALUES (@settlementKey,@logicalSettlementKey,@escrowAddress,@eventType,@milestoneIndex,@recipient,@amount,@txHash,@blockNumber,@logIndex,'PENDING',@now,@now)`).run({...input, now}); return true; }
    catch (e) { if (e instanceof Error && /UNIQUE constraint failed: settlements\.(settlementKey|logicalSettlementKey)/.test(e.message)) return false; throw e; }
  }
  public get(key: string): SettlementRow | undefined { return this.db.prepare("SELECT * FROM settlements WHERE settlementKey=?").get(key) as SettlementRow | undefined; }
  public all(): SettlementRow[] { return this.db.prepare("SELECT * FROM settlements ORDER BY createdAt DESC,id DESC").all() as SettlementRow[]; }
  public nonTerminal(): SettlementRow[] { return this.db.prepare("SELECT * FROM settlements WHERE status NOT IN ('MINTED','FAILED','PERMANENT_FAILURE') ORDER BY id").all() as SettlementRow[]; }
  public due(now: number): SettlementRow[] { return this.db.prepare("SELECT * FROM settlements WHERE status IN ('PENDING','RETRYING') AND (nextRetryAt IS NULL OR nextRetryAt<=?) ORDER BY id").all(now) as SettlementRow[]; }
  public markAttempt(k:string,n:number,now:number):void { this.db.prepare("UPDATE settlements SET attemptCount=?,lastAttemptAt=?,updatedAt=? WHERE settlementKey=?").run(n,now,now,k); }
  public update(k:string, fields: Record<string, unknown>, now:number):void { const entries=Object.entries(fields); this.db.prepare(`UPDATE settlements SET ${entries.map(([x])=>`${x}=@${x}`).join(",")},updatedAt=@now WHERE settlementKey=@key`).run({...fields,now,key:k}); }
  public counts(): Record<string,number> { const out:Record<string,number>={total:0}; for(const r of this.db.prepare("SELECT status,COUNT(*) count FROM settlements GROUP BY status").all() as Array<{status:string,count:number}>){out.total+=r.count; out[r.status.toLowerCase()]=r.count;} return out; }
  public isTerminal(s:SettlementStatus):boolean{return TERMINAL.includes(s);}
  public getCompany(slug: string): CompanyRecord | undefined { return this.db.prepare("SELECT * FROM companies WHERE slug=?").get(companySlug(slug)) as CompanyRecord | undefined; }
  public getCompanyByWallet(walletAddress: string): CompanyRecord | undefined { return this.db.prepare("SELECT * FROM companies WHERE lower(walletAddress)=lower(?)").get(walletAddress) as CompanyRecord | undefined; }
  public registerCompany(name: string, walletAddress: string, now: number): CompanyRecord {
    const slug = companySlug(name);
    if (!slug || !walletAddress) throw new Error("Company name and wallet address are required");
    const existing = this.getCompany(slug);
    if (existing && existing.walletAddress.toLowerCase() !== walletAddress.toLowerCase()) throw new Error("Company name is already registered to another account");
    const byWallet = this.db.prepare("SELECT * FROM companies WHERE lower(walletAddress)=lower(?)").get(walletAddress) as CompanyRecord | undefined;
    if (byWallet && byWallet.slug !== slug) throw new Error("This account is already registered to another company");
    this.db.prepare(`INSERT INTO companies(slug,name,walletAddress,createdAt,updatedAt) VALUES(?,?,?,?,?)
      ON CONFLICT(slug) DO UPDATE SET name=excluded.name,walletAddress=excluded.walletAddress,updatedAt=excluded.updatedAt`).run(slug, name.trim(), walletAddress, existing?.createdAt ?? now, now);
    return this.getCompany(slug)!;
  }
  public createProposal(input: Omit<ProposalRecord,"createdAt"|"updatedAt"|"status"|"agreementId"|"escrowAddress"|"acceptedByCompany"|"acceptedByAddress"> & { status?: ProposalStatus }, now: number): ProposalRecord {
    const status = input.status ?? "OPEN";
    this.db.prepare(`INSERT INTO proposals(id,proposerCompany,proposerAddress,recipientCompany,visibility,status,title,description,totalUSDC,sellerCommitmentWindow,buyerResponseWindow,disputeWindow,proposalExpiresAt,milestonesJson,agreementId,escrowAddress,acceptedByCompany,acceptedByAddress,createdAt,updatedAt)
      VALUES(@id,@proposerCompany,@proposerAddress,@recipientCompany,@visibility,@status,@title,@description,@totalUSDC,@sellerCommitmentWindow,@buyerResponseWindow,@disputeWindow,@proposalExpiresAt,@milestonesJson,NULL,NULL,NULL,NULL,@now,@now)`).run({ ...input, recipientCompany: input.recipientCompany ? companySlug(input.recipientCompany) : null, visibility: input.visibility as ProposalVisibility, status, milestonesJson: JSON.stringify(input.milestones), now });
    return this.getProposal(input.id)!;
  }
  public getProposal(id: string): ProposalRecord | undefined {
    const row = this.db.prepare("SELECT * FROM proposals WHERE id=?").get(id) as (Omit<ProposalRecord,"milestones"> & {milestonesJson:string}) | undefined;
    if (!row) return undefined;
    const { milestonesJson, ...record } = row;
    return { ...record, milestones: JSON.parse(milestonesJson) } as ProposalRecord;
  }
  public publicProposals(now: number): ProposalRecord[] { this.db.prepare("UPDATE proposals SET status='EXPIRED',updatedAt=? WHERE status='OPEN' AND proposalExpiresAt<=?").run(now, now); return this.allProposals("SELECT * FROM proposals WHERE visibility='PUBLIC' AND status='OPEN' AND proposalExpiresAt>? ORDER BY createdAt DESC", [now]); }
  public proposalsForCompany(slug: string, now: number): ProposalRecord[] { this.db.prepare("UPDATE proposals SET status='EXPIRED',updatedAt=? WHERE status='OPEN' AND proposalExpiresAt<=?").run(now, now); return this.allProposals("SELECT * FROM proposals WHERE proposerCompany=? OR recipientCompany=? ORDER BY createdAt DESC", [companySlug(slug), companySlug(slug)]); }
  public bindProposal(id: string, agreementId: string, escrowAddress: string, now: number): ProposalRecord | undefined { this.db.prepare("UPDATE proposals SET status='ACCEPTED',agreementId=?,escrowAddress=?,updatedAt=? WHERE id=?").run(agreementId, escrowAddress, now, id); return this.getProposal(id); }
  public acceptProposal(id: string, company: string, walletAddress: string, now: number): ProposalRecord | undefined {
    const proposal = this.getProposal(id);
    if (!proposal) return undefined;
    if (proposal.status !== "OPEN") throw new Error("This proposal is no longer open");
    if (proposal.recipientCompany && proposal.recipientCompany !== companySlug(company)) throw new Error("This proposal is addressed to another company");
    this.db.prepare("UPDATE proposals SET status='ACCEPTED',acceptedByCompany=?,acceptedByAddress=?,updatedAt=? WHERE id=?").run(companySlug(company), walletAddress, now, id);
    return this.getProposal(id);
  }
  public deleteExpiredProposal(id: string, walletAddress: string, now: number): boolean {
    const proposal = this.getProposal(id);
    if (!proposal) return false;
    if (proposal.proposerAddress.toLowerCase() !== walletAddress.toLowerCase()) throw new Error("Only the proposing account can remove this proposal");
    if (proposal.status !== "EXPIRED" && proposal.proposalExpiresAt > now) throw new Error("Only expired proposals can be removed");
    const result = this.db.prepare("DELETE FROM proposals WHERE id=? AND proposerAddress=?").run(id, proposal.proposerAddress);
    return result.changes === 1;
  }
  private allProposals(sql: string, params: unknown[]): ProposalRecord[] { return (this.db.prepare(sql).all(...params) as Array<Omit<ProposalRecord,"milestones"> & {milestonesJson:string}>).map(({ milestonesJson, ...record }) => ({ ...record, milestones: JSON.parse(milestonesJson) } as ProposalRecord)); }
  public close():void{this.db.close();}
}
