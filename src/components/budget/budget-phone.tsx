import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { ChevronDownIcon } from "lucide-react"
import { BudgetBody, ReadyToAssign } from "./month-parts"
import { AssignedCell, AvailablePillText, Figure, SpentLink } from "./cells"
import { LastChange, SpendingHistory } from "./inspector"
import { MonthSwitcher } from "./month-switcher"
import { MoveMoney } from "./move-money"
import { budgetQueries } from "./queries"
import type { BudgetCategory, BudgetMonth } from "@/shared/types"
import { cn } from "@/lib/utils"
import { formatMoney } from "@/lib/format"
import { Button } from "@/components/ui/button"
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer"

/**
 * The budget on a phone: Ready to assign sticky on top, the month switcher,
 * then each group as a collapsible list of name … available. Tapping a row
 * opens a drawer with Assigned, the three numbers, Last change and Move money.
 */
export function BudgetPhone({
  month,
  currency,
  showHidden,
}: {
  month: BudgetMonth
  currency: string
  showHidden: boolean
}) {
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set())
  const [openId, setOpenId] = useState<number | null>(null)
  const open = month.groups
    .flatMap((g) => g.categories)
    .find((c) => c.id === openId)

  return (
    <div className="flex flex-col gap-4">
      <div className="sticky top-0 z-10 -mx-4 -mt-4 bg-background/95 px-4 py-3 backdrop-blur supports-backdrop-filter:bg-background/80">
        <ReadyToAssign amount={month.toBudget} currency={currency} />
      </div>
      <MonthSwitcher month={month.month} />
      <BudgetBody month={month} onAddGroup={() => undefined}>
        <div className="flex flex-col">
          {month.groups.map((group) => {
            const isOpen = !collapsed.has(group.id)
            return (
              <section key={group.id} className="flex flex-col">
                <button
                  type="button"
                  aria-expanded={isOpen}
                  onClick={() => {
                    const next = new Set(collapsed)
                    if (isOpen) next.add(group.id)
                    else next.delete(group.id)
                    setCollapsed(next)
                  }}
                  className="flex h-11 items-center gap-1.5 border-b text-sm font-semibold"
                >
                  <ChevronDownIcon
                    className={cn(
                      "size-4 text-muted-foreground transition-transform",
                      !isOpen && "-rotate-90"
                    )}
                  />
                  <span className="truncate">{group.name}</span>
                  <span
                    className={cn(
                      "ml-auto tabular-nums",
                      group.available < 0 && "text-negative"
                    )}
                  >
                    {formatMoney(group.available, currency)}
                  </span>
                </button>
                {isOpen &&
                  group.categories
                    .filter((c) => showHidden || !c.hidden)
                    .map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => setOpenId(c.id)}
                        className={cn(
                          "flex h-13 items-center gap-3 border-b pl-5.5 text-left text-sm active:bg-muted",
                          c.hidden && "text-muted-foreground"
                        )}
                      >
                        <span className="min-w-0 flex-1 truncate">
                          {c.name}
                        </span>
                        <AvailablePillText
                          available={c.available}
                          currency={currency}
                        />
                      </button>
                    ))}
              </section>
            )
          })}
        </div>
      </BudgetBody>
      <Drawer
        open={!!open}
        onOpenChange={(next) => {
          if (!next) setOpenId(null)
        }}
      >
        <DrawerContent>
          {open && (
            <CategoryDrawer
              month={month}
              category={open}
              currency={currency}
              onDone={() => setOpenId(null)}
            />
          )}
        </DrawerContent>
      </Drawer>
    </div>
  )
}

function CategoryDrawer({
  month,
  category,
  currency,
  onDone,
}: {
  month: BudgetMonth
  category: BudgetCategory
  currency: string
  onDone: () => void
}) {
  const detail = useQuery(budgetQueries.category(month.month, category.id))
  const [moving, setMoving] = useState(false)
  return (
    <div className="flex max-h-[80dvh] flex-col overflow-y-auto pb-[max(1rem,env(safe-area-inset-bottom))]">
      <DrawerHeader className="gap-1 text-left!">
        <DrawerTitle className="text-left">{category.name}</DrawerTitle>
        <LastChange
          detail={detail.data}
          month={month.month}
          category={category.name}
        />
      </DrawerHeader>
      {moving ? (
        <MoveMoney
          month={month}
          category={category}
          currency={currency}
          onDone={onDone}
        />
      ) : (
        <div className="flex flex-col gap-4 px-4">
          <dl className="flex flex-col">
            <Figure label="Assigned">
              <AssignedCell
                month={month.month}
                category={category}
                currency={currency}
                symbol
                className="-mr-2 h-9 w-32"
              />
            </Figure>
            <Figure label="Spent">
              <SpentLink
                month={month.month}
                category={category}
                currency={currency}
                symbol
              />
            </Figure>
            <Figure label="Available">
              <AvailablePillText
                available={category.available}
                currency={currency}
                className="-mr-2"
              />
            </Figure>
          </dl>
          <SpendingHistory
            detail={detail.data}
            month={month.month}
            currency={currency}
          />
          <Button variant="outline" size="lg" onClick={() => setMoving(true)}>
            {category.available < 0 ? "Cover overspending" : "Move money"}
          </Button>
        </div>
      )}
    </div>
  )
}
