// Overview stays current while it is open, so an agent's changes appear
// without a reload: every query on it refetches on window focus and every
// 30 seconds (also in a background tab it isn't; TanStack Query pauses then).
export const live = {
  refetchInterval: 30_000,
  refetchOnWindowFocus: true,
} as const
