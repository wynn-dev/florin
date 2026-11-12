// Every MCP tool, in the order clients list them. To add a tool, write it
// with defineTool in a file in this folder and add it here.
import { deleteAccountTool, listAccountsTool, saveAccount } from "./accounts"
import {
  coverOverspendingTool,
  getBudgetMonthTool,
  moveMoney,
  setBudget,
  setMonthlyGoalTool,
} from "./budget"
import {
  deleteCategoryTool,
  listCategories,
  saveCategory,
  saveCategoryGroup,
} from "./categories"
import { listBankLinksTool, syncBanks } from "./banks"
import { ibkrPull, ibkrStatus } from "./ibkr"
import { overview } from "./overview"
import {
  deletePayeesTool,
  listPayeesTool,
  mergePayeesTool,
  renamePayeeTool,
  setPayeeCategoryTool,
} from "./payees"
import {
  applyRulesTool,
  deleteRulesTool,
  listRulesTool,
  saveRulesTool,
} from "./rules"
import {
  getActivity,
  getExchangeRates,
  getInvestments,
  getReport,
} from "./reports"
import {
  addTransactions,
  deleteTransactionsTool,
  importTransactionsTool,
  linkTransfersTool,
  searchTransactions,
  suggestTransfersTool,
  updateTransactions,
} from "./transactions"
import type { FlorinTool } from "../tool"

export const tools: FlorinTool[] = [
  overview,
  // Transactions
  searchTransactions,
  addTransactions,
  updateTransactions,
  deleteTransactionsTool,
  importTransactionsTool,
  suggestTransfersTool,
  linkTransfersTool,
  // Budget
  getBudgetMonthTool,
  setBudget,
  moveMoney,
  coverOverspendingTool,
  setMonthlyGoalTool,
  // Categories
  listCategories,
  saveCategory,
  saveCategoryGroup,
  deleteCategoryTool,
  // Accounts
  listAccountsTool,
  saveAccount,
  deleteAccountTool,
  // Bank sync
  listBankLinksTool,
  syncBanks,
  // Payees
  listPayeesTool,
  renamePayeeTool,
  setPayeeCategoryTool,
  mergePayeesTool,
  deletePayeesTool,
  // Rules
  listRulesTool,
  saveRulesTool,
  deleteRulesTool,
  applyRulesTool,
  // Reports, investments, rates, history
  getReport,
  getInvestments,
  getExchangeRates,
  getActivity,
  // Connections
  ibkrStatus,
  ibkrPull,
]
