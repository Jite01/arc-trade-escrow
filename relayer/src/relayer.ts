import type { RelayerConfig } from "./config.js";
import { TransferDatabase } from "./database.js";
import type { ChainLog, EventSource, EventType, GatewayClient, Logger, LogProvider, TransferInput, TransferRow } from "./types.js";

const retryDelaySeconds = [30, 120, 600, 1800] as const;

export class Relayer {
  private readonly inFlight = new Set<string>();
  private retryTimer: NodeJS.Timeout | undefined;
  private active = false;

  public constructor(
    public readonly config: RelayerConfig,
    public readonly database: TransferDatabase,
    private readonly provider: LogProvider,
    private readonly eventSource: EventSource,
    private readonly gateway: GatewayClient,
    private readonly logger: Logger,
    private readonly now: () => number = () => Math.floor(Date.now() / 1000)
  ) {}

  public get listening(): boolean {
    return this.active;
  }

  public async initialize(): Promise<void> {
    const code = await this.provider.getCode(this.config.contractAddress);
    if (code === "0x") throw new Error(`No deployed contract code at ${this.config.contractAddress}`);
    this.database.migrate();

    await this.resumeNonTerminal();
    await this.historicalSweep();
    for (const topic of Object.values(this.config.eventTopics)) {
      this.eventSource.subscribe(topic, (log) => {
        void this.handleLog(log);
      });
    }
    this.active = true;
    this.retryTimer = setInterval(() => {
      void this.processDueRetries();
    }, 10_000);
    this.retryTimer.unref();
    this.logger.info("Relayer initialized", { contractAddress: this.config.contractAddress });
  }

  public stop(): void {
    this.active = false;
    this.eventSource.unsubscribe();
    if (this.retryTimer) clearInterval(this.retryTimer);
    this.retryTimer = undefined;
  }

  public async historicalSweep(): Promise<void> {
    const toBlock = await this.provider.getBlockNumber();
    const topics = Object.values(this.config.eventTopics);
    const logs = await this.provider.getLogs({
      address: this.config.contractAddress,
      fromBlock: this.config.deploymentBlock,
      toBlock,
      topics: [topics]
    });
    this.logger.info("Historical sweep completed", { fromBlock: this.config.deploymentBlock, toBlock, logCount: logs.length });
    for (const log of logs) await this.handleLog(log);
  }

  public async handleLog(log: ChainLog): Promise<void> {
    const input = this.decodeTransfer(log);
    if (!input) return;
    if (log.removed) {
      const row = this.database.get(input.transferHash);
      if (row) this.logger.warn(`reorg detected for transferHash: ${input.transferHash}`, { status: row.status });
      return;
    }

    const inserted = this.database.insert(input, this.now());
    if (!inserted) {
      this.logger.debug("Duplicate transferHash skipped by SQLite UNIQUE constraint", { transferHash: input.transferHash });
      return;
    }
    await this.initiateGatewayTransfer(input.transferHash);
  }

  public async resumeNonTerminal(): Promise<void> {
    const now = this.now();
    for (const row of this.database.nonTerminal()) {
      if (row.nextRetryAt === null || row.nextRetryAt <= now) await this.initiateGatewayTransfer(row.transferHash);
      else this.logger.info("Scheduled persisted retry", { transferHash: row.transferHash, nextRetryAt: row.nextRetryAt });
    }
  }

  public async processDueRetries(): Promise<void> {
    for (const row of this.database.due(this.now())) await this.initiateGatewayTransfer(row.transferHash);
  }

  /** The only code path that submits a pre-authorized transfer to Circle Gateway. */
  public async initiateGatewayTransfer(transferHash: string): Promise<void> {
    if (this.inFlight.has(transferHash)) return;
    const row = this.database.get(transferHash);
    if (!row || this.database.isTerminal(row.status)) return;

    this.inFlight.add(transferHash);
    try {
      await this.submit(row);
    } finally {
      this.inFlight.delete(transferHash);
    }
  }

