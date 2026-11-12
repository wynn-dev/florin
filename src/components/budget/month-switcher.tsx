import { useState } from "react"
import { Link } from "@tanstack/react-router"
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  addMonths,
  currentMonth,
  formatMonth,
  formatMonthShort,
} from "@/lib/format"
import { Button } from "@/components/ui/button"
import { ButtonGroup } from "@/components/ui/button-group"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

/** ‹ · "November 2026" (a month grid) · ›, plus "This month" when away from it. */
export function MonthSwitcher({
  month,
  className,
}: {
  month: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [year, setYear] = useState(Number(month.slice(0, 4)))
  const now = currentMonth()

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <ButtonGroup>
        <Button variant="outline" size="icon" asChild>
          <Link
            to="/budget/$month"
            params={{ month: addMonths(month, -1) }}
            aria-label="Previous month"
          >
            <ChevronLeftIcon />
          </Link>
        </Button>
        <Popover
          open={open}
          onOpenChange={(next) => {
            setOpen(next)
            if (next) setYear(Number(month.slice(0, 4)))
          }}
        >
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              className="min-w-36 justify-center font-medium tabular-nums"
            >
              {formatMonth(month)}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-64 gap-2 p-2">
            <div className="flex items-center justify-between">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Previous year"
                onClick={() => setYear(year - 1)}
              >
                <ChevronLeftIcon />
              </Button>
              <span className="text-sm font-medium tabular-nums">{year}</span>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Next year"
                onClick={() => setYear(year + 1)}
              >
                <ChevronRightIcon />
              </Button>
            </div>
            <div className="grid grid-cols-3 gap-1">
              {Array.from({ length: 12 }, (_, i) => {
                const m = `${year}-${String(i + 1).padStart(2, "0")}`
                return (
                  <Button
                    key={m}
                    variant={m === month ? "default" : "ghost"}
                    size="sm"
                    className={cn(
                      "h-8",
                      m === now &&
                        m !== month &&
                        "font-semibold underline underline-offset-4"
                    )}
                    asChild
                  >
                    <Link
                      to="/budget/$month"
                      params={{ month: m }}
                      onClick={() => setOpen(false)}
                    >
                      {formatMonthShort(m)}
                    </Link>
                  </Button>
                )
              })}
            </div>
          </PopoverContent>
        </Popover>
        <Button variant="outline" size="icon" asChild>
          <Link
            to="/budget/$month"
            params={{ month: addMonths(month, 1) }}
            aria-label="Next month"
          >
            <ChevronRightIcon />
          </Link>
        </Button>
      </ButtonGroup>
      {month !== now && (
        <Button variant="ghost" asChild>
          <Link to="/budget/$month" params={{ month: now }}>
            This month
          </Link>
        </Button>
      )}
    </div>
  )
}
