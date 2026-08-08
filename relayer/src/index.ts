import { FetchRequest, JsonRpcProvider } from "ethers";
import { loadConfig } from "./config.js";
import { TransferDatabase } from "./database.js";
import { EthersContractEventSource, EthersLogProvider } from "./event-source.js";
import { CircleGatewayClient } from "./gateway.js";
import { consoleLogger } from "./logger.js";
import { Relayer } from "./relayer.js";
import { EthersSettlementExecutor } from "./onchain.js";
import { StatusServer } from "./status-server.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const rpcRequest = new FetchRequest(config.arcRpcUrl);
  rpcRequest.timeout = 30_000;
  const provider = new JsonRpcProvider(rpcRequest, { name: "arc-testnet", chainId: 5_042_002 }, { staticNetwork: true });
  const database = new TransferDatabase(config.sqlitePath);
  const relayer = new Relayer(
    config,
    database,
    new EthersLogProvider(provider),
    new EthersContractEventSource(provider, config),
    new CircleGatewayClient(config.gatewayApiBaseUrl),
    new EthersSettlementExecutor(config.arcRpcUrl, config.relayerPrivateKey, config),
    consoleLogger
  );
  const server = new StatusServer(relayer, config.relayerPort);
  await relayer.initialize();
  await server.start();
  consoleLogger.info("Relayer status server started", { port: config.relayerPort });

  const shutdown = async (): Promise<void> => {
    relayer.stop();
    await server.stop();
    database.close();
  };
  process.once("SIGINT", () => void shutdown().finally(() => process.exit(0)));
  process.once("SIGTERM", () => void shutdown().finally(() => process.exit(0)));
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
