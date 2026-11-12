// API types for first-run setup (/api/setup), the password change
// (/api/password) and the export downloads (/api/export/*).

/**
 * What the first-run steps need to know: which of them still apply. Before a
 * password exists anyone may read it (it holds no budget data beyond the
 * currency); afterwards it needs a session.
 */
export type SetupStatus = {
  /** No password yet: step 1 sets it, with the setup code. */
  needsSetup: boolean
  currency: string
  /** Transactions exist, so the budget currency can't change. */
  currencyFixed: boolean
  /** Open accounts; step 2 applies while there are none. */
  accounts: number
  /**
   * The starter categories can still be replaced: nothing is budgeted and no
   * transaction uses a category outside the income group. Step 3 applies.
   */
  categoriesReplaceable: boolean
  /** MCP access tokens; step 4 applies while there are none. */
  mcpTokens: number
}

/** POST /api/setup/categories: the groups to start with; empty starts empty. */
export type StarterCategories = {
  groups: { name: string; categories: string[] }[]
}

/** POST /api/password */
export type PasswordChange = { current: string; next: string }
