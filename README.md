## Foundry

**Foundry is a blazing fast, portable and modular toolkit for Ethereum application development written in Rust.**

Foundry consists of:

- **Forge**: Ethereum testing framework (like Truffle, Hardhat and DappTools).
- **Cast**: Swiss army knife for interacting with EVM smart contracts, sending transactions and getting chain data.
- **Anvil**: Local Ethereum node, akin to Ganache, Hardhat Network.
- **Chisel**: Fast, utilitarian, and verbose solidity REPL.

## Documentation

https://book.getfoundry.sh/

## Relayer

The TypeScript relayer observes the four fund-authorization events from
`DocumentaryTradeEscrow`, constructs and authorizes each settlement's Gateway burn intent,
and stores its execution state in SQLite.

Install dependencies, then build and test it with:

```shell
npm run build
npm test
```

`config.json` is the generated deployment manifest. It contains the deployed
contract address, deployment block, ABI, event topics, and Gateway contract
addresses. Runtime secrets and environment-specific values remain in `.env`.
After every deployment, regenerate the manifest before starting the relayer.

```shell
set -a; source .env; set +a
forge script script/DeployDocumentaryTradeEscrow.s.sol:DeployDocumentaryTradeEscrow \
  --rpc-url "$ARC_RPC_URL" --private-key "$DEPLOYER_PRIVATE_KEY" --broadcast
./regenerate-config.sh
npm start
```

The relayer reads `CONTRACT_ADDRESS` and `DEPLOYMENT_BLOCK` directly from the
newly generated `config.json`; they must not be duplicated in `.env`.

The testnet Gateway API URL is the default. `OPERATOR_PRIVATE_KEY` is used as
the relayer signing key unless an explicit `RELAYER_PRIVATE_KEY` is provided.

The relayer serves `GET /status`, `GET /transfers`, and
`GET /settlements/:settlementKey` on `RELAYER_PORT`.

## Usage

### Build

```shell
$ forge build
```

### Test

```shell
$ forge test
```

### Format

```shell
$ forge fmt
```

### Gas Snapshots

```shell
$ forge snapshot
```

### Anvil

```shell
$ anvil
```

### Deploy

```shell
$ forge script script/Counter.s.sol:CounterScript --rpc-url <your_rpc_url> --private-key <your_private_key>
```

### Cast

```shell
$ cast <subcommand>
```

### Help

```shell
$ forge --help
$ anvil --help
$ cast --help
```
