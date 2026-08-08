import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { test } from "node:test";
import type { AddressInfo } from "node:net";
import { Interface } from "ethers";
import { loadConfig, type RelayerConfig } from "../src/config.js";
import { TransferDatabase } from "../src/database.js";
import { CircleGatewayClient } from "../src/gateway.js";
import { Relayer } from "../src/relayer.js";
import { StatusServer } from "../src/status-server.js";
import type { ChainLog, EventSource, GatewayClient, GatewayResult, Logger, LogProvider, TransferInput } from "../src/types.js";

const CONTRACT_ADDRESS = "0x1111111111111111111111111111111111111111";
const RECIPIENT = "0x2222222222222222222222222222222222222222";
const GATEWAY_WALLET_ADDRESS = "0x3333333333333333333333333333333333333333";
const ABI = [
  "event MilestoneReleased(uint256 index, address recipient, uint256 amount, bytes32 transferHash)",
  "event MilestoneArbitrated(uint256 index, address recipient, uint256 amount, bytes32 transferHash)",
  "event ArbitrationForced(uint256 index, address recipient, uint256 amount, bytes32 transferHash)",
  "event FundsReclaimed(address recipient, uint256 amount, bytes32 transferHash)"
] as const;
const iface = new Interface(ABI);
const eventNames = ["MilestoneReleased", "MilestoneArbitrated", "ArbitrationForced", "FundsReclaimed"] as const;
type EventName = (typeof eventNames)[number];

class FakeProvider implements LogProvider {
  public constructor(private readonly logs: ChainLog[] = []) {}

  public async getBlockNumber(): Promise<number> {
    return 101;
  }

  public async getCode(): Promise<string> {
    return "0x6000";
  }

  public async getLogs(): Promise<ChainLog[]> {
    return this.logs;
  }
}

class FakeEventSource implements EventSource {
  private readonly listeners = new Map<string, (log: ChainLog) => void>();

  public subscribe(topic: string, listener: (log: ChainLog) => void): void {
    this.listeners.set(topic, listener);
  }

  public unsubscribe(): void {
    this.listeners.clear();
  }

  public emit(topic: string, log: ChainLog): void {
    this.listeners.get(topic)?.(log);
  }
}

class FakeGateway implements GatewayClient {
  public readonly calls: Array<{ contractAddress: string; transferHash: string; recipient: string; amount: string }> = [];

  public constructor(private readonly results: Array<GatewayResult | Error> = []) {}

  public async submit(input: { contractAddress: string; transferHash: string; recipient: string; amount: string }): Promise<GatewayResult> {
    this.calls.push(input);
    const result = this.results.shift() ?? { status: 200, body: { accepted: true } };
    if (result instanceof Error) throw result;
    return result;
  }
}

class FakeLogger implements Logger {
  public readonly entries: Array<{ level: string; message: string; meta?: Record<string, unknown> }> = [];

  public debug(message: string, meta?: Record<string, unknown>): void { this.entries.push({ level: "DEBUG", message, meta }); }
  public info(message: string, meta?: Record<string, unknown>): void { this.entries.push({ level: "INFO", message, meta }); }
  public warn(message: string, meta?: Record<string, unknown>): void { this.entries.push({ level: "WARN", message, meta }); }
  public error(message: string, meta?: Record<string, unknown>): void { this.entries.push({ level: "ERROR", message, meta }); }
}

function config(): RelayerConfig {
  return {
    contractAddress: CONTRACT_ADDRESS,
    contractAbi: iface,
    eventTopics: Object.fromEntries(eventNames.map((name) => [name, iface.getEvent(name)!.topicHash])) as RelayerConfig["eventTopics"],
    gatewayWalletAddress: GATEWAY_WALLET_ADDRESS,
    deploymentBlock: 100,
    arcRpcUrl: "http://rpc.example.test",
    gatewayApiBaseUrl: "http://gateway.example.test",
    gatewayApiKey: "test-key",
    relayerPort: 3001,
    sqlitePath: ":memory:"
  };
}

