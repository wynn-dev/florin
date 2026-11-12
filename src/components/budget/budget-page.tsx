import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { MoreHorizontalIcon } from "lucide-react"
import { BudgetTable, NewGroupRow } from "./budget-table"
import { BudgetPhone } from "./budget-phone"
import { CategoryInspector, MonthSummary } from "./inspector"
import { MonthSwitcher } from "./month-switcher"
import {
  BudgetBody,
  GoalHeadline,
  NotPlannedYet,
  OverPlan,
  beforeFirstMonth,
} from "./month-parts"
import type { BudgetMonth } from "@/shared/types"
import { cn } from "@/lib/utils"
import { queries } from "@/lib/api"
import { formatMonth } from "@/lib/format"
import { useIsMobile } from "@/hooks/use-mobile"
import { useAfterClose } from "@/hooks/use-after-close"
import { Page } from "@/components/page"
import { QueryState, SkeletonRows } from "@/components/states"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Skeleton } from "@/components/ui/skeleton"

export function BudgetPage({ month }: { month: string }) {
  const currency = useQuery(queries.settings()).data?.currency
  const budget = useQuery(queries.budget(month))
  const mobile = useIsMobile()
  const [showHidden, setShowHidden] = useState(false)
  const [addingGroup, setAddingGroup] = useState(false)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [editingGoal, setEditingGoal] = useState(false)
  const after = useAfterClose()

  const menu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Budget options">
          <MoreHorizontalIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-52"
        onCloseAutoFocus={after.onCloseAutoFocus}
      >
        <DropdownMenuItem onSelect={after.later(() => setAddingGroup(true))}>
          Add group
        </DropdownMenuItem>
        {budget.data && !budget.data.goal && (
          <DropdownMenuItem onSelect={after.later(() => setEditingGoal(true))}>
            Set a monthly goal
          </DropdownMenuItem>
        )}
        <DropdownMenuCheckboxItem
          checked={showHidden}
          onCheckedChange={setShowHidden}
        >
          Show hidden categories
        </DropdownMenuCheckboxItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )

  const newGroup = addingGroup && (
    <NewGroupRow
      onDone={() => setAddingGroup(false)}
      hiddenUntil={
        budget.data && beforeFirstMonth(budget.data)
          ? budget.data.firstMonth
          : undefined
      }
    />
  )

  const loading = (
    <div className="flex flex-col gap-6">
      <Skeleton className="h-8 w-64" />
      <SkeletonRows rows={12} />
    </div>
  )

  return (
    <Page title="Budget" actions={menu}>
      <QueryState
        query={budget}
        skeleton={loading}
        error={`Couldn't load ${formatMonth(month)}'s budget.`}
      >
        {(data) =>
          !currency ? (
            loading
          ) : mobile ? (
            <BudgetPhone
              month={data}
              currency={currency}
              showHidden={showHidden}
              onAddGroup={() => setAddingGroup(true)}
              newGroup={newGroup}
              editingGoal={editingGoal}
              onEditingGoalChange={setEditingGoal}
            />
          ) : (
            <div className="grid grid-cols-12 gap-6">
              <div className="col-span-12 flex flex-col gap-4 xl:col-span-8">
                <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
                  <MonthSwitcher month={month} />
                  {!beforeFirstMonth(data) && !data.goal && (
                    <NotPlannedYet amount={data.toBudget} currency={currency} />
                  )}
                </div>
                <GoalHeadline
                  month={data}
                  currency={currency}
                  editing={editingGoal}
                  onEditingChange={setEditingGoal}
                />
                {!beforeFirstMonth(data) && (
                  <OverPlan
                    month={data}
                    currency={currency}
                    className="justify-end xl:hidden"
                  />
                )}
                <BudgetBody
                  month={data}
                  onAddGroup={() => setAddingGroup(true)}
                >
                  <BudgetTable
                    month={data}
                    currency={currency}
                    showHidden={showHidden}
                    selectedId={selectedId}
                    onSelect={setSelectedId}
                  />
                </BudgetBody>
                {newGroup}
              </div>
              <aside
                className={cn(
                  "sticky top-6 hidden self-start xl:col-span-4",
                  !beforeFirstMonth(data) && "xl:block"
                )}
              >
                <Inspector
                  month={data}
                  currency={currency}
                  selectedId={selectedId}
                />
              </aside>
            </div>
          )
        }
      </QueryState>
    </Page>
  )
}

function Inspector({
  month,
  currency,
  selectedId,
}: {
  month: BudgetMonth
  currency: string
  selectedId: number | null
}) {
  const category = month.groups
    .flatMap((g) => g.categories)
    .find((c) => c.id === selectedId)
  if (!category) return <MonthSummary month={month} currency={currency} />
  return (
    <CategoryInspector
      key={category.id}
      month={month}
      category={category}
      currency={currency}
    />
  )
}
