import { Contract, type JsonRpcProvider } from "ethers";
import type { RelayerConfig } from "./config.js";
import type { ChainLog, EventSource, LogProvider } from "./types.js";

export class EthersLogProvider implements LogProvider {
  public constructor(private readonly provider: JsonRpcProvider) {}

  public getBlockNumber(): Promise<number> {
    return this.provider.getBlockNumber();
  }

  public getCode(address: string): Promise<string> {
    return this.provider.getCode(address);
  }

  public async getLogs(filter: { address: string; fromBlock: number; toBlock: number; topics: readonly (readonly string[])[] }): Promise<ChainLog[]> {
    const logs = await this.provider.getLogs({
      address: filter.address,
      fromBlock: filter.fromBlock,
      toBlock: filter.toBlock,
      topics: filter.topics as string[][]
    });
    return logs.map((log) => ({
      topics: log.topics,
      data: log.data,
      transactionHash: log.transactionHash,
      blockNumber: log.blockNumber,
      removed: log.removed
    }));
  }
}

export class EthersContractEventSource implements EventSource {
  private static readonly pollIntervalMs = 5_000;
  private static readonly maxRetryDelayMs = 60_000;
  private static readonly chunkSize = 500;
  private readonly contract: Contract;
  private readonly listeners = new Map<string, (log: ChainLog) => void>();
  private readonly deploymentBlock: number;
  private lastBlock: number;
  private timer: NodeJS.Timeout | undefined;
  private pollInFlight = false;
  private consecutiveFailures = 0;

  public constructor(provider: JsonRpcProvider, config: RelayerConfig) {
    this.contract = new Contract(config.contractAddress, config.contractAbi, provider);
    this.deploymentBlock = config.deploymentBlock;
    this.lastBlock = config.deploymentBlock - 1;
  }

  public subscribe(topic: string, listener: (log: ChainLog) => void): void {
    const event = this.contract.interface.fragments
      .filter((fragment): fragment is import("ethers").EventFragment => fragment.type === "event")
      .find((fragment) => fragment.topicHash.toLowerCase() === topic.toLowerCase());
    if (!event) throw new Error(`Contract ABI does not define event for topic ${topic}`);
    this.listeners.set(topic.toLowerCase(), listener);
    if (!this.timer) {
      this.schedulePoll(0);
    }
  }

  public unsubscribe(): void {
    this.listeners.clear();
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private schedulePoll(delayMs: number): void {
    if (this.listeners.size === 0 || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.runPoll();
    }, delayMs);
    this.timer.unref();
  }

  private async runPoll(): Promise<void> {
    if (this.pollInFlight || this.listeners.size === 0) return;
    this.pollInFlight = true;
    try {
      await this.poll();
      this.consecutiveFailures = 0;
      this.schedulePoll(EthersContractEventSource.pollIntervalMs);
    } catch (error: unknown) {
      this.consecutiveFailures += 1;
      const delayMs = Math.min(
        EthersContractEventSource.pollIntervalMs * 2 ** (this.consecutiveFailures - 1),
        EthersContractEventSource.maxRetryDelayMs
      );
      console.error("Relayer event polling failed; retrying with backoff", error);
      this.schedulePoll(delayMs);
    } finally {
      this.pollInFlight = false;
    }
  }

  private async poll(): Promise<void> {
    if (this.listeners.size === 0) return;
    const provider = this.contract.runner as JsonRpcProvider;
    const toBlock = await provider.getBlockNumber();
    const fromBlock = Math.max(this.lastBlock + 1, this.deploymentBlock);
    if (fromBlock > toBlock) return;
    const address = await this.contract.getAddress();
    const topics = [...this.listeners.keys()];
    for (let chunkFrom = fromBlock; chunkFrom <= toBlock; chunkFrom += EthersContractEventSource.chunkSize) {
      const chunkTo = Math.min(chunkFrom + EthersContractEventSource.chunkSize - 1, toBlock);
      const logs = await provider.getLogs({ address, fromBlock: chunkFrom, toBlock: chunkTo, topics: [topics] });
      for (const log of logs) {
        const topic = log.topics[0]?.toLowerCase();
        if (!topic) continue;
        this.listeners.get(topic)?.({ topics: log.topics, data: log.data, transactionHash: log.transactionHash, blockNumber: log.blockNumber, removed: log.removed });
      }
      this.lastBlock = chunkTo;
    }
  }
}
