import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import {
  keepPreviousData,
  useInfiniteQuery,
  useQuery,
} from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { useWindowVirtualizer } from "@tanstack/react-virtual"
import { MoreHorizontalIcon, PlusIcon, XIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { queries } from "@/lib/api"
import { formatDate, formatDayHeading, formatMoney } from "@/lib/format"
import { useIsMobile } from "@/hooks/use-mobile"
import { CategoryList } from "@/components/category-picker"
import { Money } from "@/components/money"
import { EmptyState, SectionError } from "@/components/states"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { TransactionFilters } from "./filters"
import { ImportCsvDialog } from "./import-csv-dialog"
import { CategoryCell, TruncatedText, payeeText, transferText } from "./parts"
import {
  transactionQueries,
  useDeleteTransactions,
  useUpdateTransactions,
} from "./queries"
import { hasFilters, toFilter } from "./search"
import { TransactionSheet } from "./transaction-sheet"
import type { Account, Transaction, TransactionPage } from "@/shared/types"
import type { TransactionSearch } from "./search"

type Props = {
  /** One account's register: no Account filter or column, a running Balance column. */
  accountId?: number
  /** The filters, when the page keeps them (in its URL); otherwise the table keeps its own. */
  search?: TransactionSearch
  onSearchChange?: (next: TransactionSearch) => void
  /** Opens the page's own New transaction sheet; otherwise the table opens one. */
  onAdd?: () => void
  /** Opens the page's own CSV import; otherwise the table opens one. */
  onImport?: () => void
  /** False for an account whose balance isn't the sum of its rows (an investment's). */
  runningBalance?: boolean
}

/**
 * Every transaction, or one account's: the filter row, the virtualised
 * table (a list grouped by day on a phone), inline categorising, the bulk
 * bar and the transaction sheet.
 */
export function TransactionsTable({
  accountId,
  search: controlled,
  onSearchChange,
  onAdd,
  onImport,
  runningBalance = true,
}: Props) {
  const [local, setLocal] = useState<TransactionSearch>({})
  const search = controlled ?? local
  const setSearch = onSearchChange ?? setLocal
  const isMobile = useIsMobile()
  const filter = toFilter(search, accountId)
  const scopedTo = accountId ?? search.accountId

  const list = useInfiniteQuery({
    ...transactionQueries.list(filter),
    placeholderData: keepPreviousData,
    // In the Uncategorised view rows stay put until the person leaves it.
    refetchOnWindowFocus: !search.uncategorized,
  })
  const accountList = useQuery(queries.accounts()).data
  const accounts = useMemo(
    () => new Map((accountList ?? []).map((a) => [a.id, a])),
    [accountList]
  )
  const budgetCurrency = useQuery(queries.settings()).data?.currency

  const [editing, setEditing] = useState<Transaction | null>(null)
  const [adding, setAdding] = useState(false)
  const [importing, setImporting] = useState(false)
  const add = onAdd ?? (() => setAdding(true))
  const importCsv = onImport ?? (() => setImporting(true))

  const rows = useMemo(
    () => list.data?.pages.flatMap((p) => p.items) ?? [],
    [list.data]
  )
  const last = list.data?.pages.at(-1)

  const [selected, setSelected] = useState<Set<number>>(() => new Set())
  const filterKey = JSON.stringify(filter)
  const [selectionKey, setSelectionKey] = useState(filterKey)
  if (filterKey !== selectionKey) {
    setSelectionKey(filterKey)
    setSelected(new Set())
  }

  const update = useUpdateTransactions()
  const categorise = (ids: number[], categoryId: number) => {
    const groups = queryCategories()
    update.mutate({
      ids,
      patch: { categoryId },
      keep: !!search.uncategorized,
      preview: (t) => ({
        ...t,
        categoryId,
        categoryName: groups.get(categoryId) ?? t.categoryName,
      }),
    })
  }
  const categoryNames = useQuery(queries.categories()).data
  const queryCategories = () =>
    new Map(
      (categoryNames ?? []).flatMap((g) =>
        g.categories.map((c) => [c.id, c.name] as const)
      )
    )
  const remove = useDeleteTransactions()

  // One currency in the column: its code goes in the header and cells drop the symbol.
  const currencies = new Set(
    scopedTo !== undefined
      ? [accounts.get(scopedTo)?.currency]
      : (accountList ?? []).map((a) => a.currency)
  )
  const columnCurrency = currencies.size === 1 ? [...currencies][0] : undefined

  let body
  if (list.data === undefined) {
    body = list.isError ? (
      <SectionError
        message="Couldn't load transactions."
        onRetry={() => void list.refetch()}
        retrying={list.isFetching}
      />
    ) : (
      <TableSkeleton />
    )
  } else if (rows.length === 0) {
    body = hasFilters(search, accountId !== undefined) ? (
      <EmptyState title="Nothing matches these filters">
        <Button
          variant="outline"
          onClick={() =>
            setSearch(
              accountId === undefined ? {} : { accountId: search.accountId }
            )
          }
        >
          Clear filters
        </Button>
      </EmptyState>
    ) : (
      <EmptyState title="No transactions yet">
        <Button onClick={add}>Add one</Button>
        <Button variant="outline" onClick={importCsv}>
          Import CSV
        </Button>
        {accountId === undefined && (
          <Button variant="outline" asChild>
            <Link to="/accounts">Connect a bank</Link>
          </Button>
        )}
      </EmptyState>
    )
  } else if (isMobile) {
    body = (
      <PhoneList
        rows={rows}
        accounts={accounts}
        budgetCurrency={budgetCurrency}
        hasMore={list.hasNextPage}
        loadMore={() => {
          if (!list.isFetching) void list.fetchNextPage()
        }}
        onOpen={setEditing}
      />
    )
  } else {
    body = (
      <DesktopTable
        rows={rows}
        accounts={accounts}
        showAccount={scopedTo === undefined}
        showBalance={scopedTo !== undefined && runningBalance}
        columnCurrency={columnCurrency}
        budgetCurrency={budgetCurrency}
        dimCategorised={!!search.uncategorized}
        selected={selected}
        onSelect={setSelected}
        onCategorise={(t, id) => categorise([t.id], id)}
        onOpen={setEditing}
        onDelete={(t) => remove.mutate([t])}
        nearEnd={() => {
          if (list.hasNextPage && !list.isFetching) void list.fetchNextPage()
        }}
      />
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <TransactionFilters
        search={search}
        onChange={setSearch}
        accountId={accountId}
      />
      <div className="flex flex-col">
        {body}
        {last && rows.length > 0 && (
          <Footer
            page={last}
            fetching={list.isFetching}
            className={cn(isMobile && "static")}
          />
        )}
      </div>
      {selected.size > 0 && !isMobile && (
        <BulkBar
          count={selected.size}
          onCategorise={(id) => {
            categorise([...selected], id)
            setSelected(new Set())
          }}
          onDelete={() => {
            remove.mutate(rows.filter((t) => selected.has(t.id)))
            setSelected(new Set())
          }}
          onClear={() => setSelected(new Set())}
        />
      )}
      {isMobile && (
        <Button
          size="icon-lg"
          aria-label="New transaction"
          onClick={add}
          className="fixed right-4 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-30 size-12 rounded-full shadow-lg"
        >
          <PlusIcon className="size-5" />
        </Button>
      )}
      <TransactionSheet
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
        transaction={editing}
      />
      {!onAdd && (
        <TransactionSheet
          open={adding}
          onOpenChange={setAdding}
          defaultAccountId={scopedTo}
        />
      )}
      {!onImport && (
        <ImportCsvDialog
          open={importing}
          onOpenChange={setImporting}
          accountId={scopedTo}
        />
      )}
    </div>
  )
}

function TableSkeleton() {
  return (
    <div aria-hidden className="flex flex-col">
      <div className="h-9 border-b" />
      {Array.from({ length: 12 }, (_, i) => (
        <div key={i} className="flex h-10 items-center gap-6 border-b px-2">
          <Skeleton className="h-3.5 w-12" />
          <Skeleton
            className="h-3.5"
            style={{ width: `${18 + ((i * 7) % 14)}%` }}
          />
          <Skeleton className="hidden h-3.5 w-24 md:block" />
          <Skeleton className="ml-auto h-3.5 w-16" />
        </div>
      ))}
    </div>
  )
}

/** "1,284 transactions · −€3,410.22" for everything the filters match. */
function Footer({
  page,
  fetching,
  className,
}: {
  page: TransactionPage
  fetching: boolean
  className?: string
}) {
  return (
    <div
      className={cn(
        "sticky bottom-0 z-10 flex h-10 items-center gap-2 border-t bg-background px-2 text-sm text-muted-foreground tabular-nums",
        className
      )}
    >
      <span>
        {page.total.toLocaleString()}{" "}
        {page.total === 1 ? "transaction" : "transactions"}
      </span>
      {page.sums.map((s) => (
        <span key={s.currency}>
          · {formatMoney(s.amount, s.currency, { signed: true })}
        </span>
      ))}
      {fetching && <Spinner className="ml-auto size-3.5" />}
    </div>
  )
}

const ROW = 40

function DesktopTable({
  rows,
  accounts,
  showAccount,
  showBalance,
  columnCurrency,
  budgetCurrency,
  dimCategorised,
  selected,
  onSelect,
  onCategorise,
  onOpen,
  onDelete,
  nearEnd,
}: {
  rows: Transaction[]
  accounts: Map<number, Account>
  showAccount: boolean
  showBalance: boolean
  /** Set when every row is in one currency. */
  columnCurrency: string | undefined
  budgetCurrency: string | undefined
  dimCategorised: boolean
  selected: Set<number>
  onSelect: (next: Set<number>) => void
  onCategorise: (t: Transaction, categoryId: number) => void
  onOpen: (t: Transaction) => void
  onDelete: (t: Transaction) => void
  nearEnd: () => void
}) {
  const ref = useRef<HTMLTableElement>(null)
  const [offset, setOffset] = useState(0)
  useLayoutEffect(() => {
    const measure = () =>
      setOffset(
        (ref.current?.getBoundingClientRect().top ?? 0) + window.scrollY
      )
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(document.body)
    return () => observer.disconnect()
  }, [])

  const virtualizer = useWindowVirtualizer({
    count: rows.length,
    estimateSize: () => ROW,
    overscan: 16,
    scrollMargin: offset,
  })
  const items = virtualizer.getVirtualItems()
  const lastIndex = items.at(-1)?.index ?? 0
  useEffect(() => {
    if (lastIndex >= rows.length - 40) nearEnd()
  }, [lastIndex, rows.length, nearEnd])

  useEffect(() => {
    if (!selected.size) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onSelect(new Set())
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [selected, onSelect])

  const selecting = selected.size > 0
  const allSelected = selecting && rows.every((t) => selected.has(t.id))
  const toggle = (id: number) => {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    onSelect(next)
  }
  const symbolFor = (t: Transaction) => {
    const currency = accounts.get(t.accountId)?.currency ?? budgetCurrency
    return !columnCurrency && currency !== budgetCurrency
  }
  const before = items[0] ? items[0].start - offset : 0
  const after = items.length
    ? virtualizer.getTotalSize() - (items.at(-1)!.end - offset)
    : 0

  return (
    <table ref={ref} className="w-full table-fixed text-sm">
      <colgroup>
        <col className="w-9" />
        <col className="w-24" />
        {showAccount && <col className="w-40" />}
        <col />
        <col className="w-48" />
        <col />
        <col className="w-32" />
        {showBalance && <col className="w-32" />}
        <col className="w-10" />
      </colgroup>
      <thead className="sticky top-0 z-10 bg-background">
        <tr className="h-9 text-left text-xs font-medium text-muted-foreground [&>th]:px-2 [&>th]:font-medium [&>th]:shadow-[inset_0_-1px_0_var(--border)]">
          <th className="pl-2!">
            <Checkbox
              aria-label="Select all"
              checked={allSelected ? true : selecting ? "indeterminate" : false}
              onCheckedChange={(on) =>
                onSelect(on ? new Set(rows.map((t) => t.id)) : new Set())
              }
              className={cn(
                "transition-opacity",
                !selecting &&
                  "opacity-0 hover:opacity-100 focus-visible:opacity-100"
              )}
            />
          </th>
          <th>Date</th>
          {showAccount && <th>Account</th>}
          <th>Payee</th>
          <th>Category</th>
          <th>Memo</th>
          <th className="text-right">
            Amount{columnCurrency && ` · ${columnCurrency}`}
          </th>
          {showBalance && <th className="text-right">Balance</th>}
          <th />
        </tr>
      </thead>
      <tbody>
        {before > 0 && <tr style={{ height: before }} />}
        {items.map((item) => {
          const t = rows[item.index]
          const isSelected = selected.has(t.id)
          const pending = t.status === "pending"
          const currency = accounts.get(t.accountId)?.currency ?? "EUR"
          return (
            <tr
              key={t.id}
              data-selected={isSelected}
              onClick={(e) => {
                if (
                  (e.target as HTMLElement).closest(
                    "button,a,input,[role=checkbox],[role=menuitem]"
                  )
                )
                  return
                if (selecting) toggle(t.id)
                else onOpen(t)
              }}
              className={cn(
                "group h-10 cursor-default border-b transition-colors hover:bg-muted/50 data-[selected=true]:bg-muted [&>td]:px-2",
                dimCategorised && t.categoryId !== null && "opacity-50"
              )}
            >
              <td className="pl-2!">
                <Checkbox
                  aria-label="Select"
                  checked={isSelected}
                  onCheckedChange={() => toggle(t.id)}
                  className={cn(
                    "transition-opacity",
                    !selecting &&
                      "opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                  )}
                />
              </td>
              <td className="whitespace-nowrap text-muted-foreground tabular-nums">
                {pending ? "Pending" : formatDate(t.date)}
              </td>
              {showAccount && (
                <td>
                  <TruncatedText>{t.accountName}</TruncatedText>
                </td>
              )}
              <td>
                <TruncatedText
                  className={cn(
                    t.transferId && !t.categoryId && "text-muted-foreground"
                  )}
                >
                  {payeeText(t)}
                </TruncatedText>
              </td>
              <td>
                <CategoryCell
                  t={t}
                  accounts={accounts}
                  onPick={(id) => onCategorise(t, id)}
                />
              </td>
              <td>
                <TruncatedText className="text-muted-foreground">
                  {t.notes}
                </TruncatedText>
              </td>
              <td className="text-right">
                <Money
                  cents={t.amount}
                  currency={currency}
                  signed
                  symbol={symbolFor(t)}
                  className={cn(pending && "text-muted-foreground")}
                />
              </td>
              {showBalance && (
                <td className="text-right">
                  {t.balance !== undefined && (
                    <Money
                      cents={t.balance}
                      currency={currency}
                      symbol={false}
                      className="text-muted-foreground"
                    />
                  )}
                </td>
              )}
              <td className="pr-1!">
                <RowMenu
                  onEdit={() => onOpen(t)}
                  onDelete={() => onDelete(t)}
                />
              </td>
            </tr>
          )
        })}
        {after > 0 && <tr style={{ height: after }} />}
      </tbody>
    </table>
  )
}

function RowMenu({
  onEdit,
  onDelete,
}: {
  onEdit: () => void
  onDelete: () => void
}) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="More"
          className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 aria-expanded:opacity-100"
        >
          <MoreHorizontalIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuItem onSelect={onEdit}>Edit details</DropdownMenuItem>
        <DropdownMenuItem variant="destructive" onSelect={onDelete}>
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** "12 selected · Categorise · Delete · ✕", floating at the bottom centre. */
function BulkBar({
  count,
  onCategorise,
  onDelete,
  onClear,
}: {
  count: number
  onCategorise: (categoryId: number) => void
  onDelete: () => void
  onClear: () => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <div
      role="toolbar"
      aria-label="Selected transactions"
      className="fixed bottom-14 left-1/2 z-40 flex h-11 -translate-x-1/2 animate-in items-center gap-1 rounded-xl border bg-popover p-1 pl-3 text-sm text-popover-foreground shadow-lg fade-in-0 slide-in-from-bottom-2"
    >
      <span className="pr-2 tabular-nums">{count} selected</span>
      <Separator orientation="vertical" className="my-2" />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="ghost">Categorise</Button>
        </PopoverTrigger>
        <PopoverContent side="top" align="center" className="w-64 p-0">
          <CategoryList
            value={null}
            onSelect={(choice) => {
              if (choice.type !== "category") return
              setOpen(false)
              onCategorise(choice.id)
            }}
          />
        </PopoverContent>
      </Popover>
      <Button variant="ghost" onClick={onDelete}>
        Delete
      </Button>
      <Separator orientation="vertical" className="my-2" />
      <Button
        variant="ghost"
        size="icon"
        aria-label="Clear selection"
        onClick={onClear}
      >
        <XIcon />
      </Button>
    </div>
  )
}

/** The phone list: days under sticky headings, payee over category, amount at the right. */
function PhoneList({
  rows,
  accounts,
  budgetCurrency,
  hasMore,
  loadMore,
  onOpen,
}: {
  rows: Transaction[]
  accounts: Map<number, Account>
  budgetCurrency: string | undefined
  hasMore: boolean
  loadMore: () => void
  onOpen: (t: Transaction) => void
}) {
  const sentinel = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = sentinel.current
    if (!el || !hasMore) return
    const observer = new IntersectionObserver(
      ([entry]) => entry.isIntersecting && loadMore(),
      { rootMargin: "800px" }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [hasMore, loadMore])

  const days: { date: string; rows: Transaction[] }[] = []
  for (const t of rows) {
    if (days.at(-1)?.date !== t.date) days.push({ date: t.date, rows: [] })
    days.at(-1)!.rows.push(t)
  }

  return (
    <div className="-mx-4 flex flex-col">
      {days.map((day) => (
        <section key={day.date}>
          <h3 className="sticky top-0 z-10 bg-background/95 px-4 py-1.5 text-xs font-medium text-muted-foreground backdrop-blur">
            {formatDayHeading(day.date)}
          </h3>
          {day.rows.map((t) => {
            const currency = accounts.get(t.accountId)?.currency ?? "EUR"
            const pending = t.status === "pending"
            const second = [
              t.transferId && t.categoryId
                ? t.categoryName
                : (transferText(t) ??
                  t.categoryName ??
                  (accounts.get(t.accountId)?.onBudget ? "Uncategorised" : "")),
              pending && "Pending",
            ]
              .filter(Boolean)
              .join(" · ")
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => onOpen(t)}
                className="flex min-h-13 w-full items-center gap-3 px-4 py-2 text-left active:bg-muted"
              >
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm">{payeeText(t)}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {second}
                  </span>
                </span>
                <Money
                  cents={t.amount}
                  currency={currency}
                  signed
                  symbol={currency !== budgetCurrency}
                  className={cn("text-sm", pending && "text-muted-foreground")}
                />
              </button>
            )
          })}
        </section>
      ))}
      <div ref={sentinel} />
    </div>
  )
}
