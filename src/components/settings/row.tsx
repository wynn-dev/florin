import type { ReactNode } from "react"
import { cn } from "@/lib/utils"
import { Field, FieldLabel, FieldTitle } from "@/components/ui/field"

/**
 * A settings row: the title at the left, its control at the right, a
 * separator under it. No description: a row that needs explaining has the
 * wrong title.
 */
export function SettingsRow({
  title,
  htmlFor,
  children,
  className,
}: {
  title: ReactNode
  /** The control's id, so the title is its label. */
  htmlFor?: string
  children: ReactNode
  className?: string
}) {
  return (
    <Field
      orientation="horizontal"
      className={cn(
        "min-h-14 justify-between gap-4 border-b py-3 last:border-b-0 sm:gap-6",
        className
      )}
    >
      {htmlFor ? (
        <FieldLabel
          htmlFor={htmlFor}
          className="shrink-0 font-medium whitespace-nowrap"
        >
          {title}
        </FieldLabel>
      ) : (
        <FieldTitle className="min-w-0 shrink-0 whitespace-nowrap">
          {title}
        </FieldTitle>
      )}
      <div className="flex min-w-0 items-center justify-end gap-2">
        {children}
      </div>
    </Field>
  )
}

/** A group of rows under a small heading ("Enable Banking", "MCP"). */
export function SettingsSection({
  id,
  title,
  action,
  children,
}: {
  id?: string
  title?: string
  /** A button at the heading's right, e.g. [New token]. */
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <section id={id} className="flex scroll-mt-20 flex-col">
      {title && (
        <div className="flex h-10 items-center justify-between gap-4 border-b">
          <h2 className="text-base font-semibold tracking-tight">{title}</h2>
          {action}
        </div>
      )}
      <div className="flex flex-col">{children}</div>
    </section>
  )
}

/** Muted text beside a control: a fixed value's reason, a disabled button's wait. */
export function Aside({ children }: { children: ReactNode }) {
  return (
    <span className="truncate text-sm text-muted-foreground">{children}</span>
  )
}
