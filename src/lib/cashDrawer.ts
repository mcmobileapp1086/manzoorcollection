export interface CashDrawerLedgerRow {
  id: string;
  date: number;
  flowType: 'OPENING' | 'CASH_SALE' | 'CASH_RETURN' | 'OWNER_CASH_IN' | 'CASH_HANDOVER' | 'CASH_EXPENSE';
  label: string;
  urduLabel: string;
  voucherNo: string;
  description: string;
  inflow: number;
  outflow: number;
}

export interface CashDrawerSummary {
  openingGalla: number;
  inStoreCashSales: number;
  inStoreCashReturns: number;
  netCashSales: number;
  ownerCashIn: number;
  cashHandoversToOwner: number;
  shopCashExpenses: number;
  netDrawerCash: number;
  rows: CashDrawerLedgerRow[];
}

export function getRecordTime(v: any): number {
  if (!v) return 0;
  if (typeof v.date === 'number' && !isNaN(v.date)) return v.date;
  if (typeof v.date === 'string') {
    const num = Number(v.date);
    if (!isNaN(num) && num > 1000000000) return num;
    const parsed = new Date(v.date).getTime();
    if (!isNaN(parsed)) return parsed;
  }
  if (v.date?.toDate && typeof v.date.toDate === 'function') return v.date.toDate().getTime();
  if (v.date?.toMillis && typeof v.date.toMillis === 'function') return v.date.toMillis();
  if (typeof v.date?.seconds === 'number') return v.date.seconds * 1000;

  if (v.createdAt?.toDate && typeof v.createdAt.toDate === 'function') return v.createdAt.toDate().getTime();
  if (v.createdAt?.toMillis && typeof v.createdAt.toMillis === 'function') return v.createdAt.toMillis();
  if (typeof v.createdAt?.seconds === 'number') return v.createdAt.seconds * 1000;
  if (typeof v.createdAt === 'string') {
    const num = Number(v.createdAt);
    if (!isNaN(num) && num > 1000000000) return num;
    const parsed = new Date(v.createdAt).getTime();
    if (!isNaN(parsed)) return parsed;
  }
  if (typeof v.createdAt === 'number' && !isNaN(v.createdAt)) return v.createdAt;
  return 0;
}

const BANK_OR_ONLINE_KEYWORDS = ['meezan', 'ubl', 'jazzcash', 'easypaisa', 'online', 'bank'];

function hasBankKeyword(text: string): boolean {
  const lower = (text || '').toLowerCase();
  return BANK_OR_ONLINE_KEYWORDS.some(k => lower.includes(k));
}

export interface OpeningGallaResolution {
  openingGalla: number;
  isAuto: boolean;
  isManual: boolean;
  isActive: boolean;
  anchorDate: string | null;
  previousDateStr: string | null;
  previousActualGalla: number | null;
  hasEarlierAnchor: boolean;
}