function transferLog(eventType: EventName, transferHash: string, amount = 1_000_000n, removed = false): ChainLog {
  const event = iface.getEvent(eventType)!;
  const values = eventType === "FundsReclaimed"
    ? [RECIPIENT, amount, transferHash]
    : [2n, RECIPIENT, amount, transferHash];
  const encoded = iface.encodeEventLog(event, values);
  return { topics: encoded.topics, data: encoded.data, transactionHash: `0x${"ab".repeat(32)}`, blockNumber: 101, removed };
}

function transferInput(transferHash: string): TransferInput {
  return {
    transferHash,
    eventType: "MilestoneReleased",
    milestoneIndex: 0,
    recipient: RECIPIENT,
    amount: "1.000000",
    txHash: `0x${"cd".repeat(32)}`,
    blockNumber: 101
  };
}

function harness(options: { logs?: ChainLog[]; results?: Array<GatewayResult | Error>; now?: number } = {}) {
  let timestamp = options.now ?? 1_000;
  const database = new TransferDatabase(":memory:");
  const source = new FakeEventSource();
  const gateway = new FakeGateway(options.results);
  const logger = new FakeLogger();
  const relayer = new Relayer(config(), database, new FakeProvider(options.logs), source, gateway, logger, () => timestamp);
  return { database, source, gateway, logger, relayer, setNow: (value: number) => { timestamp = value; } };
}

test("config validation requires the complete relayer handoff", () => {
  assert.throws(() => loadConfig({}), /CONTRACT_ADDRESS/);
  const env = {
    CONTRACT_ADDRESS,
    CONTRACT_ABI: JSON.stringify(ABI),
    EVENT_TOPIC_RELEASED: iface.getEvent("MilestoneReleased")!.topicHash,
    EVENT_TOPIC_ARBITRATED: iface.getEvent("MilestoneArbitrated")!.topicHash,
    EVENT_TOPIC_FORCED: iface.getEvent("ArbitrationForced")!.topicHash,
    EVENT_TOPIC_RECLAIMED: iface.getEvent("FundsReclaimed")!.topicHash,
    GATEWAY_WALLET_ADDRESS,
    DEPLOYMENT_BLOCK: "100",
    ARC_RPC_URL: "http://rpc.example.test",
    GATEWAY_API_BASE_URL: "http://gateway.example.test/",
    GATEWAY_API_KEY: "key"
  };
  const loaded = loadConfig(env);
  assert.equal(loaded.relayerPort, 3001);
  assert.equal(loaded.sqlitePath, "./relayer.db");
  assert.equal(loaded.gatewayApiBaseUrl, "http://gateway.example.test");
});

test("historical sweep handles every authorized-transfer event and formats USDC to six decimals", async () => {
  const hashes = eventNames.map((_, index) => `0x${index.toString(16).padStart(64, "0")}`);
  const logs = eventNames.map((name, index) => transferLog(name, hashes[index]!, 1_000_001n + BigInt(index)));
  const { database, gateway, relayer } = harness({ logs });

  await relayer.initialize();

  const rows = database.all();
  assert.equal(rows.length, 4);
  assert.deepEqual(new Set(rows.map((row) => row.eventType)), new Set(eventNames));
  assert.equal(rows.find((row) => row.eventType === "FundsReclaimed")!.milestoneIndex, null);
  assert.ok(rows.filter((row) => row.eventType !== "FundsReclaimed").every((row) => row.milestoneIndex === 2));
  assert.deepEqual(gateway.calls.map((call) => call.amount).sort(), ["1.000001", "1.000002", "1.000003", "1.000004"]);
  assert.ok(rows.every((row) => row.status === "SUBMITTED"));
  relayer.stop();
  database.close();
});

