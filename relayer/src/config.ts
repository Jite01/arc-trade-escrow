import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Interface, isAddress, type InterfaceAbi } from "ethers";

export interface RelayerConfig {
  contractAddress: string;
  contractAbi: Interface;
  eventTopics: Record<"MilestoneReleased" | "MilestoneArbitrated" | "ArbitrationForced" | "FundsReclaimed", string>;
  gatewayWalletAddress: string;
  gatewayMinterAddress: string;
  deploymentBlock: number;
  arcRpcUrl: string;
  arcWssUrl?: string;
  gatewayApiBaseUrl: string;
  relayerPrivateKey: string;
  relayerPort: number;
  sqlitePath: string;
}

const required = ["ARC_RPC_URL"] as const;

interface DeploymentConfig {
  CONTRACT_ADDRESS: string;
  CONTRACT_ABI: InterfaceAbi;
  EVENT_TOPIC_RELEASED: string;
  EVENT_TOPIC_ARBITRATED: string;
  EVENT_TOPIC_FORCED: string;
  EVENT_TOPIC_RECLAIMED: string;
  GATEWAY_WALLET_ADDRESS: string;
  GATEWAY_MINTER_ADDRESS: string;
  DEPLOYMENT_BLOCK: number;
}

function value(env: NodeJS.ProcessEnv, key: string): string {
  return requiredString(env[key], key);
}

function requiredString(raw: unknown, key: string): string {
  const candidate = typeof raw === "string" ? raw.trim() : "";
  if (!candidate) throw new Error(`Missing required configuration value: ${key}`);
  return candidate;
}

function addressValue(raw: unknown, key: string): string {
  const candidate = requiredString(raw, key);
  if (!isAddress(candidate)) throw new Error(`Invalid address in ${key}`);
  return candidate;
}

function topicValue(raw: unknown, key: string): string {
  const candidate = requiredString(raw, key);
  if (!/^0x[0-9a-fA-F]{64}$/.test(candidate)) throw new Error(`Invalid event topic in ${key}`);
  return candidate;
}

function positiveInteger(raw: string, name: string): number {
  if (!/^\d+$/.test(raw)) throw new Error(`Invalid integer in ${name}`);
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`Invalid integer in ${name}`);
  return parsed;
}

function deploymentBlockValue(raw: unknown): number {
  const candidate = typeof raw === "number" ? String(raw) : requiredString(raw, "DEPLOYMENT_BLOCK");
  return positiveInteger(candidate, "DEPLOYMENT_BLOCK");
}

function readDeploymentConfig(): DeploymentConfig {
  const configPath = resolve(process.cwd(), "config.json");
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(configPath, "utf8"));
  } catch (error) {
    const detail = error instanceof Error ? `: ${error.message}` : "";
    throw new Error(`Unable to read generated deployment config at ${configPath}${detail}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Generated deployment config at ${configPath} must be a JSON object`);
  }
  const raw = parsed as Record<string, unknown>;
  const abi = raw.CONTRACT_ABI;
  if (!Array.isArray(abi)) throw new Error("Generated deployment config CONTRACT_ABI must be a JSON array");
  return {
    CONTRACT_ADDRESS: addressValue(raw.CONTRACT_ADDRESS, "CONTRACT_ADDRESS"),
    CONTRACT_ABI: abi as InterfaceAbi,
    EVENT_TOPIC_RELEASED: topicValue(raw.EVENT_TOPIC_RELEASED, "EVENT_TOPIC_RELEASED"),
    EVENT_TOPIC_ARBITRATED: topicValue(raw.EVENT_TOPIC_ARBITRATED, "EVENT_TOPIC_ARBITRATED"),
    EVENT_TOPIC_FORCED: topicValue(raw.EVENT_TOPIC_FORCED, "EVENT_TOPIC_FORCED"),
    EVENT_TOPIC_RECLAIMED: topicValue(raw.EVENT_TOPIC_RECLAIMED, "EVENT_TOPIC_RECLAIMED"),
    GATEWAY_WALLET_ADDRESS: addressValue(raw.GATEWAY_WALLET_ADDRESS, "GATEWAY_WALLET_ADDRESS"),
    GATEWAY_MINTER_ADDRESS: addressValue(raw.GATEWAY_MINTER_ADDRESS, "GATEWAY_MINTER_ADDRESS"),
    DEPLOYMENT_BLOCK: deploymentBlockValue(raw.DEPLOYMENT_BLOCK)
  };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): RelayerConfig {
  const deployment = readDeploymentConfig();
  for (const key of required) value(env, key);
  const parsedAbi = deployment.CONTRACT_ABI;

  const port = positiveInteger(env.RELAYER_PORT?.trim() || "3001", "RELAYER_PORT");
  if (port === 0 || port > 65_535) throw new Error("RELAYER_PORT must be between 1 and 65535");
  const gatewayApiBaseUrl = (env.GATEWAY_API_BASE_URL?.trim() || "https://gateway-api-testnet.circle.com").replace(/\/+$/, "");
  const relayerPrivateKey = env.RELAYER_PRIVATE_KEY?.trim() || env.OPERATOR_PRIVATE_KEY?.trim();
  if (!relayerPrivateKey) throw new Error("Missing required configuration value: RELAYER_PRIVATE_KEY or OPERATOR_PRIVATE_KEY");
  const arcRpcUrl = value(env, "ARC_RPC_URL");
  const arcWssUrl = env.ARC_WSS_URL?.trim() || undefined;
  try {
    new URL(gatewayApiBaseUrl);
    new URL(arcRpcUrl);
    if (arcWssUrl) new URL(arcWssUrl);
  } catch {
    throw new Error("ARC_RPC_URL, ARC_WSS_URL, and GATEWAY_API_BASE_URL must be valid URLs");
  }
  if (arcWssUrl) console.warn("ARC_WSS_URL is configured but the relayer uses HTTP eth_getLogs polling for resilient event delivery");
  else console.warn("ARC_WSS_URL is not configured; using HTTP eth_getLogs polling for live events");

  return {
    contractAddress: deployment.CONTRACT_ADDRESS,
    contractAbi: new Interface(parsedAbi),
    eventTopics: {
      MilestoneReleased: deployment.EVENT_TOPIC_RELEASED,
      MilestoneArbitrated: deployment.EVENT_TOPIC_ARBITRATED,
      ArbitrationForced: deployment.EVENT_TOPIC_FORCED,
      FundsReclaimed: deployment.EVENT_TOPIC_RECLAIMED
    },
    gatewayWalletAddress: deployment.GATEWAY_WALLET_ADDRESS,
    gatewayMinterAddress: deployment.GATEWAY_MINTER_ADDRESS,
    deploymentBlock: deployment.DEPLOYMENT_BLOCK,
    arcRpcUrl,
    arcWssUrl,
    gatewayApiBaseUrl,
    relayerPrivateKey,
    relayerPort: port,
    sqlitePath: env.SQLITE_PATH?.trim() || "./relayer.db"
  };
}
