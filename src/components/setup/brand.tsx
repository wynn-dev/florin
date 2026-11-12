/** florin's mark and name, as the sidebar shows them, for sign-in and setup. */
export function Brand() {
  return (
    <div className="flex items-center gap-2">
      <span
        aria-hidden
        className="flex size-6 items-center justify-center rounded-md bg-primary font-serif text-[15px] leading-none text-primary-foreground italic"
      >
        ƒ
      </span>
      <span className="text-lg font-semibold tracking-tight">florin</span>
    </div>
  )
}
