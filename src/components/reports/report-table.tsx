import {
  createSortedRowModel,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_basic,
  tableFeatures,
  useTable,
} from "@tanstack/react-table"
import { ArrowDownIcon, ArrowUpIcon } from "lucide-react"
import { useMemo } from "react"
import type { ColumnDef, RowData } from "@tanstack/react-table"
import type { ReactNode } from "react"
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { cn } from "@/lib/utils"

/** One column of a report's table twin. */
export type ReportColumn<T> = {
  id: string
  header: string
  /** What the column sorts by: numbers numerically, text alphabetically. */
  value: (row: T) => number | string | null
  /** How a cell reads; defaults to the value. */
  cell?: (row: T) => ReactNode
  /** Numbers are right-aligned. Defaults to right unless the value is text. */
  align?: "left" | "right"
  /** The column's total over some rows, for group rows and the footer. */
  total?: (rows: T[]) => ReactNode
}

const features = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: { basic: sortFn_basic, alphanumeric: sortFn_alphanumeric },
})

/**
 * A report's numbers as a sortable table (click a header). Optionally in
 * sections (Cash, Credit, Investments), each sorted on its own with its
 * subtotal, and a total footer when any column has `total`.
 */
export function ReportTable<T extends RowData>({
  rows,
  columns,
  rowKey,
  defaultSort,
  sections,
  onRowClick,
  rowLabel,
}: {
  rows: T[]
  columns: ReportColumn<T>[]
  rowKey: (row: T) => string | number
  defaultSort: { id: string; desc: boolean }
  sections?: { label: string; rows: (row: T) => boolean }[]
  onRowClick?: (row: T) => void
  /** What a click on the row opens, for screen readers: "Transactions for Rent". */
  rowLabel?: (row: T) => string
}) {
  const defs = useMemo<ColumnDef<typeof features, T>[]>(
    () =>
      columns.map((c) => ({
        id: c.id,
        accessorFn: (row: T) => c.value(row),
        sortFn: textColumn(c, rows) ? "alphanumeric" : "basic",
        sortUndefined: "last",
        sortDescFirst: !textColumn(c, rows),
      })),
    [columns, rows]
  )
  const table = useTable({
    features,
    columns: defs,
    data: rows,
    getRowId: (row) => String(rowKey(row)),
    initialState: { sorting: [defaultSort] },
  })
  const sorted = table.getRowModel().rows.map((r) => r.original)
  const hasTotals = columns.some((c) => c.total)
  const groups = sections
    ? sections
        .map((s) => ({ label: s.label, rows: sorted.filter(s.rows) }))
        .filter((s) => s.rows.length)
    : [{ label: null, rows: sorted }]

  return (
    <Table className="text-sm">
      <TableHeader className="sticky top-0 bg-background">
        <TableRow className="hover:bg-transparent">
          {table.getHeaderGroups()[0].headers.map((header, i) => {
            const column = columns[i]
            const sort = header.column.getIsSorted()
            const right = alignOf(column, rows) === "right"
            return (
              <TableHead
                key={header.id}
                aria-sort={
                  sort === "asc"
                    ? "ascending"
                    : sort === "desc"
                      ? "descending"
                      : undefined
                }
                className={cn(
                  "h-9 px-0 text-xs font-medium text-muted-foreground",
                  right && "text-right"
                )}
              >
                <button
                  type="button"
                  onClick={header.column.getToggleSortingHandler()}
                  className={cn(
                    "inline-flex h-full items-center gap-1 px-2 hover:text-foreground",
                    right && "flex-row-reverse",
                    sort && "text-foreground"
                  )}
                >
                  {column.header}
                  {sort === "asc" && <ArrowUpIcon className="size-3" />}
                  {sort === "desc" && <ArrowDownIcon className="size-3" />}
                  {!sort && <span className="size-3" />}
                </button>
              </TableHead>
            )
          })}
        </TableRow>
      </TableHeader>
      <TableBody>
        {groups.map((group) => (
          <Section
            key={group.label ?? ""}
            label={group.label}
            rows={group.rows}
            all={rows}
            columns={columns}
            rowKey={rowKey}
            onRowClick={onRowClick}
            rowLabel={rowLabel}
            subtotal={groups.length > 1 && hasTotals}
          />
        ))}
      </TableBody>
      {hasTotals && (
        <TableFooter className="bg-transparent">
          <TableRow className="font-medium hover:bg-transparent">
            {columns.map((c, i) => (
              <TableCell
                key={c.id}
                className={cn(
                  "h-10 px-2 tabular-nums",
                  alignOf(c, rows) === "right" && "text-right"
                )}
              >
                {i === 0 ? "Total" : c.total?.(rows)}
              </TableCell>
            ))}
          </TableRow>
        </TableFooter>
      )}
    </Table>
  )
}

function Section<T>({
  label,
  rows,
  all,
  columns,
  rowKey,
  onRowClick,
  rowLabel,
  subtotal,
}: {
  label: string | null
  rows: T[]
  all: T[]
  columns: ReportColumn<T>[]
  rowKey: (row: T) => string | number
  onRowClick?: (row: T) => void
  rowLabel?: (row: T) => string
  subtotal: boolean
}) {
  return (
    <>
      {label && (
        <TableRow className="hover:bg-transparent">
          {columns.map((c, i) => (
            <TableCell
              key={c.id}
              className={cn(
                "h-10 px-2 pt-4 text-xs font-medium text-muted-foreground tabular-nums",
                alignOf(c, all) === "right" && "text-right"
              )}
            >
              {i === 0 ? label : subtotal && c.total?.(rows)}
            </TableCell>
          ))}
        </TableRow>
      )}
      {rows.map((row) => (
        <TableRow
          key={rowKey(row)}
          className={cn(onRowClick && "cursor-pointer")}
          onClick={onRowClick && (() => onRowClick(row))}
        >
          {columns.map((c, i) => (
            <TableCell
              key={c.id}
              className={cn(
                "h-10 max-w-64 truncate px-2 tabular-nums",
                alignOf(c, all) === "right" && "text-right"
              )}
            >
              {i === 0 && onRowClick ? (
                <button
                  type="button"
                  aria-label={rowLabel?.(row)}
                  className="truncate text-left outline-none focus-visible:underline"
                  onClick={(event) => {
                    event.stopPropagation()
                    onRowClick(row)
                  }}
                >
                  {c.cell ? c.cell(row) : c.value(row)}
                </button>
              ) : c.cell ? (
                c.cell(row)
              ) : (
                c.value(row)
              )}
            </TableCell>
          ))}
        </TableRow>
      ))}
    </>
  )
}

function textColumn<T>(column: ReportColumn<T>, rows: T[]): boolean {
  return rows.length > 0 && typeof column.value(rows[0]) === "string"
}

function alignOf<T>(column: ReportColumn<T>, rows: T[]): "left" | "right" {
  return column.align ?? (textColumn(column, rows) ? "left" : "right")
}
