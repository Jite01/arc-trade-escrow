import { setDefaultResultOrder } from "node:dns";
import { Agent } from "node:https";
import { createServer, type Server } from "node:http";
import { FetchRequest, JsonRpcProvider } from "ethers";
import { loadConfig } from "./config.js";
import { TransferDatabase } from "./database.js";
import { EthersLogProvider, EthersPollingEventSource } from "./event-source.js";
import { CircleGatewayClient } from "./gateway.js";
import { consoleLogger } from "./logger.js";
import { Relayer } from "./relayer.js";
import { EthersSettlementExecutor } from "./onchain.js";
import { StatusServer } from "./status-server.js";

// Arc's hostname can publish unreachable IPv6 routes in some environments.
// Prefer IPv4 before ethers opens its HTTP connection so startup does not fail
// with an opaque AggregateError while curl -4 succeeds.
setDefaultResultOrder("ipv4first");
const ipv4Agent = new Agent({ family: 4 });
FetchRequest.registerGetUrl(FetchRequest.createGetUrlFunc({ agent: ipv4Agent }));

async function main(): Promise<void> {
  const bootstrapPort = Number(process.env.PORT || process.env.RELAYER_PORT || 3001);
  const bootstrap = await startBootstrapServer(Number.isInteger(bootstrapPort) && bootstrapPort > 0 ? bootstrapPort : 3001);
  let database: TransferDatabase | undefined;
  let relayer: Relayer | undefined;
  let server: StatusServer | undefined;
  try {
    const config = loadConfig();
    const rpcRequest = new FetchRequest(config.arcRpcUrl);
    rpcRequest.timeout = 30_000;
    const httpProvider = new JsonRpcProvider(rpcRequest, { name: "arc-testnet", chainId: 5_042_002 }, { staticNetwork: true });
    database = new TransferDatabase(config.sqlitePath);
    relayer = new Relayer(
      config,
      database,
      new EthersLogProvider(httpProvider),
      new EthersPollingEventSource(new EthersLogProvider(httpProvider), config),
      new CircleGatewayClient(config.gatewayApiBaseUrl),
      new EthersSettlementExecutor(config.arcRpcUrl, config.relayerPrivateKey, config),
      consoleLogger
    );
    server = new StatusServer(relayer, config.relayerPort);
    database.migrate();
    await closeServer(bootstrap);
    await server.start();
    consoleLogger.info("Relayer status server started", { port: config.relayerPort });

    let initializationTimer: NodeJS.Timeout | undefined;
    const initialize = async (): Promise<void> => {
      try {
        await relayer?.initialize();
        consoleLogger.info("Relayer initialization completed");
      } catch (error) {
        consoleLogger.error("Relayer initialization failed; retrying", {
          error: error instanceof Error ? error.message : String(error)
        });
        initializationTimer = setTimeout(() => void initialize(), 30_000);
        initializationTimer.unref();
      }
    };
    void initialize();

    const shutdown = async (): Promise<void> => {
      relayer?.stop();
      if (initializationTimer) clearTimeout(initializationTimer);
      await server?.stop();
      database?.close();
    };
    process.once("SIGINT", () => void shutdown().finally(() => process.exit(0)));
    process.once("SIGTERM", () => void shutdown().finally(() => process.exit(0)));
  } catch (error) {
    consoleLogger.error("Relayer configuration failed; health endpoint remains available", {
      error: error instanceof Error ? error.message : String(error)
    });
    process.once("SIGINT", () => void closeServer(bootstrap).finally(() => process.exit(0)));
    process.once("SIGTERM", () => void closeServer(bootstrap).finally(() => process.exit(0)));
  }
}

async function startBootstrapServer(port: number): Promise<Server> {
  const server = createServer((request, response) => {
    response.setHeader("Content-Type", "application/json");
    response.setHeader("Access-Control-Allow-Origin", "*");
    if (request.url === "/healthz") {
      response.writeHead(200);
      response.end(JSON.stringify({ ok: true }));
      return;
    }
    response.writeHead(request.url === "/status" ? 200 : 503);
    response.end(JSON.stringify({ ready: false, listening: false }));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "0.0.0.0", resolve);
  });
  return server;
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

void main().catch((error) => {
  if (error instanceof Error) {
    const code = (error as Error & { code?: unknown }).code;
    consoleLogger.error("Relayer startup failed", {
      error: error.message || error.name || String(error),
      ...(code === undefined ? {} : { code: String(code) })
    });
  } else {
    consoleLogger.error("Relayer startup failed", { error: String(error) });
  }
  process.exitCode = 1;
});
