import { randomUUID } from "node:crypto";
import type { RelayerConfig } from "./config.js";
import { TransferDatabase } from "./database.js";
import { DEFAULT_GATEWAY_MAX_BLOCK_HEIGHT, DEFAULT_GATEWAY_MAX_FEE, buildBurnIntent, settlementSalt } from "./onchain.js";
import type { BurnIntentAuthorization, BurnIntentRequest, ChainLog, EventSource, EventType, GatewayClient, Logger, LogProvider, SettlementCoordinator, SettlementExecutor, SettlementInput, SettlementRow } from "./types.js";

const retryDelaySeconds = [30, 120, 600, 1800] as const;
const claimDurationSeconds = 300;
const USDC = "0x3600000000000000000000000000000000000000";

export class Relayer {
  private readonly inFlight = new Set<string>();
  private readonly escrows = new Map<string, number>();
  private readonly factoryBlockHashes = new Map<string, string>();
  private readonly owner: string;
  private retryTimer: NodeJS.Timeout | undefined;
  private active = false;
  private prepared = false;
  private lastReorgSweep = 0;

  public constructor(
    public readonly config: RelayerConfig,
    public readonly database: TransferDatabase,
    private readonly provider: LogProvider,
    private readonly eventSource: EventSource,
    private readonly gateway: GatewayClient,
    private readonly executor: SettlementExecutor,
    private readonly logger: Logger,
    private readonly now = () => Math.floor(Date.now() / 1000),
    private readonly coordinator?: SettlementCoordinator
  ) { this.owner = config.instanceId || randomUUID(); }

  public get listening() { return this.active; }

  public async initialize() {
    await this.prepare();
    const historicalTo = process.env.SKIP_HISTORICAL_SWEEP === "true" ? await this.provider.getBlockNumber() : await this.historicalSweep();
    this.eventSource.subscribe(this.config.factoryEventTopic, (log) => this.handleFactoryLog(log));
    for (const topic of Object.values(this.config.eventTopics)) this.eventSource.subscribe(topic, (log) => void this.handleLog(log));
    for (const [name, topic] of Object.entries(this.config.onchainEventTopics)) this.eventSource.subscribe(topic, (log) => void this.handleOnchainEvent(name as keyof RelayerConfig["onchainEventTopics"], log));
    if (this.eventSource.start) await this.eventSource.start(historicalTo);
    this.active = true;
    this.retryTimer = setInterval(() => void this.processDueRetries(), 10_000);
    this.retryTimer.unref();
    this.logger.info("Relayer initialized", { factoryAddress: this.config.factoryAddress, escrowCount: this.escrows.size, historicalSweep: process.env.SKIP_HISTORICAL_SWEEP === "true" ? "skipped" : "completed" });
  }

  public async prepare() {
    if (this.prepared) return;
    await this.validateContractWithRetry();
    this.database.migrate();
    const recovered = this.database.markSubmittingForReconciliation(this.now());
    if (recovered > 0) this.logger.warn("Recovered interrupted Gateway submissions for reconciliation", { count: recovered });
    await this.resumeNonTerminal();
    this.prepared = true;
  }

  private async validateContractWithRetry() {
    const backoffMs = [0, 2_000, 5_000, 15_000, 30_000];
    let lastError: unknown;
    for (let i = 0; i < backoffMs.length; i++) {
      if (backoffMs[i] > 0) await new Promise<void>((resolve) => setTimeout(resolve, backoffMs[i]));
      const attempt = i + 1;
      this.logger.info("Startup validation attempt", { attempt, maxAttempts: backoffMs.length });
      try {
        const code = await this.provider.getCode(this.config.factoryAddress);
        if (code === "0x") throw new Error(`No deployed factory code at ${this.config.factoryAddress}`);
        const routerCode = await this.provider.getCode(this.config.resolutionRouterAddress);
        if (routerCode === "0x") throw new Error(`No deployed Resolution Router code at ${this.config.resolutionRouterAddress}`);
        if (!this.provider.getFactoryArbitrator) throw new Error("Relayer provider cannot verify the factory's immutable arbitrator");
        const factoryRouter = await this.provider.getFactoryArbitrator(this.config.factoryAddress);
        if (factoryRouter.toLowerCase() !== this.config.resolutionRouterAddress.toLowerCase()) {
          throw new Error(`Factory/router mismatch: factory ${this.config.factoryAddress} references ${factoryRouter}, expected ${this.config.resolutionRouterAddress}`);
        }
        this.logger.info("Startup validation succeeded", { attempt });
        return;
      } catch (error) {
        lastError = error;
        if (attempt < backoffMs.length) this.logger.warn("Startup validation failed; retrying", { attempt, nextAttempt: attempt + 1, error: String(error) });
      }
    }
    throw lastError;
  }

