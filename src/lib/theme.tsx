import { useEffect, useState } from "react"

export type Theme = "light" | "dark" | "system"

const KEY = "florin-theme"

/** Runs before first paint (inlined in <head>) so the page never flashes the wrong theme. */
export const themeScript = `(function(){try{var t=localStorage.getItem("${KEY}")||"system";var d=t==="dark"||(t==="system"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d)}catch(e){}})()`

function apply(theme: Theme) {
  const dark =
    theme === "dark" ||
    (theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches)
  document.documentElement.classList.toggle("dark", dark)
}

/** Tells every useTheme on the page (sidebar menu, settings) about a change. */
const CHANGE = "florin-theme-change"

export function useTheme(): [Theme, (theme: Theme) => void] {
  const [theme, setTheme] = useState<Theme>("system")
  useEffect(() => {
    const read = () =>
      setTheme((localStorage.getItem(KEY) as Theme | null) ?? "system")
    read()
    window.addEventListener(CHANGE, read)
    return () => window.removeEventListener(CHANGE, read)
  }, [])
  useEffect(() => {
    if (theme !== "system") return
    const media = matchMedia("(prefers-color-scheme: dark)")
    const onChange = () => apply("system")
    media.addEventListener("change", onChange)
    return () => media.removeEventListener("change", onChange)
  }, [theme])
  return [
    theme,
    (next) => {
      localStorage.setItem(KEY, next)
      setTheme(next)
      apply(next)
      window.dispatchEvent(new Event(CHANGE))
    },
  ]
}
