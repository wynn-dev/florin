import { useState } from "react"
import { CheckIcon, CopyIcon } from "lucide-react"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group"

/** A read-only value with a copy button. */
export function CopyField({
  value,
  id,
  className,
}: {
  value: string
  id?: string
  className?: string
}) {
  const [copied, setCopied] = useState(false)
  return (
    <InputGroup className={className}>
      <InputGroupInput
        id={id}
        readOnly
        value={value}
        className="text-sm"
        onFocus={(e) => e.target.select()}
      />
      <InputGroupAddon align="inline-end">
        <InputGroupButton
          size="icon-xs"
          aria-label="Copy"
          onClick={() => {
            void navigator.clipboard.writeText(value).then(() => {
              setCopied(true)
              setTimeout(() => setCopied(false), 1500)
            })
          }}
        >
          {copied ? <CheckIcon /> : <CopyIcon />}
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  )
}
