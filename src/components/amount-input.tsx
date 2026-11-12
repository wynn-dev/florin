import { useState } from "react"
import { cn } from "@/lib/utils"
import { currencySymbol, formatAmountInput, parseAmount } from "@/lib/format"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"

export type Direction = "outflow" | "inflow"

/**
 * A transaction amount: an Outflow / Inflow toggle in front of a plain number
 * field, with the currency's symbol at the end. The person types an unsigned
 * number ("42.10", "1,200", "12,50"); onChange gets signed minor units
 * (outflow negative), or null while the field is empty or not a number, in
 * which case the field is marked invalid once it loses focus.
 */
export function AmountInput({
  value,
  onChange,
  currency,
  defaultDirection = "outflow",
  id,
  name,
  disabled,
  autoFocus,
  onBlur,
  invalid,
  className,
}: {
  /** Signed minor units; null for empty. */
  value: number | null
  onChange: (value: number | null) => void
  currency: string
  /** The toggle's side while the amount is empty or zero. */
  defaultDirection?: Direction
  id?: string
  name?: string
  disabled?: boolean
  autoFocus?: boolean
  onBlur?: () => void
  /** Marks the field invalid from outside, e.g. a form's own validation. */
  invalid?: boolean
  className?: string
}) {
  const [direction, setDirection] = useState<Direction>(
    value ? (value < 0 ? "outflow" : "inflow") : defaultDirection
  )
  const [text, setText] = useState(() =>
    value === null ? "" : formatAmountInput(value, currency)
  )
  const [touched, setTouched] = useState(false)

  // `shown` is the last value this field emitted or received. A different
  // value comes from outside (a form reset, another record): show it.
  const [shown, setShown] = useState(value)
  if (value !== shown) {
    setShown(value)
    setText(value === null ? "" : formatAmountInput(value, currency))
    if (value) setDirection(value < 0 ? "outflow" : "inflow")
  }

  const parsed = parseAmount(text, currency)
  const signed = (amount: number | null, side: Direction) =>
    amount === null ? null : side === "outflow" ? -amount : amount

  const emit = (next: number | null) => {
    setShown(next)
    onChange(next)
  }

  return (
    <InputGroup data-disabled={disabled} className={cn("h-9", className)}>
      <InputGroupAddon align="inline-start" className="py-0 pl-1">
        <ToggleGroup
          type="single"
          size="sm"
          spacing={0}
          value={direction}
          disabled={disabled}
          aria-label="Direction"
          onValueChange={(next) => {
            if (next !== "outflow" && next !== "inflow") return
            setDirection(next)
            emit(signed(parsed, next))
          }}
          className="rounded-md bg-muted p-0.5"
        >
          {(["outflow", "inflow"] as const).map((side) => (
            <ToggleGroupItem
              key={side}
              value={side}
              className="h-6 rounded-[5px]! px-2 text-xs text-muted-foreground hover:bg-transparent data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-xs data-[state=on]:hover:bg-background"
            >
              {side === "outflow" ? "Outflow" : "Inflow"}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </InputGroupAddon>
      <InputGroupInput
        id={id}
        name={name}
        inputMode="decimal"
        autoComplete="off"
        placeholder={formatAmountInput(0, currency)}
        disabled={disabled}
        autoFocus={autoFocus}
        value={text}
        aria-invalid={invalid || (touched && text !== "" && parsed === null)}
        onChange={(event) => {
          const next = event.target.value
          setText(next)
          emit(signed(parseAmount(next, currency), direction))
        }}
        onBlur={() => {
          setTouched(true)
          if (parsed !== null) setText(formatAmountInput(parsed, currency))
          onBlur?.()
        }}
        className="text-right tabular-nums"
      />
      <InputGroupAddon align="inline-end">
        <InputGroupText>{currencySymbol(currency)}</InputGroupText>
      </InputGroupAddon>
    </InputGroup>
  )
}
