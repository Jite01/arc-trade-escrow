#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

DEPLOY_JSON="broadcast/DeployDocumentaryTradeEscrow.s.sol/5042002/run-latest.json"

if [[ ! -f "$DEPLOY_JSON" ]]; then
  echo "ERROR: deployment file not found: $DEPLOY_JSON"
  exit 1
fi

python3 - <<'PY'
import json
import subprocess
import sys

deploy_json = "broadcast/DeployDocumentaryTradeEscrow.s.sol/5042002/run-latest.json"

with open(deploy_json) as f:
    data = json.load(f)

# Find the actual contract deployment transaction.
contract_tx = next(
    tx for tx in data["transactions"]
    if tx.get("contractName") == "DocumentaryTradeEscrow"
)

contract_address = contract_tx["contractAddress"]

# Foundry may encode blockNumber as hex in run-latest.json.
receipt = next(
    r for r in data["receipts"]
    if r.get("transactionHash") == contract_tx["hash"]
)

block_raw = receipt["blockNumber"]
deployment_block = int(block_raw, 16) if isinstance(block_raw, str) and block_raw.startswith("0x") else int(block_raw)

# --json guarantees machine-readable Foundry output.
abi_raw = subprocess.check_output(
    ["forge", "inspect", "DocumentaryTradeEscrow", "abi", "--json"],
    text=True
).strip()

abi = json.loads(abi_raw)

def topic(signature):
    return subprocess.check_output(
        ["cast", "keccak", signature],
        text=True
    ).strip()

config = {
    "CONTRACT_ADDRESS": contract_address,

    "CONTRACT_ABI": abi,

    "EVENT_TOPIC_RELEASED":
        topic("MilestoneReleased(uint256,address,uint256)"),

    "EVENT_TOPIC_ARBITRATED":
        topic("MilestoneArbitrated(uint256,address,uint256)"),

    "EVENT_TOPIC_FORCED":
        topic("ArbitrationForced(uint256,address,uint256)"),

    "EVENT_TOPIC_RECLAIMED":
        topic("FundsReclaimed(address,uint256)"),

    "GATEWAY_WALLET_ADDRESS":
        "0x0077777d7EBA4688BDeF3E311b846F25870A19B9",

    "GATEWAY_MINTER_ADDRESS":
        "0x0022222ABE238Cc2C7Bb1f21003F0a260052475B",

    "DEPLOYMENT_BLOCK":
        deployment_block
}

with open("config.json", "w") as f:
    json.dump(config, f, indent=2)
    f.write("\n")

print()
print("config.json regenerated successfully")
print("------------------------------------")
print("CONTRACT_ADDRESS =", contract_address)
print("DEPLOYMENT_BLOCK =", deployment_block)
print("ABI entries      =", len(abi))
print()
PY
