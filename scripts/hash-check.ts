import { readFileSync } from "node:fs";
import { ethers } from "ethers";

const deployment = JSON.parse(readFileSync("config.json", "utf8")) as { CONTRACT_ADDRESS: string };
const recipient = process.env.BUYER_ADDRESS;
if (!recipient) throw new Error("BUYER_ADDRESS is required");

const escrow = ethers.getAddress(deployment.CONTRACT_ADDRESS);
const b32 = (address: string): string => ethers.zeroPadValue(ethers.getAddress(address), 32);
const message = {
  maxBlockHeight: "999999999",
  maxFee: "2010000",
  spec: {
    version: 1,
    sourceDomain: 26,
    destinationDomain: 26,
    sourceContract: b32("0x0077777d7EBA4688BDeF3E311b846F25870A19B9"),
    destinationContract: b32("0x0022222ABE238Cc2C7Bb1f21003F0a260052475B"),
    sourceToken: b32("0x3600000000000000000000000000000000000000"),
    destinationToken: b32("0x3600000000000000000000000000000000000000"),
    sourceDepositor: b32(escrow),
    destinationRecipient: b32(recipient),
    sourceSigner: b32(escrow),
    destinationCaller: ethers.ZeroHash,
    value: "1000000",
    salt: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    hookData: "0x"
  }
};

const domain = { name: "GatewayWallet", version: "1" };
const types = {
  BurnIntent: [
    { name: "maxBlockHeight", type: "uint256" },
    { name: "maxFee", type: "uint256" },
    { name: "spec", type: "TransferSpec" }
  ],
  TransferSpec: [
    { name: "version", type: "uint32" },
    { name: "sourceDomain", type: "uint32" },
    { name: "destinationDomain", type: "uint32" },
    { name: "sourceContract", type: "bytes32" },
    { name: "destinationContract", type: "bytes32" },
    { name: "sourceToken", type: "bytes32" },
    { name: "destinationToken", type: "bytes32" },
    { name: "sourceDepositor", type: "bytes32" },
    { name: "destinationRecipient", type: "bytes32" },
    { name: "sourceSigner", type: "bytes32" },
    { name: "destinationCaller", type: "bytes32" },
    { name: "value", type: "uint256" },
    { name: "salt", type: "bytes32" },
    { name: "hookData", type: "bytes" }
  ]
};

console.log(`TS_HASH=${ethers.TypedDataEncoder.hash(domain, types, message)}`);
