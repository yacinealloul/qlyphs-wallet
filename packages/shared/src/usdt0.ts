/**
 * EVM networks where USDT0 (Tether's cross-chain USDT, 6 decimals) can pay. Token addresses from
 * docs.usdt0.to/technical-documentation/deployments, each checked on-chain (chain id, symbol,
 * decimals). On Ethereum the token is native USDT, which the USDT0 adapter locks.
 */
export interface Usdt0Chain {
  chainId: number;
  name: string;
  /** The USDT0 (or USDT) ERC-20 contract. */
  contract: string;
  explorerUrl: string;
  nativeSymbol: string;
  /** Public endpoint a wallet can add the network with. Never used to watch payments. */
  publicRpcUrl: string;
  /** Blocks on top of a payment before it counts, about a minute or two on each network. */
  confirmations: number;
}

export const USDT0_CHAINS: readonly Usdt0Chain[] = [
  {
    chainId: 42161,
    name: 'Arbitrum One',
    contract: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
    explorerUrl: 'https://arbiscan.io',
    nativeSymbol: 'ETH',
    publicRpcUrl: 'https://arb1.arbitrum.io/rpc',
    confirmations: 12,
  },
  {
    chainId: 1,
    name: 'Ethereum',
    contract: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    explorerUrl: 'https://etherscan.io',
    nativeSymbol: 'ETH',
    publicRpcUrl: 'https://ethereum-rpc.publicnode.com',
    confirmations: 12,
  },
  {
    chainId: 10,
    name: 'Optimism',
    contract: '0x01bFF41798a0BcF287b996046Ca68b395DbC1071',
    explorerUrl: 'https://optimistic.etherscan.io',
    nativeSymbol: 'ETH',
    publicRpcUrl: 'https://mainnet.optimism.io',
    confirmations: 30,
  },
  {
    chainId: 137,
    name: 'Polygon',
    contract: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
    explorerUrl: 'https://polygonscan.com',
    nativeSymbol: 'POL',
    publicRpcUrl: 'https://polygon-rpc.com',
    confirmations: 64,
  },
  {
    chainId: 130,
    name: 'Unichain',
    contract: '0x9151434b16b9763660705744891fA906F660EcC5',
    explorerUrl: 'https://uniscan.xyz',
    nativeSymbol: 'ETH',
    publicRpcUrl: 'https://mainnet.unichain.org',
    confirmations: 60,
  },
  {
    chainId: 57073,
    name: 'Ink',
    contract: '0x0200C29006150606B650577BBE7B6248F58470c1',
    explorerUrl: 'https://explorer.inkonchain.com',
    nativeSymbol: 'ETH',
    publicRpcUrl: 'https://rpc-gel.inkonchain.com',
    confirmations: 60,
  },
  {
    chainId: 80094,
    name: 'Berachain',
    contract: '0x779Ded0c9e1022225f8E0630b35a9b54bE713736',
    explorerUrl: 'https://berascan.com',
    nativeSymbol: 'BERA',
    publicRpcUrl: 'https://rpc.berachain.com',
    confirmations: 20,
  },
  {
    chainId: 5000,
    name: 'Mantle',
    contract: '0x779Ded0c9e1022225f8E0630b35a9b54bE713736',
    explorerUrl: 'https://mantlescan.xyz',
    nativeSymbol: 'MNT',
    publicRpcUrl: 'https://rpc.mantle.xyz',
    confirmations: 30,
  },
  {
    chainId: 999,
    name: 'HyperEVM',
    contract: '0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb',
    explorerUrl: 'https://hyperevmscan.io',
    nativeSymbol: 'HYPE',
    publicRpcUrl: 'https://rpc.hyperliquid.xyz/evm',
    confirmations: 30,
  },
  {
    chainId: 9745,
    name: 'Plasma',
    contract: '0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb',
    explorerUrl: 'https://plasmascan.to',
    nativeSymbol: 'XPL',
    publicRpcUrl: 'https://rpc.plasma.to',
    confirmations: 30,
  },
];

export const usdt0Chain = (chainId: number): Usdt0Chain | undefined =>
  USDT0_CHAINS.find((c) => c.chainId === chainId);