  private async submit(row: TransferRow): Promise<void> {
    const now = this.now();
    const attempt = row.attemptCount + 1;
    this.database.markAttempt(row.transferHash, attempt, now);
    try {
      const result = await this.gateway.submit({
        contractAddress: this.config.contractAddress,
        transferHash: row.transferHash,
        recipient: row.recipient,
        amount: row.amount
      });
      const response = stringify(result.body);
      if (result.status === 200 || (isAlreadyProcessed(result.status, result.body) && result.status >= 400 && result.status < 500)) {
        this.database.markSubmitted(row.transferHash, response, now);
        if (attempt > 1) this.logger.info("Resubmission confirmed — Gateway idempotent.", { transferHash: row.transferHash });
        else this.logger.info("Gateway transfer submitted", { transferHash: row.transferHash });
        return;
      }
      if (result.status === 400 || result.status === 401 || result.status === 403) {
        this.database.markPermanentFailure(row.transferHash, response, now);
        this.logger.error("Gateway rejected transfer permanently", { transferHash: row.transferHash, status: result.status });
        return;
      }
      await this.retryOrFail(row.transferHash, attempt, response, `Gateway returned HTTP ${result.status}`, now);
    } catch (error) {
      const response = stringifyError(error);
      await this.retryOrFail(row.transferHash, attempt, response, "Gateway request failed or timed out", now);
    }
  }

  private async retryOrFail(transferHash: string, attempt: number, response: string, reason: string, now: number): Promise<void> {
    if (attempt >= 5) {
      this.database.markFailed(transferHash, response, now);
      this.logger.error("Gateway transfer exhausted retry budget", { transferHash, attempt, reason });
      return;
    }
    const delay = retryDelaySeconds[attempt - 1];
    this.database.markRetrying(transferHash, now + delay, response, now);
    this.logger.warn("Gateway transfer scheduled for retry", { transferHash, attempt, reason, nextRetryAt: now + delay });
  }

  private decodeTransfer(log: ChainLog): TransferInput | undefined {
    const topic = log.topics[0]?.toLowerCase();
    const matched = (Object.entries(this.config.eventTopics) as Array<[EventType, string]>).find(([, configuredTopic]) => configuredTopic.toLowerCase() === topic);
    if (!matched) return undefined;
    const [eventType] = matched;
    try {
      const decoded = this.config.contractAbi.decodeEventLog(eventType, log.data, log.topics);
      const milestoneIndex = eventType === "FundsReclaimed" ? null : Number(decoded[0]);
      const offset = eventType === "FundsReclaimed" ? 0 : 1;
      const recipient = String(decoded[offset]);
      const amount = formatUsdc(BigInt(decoded[offset + 1]));
      const transferHash = String(decoded[offset + 2]);
      return { transferHash, eventType, milestoneIndex, recipient, amount, txHash: log.transactionHash, blockNumber: log.blockNumber };
    } catch (error) {
      this.logger.error("Unable to decode fund-movement event", { topic, error: error instanceof Error ? error.message : String(error) });
      return undefined;
    }
  }
}

function isAlreadyProcessed(status: number, body: unknown): boolean {
  if (status < 400 || status >= 500) return false;
  const text = stringify(body).toLowerCase();
  return /already\s+(processed|submitted|executed|used|exists)|duplicate|idempotent/.test(text);
}

/** Formats the contract's six-decimal USDC integer amount exactly as Gateway requires. */
function formatUsdc(amount: bigint): string {
  const integer = amount / 1_000_000n;
  const fraction = (amount % 1_000_000n).toString().padStart(6, "0");
  return `${integer}.${fraction}`;
}

function stringify(value: unknown): string {
  if (value === undefined) return "null";
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({ unstringifiable: String(value) });
  }
}

function stringifyError(error: unknown): string {
  if (error instanceof Error) return stringify({ name: error.name, message: error.message });
  return stringify(error);
}
