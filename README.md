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
`DocumentaryTradeEscrow`, submits each unique `transferHash` to Circle Gateway,
and stores its execution state in SQLite.

Install dependencies, then build and test it with:

```shell
npm run build
npm test
```

Before starting the relayer, export all required values. The deployed contract
address and ABI come from `config.json`; the ABI must be an inline JSON string.

```shell
export CONTRACT_ADDRESS="$(node -p 'require("./config.json").CONTRACT_ADDRESS')"
export CONTRACT_ABI="$(node -p 'JSON.stringify(require("./config.json").CONTRACT_ABI)')"
export EVENT_TOPIC_RELEASED=0x01e6246915d66de2caea3bbd13ffffc284df65ae1e23447038a5c10c8620ae02
export EVENT_TOPIC_ARBITRATED=0x2cfb62f2ccf2662597e88ab94b3b449efaa015bcc4a56360bc6b491243cd609f
export EVENT_TOPIC_FORCED=0x3ea63eaf11115c96245e0e1842e47d845525526ee21ffecd29f161c8bec75e4b
export EVENT_TOPIC_RECLAIMED=0xa1a853f26b4fee51f54ad60e0ebc3ccfbe6a00dd71b8b3636396ab3723b2532b7f
export GATEWAY_WALLET_ADDRESS=0x0077777d7EBA4688BDeF3E311b846F25870A19B9
export DEPLOYMENT_BLOCK=55838430
export ARC_RPC_URL="..."
export GATEWAY_API_BASE_URL="..."
export GATEWAY_API_KEY="..."
export RELAYER_PORT=3001
export SQLITE_PATH=./relayer.db
npm start
```

The relayer serves `GET /status`, `GET /transfers`, and
`GET /transfers/:transferHash` on `RELAYER_PORT`.

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
