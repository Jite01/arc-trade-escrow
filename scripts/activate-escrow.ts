import { FetchRequest, Contract, JsonRpcProvider, Wallet } from "ethers";
import { readFileSync } from "node:fs";

const config = JSON.parse(readFileSync("config.json", "utf8")) as {
  CONTRACT_ADDRESS: string;
  CONTRACT_ABI: unknown[];
};
const rpcRequest = new FetchRequest(process.env.ARC_RPC_URL!);
rpcRequest.timeout = 30_000;
const provider = new JsonRpcProvider(rpcRequest, { name: "arc-testnet", chainId: 5_042_002 }, { staticNetwork: true });
const buyer = new Wallet(process.env.BUYER_PRIVATE_KEY!, provider);
const seller = new Wallet(process.env.SELLER_PRIVATE_KEY!, provider);
const escrowAddress = config.CONTRACT_ADDRESS;
const usdcAddress = process.env.USDC_ADDRESS!;
const gatewayWalletAddress = "0x0077777d7EBA4688BDeF3E311b846F25870A19B9";
const totalUsdc = BigInt(process.env.TOTAL_USDC!);
const escrow = new Contract(escrowAddress, config.CONTRACT_ABI, provider);
const usdc = new Contract(usdcAddress, ["function approve(address,uint256) returns (bool)", "function balanceOf(address) view returns (uint256)"], provider);
const gatewayWallet = new Contract(gatewayWalletAddress, ["function totalBalance(address,address) view returns (uint256)"], provider);

async function send(label: string, transaction: Promise<{ hash: string; wait(): Promise<unknown> }>): Promise<string> {
  const tx = await transaction;
  console.log(`${label}_TX=${tx.hash}`);
  await tx.wait();
  console.log(`${label}_CONFIRMED=true`);
  return tx.hash;
}

async function main(): Promise<void> {
  console.log(`SELLER_USDC_BEFORE=${await usdc.balanceOf(await seller.getAddress())}`);
  await send("PROPOSE", escrow.connect(buyer).proposeMilestones([{
    description: "E2E Settlement Test",
    basisPoints: 10_000,
    sellerDeadline: 3_600,
    buyerResponseWindow: 3_600,
    disputeWindow: 30
  }]));
  await send("BUYER_APPROVE", escrow.connect(buyer).approve());
  await send("SELLER_APPROVE", escrow.connect(seller).approve());
  await send("USDC_APPROVE", usdc.connect(buyer).approve(escrowAddress, totalUsdc));
  await send("DEPOSIT", escrow.connect(buyer).depositUSDS());

  const state = await escrow.getState();
  const balances = await escrow.getBalances();
  const gatewayBalance = await gatewayWallet.totalBalance(usdcAddress, escrowAddress);
  console.log(`STATE=${state}`);
  console.log(`BALANCES=released:${balances[0]},remaining:${balances[1]},disputed:${balances[2]}`);
  console.log(`GATEWAY_TOTAL_BALANCE=${gatewayBalance}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
