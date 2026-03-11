# Reefswap Frontend

React + Vite Reefswap UI wired to Reef EVM with `wagmi` + MetaMask.

## Features

- Connect/disconnect MetaMask
- Auto switch/add Reef chain (chain id `13939`)
- Swap using deployed `ReefswapV2Router02`
- Live quote with slippage setting
- ERC20 allowance + approve flow before swap
- Custom token import by contract address

## Contracts (default)

- WrappedREEF: `0x3C2BA92EAFAbA6A5aC21502D8C55d3A33950f7A6`
- Factory: `0xDAb89107eaF290312fd8e80463A6a9Ec3D428F4A`
- Router02: `0xa3Cab0B7288fA4CAe22CcD8B1a80c4bFaDe27664`

## Run

```bash
npm install
cp .env.example .env
npm run dev
```

Open [http://localhost:8080](http://localhost:8080).

## Notes

- Browser RPC transport defaults to `/api/reef-rpc` (proxied by Vite to `http://localhost:8545`).
- Wallet chain RPC defaults to `http://localhost:8545` (override with `VITE_REEF_CHAIN_RPC_URL`).
- Subgraph endpoint defaults to `http://localhost:8000/subgraphs/name/uniswap-v2-localhost` (override with `VITE_SUBGRAPH_URL`).
- For token-to-token swaps, route defaults to `tokenIn -> WREEF -> tokenOut`.