test("SQLite UNIQUE is the only duplicate gate across historical and live discovery", async () => {
  const hash = `0x${"01".repeat(32)}`;
  const log = transferLog("MilestoneReleased", hash);
  const { database, gateway, relayer } = harness({ logs: [log] });

  await relayer.initialize();
  await Promise.all([relayer.handleLog(log), relayer.handleLog(log)]);

  assert.equal(database.all().length, 1);
  assert.equal(gateway.calls.length, 1);
  relayer.stop();
  database.close();
});

test("live subscription submits a newly emitted authorization exactly once", async () => {
  const hash = `0x${"0c".repeat(32)}`;
  const log = transferLog("MilestoneReleased", hash);
  const { database, source, gateway, relayer } = harness();

  await relayer.initialize();
  source.emit(config().eventTopics.MilestoneReleased, log);
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.equal(database.get(hash)?.status, "SUBMITTED");
  assert.equal(gateway.calls.length, 1);
  relayer.stop();
  database.close();
});

test("5xx and timeout responses follow the five-attempt retry schedule and then become FAILED", async () => {
  const hash = `0x${"02".repeat(32)}`;
  const { database, gateway, relayer, setNow } = harness({
    results: [
      { status: 503, body: { error: "temporary" } },
      new Error("socket closed after send"),
      { status: 503, body: { error: "temporary" } },
      { status: 503, body: { error: "temporary" } },
      { status: 503, body: { error: "temporary" } }
    ]
  });
  database.migrate();
  assert.equal(database.insert(transferInput(hash), 1_000), true);

  await relayer.initiateGatewayTransfer(hash);
  for (const nextRetryAt of [1_030, 1_150, 1_750, 3_550]) {
    assert.equal(database.get(hash)!.nextRetryAt, nextRetryAt);
    setNow(nextRetryAt);
    await relayer.processDueRetries();
  }

  const row = database.get(hash)!;
  assert.equal(gateway.calls.length, 5);
  assert.equal(row.attemptCount, 5);
  assert.equal(row.status, "FAILED");
  assert.equal(row.nextRetryAt, null);
  database.close();
});

test("429 retries, 401 is terminal, and an already-processed 4xx confirms submission", async () => {
  const retryHash = `0x${"03".repeat(32)}`;
  const deniedHash = `0x${"04".repeat(32)}`;
  const duplicateHash = `0x${"05".repeat(32)}`;
  const { database, relayer } = harness({
    results: [
      { status: 429, body: { error: "rate limited" } },
      { status: 401, body: { error: "unauthorized" } },
      { status: 409, body: { error: "transfer already processed" } }
    ]
  });
  database.migrate();
  for (const hash of [retryHash, deniedHash, duplicateHash]) assert.equal(database.insert(transferInput(hash), 1_000), true);

  await relayer.initiateGatewayTransfer(retryHash);
  await relayer.initiateGatewayTransfer(deniedHash);
  await relayer.initiateGatewayTransfer(duplicateHash);

  assert.equal(database.get(retryHash)!.status, "RETRYING");
  assert.equal(database.get(retryHash)!.nextRetryAt, 1_030);
  assert.equal(database.get(deniedHash)!.status, "PERMANENT_FAILURE");
  assert.equal(database.get(duplicateHash)!.status, "SUBMITTED");
  database.close();
});

test("restart recovery resumes only due non-terminal rows, while terminal rows remain untouched", async () => {
  const dueHash = `0x${"06".repeat(32)}`;
  const futureHash = `0x${"07".repeat(32)}`;
  const terminalHash = `0x${"08".repeat(32)}`;
  const { database, gateway, relayer, setNow } = harness();
  database.migrate();
  for (const hash of [dueHash, futureHash, terminalHash]) assert.equal(database.insert(transferInput(hash), 1_000), true);
  database.markRetrying(dueHash, 900, "{}", 1_000);
  database.markRetrying(futureHash, 1_100, "{}", 1_000);
  database.markSubmitted(terminalHash, "{}", 1_000);

  await relayer.resumeNonTerminal();
  assert.deepEqual(gateway.calls.map((call) => call.transferHash), [dueHash]);
  setNow(1_100);
  await relayer.processDueRetries();
  assert.deepEqual(gateway.calls.map((call) => call.transferHash), [dueHash, futureHash]);
  assert.equal(database.get(terminalHash)!.status, "SUBMITTED");
  database.close();
});

