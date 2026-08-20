import { Contract, FetchRequest, JsonRpcProvider, Wallet, getAddress } from "ethers";
import { readFileSync } from "node:fs";
import { buildBurnIntent, burnIntentHash } from "../relayer/src/onchain.ts";

const confirmation = "I_UNDERSTAND_DUPLICATE_TESTNET_PAYOUT_RISK";
if (process.env.RUN_LIVE_GATEWAY_DUPLICATE_TEST !== "true" || process.env.CONFIRM_DUPLICATE_TEST !== confirmation) {
  throw new Error(`Refusing live test. Set RUN_LIVE_GATEWAY_DUPLICATE_TEST=true and CONFIRM_DUPLICATE_TEST=${confirmation}`);
}

const config = JSON.parse(readFileSync("config.json", "utf8")) as { CONTRACT_ADDRESS: string; CONTRACT_ABI: unknown[]; GATEWAY_WALLET_ADDRESS: string; GATEWAY_MINTER_ADDRESS: string };
const rpcRequest = new FetchRequest(process.env.ARC_RPC_URL!);
rpcRequest.timeout = 30_000;
const provider = new JsonRpcProvider(rpcRequest, { name: "arc-testnet", chainId: 5_042_002 }, { staticNetwork: true });
const operator = new Wallet(process.env.OPERATOR_PRIVATE_KEY!, provider);
const escrowAddress = process.env.GATEWAY_COMPAT_ESCROW_ADDRESS || config.CONTRACT_ADDRESS;
const settlementIndex = BigInt(process.env.GATEWAY_COMPAT_SETTLEMENT_INDEX || "0");
const maxBlockHeight = BigInt(process.env.GATEWAY_COMPAT_MAX_BLOCK_HEIGHT || String((await provider.getBlockNumber()) + 100_000));
const maxFee = BigInt(process.env.GATEWAY_COMPAT_MAX_FEE || "3500");
const escrow = new Contract(escrowAddress, [
  "function operatorAddress() view returns (address)",
  "function settlementRecorded(uint256) view returns (bool)",
  "function settlementRecipient(uint256) view returns (address)",
  "function settlementAmount(uint256) view returns (uint256)",
  "function authorizeBurnIntent(uint256,uint256,uint256,bytes32) returns (bytes32)",
  "function authorizedTransfers(bytes32) view returns (bool)"
], operator);

async function authorize(salt: string): Promise<{ hash: string; request: any }> {
  const recipient = getAddress(String(await escrow.settlementRecipient(settlementIndex)));
  const amount = BigInt(await escrow.settlementAmount(settlementIndex));
  const request = buildBurnIntent({ settlementIndex, maxBlockHeight, maxFee, salt, recipient, amount, eventType: "MilestoneArbitrated", burnIntentRequest: undefined as never }, { contractAddress: escrowAddress, gatewayWalletAddress: config.GATEWAY_WALLET_ADDRESS, gatewayMinterAddress: config.GATEWAY_MINTER_ADDRESS });
  const hash = burnIntentHash(request);
  if (!(await escrow.authorizedTransfers(hash))) {
    const tx = await escrow.authorizeBurnIntent(settlementIndex, maxBlockHeight, maxFee, salt);
    await tx.wait();
    console.log(`AUTHORIZED_${salt.slice(2, 10)}=${tx.hash}`);
  } else {
    console.log(`ALREADY_AUTHORIZED_${salt.slice(2, 10)}=true`);
  }
  return { hash, request };
}

async function main(): Promise<void> {
  const expectedOperator = getAddress(String(await escrow.operatorAddress()));
  if (expectedOperator.toLowerCase() !== (await operator.getAddress()).toLowerCase()) throw new Error(`Operator key does not control escrow operator ${expectedOperator}`);
  if (!(await escrow.settlementRecorded(settlementIndex))) throw new Error(`Settlement ${settlementIndex} is not recorded on ${escrowAddress}`);
  const saltA = "0x" + "a1".repeat(32);
  const saltB = "0x" + "b2".repeat(32);
  const first = await authorize(saltA);
  const second = await authorize(saltB);
  console.log(`INTENT_A_HASH=${first.hash}`);
  console.log(`INTENT_B_HASH=${second.hash}`);
  const body = [
    { burnIntent: first.request, signature: "0x00", contractSigner: true },
    { burnIntent: second.request, signature: "0x00", contractSigner: true }
  ];
  const response = await fetch(`${(process.env.GATEWAY_API_BASE_URL || "https://gateway-api-testnet.circle.com").replace(/\/+$/, "")}/v1/transfer`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  console.log(`GATEWAY_HTTP_STATUS=${response.status}`);
  console.log(`GATEWAY_RESPONSE=${await response.text()}`);
}

main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
