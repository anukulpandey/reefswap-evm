# CODEX Memory (Reefswap FE)

Do not revert the following unless the user explicitly asks:

1. Pool header transactions button text must remain `Transactions` (not dynamic `N tx`).
2. Clicking the pool header transactions button must open a transactions overlay/modal for the selected pool.
3. Transactions modal should mirror reef-app/react-lib behavior:
   - Tab filters: `All`, `Trade`, `Stake`, `Unstake`.
   - Data source: subgraph pool events (swaps/mints/burns) for the active pool.
   - Show the complete fetched transaction list for the pool in the modal.
4. Preserve current REEF/WREEF UX rules already requested by user in this project.
5. `Your Positions` on Pools page must show real user LP positions (not hardcoded empty state) by reading LP balances from pair contracts.

When changing related files, keep these behaviors stable by default.
