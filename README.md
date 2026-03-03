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

- WrappedREEF: `0x1C2415Fd6Bc4dD007D28f050eD892C449734c238`
- Factory: `0x3a7984F200a950aEB56C74840b261e60d50A81E4`
- Router02: `0xc3F98fd71ec21f5D699a2b406317aFebfc90A0F5`

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
- For token-to-token swaps, route defaults to `tokenIn -> WREEF -> tokenOut`.
