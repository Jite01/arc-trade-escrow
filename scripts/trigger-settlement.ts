import { FetchRequest, Contract, JsonRpcProvider, Wallet, keccak256, toUtf8Bytes } from "ethers";
import { readFileSync } from "node:fs";

const config = JSON.parse(readFileSync("config.json", "utf8")) as { CONTRACT_ADDRESS: string; CONTRACT_ABI: unknown[] };
const request = new FetchRequest(process.env.ARC_RPC_URL!);
request.timeout = 30_000;
const provider = new JsonRpcProvider(request, { name: "arc-testnet", chainId: 5_042_002 }, { staticNetwork: true });
const seller = new Wallet(process.env.SELLER_PRIVATE_KEY!, provider);
const buyer = new Wallet(process.env.BUYER_PRIVATE_KEY!, provider);
const escrow = new Contract(config.CONTRACT_ADDRESS, config.CONTRACT_ABI, provider);

async function send(label: string, transaction: Promise<{ hash: string; wait(): Promise<{ blockNumber: number }> }>): Promise<void> {
  const tx = await transaction;
  const receipt = await tx.wait();
  console.log(`${label}_TX=${tx.hash}`);
  console.log(`${label}_BLOCK=${receipt.blockNumber}`);
}

async function main(): Promise<void> {
  await send("TRIGGER", escrow.connect(seller).triggerMilestone(0, keccak256(toUtf8Bytes("e2e-test"))));
  await send("CONFIRM", escrow.connect(buyer).confirmMilestone(0));
  console.log("WAITING_SECONDS=30");
  await new Promise((resolve) => setTimeout(resolve, 31_000));
  await send("RELEASE", escrow.connect(buyer).release(0));
  const status = await escrow.getMilestoneStatus(0);
  console.log(`MILESTONE_STATE=${status[0]}`);
  console.log(`MILESTONE_AMOUNT=${status[7]}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
