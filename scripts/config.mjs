// Shared configuration and lookup tables for the pipeline.

export const API = "https://api.cdp.coinbase.com/platform/v2/x402/discovery/resources";
export const PAGE_SIZE = 100;
export const CONCURRENCY = 8;
export const RETRIES = 4;

export const RAW_DIR = ".cache";
export const RAW_FILE = ".cache/registry.jsonl";
export const OUT_DIR = "dist";
export const DATA_DIR = "dist/data";
export const HISTORY_FILE = "data/history/daily.ndjson";

/** CAIP-2 style network identifiers seen in the registry -> display names. */
export const NETWORKS = {
  "eip155:1": "Ethereum",
  "eip155:10": "Optimism",
  "eip155:56": "BNB Chain",
  "eip155:137": "Polygon",
  "eip155:143": "Monad",
  "eip155:196": "X Layer",
  "eip155:480": "World Chain",
  "eip155:999": "HyperEVM",
  "eip155:1329": "Sei",
  "eip155:4663": "Fraxtal",
  "eip155:8453": "Base",
  "eip155:42161": "Arbitrum",
  "eip155:42220": "Celo",
  "eip155:43114": "Avalanche",
  "eip155:84532": "Base Sepolia",
  "eip155:1440000": "XRPL EVM",
  "eip155:11155111": "Sepolia",
  base: "Base",
  "aws:base": "Base",
  solana: "Solana",
  "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp": "Solana",
  "algorand:wGHE2Pwdvd7S12BL5FaOP20EGYesN73k": "Algorand",
  "algorand:wGHE2Pwdvd7S12BL5FaOP20EGYesN73ktiC1qzkkit8=": "Algorand",
  "xrpl:0": "XRPL",
  "stellar:pubnet": "Stellar",
  "hyperliquid:mainnet": "Hyperliquid",
};

/**
 * Token decimals are usually absent from the `extra` block. USDC-family assets
 * are 6 decimals; these are the exceptions we have observed at 18.
 */
export const DECIMALS_18 = new Set([
  "World Liberty Financial USD",
  "Palmyr",
  "HERORUN",
  "TCX",
  "USDm",
]);

/** Verbose asset names -> ticker used in the UI. */
export const ASSET_TICKERS = {
  "USD Coin": "USDC",
  USDC: "USDC",
  "Tether USD": "USDT",
  "USD₮0": "USDT0",
  "World Liberty Financial USD": "USD1",
  "Global Dollar": "USDG",
  EURC: "EURC",
  "United Stables": "USDU",
  GatewayWalletBatched: "USDC (gateway)",
  "JPY Coin": "JPYC",
};

/**
 * Ordered classifiers. First match wins, so the more specific intents sit
 * above the generic ones. Anything unmatched lands in "Other" - that bucket is
 * deliberately visible rather than force-fitted.
 */
export const CATEGORIES = [
  ["Search & Scraping", /\b(search|scrap|crawl|firecrawl|exa |tavily|serp|web extract|browse)/],
  ["AI & Inference", /\b(llm|gpt|claude|gemini|inference|embedding|prompt|completion|rerank|transcri|whisper|ocr|image gen|text-to-)/],
  ["Onchain Data", /\b(rpc|eth_|onchain|on-chain|blockchain|block number|block height|wallet|erc20|erc-20|token safety|token balance|holder|mempool|gas price|smart contract|nft|solana|evm|0x[a-f0-9]{6})/],
  ["DeFi & Trading", /\b(defi|swap|liquidit|yield|lending|perp|dex|amm|pool|staking|bridge|arbitrage|liquidation|funding rate|tvl)/],
  ["Market Data", /\b(price|quote|ticker|ohlc|candle|market data|market cap|orderbook|volatilit|spot )/],
  ["Equities & Macro", /\b(stock|equit|earnings|sec filing|10-k|10-q|forex|\bfx\b|commodit|macro|treasury|bond|etf|option chain|\bcpi\b|federal reserve)/],
  ["News & Social", /\b(news|article|\brss\b|feed|sentiment|twitter|tweet|reddit|social|telegram|discord|youtube)/],
  ["Identity & Compliance", /\b(kyc|kyb|aml|sanction|compliance|identity|verif|due diligence|screening|\bvat\b|\btax\b|attestation|proof of)/],
  ["Media & Files", /\b(image|video|audio|speech|\btts\b|voice|\bpdf\b|render|screenshot|thumbnail|document)/],
  ["Geo & Weather", /\b(weather|forecast|geocod|maps|location|flight|travel|hotel|sports|elevation|timezone)/],
  ["Enrichment & CRM", /\b(enrich|people|company data|company lookup|lead|contact|email find|email verif|linkedin|domain)/],
  ["Storage & Memory", /\b(storage|upload|ipfs|database|vector|memory|cache|bucket)/],
  ["Dev & Utility", /\b(calculator|convert|uuid|random|hash|encode|format|validate|ping|health|echo|utility)/],
];

export const CATEGORY_NAMES = CATEGORIES.map(([name]) => name).concat("Other");

export function categorize(haystack) {
  for (let i = 0; i < CATEGORIES.length; i++) {
    if (CATEGORIES[i][1].test(haystack)) return i;
  }
  return CATEGORIES.length;
}

export function networkName(id) {
  return NETWORKS[id] || String(id || "?").replace(/^eip155:/, "chain ");
}

export function assetTicker(name) {
  return ASSET_TICKERS[name] || name || "?";
}

export function decimalsFor(accept) {
  const name = accept?.extra?.name || "";
  if (accept?.extra?.decimals != null) return Number(accept.extra.decimals);
  return DECIMALS_18.has(name) ? 18 : 6;
}