  public stop() {
    this.active = false;
    this.eventSource.unsubscribe();
    if (this.retryTimer) clearInterval(this.retryTimer);
    this.retryTimer = undefined;
  }

  public async historicalSweep() {
    const latest = await this.rpcRetry("historical block number", () => this.provider.getBlockNumber());
    const to = Math.max(0, latest - this.config.confirmationDepth);
    const factoryTopics = [[this.config.factoryEventTopic]];
    const chunkSize = 500;
    for (let from = this.config.factoryDeploymentBlock; from <= to; from += chunkSize) {
      const end = Math.min(from + chunkSize - 1, to);
      const logs = await this.rpcRetry(`factory logs ${from}-${end}`, () => this.provider.getLogs({ address: this.config.factoryAddress, fromBlock: from, toBlock: end, topics: factoryTopics }));
      for (const log of logs) this.handleFactoryLog(log);
    }
    const escrowTopics = [Object.values(this.config.eventTopics).concat(Object.values(this.config.onchainEventTopics))];
    for (const [address, createdBlock] of this.escrows) {
      for (let from = createdBlock; from <= to; from += chunkSize) {
        const end = Math.min(from + chunkSize - 1, to);
        const logs = await this.rpcRetry(`historical logs ${address} ${from}-${end}`, () => this.provider.getLogs({ address, fromBlock: from, toBlock: end, topics: escrowTopics }));
        for (const log of logs) await this.handleLog(log);
      }
    }
    return to;
  }

  private handleFactoryLog(log: ChainLog): void {
    if (log.removed) return;
    try {
      const decoded = this.config.factoryAbi.decodeEventLog("AgreementCreated", log.data, log.topics);
      const address = String(decoded[1]).toLowerCase();
      if (!this.escrows.has(address)) {
        this.escrows.set(address, log.blockNumber);
        if (log.blockHash) this.factoryBlockHashes.set(address, log.blockHash);
        this.eventSource.addAddress(address);
        this.logger.info("Escrow discovered", { agreementId: String(decoded[0]), escrowAddress: address });
      }
    } catch (error) {
      this.logger.error("Unable to decode agreement-created event", { error: String(error) });
    }
  }

  private async rpcRetry<T>(label: string, operation: () => Promise<T>): Promise<T> {
    let lastError: unknown;
    for (const delayMs of [0, 2_000, 5_000]) {
      if (delayMs) await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
      try { return await operation(); }
      catch (error) {
        lastError = error;
        this.logger.warn("RPC request failed; retrying", { label, attempt: delayMs === 0 ? 1 : delayMs === 2_000 ? 2 : 3, error: String(error) });
      }
    }
    throw lastError;
  }

  public async handleLog(log: ChainLog) {
    const input = this.decodeSettlement(log);
    if (!input) return;
    if (log.removed) {
      this.logger.warn("reorg detected", { settlementKey: input.settlementKey });
      return;
    }
    if (!this.database.insert(input, this.now())) return;
    await this.initiateSettlement(input.settlementKey);
  }

