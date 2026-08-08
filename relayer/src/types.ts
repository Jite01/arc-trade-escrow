export type TransferStatus = "PENDING" | "RETRYING" | "SUBMITTED" | "FAILED" | "PERMANENT_FAILURE";

export type EventType =
  | "MilestoneReleased"
  | "MilestoneArbitrated"
  | "ArbitrationForced"
  | "FundsReclaimed";

export interface TransferInput {
  transferHash: string;
  eventType: EventType;
  milestoneIndex: number | null;
  recipient: string;
  amount: string;
  txHash: string;
  blockNumber: number;
}

export interface TransferRow extends TransferInput {
  id: number;
  status: TransferStatus;
  attemptCount: number;
  nextRetryAt: number | null;
  lastAttemptAt: number | null;
  gatewayResponse: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface ChainLog {
  topics: readonly string[];
  data: string;
  transactionHash: string;
  blockNumber: number;
  removed?: boolean;
}

export interface LogProvider {
  getBlockNumber(): Promise<number>;
  getCode(address: string): Promise<string>;
  getLogs(filter: { address: string; fromBlock: number; toBlock: number; topics: readonly (readonly string[])[] }): Promise<ChainLog[]>;
}

export interface EventSource {
  subscribe(topic: string, listener: (log: ChainLog) => void): void;
  unsubscribe(): void;
}

export interface GatewayResult {
  status: number;
  body: unknown;
}

export interface GatewayClient {
  submit(input: {
    contractAddress: string;
    transferHash: string;
    recipient: string;
    amount: string;
  }): Promise<GatewayResult>;
}

export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}
