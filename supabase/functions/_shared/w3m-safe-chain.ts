// W3M Protocol V1 is fixed to BNB Smart Chain Mainnet.
export const W3M_BSC_MAINNET_CHAIN_ID = 56;

export function isW3MBscMainnetChain(chainId: number): boolean {
  return Number.isSafeInteger(chainId) && chainId === W3M_BSC_MAINNET_CHAIN_ID;
}
