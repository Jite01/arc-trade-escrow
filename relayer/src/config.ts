import { Interface, isAddress } from "ethers";

export interface RelayerConfig {
  contractAddress: string;
  contractAbi: Interface;
  eventTopics: Record<"MilestoneReleased" | "MilestoneArbitrated" | "ArbitrationForced" | "FundsReclaimed", string>;
  gatewayWalletAddress: string;
  deploymentBlock: number;
  arcRpcUrl: string;
  gatewayApiBaseUrl: string;
  gatewayApiKey: string;
  relayerPort: number;
  sqlitePath: string;
}

const required = [
  "CONTRACT_ADDRESS",
  "CONTRACT_ABI",
  "EVENT_TOPIC_RELEASED",
  "EVENT_TOPIC_ARBITRATED",
  "EVENT_TOPIC_FORCED",
  "EVENT_TOPIC_RECLAIMED",
  "GATEWAY_WALLET_ADDRESS",
  "DEPLOYMENT_BLOCK",
  "ARC_RPC_URL",
  "GATEWAY_API_BASE_URL",
  "GATEWAY_API_KEY"
] as const;

function value(env: NodeJS.ProcessEnv, key: string): string {
  const candidate = env[key]?.trim();
  if (!candidate) throw new Error(`Missing required environment variable: ${key}`);
  return candidate;
}

function address(env: NodeJS.ProcessEnv, key: string): string {
  const candidate = value(env, key);
  if (!isAddress(candidate)) throw new Error(`Invalid address in ${key}`);
  return candidate;
}

function topic(env: NodeJS.ProcessEnv, key: string): string {
  const candidate = value(env, key);
  if (!/^0x[0-9a-fA-F]{64}$/.test(candidate)) throw new Error(`Invalid event topic in ${key}`);
  return candidate;
}

function positiveInteger(raw: string, name: string): number {
  if (!/^\d+$/.test(raw)) throw new Error(`Invalid integer in ${name}`);
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`Invalid integer in ${name}`);
  return parsed;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): RelayerConfig {
  for (const key of required) value(env, key);
  let parsedAbi: unknown;
  try {
    parsedAbi = JSON.parse(value(env, "CONTRACT_ABI"));
  } catch {
    throw new Error("CONTRACT_ABI must be valid inline JSON");
  }
  if (!Array.isArray(parsedAbi)) throw new Error("CONTRACT_ABI must be a JSON array");

  const port = positiveInteger(env.RELAYER_PORT?.trim() || "3001", "RELAYER_PORT");
  if (port === 0 || port > 65_535) throw new Error("RELAYER_PORT must be between 1 and 65535");
  const deploymentBlock = positiveInteger(value(env, "DEPLOYMENT_BLOCK"), "DEPLOYMENT_BLOCK");
  const gatewayApiBaseUrl = value(env, "GATEWAY_API_BASE_URL").replace(/\/+$/, "");
  try {
    new URL(gatewayApiBaseUrl);
    new URL(value(env, "ARC_RPC_URL"));
  } catch {
    throw new Error("ARC_RPC_URL and GATEWAY_API_BASE_URL must be valid URLs");
  }

  return {
    contractAddress: address(env, "CONTRACT_ADDRESS"),
    contractAbi: new Interface(parsedAbi),
    eventTopics: {
      MilestoneReleased: topic(env, "EVENT_TOPIC_RELEASED"),
      MilestoneArbitrated: topic(env, "EVENT_TOPIC_ARBITRATED"),
      ArbitrationForced: topic(env, "EVENT_TOPIC_FORCED"),
      FundsReclaimed: topic(env, "EVENT_TOPIC_RECLAIMED")
    },
    gatewayWalletAddress: address(env, "GATEWAY_WALLET_ADDRESS"),
    deploymentBlock,
    arcRpcUrl: value(env, "ARC_RPC_URL"),
    gatewayApiBaseUrl,
    gatewayApiKey: value(env, "GATEWAY_API_KEY"),
    relayerPort: port,
    sqlitePath: env.SQLITE_PATH?.trim() || "./relayer.db"
  };
}