const DATE_STR_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export function toLocalDateStr(ts: number): string {
  if (!ts || isNaN(ts)) return '';
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '';
  const yy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

export function addDaysToDateStr(dateStr: string, days: number): string {
  if (!DATE_STR_REGEX.test(dateStr)) return dateStr;
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d + days, 12, 0, 0, 0);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

export function calculateCashDrawer(params: {
  sales: any[];
  ledgerEntries: any[];
  ownerTransactions: any[];
  openingGalla: number;
  openingGallaDescription?: string;
  branchId?: string | null;
  fallbackBranchId?: string;
  isWithinDate: (ts: number) => boolean;
}): CashDrawerSummary {
  const {
    sales,
    ledgerEntries,
    ownerTransactions,
    openingGalla,
    openingGallaDescription,
    branchId,
    fallbackBranchId = 'main',
    isWithinDate,
  } = params;

  const matchesBranch = (itemBranch?: string) => {
    if (!branchId) return true;
    return (itemBranch || fallbackBranchId) === branchId;
  };

  let inStoreCashSales = 0;
  let inStoreCashReturns = 0;
  let ownerCashIn = 0;
  let cashHandoversToOwner = 0;
  let shopCashExpenses = 0;
  const rows: CashDrawerLedgerRow[] = [];

  if (openingGalla !== 0) {
    rows.push({
      id: 'opening-galla',
      date: 0,
      flowType: 'OPENING',
      label: 'Opening Galla (+)',
      urduLabel: 'ابتدائی گلہ',
      voucherNo: 'OPENING',
      description: openingGallaDescription || 'Daily Opening Galla Balance',
      inflow: openingGalla > 0 ? openingGalla : 0,
      outflow: openingGalla < 0 ? Math.abs(openingGalla) : 0,
    });
  }

  // 1. In-Store Cash Sales & Cash Returns (from sales)
  sales.forEach(s => {
    if (!matchesBranch(s.branchId)) return;
    const ts = getRecordTime(s);
    if (!isWithinDate(ts)) return;
    if (s.saleType === 'Online') return;

    const pm = (s.paymentMethod || s.advancePaymentMethod || '').toLowerCase();
    const pa = (s.paymentAccount || s.advancePaymentAccount || '').toLowerCase();
    const isReturn = s.transactionType === 'Return';
    const invNo = s.invoiceNo ? `#${s.invoiceNo}` : (s.id ? s.id.substring(0, 6).toUpperCase() : '-');

    let cashAmt = 0;
    let treatAsReturn = isReturn;

    const isNonCash =
      pm !== 'split' &&
      (pm.includes('online') ||
        pm.includes('owner') ||
        hasBankKeyword(pm) ||
        hasBankKeyword(pa) ||
        pa.includes('owner'));

    const billTotal = Number(s.total) || 0;

    if (pm === 'split') {
      const sc = Math.max(0, Number(s.splitCashAmount) || 0);
      const so = Math.max(0, Number(s.splitOnlineAmount) || 0);
      if (!isReturn && billTotal > 0 && sc + so > billTotal) {
        cashAmt = Math.max(0, Math.min(sc, billTotal - so));
      } else {
        cashAmt = sc;
      }
    } else if (!isNonCash) {
      if (isReturn) {
        const rawRec = s.received !== undefined && s.received !== null ? Number(s.received) : billTotal;
        cashAmt = Math.abs(rawRec);
      } else if (billTotal < 0) {
        // Exchange bill where return items exceeded new items: net cash refunded out of drawer
        treatAsReturn = true;
        cashAmt = Math.abs(billTotal);
      } else {
        const rawRec = s.received !== undefined && s.received !== null ? Number(s.received) : billTotal;
        cashAmt = billTotal > 0 ? Math.min(Math.max(0, rawRec), billTotal) : Math.max(0, rawRec);
      }
    }

    if (cashAmt <= 0) return;

    if (treatAsReturn) {
      inStoreCashReturns += cashAmt;
      rows.push({
        id: `sale-${s.id}`,
        date: ts,
        flowType: 'CASH_RETURN',
        label: 'Cash Sale Return (-)',
        urduLabel: 'واپسی نقد کیش',
        voucherNo: invNo,
        description: `In-Store ${isReturn ? 'Return' : 'Exchange Refund'} - ${s.customerName || 'Walk-in'}${pm === 'split' ? ' (Split Cash)' : ''}`,
        inflow: 0,
        outflow: cashAmt,
      });
    } else {
      inStoreCashSales += cashAmt;
      rows.push({
        id: `sale-${s.id}`,
        date: ts,
        flowType: 'CASH_SALE',
        label: 'In-Store Cash Sale (+)',
        urduLabel: 'نقد کاؤنٹر سیل',
        voucherNo: invNo,
        description: `In-Store Sale - ${s.customerName || 'Walk-in'}${pm === 'split' ? ' (Split Cash)' : ''}`,
        inflow: cashAmt,
        outflow: 0,
      });
    }
  });

  // 2. Cash Handovers & Owner Cash IN (from ownerTransactions first)
  const seenOwnerTxIds = new Set<string>();
  ownerTransactions.forEach(t => {
    if (!matchesBranch(t.branchId)) return;
    const ts = getRecordTime(t);
    if (!isWithinDate(ts)) return;

    if (t.id) seenOwnerTxIds.add(t.id);

    const cat = (t.category || '').toLowerCase();
    const acc = (t.accountHead || t.paymentMode || '').toLowerCase();

    // Skip sale-linked records (sales collection is handled directly from `sales`, and bank transfers never touched drawer)
    if (t.saleInvoiceId || t.saleInvoiceNo || cat === 'sale payment' || cat === 'online received') {
      return;
    }

    // Skip bank/online digital transfers
    if (hasBankKeyword(acc)) {
      return;
    }

    const amt = Math.abs(Number(t.amount) || 0);
    if (amt <= 0) return;

    if (t.type === 'OUT') {
      cashHandoversToOwner += amt;
      rows.push({
        id: `owner-tx-${t.id}`,
        date: ts,
        flowType: 'CASH_HANDOVER',
        label: 'Cash Handover (-)',
        urduLabel: 'مالک کو نقد دیا',
        voucherNo: t.voucherNo || `OWN-${String(t.id || '').substring(0, 6).toUpperCase()}`,
        description: t.description || `Cash handover to ${t.ownerName || 'Owner'}`,
        inflow: 0,
        outflow: amt,
      });
    } else if (t.type === 'IN') {
      ownerCashIn += amt;
      rows.push({
        id: `owner-tx-${t.id}`,
        date: ts,
        flowType: 'OWNER_CASH_IN',
        label: 'Owner Cash In (+)',
        urduLabel: 'مالک سے کیش وصول',
        voucherNo: t.voucherNo || `OWN-${String(t.id || '').substring(0, 6).toUpperCase()}`,
        description: t.description || `Cash received from ${t.ownerName || 'Owner'}`,
        inflow: amt,
        outflow: 0,
      });
    }
  });

  // 3. Shop Cash Expenses & fallback unlinked Ledger Owner Cash entries
  ledgerEntries.forEach(l => {
    if (!matchesBranch(l.branchId)) return;
    const ts = getRecordTime(l);
    if (!isWithinDate(ts)) return;

    const cat = (l.category || '').toLowerCase();
    const acc = (l.accountName || l.paymentMode || '').toLowerCase();
    const ref = (l.reference || '').toLowerCase();
    const desc = (l.description || '').toLowerCase();
    const amt = Math.abs(Number(l.amount) || 0);
    if (amt <= 0) return;

    // 3A. Shop Cash Expenses (-)
    if ((cat === 'expense' || cat === 'general expense' || cat.includes('expense')) && l.type === 'OUT') {
      // Exclude expenses paid directly by a vendor or via bank/online wallet
      if (desc.startsWith('paid via ') || hasBankKeyword(acc) || hasBankKeyword(ref)) {
        return;
      }
      shopCashExpenses += amt;
      rows.push({
        id: `ledger-${l.id}`,
        date: ts,
        flowType: 'CASH_EXPENSE',
        label: 'Cash Expense (-)',
        urduLabel: 'دکان نقد خرچہ',
        voucherNo: l.reference || 'EXPENSE',
        description: l.description || 'Shop Cash Expense',
        inflow: 0,
        outflow: amt,
      });
      return;
    }

    // 3B. Fallback manual ledger Owner Withdrawal / Capital (only if NOT mirrored from ownerTransactions and NOT sale Owner Transfer)
    if (l.ownerTxId && seenOwnerTxIds.has(l.ownerTxId)) return;
    if (l.saleId || cat === 'owner transfer') return;

    if ((cat === 'owner withdrawal' || cat === 'cash handover') && l.type === 'OUT') {
      if (hasBankKeyword(acc) || hasBankKeyword(ref) || hasBankKeyword(desc)) return;
      cashHandoversToOwner += amt;
      rows.push({
        id: `ledger-${l.id}`,
        date: ts,
        flowType: 'CASH_HANDOVER',
        label: 'Cash Handover (-)',
        urduLabel: 'مالک کو نقد دیا',
        voucherNo: l.reference || 'HANDOVER',
        description: l.description || 'Cash Handover to Owner',
        inflow: 0,
        outflow: amt,
      });
    } else if (cat === 'owner capital' && l.type === 'IN') {
      if (hasBankKeyword(acc) || hasBankKeyword(ref) || hasBankKeyword(desc)) return;
      ownerCashIn += amt;
      rows.push({
        id: `ledger-${l.id}`,
        date: ts,
        flowType: 'OWNER_CASH_IN',
        label: 'Owner Cash In (+)',
        urduLabel: 'مالک سے کیش وصول',
        voucherNo: l.reference || 'CAPITAL',
        description: l.description || 'Cash Received from Owner',
        inflow: amt,
        outflow: 0,
      });
    }
  });

  rows.sort((a, b) => b.date - a.date);

  const netCashSales = inStoreCashSales - inStoreCashReturns;
  const netDrawerCash = openingGalla + netCashSales + ownerCashIn - cashHandoversToOwner - shopCashExpenses;

  return {
    openingGalla,
    inStoreCashSales,
    inStoreCashReturns,
    netCashSales,
    ownerCashIn,
    cashHandoversToOwner,
    shopCashExpenses,
    netDrawerCash,
    rows,
  };
}

/**
 * Resolves the Opening Galla for a given target date (`YYYY-MM-DD`).
 *
 * Rule:
 * - Auto carry-forward ONLY starts once at least one manual Opening Galla has been added
 *   for the branch on or before `targetDateStr`.
 * - Before any manual entry exists, returns `openingGalla: 0` (`isActive: false`).
 * - If `targetDateStr` itself has a manual entry, returns that exact manual value (`isManual: true`).
 * - For subsequent days after the most recent manual anchor `anchorDate < targetDateStr`,
 *   automatically carries forward each day's closing Actual Galla (`netDrawerCash`) to the
 *   next day's Opening Galla day-by-day up to `targetDateStr`.
 */
export function resolveOpeningGallaForDate(params: {
  targetDateStr: string;
  dailyOpeningBalances: Record<string, number>;
  sales: any[];
  ledgerEntries: any[];
  ownerTransactions: any[];
  branchId?: string | null;
  fallbackBranchId?: string;
}): OpeningGallaResolution {
  const {
    targetDateStr,
    dailyOpeningBalances,
    sales,
    ledgerEntries,
    ownerTransactions,
    branchId,
    fallbackBranchId = 'main',
  } = params;

  const emptyResult: OpeningGallaResolution = {
    openingGalla: 0,
    isAuto: false,
    isManual: false,
    isActive: false,
    anchorDate: null,
    previousDateStr: null,
    previousActualGalla: null,
    hasEarlierAnchor: false,
  };

  if (!targetDateStr || !DATE_STR_REGEX.test(targetDateStr)) {
    return emptyResult;
  }

  const eligibleManualDates = Object.keys(dailyOpeningBalances || {})
    .filter(d => DATE_STR_REGEX.test(d) && d <= targetDateStr)
    .sort();

  if (eligibleManualDates.length === 0) {
    return emptyResult;
  }

  const anchorDate = eligibleManualDates[eligibleManualDates.length - 1];
  const hasEarlierAnchor = eligibleManualDates.some(d => d < targetDateStr);

  if (anchorDate === targetDateStr) {
    return {
      openingGalla: Number(dailyOpeningBalances[targetDateStr]) || 0,
      isAuto: false,
      isManual: true,
      isActive: true,
      anchorDate,
      previousDateStr: null,
      previousActualGalla: null,
      hasEarlierAnchor,
    };
  }

  const matchesBranch = (itemBranch?: string) => {
    if (!branchId) return true;
    return (itemBranch || fallbackBranchId) === branchId;
  };

  const bucketByDate = (items: any[]) => {
    const map = new Map<string, any[]>();
    for (const item of items) {
      if (!matchesBranch(item.branchId)) continue;
      const dStr = toLocalDateStr(getRecordTime(item));
      if (!dStr || dStr < anchorDate || dStr >= targetDateStr) continue;
      let list = map.get(dStr);
      if (!list) {
        list = [];
        map.set(dStr, list);
      }
      list.push(item);
    }
    return map;
  };

  const salesByDate = bucketByDate(sales);
  const ledgerByDate = bucketByDate(ledgerEntries);
  const ownerTxByDate = bucketByDate(ownerTransactions);

  let currDate = anchorDate;
  let runningOpening = Number(dailyOpeningBalances[anchorDate]) || 0;
  let steps = 0;

  while (currDate < targetDateStr && steps < 3660) {
    const daySummary = calculateCashDrawer({
      sales: salesByDate.get(currDate) || [],
      ledgerEntries: ledgerByDate.get(currDate) || [],
      ownerTransactions: ownerTxByDate.get(currDate) || [],
      openingGalla: runningOpening,
      branchId,
      fallbackBranchId,
      isWithinDate: () => true,
    });

    const closing = daySummary.netDrawerCash;
    const nextDate = addDaysToDateStr(currDate, 1);

    if (nextDate >= targetDateStr) {
      return {
        openingGalla: closing,
        isAuto: true,
        isManual: false,
        isActive: true,
        anchorDate,
        previousDateStr: currDate,
        previousActualGalla: closing,
        hasEarlierAnchor: true,
      };
    }

    runningOpening = closing;
    currDate = nextDate;
    steps++;
  }

  return {
    openingGalla: runningOpening,
    isAuto: true,
    isManual: false,
    isActive: true,
    anchorDate,
    previousDateStr: currDate,
    previousActualGalla: runningOpening,
    hasEarlierAnchor: true,
  };
}

