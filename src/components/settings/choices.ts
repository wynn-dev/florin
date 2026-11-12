// The currencies and locales Settings and first-run setup offer, and what to
// default to from the browser.

/** The budget currencies on offer: the euro and every currency the ECB publishes a rate for. */
// prettier-ignore
export const CURRENCIES = [
  "EUR", "USD", "GBP", "CHF", "SEK", "NOK", "DKK", "ISK", "PLN", "CZK", "HUF",
  "RON", "BGN", "TRY", "JPY", "CNY", "HKD", "SGD", "KRW", "INR", "IDR", "MYR",
  "PHP", "THB", "AUD", "NZD", "CAD", "MXN", "BRL", "ILS", "ZAR",
]

// prettier-ignore
export const LOCALES = [
  "en-GB", "en-US", "en-IE", "en-AU", "en-CA", "de-DE", "de-AT", "de-CH",
  "fr-FR", "fr-BE", "fr-CH", "nl-NL", "nl-BE", "es-ES", "it-IT", "pt-PT",
  "pt-BR", "sv-SE", "da-DK", "nb-NO", "fi-FI", "pl-PL", "cs-CZ", "hu-HU",
  "ro-RO", "el-GR", "ja-JP",
]

// prettier-ignore
const EURO = new Set(
  "AT BE CY DE EE ES FI FR GR HR IE IT LT LU LV MT NL PT SI SK".split(" ")
)
// prettier-ignore
const REGION_CURRENCY: Record<string, string> = {
  US: "USD", GB: "GBP", CH: "CHF", LI: "CHF", SE: "SEK", NO: "NOK", DK: "DKK",
  IS: "ISK", PL: "PLN", CZ: "CZK", HU: "HUF", RO: "RON", BG: "BGN", TR: "TRY",
  JP: "JPY", CN: "CNY", HK: "HKD", SG: "SGD", KR: "KRW", IN: "INR", ID: "IDR",
  MY: "MYR", PH: "PHP", TH: "THB", AU: "AUD", NZ: "NZD", CA: "CAD", MX: "MXN",
  BR: "BRL", IL: "ILS", ZA: "ZAR",
}

function region(tag: string): string | undefined {
  try {
    return new Intl.Locale(tag).maximize().region
  } catch {
    return undefined
  }
}

/** The browser's locale, made one florin can format with ("en-GB" if not). */
export function browserLocale(): string {
  const tag = typeof navigator === "undefined" ? "en-GB" : navigator.language
  try {
    const canonical = Intl.getCanonicalLocales(tag)[0]
    // A bare language ("de") gets its likely region ("de-DE").
    const r = region(canonical)
    const full = canonical.includes("-") || !r ? canonical : `${canonical}-${r}`
    return Intl.NumberFormat.supportedLocalesOf(full).length ? full : "en-GB"
  } catch {
    return "en-GB"
  }
}

/** The currency of the browser locale's country, if it's one florin offers. */
export function browserCurrency(): string {
  const r = region(browserLocale())
  if (r && EURO.has(r)) return "EUR"
  return (r && REGION_CURRENCY[r]) || "EUR"
}

/** "Euro", in the given locale. */
export function currencyName(code: string, locale: string): string {
  try {
    return (
      new Intl.DisplayNames([locale], { type: "currency" }).of(code) ?? code
    )
  } catch {
    return code
  }
}

/** "Deutsch (Deutschland)": a locale named in its own language. */
export function localeName(tag: string): string {
  try {
    const name = new Intl.DisplayNames([tag], { type: "language" }).of(tag)
    return name ? name.charAt(0).toLocaleUpperCase(tag) + name.slice(1) : tag
  } catch {
    return tag
  }
}

/** How a locale writes an amount and a date: "1.234,56 · 12. Nov.". */
export function localeSample(tag: string): string {
  const number = new Intl.NumberFormat(tag, {
    minimumFractionDigits: 2,
  }).format(1234.56)
  const date = new Intl.DateTimeFormat(tag, {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(2026, 10, 12)))
  return `${number} · ${date}`
}
