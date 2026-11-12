// Small helpers for the /api server routes.
import { InvalidInput, NotFound } from "./data/validate"

/** Runs a handler, answering its result as JSON and data-layer errors as 400/404. */
export async function respond(fn: () => unknown): Promise<Response> {
  try {
    const result = await fn()
    if (result instanceof Response) return result
    if (result === undefined) return new Response(null, { status: 204 })
    return Response.json(result)
  } catch (error) {
    if (error instanceof InvalidInput)
      return Response.json({ error: error.message }, { status: 400 })
    if (error instanceof NotFound)
      return Response.json({ error: error.message }, { status: 404 })
    if (error instanceof SyntaxError)
      return Response.json(
        { error: "the body is not valid JSON" },
        { status: 400 }
      )
    console.error(error)
    return Response.json({ error: "internal error" }, { status: 500 })
  }
}

export async function body<T>(request: Request): Promise<T> {
  const value = (await request.json()) as unknown
  if (!value || typeof value !== "object")
    throw new InvalidInput("the body must be a JSON object")
  return value as T
}

/** A numeric id from a path parameter. */
export function id(value: string): number {
  const n = Number(value)
  if (!Number.isSafeInteger(n) || n <= 0) throw new NotFound("not found")
  return n
}

/** Query parameters as a plain object, numbers and booleans parsed. */
export function query(request: Request): Record<string, string | undefined> {
  return Object.fromEntries(new URL(request.url).searchParams)
}

export function optionalInt(value: string | undefined): number | undefined {
  if (value === undefined || value === "") return undefined
  const n = Number(value)
  if (!Number.isSafeInteger(n))
    throw new InvalidInput(`${value} is not a whole number`)
  return n
}
