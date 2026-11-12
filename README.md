# florin

A budgeting app you run yourself: one `florin` command serves a web dashboard,
a JSON API and an MCP server on one local port, over one SQLite file in
`~/.florin`. Envelope budgets per category with leftover carrying over,
accounts in any currency, transfers, CSV import and reports.

## Development

You need Node 24 and pnpm. florin runs on Node; pnpm is its only package manager.

```sh
pnpm install
pnpm build                                   # → .output/
export FLORIN_HOME=$(mktemp -d) FLORIN_PORT=4691
pnpm florin seed-demo                        # 18 months of sample data
pnpm florin start                            # http://127.0.0.1:4691
```

The first visit asks you to choose the dashboard password. Keep development
instances in a temporary `FLORIN_HOME` and off port 4680, the default.

For UI work, `pnpm dev` runs the same app with hot reload on port 4780, using
the data folder in `FLORIN_HOME`.

Checks: `pnpm lint`, `pnpm typecheck`, `pnpm test` (runs against a real database
in a temporary folder) and `pnpm build`. CI runs all four on every pull request.

### Layout

- `src/server/db/` – the Drizzle schema and database setup (node:sqlite).
  `pnpm db:generate` turns schema changes into a migration in `drizzle/`;
  migrations are bundled into the build and applied when florin opens the database.
- `src/server/data/` – the data layer: every read and write of the budget.
  The `/api` routes and the MCP both call it. Every write takes an actor
  (`person`, `mcp:<client>`, `bank-sync`, `import`, `demo`) and records a line
  in the change log.
- `src/shared/types.ts` – the API types, shared by the server and the web app.
- `src/routes/api/` – the REST API; `src/routes/mcp.ts` – the MCP endpoint.
- `src/routes/_app/` – dashboard pages; `src/components/ui/` – shadcn/ui components.
- `src/cli.ts` – the `florin` command.
- `test/` – tests (Vitest).

### Data

Money is stored as integer minor units (cents) in the currency of the account
it belongs to. The budget has one currency; only accounts in that currency can
be on budget. Accounts in other currencies are tracked and counted in net worth
using exchange rates against the euro, as the ECB publishes them.

### The build

`pnpm build` writes a self-contained `.output/`: `cli.mjs` (the `florin`
command), `server/` (the app server, dependencies included) and `public/` (the
dashboard's static files). Run it with `node .output/cli.mjs start`; it needs
nothing else installed.

## License

MIT
