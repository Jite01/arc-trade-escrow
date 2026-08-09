export type SettlementStatus =
  | "PENDING"
  | "RETRYING"
  | "AUTHORIZED"
  | "MINTING"
  | "MINTED"
  | "FAILED"
  | "PERMANENT_FAILURE";

export type EventType = "MilestoneReleased" | "MilestoneArbitrated" | "ArbitrationForced" | "FundsReclaimed";

export interface SettlementInput {
  settlementKey: string;
  eventType: EventType;
  milestoneIndex: number | null;
  recipient: string;
  amount: string;
  txHash: string;
  blockNumber: number;
  logIndex: number | null;
}

export interface SettlementRow extends SettlementInput {
  id: number;
  status: SettlementStatus;
  attemptCount: number;
  nextRetryAt: number | null;
  lastAttemptAt: number | null;
  gatewayResponse: string | null;
  authorizationTxHash: string | null;
  gatewayTransferId: string | null;
  attestation: string | null;
  operatorSignature: string | null;
  mintTxHash: string | null;
  burnIntentHash: string | null;
  burnIntentJson: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface ChainLog {
  topics: readonly string[];
  data: string;
  transactionHash: string;
  blockNumber: number;
  logIndex?: number;
  removed?: boolean;
}

export interface LogProvider {
  getBlockNumber(): Promise<number>;
  getCode(address: string): Promise<string>;
  getAvailableBalance?(token: string, depositor: string): Promise<bigint>;
  getLogs(filter: { address: string; fromBlock: number; toBlock: number; topics: readonly (readonly string[])[] }): Promise<ChainLog[]>;
}

export interface EventSource {
  subscribe(topic: string, listener: (log: ChainLog) => void): void;
  unsubscribe(): void;
}

export interface BurnIntentSpec {
  version: number;
  sourceDomain: number;
  destinationDomain: number;
  sourceContract: string;
  destinationContract: string;
  sourceToken: string;
  destinationToken: string;
  sourceDepositor: string;
  destinationRecipient: string;
  sourceSigner: string;
  destinationCaller: string;
  value: string;
  salt: string;
  hookData: string;
}

export interface BurnIntentRequest {
  maxBlockHeight: string;
  maxFee: string;
  spec: BurnIntentSpec;
}

export interface GatewayTransferRequest {
  burnIntent: BurnIntentRequest;
  signature: string;
  contractSigner: true;
}

export interface GatewayResult {
  status: number;
  body: unknown;
}

export interface GatewayClient {
  submit(request: GatewayTransferRequest): Promise<GatewayResult>;
  getTransfer?(transferId: string): Promise<GatewayResult>;
}

export interface BurnIntentAuthorization {
  settlementIndex: bigint;
  maxBlockHeight: bigint;
  maxFee: bigint;
  salt: string;
  recipient: string;
  amount: bigint;
  burnIntentRequest: BurnIntentRequest;
}

export interface BurnIntentAuthorizationResult {
  burnIntentHash: string;
  authorizationTxHash: string;
}

export interface SettlementAuthorizer {
  authorize(input: BurnIntentAuthorization): Promise<BurnIntentAuthorizationResult>;
}

export interface GatewayMinter {
  mint(input: { attestation: string; signature: string }): Promise<{ mintTxHash: string }>;
}

export interface SettlementExecutor {
  authorize(input: BurnIntentAuthorization): Promise<BurnIntentAuthorizationResult>;
  mint(input: { attestation: string; signature: string }): Promise<{ mintTxHash: string }>;
}

export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}