test("a removed event only records a reorg warning and never resubmits", async () => {
  const hash = `0x${"09".repeat(32)}`;
  const { database, gateway, logger, relayer } = harness();
  database.migrate();
  assert.equal(database.insert(transferInput(hash), 1_000), true);
  database.markSubmitted(hash, "{}", 1_000);

  await relayer.handleLog(transferLog("MilestoneReleased", hash, 1_000_000n, true));

  assert.equal(gateway.calls.length, 0);
  assert.ok(logger.entries.some((entry) => entry.level === "WARN" && entry.message.includes("reorg detected")));
  assert.equal(database.get(hash)!.status, "SUBMITTED");
  database.close();
});

test("Gateway client sends the exact transfer contract request", async () => {
  let requestBody = "";
  let requestHeaders: Record<string, string | string[] | undefined> = {};
  const server = createServer((request, response) => {
    requestHeaders = request.headers;
    request.on("data", (chunk) => { requestBody += String(chunk); });
    request.on("end", () => {
      assert.equal(request.method, "POST");
      assert.equal(request.url, "/v1/transfer");
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ accepted: true }));
    });
  });
  await listen(server);
  const port = (server.address() as AddressInfo).port;

  const client = new CircleGatewayClient(`http://127.0.0.1:${port}`, "gateway-key");
  const result = await client.submit({ contractAddress: CONTRACT_ADDRESS, transferHash: `0x${"0a".repeat(32)}`, recipient: RECIPIENT, amount: "1.000000" });

  assert.equal(result.status, 200);
  assert.equal(requestHeaders.authorization, "Bearer gateway-key");
  assert.equal(requestHeaders["content-type"], "application/json");
  assert.deepEqual(JSON.parse(requestBody), {
    contractAddress: CONTRACT_ADDRESS,
    contractSigner: true,
    hash: `0x${"0a".repeat(32)}`,
    recipient: RECIPIENT,
    amount: "1.000000",
    chain: "arc-testnet"
  });
  await close(server);
});

test("status server exposes live counts, transfer rows, and a 404 for unknown hashes", async () => {
  const { database, relayer } = harness();
  database.migrate();
  const hash = `0x${"0b".repeat(32)}`;
  assert.equal(database.insert(transferInput(hash), 1_000), true);
  const server = new StatusServer(relayer, 0);
  await server.start();
  const nativeServer = (server as unknown as { server: Server }).server;
  const port = (nativeServer.address() as AddressInfo).port;

  const status = await fetch(`http://127.0.0.1:${port}/status`);
  const transfers = await fetch(`http://127.0.0.1:${port}/transfers`);
  const known = await fetch(`http://127.0.0.1:${port}/transfers/${hash}`);
  const unknown = await fetch(`http://127.0.0.1:${port}/transfers/0xunknown`);
  assert.equal(status.status, 200);
  assert.equal((await status.json() as { transfers: { pending: number } }).transfers.pending, 1);
  assert.equal(transfers.status, 200);
  assert.equal((await transfers.json() as Array<{ transferHash: string }>)[0]!.transferHash, hash);
  assert.equal(known.status, 200);
  assert.equal((await known.json() as { transferHash: string }).transferHash, hash);
  assert.equal(unknown.status, 404);
  await server.stop();
  database.close();
});

function listen(server: Server): Promise<void> {
  return new Promise((resolve, reject) => server.listen(0, "127.0.0.1", (error?: Error) => (error ? reject(error) : resolve())));
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}
