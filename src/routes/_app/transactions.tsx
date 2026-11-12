import { useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { queries } from "@/lib/api"
import { useCommand } from "@/lib/commands"
import { Page } from "@/components/page"
import { ImportCsvDialog } from "@/components/transactions/import-csv-dialog"
import { validateTransactionSearch } from "@/components/transactions/search"
import { TransactionSheet } from "@/components/transactions/transaction-sheet"
import { TransactionsTable } from "@/components/transactions/transactions-table"
import { Button } from "@/components/ui/button"

export const Route = createFileRoute("/_app/transactions")({
  validateSearch: validateTransactionSearch,
  // In the browser only: the API's fetches are relative to the page.
  loader: ({ context: { queryClient } }) =>
    typeof window !== "undefined" &&
    Promise.all([
      queryClient.ensureQueryData(queries.accounts()),
      queryClient.ensureQueryData(queries.settings()),
      queryClient.ensureQueryData(queries.categories()),
    ]),
  component: Transactions,
})

function Transactions() {
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const [adding, setAdding] = useState(false)
  const [importing, setImporting] = useState(false)
  // ⌘K › New transaction and Import CSV land here.
  useCommand("new-transaction", () => setAdding(true))
  useCommand("import-csv", () => setImporting(true))

  return (
    <Page
      title="Transactions"
      actions={
        <>
          <Button
            variant="outline"
            className="hidden md:inline-flex"
            onClick={() => setImporting(true)}
          >
            Import
          </Button>
          <Button
            className="hidden md:inline-flex"
            onClick={() => setAdding(true)}
          >
            New transaction
          </Button>
        </>
      }
    >
      <TransactionsTable
        search={search}
        onSearchChange={(next) =>
          void navigate({ search: next, replace: true })
        }
        onAdd={() => setAdding(true)}
        onImport={() => setImporting(true)}
      />
      <TransactionSheet
        open={adding}
        onOpenChange={setAdding}
        defaultAccountId={search.accountId}
      />
      <ImportCsvDialog
        open={importing}
        onOpenChange={setImporting}
        accountId={search.accountId}
      />
    </Page>
  )
}
