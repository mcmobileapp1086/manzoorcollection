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

export function calculateCashDrawer(params: {
  sales: any[];
  ledgerEntries: any[];
  ownerTransactions: any[];
  openingGalla: number;
  branchId?: string | null;
  fallbackBranchId?: string;
  isWithinDate: (ts: number) => boolean;
}): CashDrawerSummary {
  const {
    sales,
    ledgerEntries,
    ownerTransactions,
    openingGalla,
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

  if (openingGalla > 0) {
    rows.push({
      id: 'opening-galla',
      date: 0,
      flowType: 'OPENING',
      label: 'Opening Galla (+)',
      urduLabel: 'ابتدائی گلہ',
      voucherNo: 'OPENING',
      description: 'Daily Opening Galla Balance',
      inflow: openingGalla,
      outflow: 0,
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