  private async handleOnchainEvent(name: keyof RelayerConfig["onchainEventTopics"], log: ChainLog) {
    if (log.removed || !this.config.commercialRegistryUrl || !this.config.commercialRegistryToken) return;
    const state = name === "ContractActivated" ? "ACTIVE" : name === "ContractFinalized" ? "FINALIZED" : name === "ContractCommitted" ? "COMMITTED" : "NEGOTIATION";
    try {
      await fetch(`${this.config.commercialRegistryUrl}${name === "CommitmentAbandoned" ? "/internal/commitment-expired" : "/internal/onchain-state"}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-registry-token": this.config.commercialRegistryToken },
        body: JSON.stringify({ contractAddress: log.address, state, blockNumber: log.blockNumber })
      });
    } catch (error) {
      this.logger.warn("Commercial registry state update failed", { error: String(error), contractAddress: log.address, state });
    }
  }

  public async resumeNonTerminal() {
    for (const row of this.database.nonTerminal()) {
      if (row.status === "AUTHORIZED" || row.status === "GATEWAY_PENDING" || row.status === "MINTING" || row.nextRetryAt === null || row.nextRetryAt <= this.now()) {
        await this.initiateSettlement(row.settlementKey);
      }
    }
  }

  public async processDueRetries() {
    await this.reconcileReorgedSettlements();
    for (const row of this.database.due(this.now())) await this.initiateSettlement(row.settlementKey);
  }

  private async reconcileReorgedSettlements() {
    if (!this.provider.getBlockHash) return;
    const now = this.now();
    if (now - this.lastReorgSweep < 30) return;
    this.lastReorgSweep = now;
    const latest = await this.provider.getBlockNumber();
    const confirmed = latest - this.config.confirmationDepth;
    for (const row of this.database.rowsWithBlockHashes()) {
      if (row.blockNumber > confirmed || !row.blockHash) continue;
      const currentHash = await this.provider.getBlockHash(row.blockNumber);
      if (currentHash && currentHash.toLowerCase() !== row.blockHash.toLowerCase()) {
        this.database.update(row.settlementKey, { status: "RECONCILIATION_REQUIRED", nextRetryAt: null, gatewayResponse: JSON.stringify({ reason: "source block reorg", recordedBlockHash: row.blockHash, currentBlockHash: currentHash }) }, now);
        this.logger.error("Settlement source block changed after indexing; manual reconciliation required", { settlementKey: row.settlementKey, blockNumber: row.blockNumber, recordedBlockHash: row.blockHash, currentBlockHash: currentHash });
      }
    }
    for (const [escrowAddress, createdBlock] of this.escrows) {
      const recordedHash = this.factoryBlockHashes.get(escrowAddress);
      if (createdBlock > confirmed || !recordedHash) continue;
      const currentHash = await this.provider.getBlockHash(createdBlock);
      if (currentHash && currentHash.toLowerCase() !== recordedHash.toLowerCase()) {
        this.escrows.delete(escrowAddress);
        this.factoryBlockHashes.delete(escrowAddress);
        this.eventSource.removeAddress?.(escrowAddress);
        for (const row of this.database.rowsForEscrow(escrowAddress)) {
          this.database.update(row.settlementKey, { status: "RECONCILIATION_REQUIRED", nextRetryAt: null, gatewayResponse: JSON.stringify({ reason: "factory deployment block reorg", recordedBlockHash: recordedHash, currentBlockHash: currentHash }) }, now);
        }
        this.logger.error("Factory deployment block changed after escrow discovery; removed escrow from monitoring", { escrowAddress, blockNumber: createdBlock, recordedBlockHash: recordedHash, currentBlockHash: currentHash });
      }
    }
  }

  public async initiateSettlement(key: string) {
    if (this.inFlight.has(key)) return;
    const now = this.now();
    const row = this.database.get(key);
    if (!row) return;
    const claimed = this.coordinator
      ? await this.coordinator.claim(row.logicalSettlementKey, this.owner)
      : this.database.claim(key, this.owner, now, claimDurationSeconds);
    if (!claimed) return;
    this.inFlight.add(key);
    try { await this.submit(row); }
    finally {
      this.inFlight.delete(key);
      if (this.coordinator) {
        if (this.database.get(key)?.status === "MINTED") await this.coordinator.complete(row.logicalSettlementKey, this.owner);
      } else {
        this.database.releaseClaim(key, this.owner, this.now());
      }
    }
  }

  private async submit(row: SettlementRow) {
    const now = this.now();
    const attempt = row.attemptCount + 1;
    let gatewaySubmissionAttempted = false;
    this.database.markAttempt(row.settlementKey, attempt, now);
    try {
      let request = row.burnIntentJson ? parseBurnIntent(row.burnIntentJson) : undefined;
      const auth = this.authorizationFor(row, request);
      request = auth.burnIntentRequest;
      const currentBlock = await this.provider.getBlockNumber();
      if (auth.maxFee < DEFAULT_GATEWAY_MAX_FEE || auth.maxBlockHeight <= BigInt(currentBlock)) {
        this.reconciliationRequired(row, JSON.stringify({ maxBlockHeight: auth.maxBlockHeight.toString(), maxFee: auth.maxFee.toString(), currentBlock }), "Persisted Gateway parameters are no longer valid", now);
        return;
      }

      if (!row.burnIntentJson) {
        this.database.update(row.settlementKey, { burnIntentJson: JSON.stringify(request) }, now);
        const authorized = await this.executor.authorize(auth, row.escrowAddress);
        this.persistAuthorization(row, request, authorized.authorizationTxHash, authorized.burnIntentHash, now);
      } else {
        // Re-validates the persisted request against the live escrow and recovers
        // the post-authorization crash window without creating a new salt.
        const authorized = await this.executor.authorize(auth, row.escrowAddress);
        if (!row.authorizationTxHash || !row.burnIntentHash) this.persistAuthorization(row, request, authorized.authorizationTxHash, authorized.burnIntentHash, now);
      }

      if (row.gatewayTransferId) {
        await this.recoverGatewayTransfer({ ...row, burnIntentJson: JSON.stringify(request) }, attempt, now);
        return;
      }

      if (row.status === "MINTING" && row.attestation && row.operatorSignature) {
        const minted = await this.executor.mint({ attestation: row.attestation, signature: row.operatorSignature });
        this.database.update(row.settlementKey, { status: "MINTED", mintTxHash: minted.mintTxHash }, this.now());
        return;
      }

      const available = await this.provider.getAvailableBalance?.(USDC, row.escrowAddress);
      if (available !== undefined && available < auth.amount + DEFAULT_GATEWAY_MAX_FEE) {
        this.retry(row, attempt, JSON.stringify({ available: available.toString(), required: (auth.amount + DEFAULT_GATEWAY_MAX_FEE).toString() }), "Insufficient Gateway Wallet balance before submission", now);
        return;
      }

      this.database.update(row.settlementKey, { status: "SUBMITTING", nextRetryAt: null }, now);
      gatewaySubmissionAttempted = true;
      const result = await this.gateway.submit({ burnIntent: request, signature: "0x00", contractSigner: true });
      const body = stringify(result.body);
      const transferId = extractTransferId(result.body);
      if (transferId) {
        this.database.update(row.settlementKey, { status: "GATEWAY_PENDING", gatewayTransferId: transferId, gatewayResponse: body }, now);
        await this.recoverGatewayTransfer({ ...row, status: "GATEWAY_PENDING", gatewayTransferId: transferId, burnIntentJson: JSON.stringify(request) }, attempt, now);
        return;
      }

      const attestation = extractAttestation(result.body);
      if (result.status >= 200 && result.status < 300 && attestation) {
        await this.persistAndMint(row, body, attestation, now);
        return;
      }
      if (result.status >= 400 && result.status < 500) {
        this.database.update(row.settlementKey, { status: "PERMANENT_FAILURE", gatewayResponse: body, nextRetryAt: null }, now);
        return;
      }
      this.reconciliationRequired(row, body, "Gateway submission outcome has no reliable transfer ID", now);
    } catch (error) {
      if (gatewaySubmissionAttempted) {
        if (row.gatewayTransferId) this.retry(row, attempt, stringifyError(error), "Gateway status recovery failed", now);
        else this.reconciliationRequired(row, stringifyError(error), "Gateway submission outcome is unknown", now);
        return;
      }
      if (isAuthorizationConflict(error)) this.reconciliationRequired(row, stringifyError(error), "Live escrow authorization no longer matches the persisted settlement", now);
      else this.retry(row, attempt, stringifyError(error), "Settlement attempt failed", now);
    }
  }

  private async recoverGatewayTransfer(row: SettlementRow, attempt: number, now: number): Promise<void> {
    const result = await this.gateway.getTransfer(row.gatewayTransferId!);
    const body = stringify(result.body);
    const attestation = extractAttestation(result.body);
    if (attestation) {
      await this.persistAndMint(row, body, attestation, now);
      return;
    }
    if (result.status >= 400 && result.status < 500) {
      this.database.update(row.settlementKey, { status: "FAILED", gatewayResponse: body, nextRetryAt: null }, now);
      this.logger.error("Gateway transfer recovery failed", { settlementKey: row.settlementKey, transferId: row.gatewayTransferId });
      return;
    }
    this.retry(row, attempt, body, "Gateway attestation unavailable; retrying recovery without resubmission", now);
  }

  private async persistAndMint(row: SettlementRow, body: string, attestation: { id: string | null; payload: string; signature: string }, now: number) {
    this.database.update(row.settlementKey, { status: "MINTING", gatewayResponse: body, gatewayTransferId: attestation.id ?? row.gatewayTransferId, attestation: attestation.payload, operatorSignature: attestation.signature }, now);
    const minted = await this.executor.mint({ attestation: attestation.payload, signature: attestation.signature });
    this.database.update(row.settlementKey, { status: "MINTED", mintTxHash: minted.mintTxHash }, this.now());
    this.logger.info("Gateway settlement minted", { settlementKey: row.settlementKey, mintTxHash: minted.mintTxHash });
  }

  private persistAuthorization(row: SettlementRow, request: BurnIntentRequest, authorizationTxHash: string, burnIntentHash: string, now: number) {
    this.database.update(row.settlementKey, { status: "AUTHORIZED", authorizationTxHash, burnIntentHash, burnIntentJson: JSON.stringify(request) }, now);
  }

  private authorizationFor(row: SettlementRow, persisted?: BurnIntentRequest): BurnIntentAuthorization {
    const settlementIndex = row.milestoneIndex === null ? DEFAULT_GATEWAY_MAX_BLOCK_HEIGHT : BigInt(row.milestoneIndex);
    const maxBlockHeight = persisted ? BigInt(persisted.maxBlockHeight) : DEFAULT_GATEWAY_MAX_BLOCK_HEIGHT;
    const maxFee = persisted ? BigInt(persisted.maxFee) : DEFAULT_GATEWAY_MAX_FEE;
    const salt = persisted?.spec.salt ?? settlementSalt(row.escrowAddress, settlementIndex);
    const auth: BurnIntentAuthorization = {
      eventType: row.eventType,
      settlementIndex,
      maxBlockHeight,
      maxFee,
      salt,
      recipient: row.recipient,
      amount: parseUsdc(row.amount),
      burnIntentRequest: undefined as never
    };
    auth.burnIntentRequest = persisted ?? buildBurnIntent(auth, { contractAddress: row.escrowAddress, gatewayWalletAddress: this.config.gatewayWalletAddress, gatewayMinterAddress: this.config.gatewayMinterAddress });
    return auth;
  }

  private reconciliationRequired(row: SettlementRow, response: string, reason: string, now: number) {
    this.database.update(row.settlementKey, { status: "RECONCILIATION_REQUIRED", gatewayResponse: response, nextRetryAt: null }, now);
    this.logger.error("Gateway reconciliation required", { settlementKey: row.settlementKey, reason });
  }

  private retry(row: SettlementRow, attempt: number, response: string, reason: string, now: number) {
    if (attempt >= 5) {
      this.database.update(row.settlementKey, { status: "FAILED", gatewayResponse: response, nextRetryAt: null }, now);
      this.logger.error("Settlement exhausted retry budget", { settlementKey: row.settlementKey, reason });
      return;
    }
    const delay = retryDelaySeconds[attempt - 1];
    this.database.update(row.settlementKey, { status: "RETRYING", gatewayResponse: response, nextRetryAt: now + delay }, now);
    this.logger.warn("Settlement scheduled for retry", { settlementKey: row.settlementKey, nextRetryAt: now + delay, reason });
  }

  private decodeSettlement(log: ChainLog): SettlementInput | undefined {
    const topic = log.topics[0]?.toLowerCase();
    const pair = (Object.entries(this.config.eventTopics) as Array<[EventType, string]>).find(([, value]) => value.toLowerCase() === topic);
    if (!pair) return;
    try {
      const [eventType] = pair;
      const decoded = this.config.contractAbi.decodeEventLog(eventType, log.data, log.topics);
      const reclaimed = eventType === "FundsReclaimed";
      const index = reclaimed ? null : Number(decoded[0]);
      const offset = reclaimed ? 0 : 1;
      const recipient = String(decoded[offset]);
      const amount = formatUsdc(BigInt(decoded[offset + 1]));
      const settlementKey = `${log.address}:${log.transactionHash}:${log.logIndex ?? 0}:${eventType}:${index ?? "reclaim"}`;
      const logicalSettlementKey = `${log.address.toLowerCase()}:${index === null ? "reclaim" : index}`;
      return { settlementKey, logicalSettlementKey, escrowAddress: log.address, eventType, milestoneIndex: index, recipient, amount, txHash: log.transactionHash, blockNumber: log.blockNumber, logIndex: log.logIndex ?? null, blockHash: log.blockHash ?? null };
    } catch (error) {
      this.logger.error("Unable to decode fund-movement event", { error: String(error) });
      return;
    }
  }
}

function parseBurnIntent(value: string): BurnIntentRequest {
  const parsed = JSON.parse(value) as BurnIntentRequest;
  if (!parsed || typeof parsed !== "object" || typeof parsed.maxBlockHeight !== "string" || typeof parsed.maxFee !== "string" || !parsed.spec || typeof parsed.spec.salt !== "string") throw new Error("Persisted burn intent is malformed");
  return parsed;
}

function parseUsdc(value: string) {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * 1_000_000n + BigInt((fraction + "000000").slice(0, 6));
}

function formatUsdc(value: bigint) {
  return `${value / 1_000_000n}.${(value % 1_000_000n).toString().padStart(6, "0")}`;
}

function stringify(value: unknown) {
  try { return JSON.stringify(value) ?? "null"; }
  catch { return String(value); }
}

function stringifyError(error: unknown) {
  return stringify(error instanceof Error ? { name: error.name, message: error.message } : error);
}

function extractTransferId(body: unknown): string | undefined {
  const value = body as any;
  const id = value?.transferId ?? value?.id ?? value?.data?.transferId ?? value?.data?.id ?? value?.transfer?.transferId ?? value?.transfer?.id;
  return typeof id === "string" && id ? id : undefined;
}

function extractAttestation(body: unknown): { id: string | null; payload: string; signature: string } | undefined {
  const value = body as any;
  const nested = typeof value?.attestation === "object" ? value.attestation : (value?.data?.attestation ?? value?.transfer?.attestation);
  const payload = typeof value?.attestation === "string" ? value.attestation : (nested?.payload ?? nested?.attestationPayload ?? nested?.encoded);
  const signature = typeof value?.signature === "string" ? value.signature : (nested?.signature ?? value?.data?.signature ?? value?.transfer?.signature);
  if (typeof payload !== "string" || typeof signature !== "string") return;
  return { id: extractTransferId(body) ?? null, payload, signature };
}

function isAuthorizationConflict(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /Burn intent hash mismatch|Settlement terms changed|Settlement state|Burn intent event mismatch|Missing BurnIntentAuthorized/.test(message);
}
