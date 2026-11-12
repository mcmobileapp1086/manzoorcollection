import React, { useState, useEffect } from 'react';
import { useBranch } from '../context/BranchContext';
import { useAuth } from '../context/AuthContext';
import { useSettings } from '../context/SettingsContext';
import { collection, query, where, Timestamp, doc, addDoc, updateDoc, deleteDoc } from '../lib/customFirestore';
import { db, safeCollectionSnapshot } from '../lib/firebase';
import { 
  Landmark, 
  Plus, 
  ArrowDownRight, 
  ArrowUpRight, 
  Printer, 
  Trash2, 
  Edit, 
  Search, 
  Banknote, 
  CreditCard,
  Building2,
  Smartphone,
  CheckCircle, 
  Clock, 
  X,
  RefreshCw,
  Hash,
  Send,
  Globe,
  Truck,
  Receipt,
  CheckCircle2,
  Copy,
  FileText,
  ExternalLink,
  Store,
  SlidersHorizontal,
  BarChart3,
  Layers,
  ArrowRightLeft
} from 'lucide-react';
import { printInvoice } from '../lib/print';
import { format, startOfDay, endOfDay, startOfWeek, startOfMonth, isWithinInterval, isValid } from 'date-fns';

const safeFormat = (date: any, formatStr: string) => {
  if (!date) return '';
  const d = new Date(date);
  if (!isValid(d)) return '';
  try {
    return format(d, formatStr);
  } catch (e) {
    return '';
  }
};
import { OwnerTransaction } from '../types';
import toast from 'react-hot-toast';
import { recordActivityLog } from '../lib/activityLogger';

export interface AccountSaleBreakdown {
  online: number;
  inStore: number;
  total: number;
  label: string;
  iconType: string;
}

export interface StaffSaleBreakdown {
  online: number;
  inStore: number;
  total: number;
  count: number;
  code: string;
}

export function OwnerAccount() {
  const { user } = useAuth();
  const { activeBranchId, branches } = useBranch();
  const { enableDeletion } = useSettings();

  const [transactions, setTransactions] = useState<OwnerTransaction[]>([]);
  const [salesTransfers, setSalesTransfers] = useState<any[]>([]);
  const [ledgerEntries, setLedgerEntries] = useState<any[]>([]);

  // Top Navigation View Tabs: Sale Type Dashboard, Online Bills, In-Store Bills, All Records, Cash Handover, Bank & Wallets
  const [activeTab, setActiveTab] = useState<'sale_type_dashboard' | 'online_bills' | 'instore_bills' | 'all' | 'cash_handover' | 'bank_accounts'>('sale_type_dashboard');
  const [saleTypeSubFilter, setSaleTypeSubFilter] = useState<'all' | 'Online' | 'In-Store'>('all');
  const [onlineBillStatusFilter, setOnlineBillStatusFilter] = useState<'all' | 'advance' | 'cleared' | 'pending_cod'>('all');
  const [showOnlineStatementPreview, setShowOnlineStatementPreview] = useState(false);
  const [showSaleTypeStatementPreview, setShowSaleTypeStatementPreview] = useState(false);
  const [allSalesRaw, setAllSalesRaw] = useState<any[]>([]);

  // Branch State: Strictly locked to the currently logged-in / active branch (کوئی سلیکشن نہیں - صرف لاگ ان برانچ)
  const currentBranchId = activeBranchId || user?.branchId || (branches[0]?.id || 'main');
  const currentBranch = branches.find(b => b.id === currentBranchId) || branches[0];

  const [dateFilter, setDateFilter] = useState<'all' | 'today' | 'yesterday' | 'week' | 'month' | 'custom'>('month');
  const [startDate, setStartDate] = useState(format(startOfMonth(new Date()), 'yyyy-MM-dd'));
  const [endDate, setEndDate] = useState(format(endOfDay(new Date()), 'yyyy-MM-dd'));
  const [typeFilter, setTypeFilter] = useState<'all' | 'ONLINE' | 'OUT' | 'IN' | 'SALE'>('all');
  const [accountFilter, setAccountFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Modal State
  const [showAddModal, setShowAddModal] = useState(false);
  const [editTxId, setEditTxId] = useState<string | null>(null);
  const [txType, setTxType] = useState<'OUT' | 'IN'>('OUT'); // OUT = Given to Owner, IN = Received into Owner Account / From Owner
  const [txCategory, setTxCategory] = useState<'Cash Handover' | 'Online Received' | 'Owner Capital' | 'Owner Drawing' | 'Sale Payment' | 'Other'>('Cash Handover');
  const [accountHead, setAccountHead] = useState<string>('Meezan Bank');
  const [customAccountHead, setCustomAccountHead] = useState<string>('');
  const [trxId, setTrxId] = useState<string>('');
  const [senderName, setSenderName] = useState<string>('');
  const [txAmount, setTxAmount] = useState<number | ''>('');
  const [txDate, setTxDate] = useState(format(new Date(), "yyyy-MM-dd'T'HH:mm"));
  const [ownerName, setOwnerName] = useState('Manzoor Ahmed (Owner)');
  const [handledBy, setHandledBy] = useState(user?.name || 'Cashier');
  const [paymentMode, setPaymentMode] = useState<string>('Cash by Hand');
  const [description, setDescription] = useState('');
  const [voucherNo, setVoucherNo] = useState('');
  const [targetBranchId, setTargetBranchId] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Voucher and Statement print preview states
  const [printTx, setPrintTx] = useState<any | null>(null);
  const [showStatementPreview, setShowStatementPreview] = useState(false);
  const [voucherPrintFormat, setVoucherPrintFormat] = useState<'thermal' | 'a4'>('thermal');

  // English words for Pakistani currency (Lakh, Crore, Thousand)
  const numberToWords = (num: number): string => {
    if (!num || isNaN(num)) return 'Zero Rupees Only';
    const a = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
    const b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

    function inWords(n: number): string {
      if (n < 20) return a[n];
      if (n < 100) return b[Math.floor(n / 10)] + (n % 10 !== 0 ? ' ' + a[n % 10] : '');
      if (n < 1000) return a[Math.floor(n / 100)] + ' Hundred' + (n % 100 !== 0 ? ' ' + inWords(n % 100) : '');
      if (n < 100000) return inWords(Math.floor(n / 1000)) + ' Thousand' + (n % 1000 !== 0 ? ' ' + inWords(n % 1000) : '');
      if (n < 10000000) return inWords(Math.floor(n / 100000)) + ' Lakh' + (n % 100000 !== 0 ? ' ' + inWords(n % 100000) : '');
      return inWords(Math.floor(n / 10000000)) + ' Crore' + (n % 10000000 !== 0 ? ' ' + inWords(n % 10000000) : '');
    }

    return inWords(Math.floor(Math.abs(num))).trim() + ' Rupees Only';
  };

  // Load Transactions - Centrally across ALL branches without branch filtering
  useEffect(() => {
    // Owner Account is the business owner's master account across the entire company: do NOT filter by branchId
    const txQ: any = collection(db, 'ownerTransactions');
    const sQ: any = collection(db, 'sales');
    const lQ: any = collection(db, 'ledger');

    const unsubTx = safeCollectionSnapshot(txQ, (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() } as OwnerTransaction));
      setTransactions(list);
    });

    const unsubSales = safeCollectionSnapshot(sQ, (snap) => {
      const allSales = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setAllSalesRaw(allSales);
      // Capture ALL Online Bills (saleType === 'Online') as well as any sales paid via Bank / Digital accounts
      const ownerSales = allSales.filter((s: any) => {
        if (s.saleType === 'Online') return true;
        const pm = (s.paymentMethod || '').toLowerCase();
        const pa = (s.paymentAccount || '').toLowerCase();
        const apm = (s.advancePaymentMethod || '').toLowerCase();
        const apa = (s.advancePaymentAccount || '').toLowerCase();
        return (
          pm.includes('owner') || 
          pa.includes('owner') || 
          apm.includes('owner') || 
          apa.includes('owner') ||
          pa.includes('meezan') ||
          apa.includes('meezan') ||
          pa.includes('ubl') ||
          apa.includes('ubl') ||
          pa.includes('jazzcash') ||
          apa.includes('jazzcash') ||
          pa.includes('easypaisa') ||
          apa.includes('easypaisa') ||
          pm.includes('online') ||
          pm === 'split'
        );
      });
      setSalesTransfers(ownerSales);
    });

    const unsubLedger = safeCollectionSnapshot(lQ, (snap) => {
      const allLedger = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      // Filter ledger entries with Owner Transfer, Owner Withdrawal, Owner Capital, Online Received
      const ownerLedger = allLedger.filter((l: any) => {
        const cat = l.category || '';
        return (
          cat === 'Owner Transfer' || 
          cat === 'Owner Withdrawal' || 
          cat === 'Owner Capital' || 
          cat === 'Online Received' ||
          (l.accountName && (l.accountName.includes('Meezan') || l.accountName.includes('UBL') || l.accountName.includes('JazzCash') || l.accountName.includes('EasyPaisa') || l.accountName.includes('Owner')))
        );
      });
      setLedgerEntries(ownerLedger);
    });

    return () => {
      unsubTx();
      unsubSales();
      unsubLedger();
    };
  }, []);

  // Combine and deduplicate transactions
  const combinedItems = React.useMemo(() => {
    const items: any[] = [];
    const seenKeys = new Set<string>();

    const salesById = new Map<string, any>();
    const salesByInv = new Map<string, any>();
    allSalesRaw.forEach(s => {
      if (s.id) salesById.set(s.id, s);
      const inv = String(s.invoiceNo || '').trim().toUpperCase();
      if (inv) salesByInv.set(inv, s);
    });

    // 1. All ownerTransactions
    transactions.forEach(t => {
      const key = t.saleInvoiceId ? `sale-${t.saleInvoiceId}` : (t.ledgerId ? `ledger-${t.ledgerId}` : `tx-${t.id}`);
      seenKeys.add(key);
      seenKeys.add(t.id);
      if (t.voucherNo) seenKeys.add(t.voucherNo);

      // Derive linked sale if any
      const linkedSale = (t.saleInvoiceId && salesById.get(t.saleInvoiceId)) || 
                         (t.saleInvoiceNo && salesByInv.get(String(t.saleInvoiceNo).toUpperCase())) || 
                         null;

      // -------------------------------------------------------------
      // SIMPLE FORMULA:
      // Jo bill Online Delivery bana (saleType === 'Online'), wo 100% Online Bill hai.
      // Jo bill In-Store bana (saleType !== 'Online'), wo 100% In-Store Bill hai (chahe Meezan/JazzCash/Online se pay ho).
      // Store ki online payment kabhi bi Online Bill mein add nahi hogi!
      // -------------------------------------------------------------
      const hasSaleBill = !!linkedSale || !!t.saleInvoiceId || !!t.saleInvoiceNo;
      
      let resolvedSaleType: 'Online' | 'In-Store' | null = null;
      if (linkedSale) {
        resolvedSaleType = linkedSale.saleType === 'Online' ? 'Online' : 'In-Store';
      } else if ((t as any).saleType === 'Online' || (t as any).saleType === 'In-Store') {
        resolvedSaleType = (t as any).saleType;
      } else if (hasSaleBill) {
        // If there's an invoice, check if description/voucher explicitly indicates Online Delivery
        const desc = ((t.description || '') + ' ' + (t.voucherNo || '')).toLowerCase();
        if (desc.includes('online delivery') || desc.includes('courier') || desc.includes('cod') || desc.includes('advance')) {
          resolvedSaleType = 'Online';
        } else {
          resolvedSaleType = 'In-Store';
        }
      }

      const isOnlineBill = resolvedSaleType === 'Online';
      const isInStoreBill = resolvedSaleType === 'In-Store';

      // Derive account head
      const derivedAccountHead = t.accountHead || (
        t.category === 'Online Received' 
          ? (t.paymentMode || 'Meezan Bank') 
          : (t.paymentMode === 'Cash by Hand' ? 'Cash by Hand' : (t.paymentMode || 'Owner Account'))
      );

      items.push({
        id: t.id,
        source: 'owner_tx',
        isOnlineBill: isOnlineBill,
        isInStoreBill: isInStoreBill,
        saleType: resolvedSaleType,
        date: t.date,
        type: t.type,
        amount: Number(t.amount) || 0,
        onlineReceivedAmount: isOnlineBill ? (Number(t.amount) || 0) : 0,
        inStoreReceivedAmount: isInStoreBill ? (Number(t.amount) || 0) : 0,
        ownerName: t.ownerName || 'Manzoor Ahmed (Owner)',
        handledBy: t.handledBy || (linkedSale?.onlineEmployeeName || linkedSale?.salesmanName || ''),
        onlineEmployeeName: linkedSale?.onlineEmployeeName || linkedSale?.salesmanName || t.handledBy || '',
        onlineEmployeeCode: linkedSale?.onlineEmployeeCode || '',
        customerName: t.senderName || linkedSale?.customerName || (isOnlineBill ? 'Online Customer' : (isInStoreBill ? 'Walk-in' : '')),
        customerPhone: linkedSale?.customerPhone || linkedSale?.phone || '',
        shippingAddress: linkedSale?.shippingAddress || '',
        billTotal: Number(linkedSale?.total) || Number(t.amount) || 0,
        advanceAmount: Number(linkedSale?.advanceAmount) || 0,
        receivedAmount: Number(linkedSale?.received) || Number(t.amount) || 0,
        balance: linkedSale?.balance !== undefined ? Number(linkedSale?.balance) : 0,
        courier: linkedSale?.courier || '',
        trackingNumber: linkedSale?.trackingNumber || '',
        codCashReceived: !!linkedSale?.codCashReceived,
        paymentMode: t.paymentMode || 'Cash by Hand',
        accountHead: derivedAccountHead,
        category: t.category || (isOnlineBill ? 'Online Received' : (t.type === 'OUT' ? 'Cash Handover' : 'Owner Capital')),
        trxId: t.trxId,
        senderName: t.senderName,
        description: t.description,
        voucherNo: t.voucherNo || `OWN-${t.id.substring(0, 6).toUpperCase()}`,
        saleInvoiceId: t.saleInvoiceId,
        saleInvoiceNo: t.saleInvoiceNo || linkedSale?.invoiceNo,
        branchId: t.branchId || linkedSale?.branchId,
        raw: t,
        linkedSale: linkedSale
      });
    });

    // 2. Sales with Owner Account / Online Heads (add if not already tracked in ownerTransactions)
    salesTransfers.forEach(s => {
      const invNo = String(s.invoiceNo || s.id.substring(0, 6)).toUpperCase();
      const saleKey = `sale-${s.id}`;
      if (!seenKeys.has(saleKey) && !seenKeys.has(invNo) && !seenKeys.has(s.id)) {
        let amount = 0;
        let onlineReceivedAmount = 0;
        const isOnlineBill = s.saleType === 'Online';
        const isInStoreBill = s.saleType !== 'Online';
        const saleType: 'Online' | 'In-Store' = isOnlineBill ? 'Online' : 'In-Store';

        if (s.paymentMethod === 'Split') {
          amount = Number(s.splitOnlineAmount) || 0;
          onlineReceivedAmount = isOnlineBill ? amount : 0;
        } else if (isOnlineBill) {
          const adv = Number(s.advanceAmount) || 0;
          const rec = Number(s.received) || 0;
          // In online bills, advance received or total received is the payment received online
          amount = adv > 0 ? adv : rec;
          onlineReceivedAmount = amount;
          if (s.codCashReceived && rec > 0) {
            onlineReceivedAmount = rec;
            amount = rec;
          }
        } else {
          amount = s.received !== undefined ? Number(s.received) : Number(s.total) || 0;
          onlineReceivedAmount = 0;
        }

        if (amount > 0 || isOnlineBill) {
          const rawAccount = (s.advancePaymentAccount || s.paymentAccount || s.advancePaymentMethod || s.paymentMethod || '').toLowerCase();
          let accHead = 'Meezan Bank';
          if (rawAccount.includes('meezan')) accHead = 'Meezan Bank';
          else if (rawAccount.includes('ubl')) accHead = 'UBL Bank';
          else if (rawAccount.includes('jazzcash')) accHead = 'JazzCash';
          else if (rawAccount.includes('easypaisa')) accHead = 'EasyPaisa';
          else if (rawAccount.includes('cash')) accHead = 'Cash by Hand';
          else if (rawAccount.includes('owner')) accHead = 'Owner Account';
          else if (isOnlineBill) {
            accHead = s.advancePaymentAccount || s.advancePaymentMethod || 'Meezan Bank';
          }

          const isOnline = isOnlineBill || accHead !== 'Cash by Hand' || s.paymentMethod === 'Split' || s.paymentMethod === 'Online';

          items.push({
            id: `sale-item-${s.id}`,
            source: 'sale',
            isOnlineBill: isOnlineBill,
            isInStoreBill: isInStoreBill,
            saleType: saleType,
            date: s.date || (s.createdAt?.seconds ? s.createdAt.seconds * 1000 : Date.now()),
            type: 'OUT', // Credited to owner
            amount: amount,
            onlineReceivedAmount: isOnlineBill ? amount : 0,
            inStoreReceivedAmount: isInStoreBill ? amount : 0,
            ownerName: 'Manzoor Ahmed (Owner)',
            handledBy: s.onlineEmployeeName || s.salesmanName || 'Sale Counter',
            onlineEmployeeName: s.onlineEmployeeName || s.salesmanName || '',
            onlineEmployeeCode: s.onlineEmployeeCode || '',
            customerName: s.customerName || (isOnlineBill ? 'Online Customer' : 'Walk-in'),
            customerPhone: s.customerPhone || s.phone || '',
            shippingAddress: s.shippingAddress || '',
            paymentMode: accHead,
            accountHead: accHead,
            category: isOnlineBill ? 'Online Received' : (isOnline ? 'Online Received' : 'Sale Payment'),
            description: isOnlineBill 
              ? `Online Bill #${invNo} - Customer: ${s.customerName || 'Online Customer'} (${accHead}${s.advanceTrxId ? ` | Trx: ${s.advanceTrxId}` : ''})`
              : `In-Store Invoice #${invNo} - Customer: ${s.customerName || 'Walk-in'} (Payment via ${accHead})`,
            voucherNo: `INV-${invNo}`,
            saleInvoiceId: s.id,
            saleInvoiceNo: invNo,
            billTotal: Number(s.total) || 0,
            advanceAmount: Number(s.advanceAmount) || 0,
            receivedAmount: Number(s.received) || 0,
            balance: s.balance !== undefined ? Number(s.balance) : (Number(s.total || 0) - Number(s.received || 0)),
            courier: s.courier || '',
            trackingNumber: s.trackingNumber || '',
            codCashReceived: !!s.codCashReceived,
            trxId: s.advanceTrxId || s.trxId || '',
            branchId: s.branchId,
            raw: s,
            linkedSale: s
          });
        }
      }
    });

    // Sort by date descending
    return items.sort((a, b) => b.date - a.date);
  }, [transactions, salesTransfers, allSalesRaw]);

  // Date range calculation
  const getDateRange = () => {
    const now = new Date();
    let start = startOfDay(now);
    let end = endOfDay(now);

    if (dateFilter === 'yesterday') {
      const yest = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      start = startOfDay(yest);
      end = endOfDay(yest);
    } else if (dateFilter === 'week') {
      start = startOfWeek(now, { weekStartsOn: 1 });
      end = endOfDay(now);
    } else if (dateFilter === 'month') {
      start = startOfMonth(now);
      end = endOfDay(now);
    } else if (dateFilter === 'custom') {
      const [sy, sm, sd] = (startDate || '').split('-');
      start = new Date(Number(sy), Number(sm) - 1, Number(sd), 0, 0, 0, 0);
      const [ey, em, ed] = (endDate || '').split('-');
      end = new Date(Number(ey), Number(em) - 1, Number(ed), 23, 59, 59, 999);
    }
    return { start, end };
  };

  const isItemWithinDate = (timestamp: number) => {
    if (dateFilter === 'all') return true;
    const { start, end } = getDateRange();
    const d = new Date(timestamp);
    return isWithinInterval(d, { start, end });
  };

  // Filtered List for General / All Transactions
  const filteredList = combinedItems.filter(item => {
    // Strictly filter by logged-in / active branch only (صرف اس برانچ کا کھاتہ - کمبائن سسٹم ختم)
    const itemBranch = item.branchId || (branches[0]?.id || 'main');
    if (itemBranch !== currentBranchId) return false;

    // Date filter
    if (!isItemWithinDate(item.date)) return false;

    // Type filter
    if (typeFilter === 'ONLINE') {
      const acc = (item.accountHead || item.paymentMode || '').toLowerCase();
      const isOnline = item.category === 'Online Received' || acc.includes('meezan') || acc.includes('ubl') || acc.includes('jazzcash') || acc.includes('easypaisa');
      if (!isOnline) return false;
    } else if (typeFilter === 'OUT') {
      if (item.type !== 'OUT' || item.category === 'Sale Payment' || item.category === 'Online Received') return false;
    } else if (typeFilter === 'IN') {
      if (item.type !== 'IN' || item.category === 'Online Received') return false;
    } else if (typeFilter === 'SALE') {
      if (item.category !== 'Sale Payment' && item.source !== 'sale') return false;
    }

    if (accountFilter !== 'all') {
      const acc = (item.accountHead || item.paymentMode || '').toLowerCase();
      const target = accountFilter.toLowerCase();
      if (target === 'ubl bank' || target === 'ubl') {
        if (!acc.includes('ubl')) return false;
      } else if (target === 'meezan bank' || target === 'meezan') {
        if (!acc.includes('meezan')) return false;
      } else if (target === 'jazzcash') {
        if (!acc.includes('jazzcash')) return false;
      } else if (target === 'easypaisa') {
        if (!acc.includes('easypaisa')) return false;
      } else if (target === 'cash by hand') {
        if (!acc.includes('cash')) return false;
      } else if (target === 'owner account') {
        if (!acc.includes('owner')) return false;
      } else if (!acc.includes(target)) {
        return false;
      }
    }

    // Search query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchVoucher = (item.voucherNo || '').toLowerCase().includes(q);
      const matchDesc = (item.description || '').toLowerCase().includes(q);
      const matchOwner = (item.ownerName || '').toLowerCase().includes(q);
      const matchHandled = (item.handledBy || '').toLowerCase().includes(q);
      const matchMode = (item.paymentMode || '').toLowerCase().includes(q);
      const matchAcc = (item.accountHead || '').toLowerCase().includes(q);
      const matchTrx = (item.trxId || '').toLowerCase().includes(q);
      const matchSender = (item.senderName || item.customerName || '').toLowerCase().includes(q);
      return matchVoucher || matchDesc || matchOwner || matchHandled || matchMode || matchAcc || matchTrx || matchSender;
    }

    return true;
  });

  // Dedicated Filtered List specifically for Online Bills Payments
  const onlineBillsList = React.useMemo(() => {
    return combinedItems.filter(item => {
      // Strictly filter by logged-in / active branch only (صرف اس برانچ کا کھاتہ - کمبائن سسٹم ختم)
      const itemBranch = item.branchId || (branches[0]?.id || 'main');
      if (itemBranch !== currentBranchId) return false;

      // SIMPLE FORMULA: ONLY Online Delivery bills (jo bill online delivery bana)
      const isOnlineDelivery = item.saleType === 'Online' || item.isOnlineBill === true;
      if (!isOnlineDelivery) return false;

      // Date filter
      if (!isItemWithinDate(item.date)) return false;

      // Account Head filter
      if (accountFilter !== 'all') {
        const acc = (item.accountHead || item.paymentMode || '').toLowerCase();
        const target = accountFilter.toLowerCase();
        if (target === 'ubl bank' || target === 'ubl') {
          if (!acc.includes('ubl')) return false;
        } else if (target === 'meezan bank' || target === 'meezan') {
          if (!acc.includes('meezan')) return false;
        } else if (target === 'jazzcash') {
          if (!acc.includes('jazzcash')) return false;
        } else if (target === 'easypaisa') {
          if (!acc.includes('easypaisa')) return false;
        } else if (target === 'cash by hand') {
          if (!acc.includes('cash')) return false;
        } else if (!acc.includes(target)) {
          return false;
        }
      }

      // Online Bill Status filter
      if (onlineBillStatusFilter === 'advance') {
        if (!item.advanceAmount || item.advanceAmount <= 0) return false;
      } else if (onlineBillStatusFilter === 'cleared') {
        if (item.balance > 0 && !item.codCashReceived) return false;
      } else if (onlineBillStatusFilter === 'pending_cod') {
        if (item.balance <= 0 || item.codCashReceived) return false;
      }

      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchInv = (item.voucherNo || item.saleInvoiceNo || '').toLowerCase().includes(q);
        const matchCustomer = (item.customerName || '').toLowerCase().includes(q);
        const matchPhone = (item.customerPhone || '').toLowerCase().includes(q);
        const matchStaff = (item.onlineEmployeeName || item.onlineEmployeeCode || item.handledBy || '').toLowerCase().includes(q);
        const matchTrx = (item.trxId || '').toLowerCase().includes(q);
        const matchCourier = (item.courier || item.trackingNumber || '').toLowerCase().includes(q);
        const matchAcc = (item.accountHead || '').toLowerCase().includes(q);
        return matchInv || matchCustomer || matchPhone || matchStaff || matchTrx || matchCourier || matchAcc;
      }

      return true;
    });
  }, [combinedItems, currentBranchId, branches, dateFilter, startDate, endDate, accountFilter, onlineBillStatusFilter, searchQuery]);

  // Dedicated Online Bills Summary Metrics
  const onlineBillsMetrics = React.useMemo(() => {
    let totalOnlineReceived = 0;
    let totalBillValue = 0;
    let totalPendingCOD = 0;
    let meezanTotal = 0;
    let ublTotal = 0;
    let jazzCashTotal = 0;
    let easyPaisaTotal = 0;
    let cashTotal = 0;

    const now = new Date();
    const todayStart = startOfDay(now).getTime();
    const todayEnd = endOfDay(now).getTime();
    let todayOnlineReceived = 0;

    onlineBillsList.forEach(item => {
      const recAmt = Number(item.onlineReceivedAmount || item.amount) || 0;
      const billVal = Number(item.billTotal) || 0;
      const bal = Number(item.balance) || 0;

      totalOnlineReceived += recAmt;
      totalBillValue += billVal;
      if (bal > 0 && !item.codCashReceived) {
        totalPendingCOD += bal;
      }

      if (item.date >= todayStart && item.date <= todayEnd) {
        todayOnlineReceived += recAmt;
      }

      const acc = (item.accountHead || item.paymentMode || '').toLowerCase();
      if (acc.includes('meezan')) meezanTotal += recAmt;
      else if (acc.includes('ubl')) ublTotal += recAmt;
      else if (acc.includes('jazzcash')) jazzCashTotal += recAmt;
      else if (acc.includes('easypaisa')) easyPaisaTotal += recAmt;
      else if (acc.includes('cash')) cashTotal += recAmt;
    });

    return {
      totalOnlineReceived,
      todayOnlineReceived,
      totalBillValue,
      totalPendingCOD,
      totalBillsCount: onlineBillsList.length,
      meezanTotal,
      ublTotal,
      jazzCashTotal,
      easyPaisaTotal,
      cashTotal
    };
  }, [onlineBillsList]);

  // Dedicated Filtered List specifically for Sale Type Dashboard (Online Delivery vs In-Store)
  const saleBillsList = React.useMemo(() => {
    return combinedItems.filter(item => {
      // Filter by active branch
      const itemBranch = item.branchId || (branches[0]?.id || 'main');
      if (itemBranch !== currentBranchId) return false;

      // SIMPLE FORMULA: Must be a sale bill (Online Delivery or In-Store)
      const isSale = item.saleType === 'Online' || item.saleType === 'In-Store' || item.isOnlineBill === true || item.isInStoreBill === true;
      if (!isSale) return false;

      // Sub-filter: Online vs In-Store vs All
      if (saleTypeSubFilter === 'Online') {
        const isOnline = item.saleType === 'Online' || item.isOnlineBill === true;
        if (!isOnline) return false;
      } else if (saleTypeSubFilter === 'In-Store') {
        const isInStore = (item.saleType === 'In-Store' || item.isInStoreBill === true) && item.saleType !== 'Online' && !item.isOnlineBill;
        if (!isInStore) return false;
      }

      // Date filter
      if (!isItemWithinDate(item.date)) return false;

      // Account Head filter
      if (accountFilter !== 'all') {
        const acc = (item.accountHead || item.paymentMode || '').toLowerCase();
        const target = accountFilter.toLowerCase();
        if (target === 'ubl bank' || target === 'ubl') {
          if (!acc.includes('ubl')) return false;
        } else if (target === 'meezan bank' || target === 'meezan') {
          if (!acc.includes('meezan')) return false;
        } else if (target === 'jazzcash') {
          if (!acc.includes('jazzcash')) return false;
        } else if (target === 'easypaisa') {
          if (!acc.includes('easypaisa')) return false;
        } else if (target === 'cash by hand') {
          if (!acc.includes('cash')) return false;
        } else if (target === 'owner account') {
          if (!acc.includes('owner')) return false;
        } else if (!acc.includes(target)) {
          return false;
        }
      }

      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchInv = (item.voucherNo || item.saleInvoiceNo || '').toLowerCase().includes(q);
        const matchCustomer = (item.customerName || item.senderName || '').toLowerCase().includes(q);
        const matchPhone = (item.customerPhone || '').toLowerCase().includes(q);
        const matchStaff = (item.onlineEmployeeName || item.onlineEmployeeCode || item.handledBy || '').toLowerCase().includes(q);
        const matchTrx = (item.trxId || '').toLowerCase().includes(q);
        const matchCourier = (item.courier || item.trackingNumber || '').toLowerCase().includes(q);
        const matchAcc = (item.accountHead || item.paymentMode || '').toLowerCase().includes(q);
        return matchInv || matchCustomer || matchPhone || matchStaff || matchTrx || matchCourier || matchAcc;
      }

      return true;
    });
  }, [combinedItems, currentBranchId, branches, dateFilter, startDate, endDate, accountFilter, saleTypeSubFilter, searchQuery]);

  // Dedicated In-Store Bills Filtered List
  const inStoreBillsList = React.useMemo(() => {
    return combinedItems.filter(item => {
      const itemBranch = item.branchId || (branches[0]?.id || 'main');
      if (itemBranch !== currentBranchId) return false;
      
      // SIMPLE FORMULA: ONLY In-Store bills (jo bill In-Store bana, chahe Meezan/JazzCash se pay hua ho)
      const isInStore = (item.saleType === 'In-Store' || item.isInStoreBill === true) && item.saleType !== 'Online' && !item.isOnlineBill;
      if (!isInStore) return false;
      if (!isItemWithinDate(item.date)) return false;
      if (accountFilter !== 'all') {
        const acc = (item.accountHead || item.paymentMode || '').toLowerCase();
        const target = accountFilter.toLowerCase();
        if (target === 'ubl bank' || target === 'ubl') {
          if (!acc.includes('ubl')) return false;
        } else if (target === 'meezan bank' || target === 'meezan') {
          if (!acc.includes('meezan')) return false;
        } else if (target === 'jazzcash') {
          if (!acc.includes('jazzcash')) return false;
        } else if (target === 'easypaisa') {
          if (!acc.includes('easypaisa')) return false;
        } else if (target === 'cash by hand') {
          if (!acc.includes('cash')) return false;
        } else if (target === 'owner account') {
          if (!acc.includes('owner')) return false;
        } else if (!acc.includes(target)) {
          return false;
        }
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchInv = (item.voucherNo || item.saleInvoiceNo || '').toLowerCase().includes(q);
        const matchCustomer = (item.customerName || item.senderName || '').toLowerCase().includes(q);
        const matchPhone = (item.customerPhone || '').toLowerCase().includes(q);
        const matchStaff = (item.onlineEmployeeName || item.onlineEmployeeCode || item.handledBy || '').toLowerCase().includes(q);
        const matchTrx = (item.trxId || '').toLowerCase().includes(q);
        const matchAcc = (item.accountHead || item.paymentMode || '').toLowerCase().includes(q);
        return matchInv || matchCustomer || matchPhone || matchStaff || matchTrx || matchAcc;
      }
      return true;
    });
  }, [combinedItems, currentBranchId, branches, dateFilter, startDate, endDate, accountFilter, searchQuery]);

  // Dedicated Metrics for Sale Type Dashboard (Online Delivery vs In-Store separation per account)
  const saleTypeMetrics = React.useMemo(() => {
    let onlineTotalReceived = 0;
    let onlineBillsCount = 0;
    let onlineTotalBillValue = 0;
    let onlinePendingCOD = 0;
    let onlineTodayReceived = 0;

    let inStoreTotalReceived = 0;
    let inStoreBillsCount = 0;
    let inStoreTotalBillValue = 0;
    let inStorePendingBalance = 0;
    let inStoreTodayReceived = 0;

    const accountBreakdown: Record<string, { online: number; inStore: number; total: number; label: string; iconType: string }> = {
      meezan: { online: 0, inStore: 0, total: 0, label: 'Meezan Bank (میزان بینک)', iconType: 'bank' },
      jazzCash: { online: 0, inStore: 0, total: 0, label: 'JazzCash (جاز کیش)', iconType: 'mobile' },
      easyPaisa: { online: 0, inStore: 0, total: 0, label: 'EasyPaisa (ایزی پیسہ)', iconType: 'wallet' },
      ubl: { online: 0, inStore: 0, total: 0, label: 'UBL Bank (یو بی ایل)', iconType: 'bank' },
      cash: { online: 0, inStore: 0, total: 0, label: 'Cash by Hand (نقد کیش)', iconType: 'cash' },
      ownerAcc: { online: 0, inStore: 0, total: 0, label: 'Owner Account (مالک کھاتہ)', iconType: 'owner' },
      other: { online: 0, inStore: 0, total: 0, label: 'Other Accounts (دیگر)', iconType: 'other' }
    };

    const staffBreakdown: Record<string, StaffSaleBreakdown> = {};

    const now = new Date();
    const todayStart = startOfDay(now).getTime();
    const todayEnd = endOfDay(now).getTime();

    // Iterate through all sale items within date & branch filter (ignoring saleTypeSubFilter so comparison cards are always accurate)
    const baseItems = combinedItems.filter(item => {
      const itemBranch = item.branchId || (branches[0]?.id || 'main');
      if (itemBranch !== currentBranchId) return false;
      // SIMPLE FORMULA: Must be a sale bill (Online or In-Store)
      const isSale = item.saleType === 'Online' || item.saleType === 'In-Store' || item.isOnlineBill === true || item.isInStoreBill === true;
      if (!isSale) return false;
      return isItemWithinDate(item.date);
    });

    baseItems.forEach(item => {
      const recAmt = Number(item.amount) || 0;
      const billVal = Number(item.billTotal) || recAmt;
      const bal = Number(item.balance) || 0;
      
      // SIMPLE FORMULA: strictly check saleType
      const isOnline = item.saleType === 'Online' || item.isOnlineBill === true;
      const isInStore = (item.saleType === 'In-Store' || item.isInStoreBill === true) && !isOnline;

      // Only count sale bills
      if (!isOnline && !isInStore) return;
      const isToday = item.date >= todayStart && item.date <= todayEnd;

      const acc = (item.accountHead || item.paymentMode || '').toLowerCase();
      let accKey = 'other';
      if (acc.includes('meezan')) accKey = 'meezan';
      else if (acc.includes('jazzcash')) accKey = 'jazzCash';
      else if (acc.includes('easypaisa')) accKey = 'easyPaisa';
      else if (acc.includes('ubl')) accKey = 'ubl';
      else if (acc.includes('cash')) accKey = 'cash';
      else if (acc.includes('owner')) accKey = 'ownerAcc';

      // Staff tracking
      const staffName = item.onlineEmployeeName || item.handledBy || 'Counter Cashier';
      const staffCode = item.onlineEmployeeCode || '';
      if (!staffBreakdown[staffName]) {
        staffBreakdown[staffName] = { online: 0, inStore: 0, total: 0, count: 0, code: staffCode };
      }
      if (staffCode && !staffBreakdown[staffName].code) {
        staffBreakdown[staffName].code = staffCode;
      }

      if (isOnline) {
        onlineTotalReceived += recAmt;
        onlineBillsCount += 1;
        onlineTotalBillValue += billVal;
        if (bal > 0 && !item.codCashReceived) {
          onlinePendingCOD += bal;
        }
        if (isToday) {
          onlineTodayReceived += recAmt;
        }
        accountBreakdown[accKey].online += recAmt;
        staffBreakdown[staffName].online += recAmt;
      } else {
        inStoreTotalReceived += recAmt;
        inStoreBillsCount += 1;
        inStoreTotalBillValue += billVal;
        if (bal > 0) {
          inStorePendingBalance += bal;
        }
        if (isToday) {
          inStoreTodayReceived += recAmt;
        }
        accountBreakdown[accKey].inStore += recAmt;
        staffBreakdown[staffName].inStore += recAmt;
      }
      accountBreakdown[accKey].total += recAmt;
      staffBreakdown[staffName].total += recAmt;
      staffBreakdown[staffName].count += 1;
    });

    const grandTotalReceived = onlineTotalReceived + inStoreTotalReceived;
    const grandTotalBills = onlineBillsCount + inStoreBillsCount;
    const grandTotalBillValue = onlineTotalBillValue + inStoreTotalBillValue;
    const onlinePct = grandTotalReceived > 0 ? (onlineTotalReceived / grandTotalReceived) * 100 : 0;
    const inStorePct = grandTotalReceived > 0 ? (inStoreTotalReceived / grandTotalReceived) * 100 : 0;

    return {
      onlineTotalReceived,
      onlineBillsCount,
      onlineTotalBillValue,
      onlinePendingCOD,
      onlineTodayReceived,
      inStoreTotalReceived,
      inStoreBillsCount,
      inStoreTotalBillValue,
      inStorePendingBalance,
      inStoreTodayReceived,
      grandTotalReceived,
      grandTotalBills,
      grandTotalBillValue,
      onlinePct,
      inStorePct,
      accountBreakdown,
      staffBreakdown
    };
  }, [combinedItems, currentBranchId, branches, dateFilter, startDate, endDate]);

  // Calculate High-level Summary Metrics
  const metrics = React.useMemo(() => {
    let totalCashGivenOut = 0; // Handover by hand
    let totalOnlineReceived = 0; // JazzCash, Meezan, UBL, EasyPaisa, etc.
    let totalSalesInOwnerAccount = 0; // Sales transferred
    let totalReceivedBackIn = 0; // Inflow from owner back to shop

    let meezanTotal = 0;
    let ublTotal = 0;
    let jazzCashTotal = 0;
    let easyPaisaTotal = 0;
    let cashTotal = 0;

    const now = new Date();
    const todayStart = startOfDay(now).getTime();
    const todayEnd = endOfDay(now).getTime();
    let todayGivenOut = 0;
    let todayOnlineRecv = 0;

    filteredList.forEach(item => {
      const amt = Number(item.amount) || 0;
      const acc = (item.accountHead || item.paymentMode || '').toLowerCase();

      if (acc.includes('meezan')) meezanTotal += amt;
      else if (acc.includes('ubl')) ublTotal += amt;
      else if (acc.includes('jazzcash')) jazzCashTotal += amt;
      else if (acc.includes('easypaisa')) easyPaisaTotal += amt;
      else if (acc.includes('cash')) cashTotal += amt;

      const isOnline = item.category === 'Online Received' || acc.includes('meezan') || acc.includes('ubl') || acc.includes('jazzcash') || acc.includes('easypaisa');

      if (item.category === 'Online Received' || isOnline) {
        totalOnlineReceived += amt;
        if (item.date >= todayStart && item.date <= todayEnd) {
          todayOnlineRecv += amt;
        }
      } else if (item.source === 'sale' || item.category === 'Sale Payment') {
        totalSalesInOwnerAccount += amt;
      } else if (item.type === 'OUT') {
        totalCashGivenOut += amt;
        if (item.date >= todayStart && item.date <= todayEnd) {
          todayGivenOut += amt;
        }
      } else if (item.type === 'IN') {
        totalReceivedBackIn += amt;
      }
    });

    // Total net balance currently with Owner (Cash Handed Over + Online In Owner Accounts + Sales - Received Back)
    const netOwnerBalance = (totalCashGivenOut + totalOnlineReceived + totalSalesInOwnerAccount) - totalReceivedBackIn;

    return {
      totalCashGivenOut,
      totalOnlineReceived,
      totalSalesInOwnerAccount,
      totalReceivedBackIn,
      netOwnerBalance,
      todayGivenOut,
      todayOnlineRecv,
      meezanTotal,
      ublTotal,
      jazzCashTotal,
      easyPaisaTotal,
      cashTotal
    };
  }, [filteredList]);

  // Memoized chronological list for statement printing with running balance
  const chronologicalList = React.useMemo(() => {
    // Sort oldest first for running balance calculation
    const sorted = [...filteredList].sort((a, b) => a.date - b.date);
    let running = 0;
    return sorted.map((item, index) => {
      const amt = Number(item.amount) || 0;
      const isOut = item.type === 'OUT' || item.category === 'Online Received' || item.category === 'Sale Payment' || item.source === 'sale';
      if (isOut) {
        running += amt;
      } else {
        running -= amt;
      }
      return {
        ...item,
        seqNo: index + 1,
        runningBalance: running
      };
    });
  }, [filteredList]);

  // Open Modal for Cash Handover
  const handleOpenCashHandover = () => {
    setEditTxId(null);
    setTxType('OUT');
    setTxCategory('Cash Handover');
    setAccountHead('Cash by Hand');
    setPaymentMode('Cash by Hand');
    setCustomAccountHead('');
    setTrxId('');
    setSenderName('');
    setTxAmount('');
    setTxDate(format(new Date(), "yyyy-MM-dd'T'HH:mm"));
    setOwnerName('Manzoor Ahmed (Owner)');
    setHandledBy(user?.name || 'Cashier');
    setDescription('');
    
    const d = new Date();
    const code = `OWN-CSH-${format(d, 'yyMMdd')}-${Math.floor(100 + Math.random() * 900)}`;
    setVoucherNo(code);
    setTargetBranchId(currentBranchId);
    setShowAddModal(true);
  };

  // Open Modal for Online Received (e.g. JazzCash, Meezan Bank, EasyPaisa)
  const handleOpenOnlineReceived = (defaultAccount = 'Meezan Bank') => {
    setEditTxId(null);
    setTxType('IN');
    setTxCategory('Online Received');
    setAccountHead(defaultAccount);
    setPaymentMode(defaultAccount);
    setCustomAccountHead('');
    setTrxId('');
    setSenderName('');
    setTxAmount('');
    setTxDate(format(new Date(), "yyyy-MM-dd'T'HH:mm"));
    setOwnerName('Manzoor Ahmed (Owner)');
    setHandledBy(user?.name || 'Cashier');
    setDescription('');

    const d = new Date();
    const code = `OWN-ONL-${format(d, 'yyMMdd')}-${Math.floor(100 + Math.random() * 900)}`;
    setVoucherNo(code);
    setTargetBranchId(currentBranchId);
    setShowAddModal(true);
  };

  // Handle Edit Click
  const handleEdit = (item: any) => {
    if (item.source === 'sale') {
      toast('This transaction is linked to a Sale Invoice. Please manage it from Sales / Invoices.', { icon: 'ℹ️' });
      return;
    }

    setEditTxId(item.id);
    setTxType(item.type);
    setTxCategory(item.category || (item.type === 'OUT' ? 'Cash Handover' : 'Owner Capital'));
    
    const isStandardAcc = ['Meezan Bank', 'UBL Bank', 'JazzCash', 'EasyPaisa', 'Owner Account', 'Cash by Hand'].includes(item.accountHead || item.paymentMode);
    if (isStandardAcc) {
      setAccountHead(item.accountHead || item.paymentMode || 'Meezan Bank');
      setCustomAccountHead('');
    } else {
      setAccountHead('custom');
      setCustomAccountHead(item.accountHead || item.paymentMode || '');
    }

    setPaymentMode(item.paymentMode || 'Meezan Bank');
    setTrxId(item.trxId || '');
    setSenderName(item.senderName || '');
    setTxAmount(item.amount);
    setTxDate(safeFormat(new Date(item.date), "yyyy-MM-dd'T'HH:mm"));
    setOwnerName(item.ownerName || 'Manzoor Ahmed (Owner)');
    setHandledBy(item.handledBy || user?.name || '');
    setDescription(item.description || '');
    setVoucherNo(item.voucherNo || '');
    setTargetBranchId(item.branchId || currentBranchId);
    setShowAddModal(true);
  };

  // Handle Save Transaction (Supports both Cash Handover and Online Received)
  const handleSaveTransaction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!txAmount || Number(txAmount) <= 0) {
      toast.error("Please enter a valid amount");
      return;
    }

    const branchToUse = targetBranchId || currentBranchId;
    setIsSubmitting(true);

    try {
      const timestamp = new Date(txDate).getTime();
      const numAmount = Number(txAmount);
      const prefix = txCategory === 'Online Received' ? 'OWN-ONL' : 'OWN-CSH';
      const generatedVoucher = voucherNo.trim() || `${prefix}-${safeFormat(new Date(timestamp), 'yyMMdd')}-${Math.floor(100 + Math.random() * 900)}`;
      
      const finalAccountHead = accountHead === 'custom' 
        ? (customAccountHead.trim() || 'Custom Account') 
        : accountHead;

      const finalPaymentMode = txCategory === 'Online Received' 
        ? finalAccountHead 
        : paymentMode;

      let defaultDesc = '';
      if (txCategory === 'Online Received') {
        defaultDesc = `Online Received into ${finalAccountHead}${trxId.trim() ? ` (Trx #${trxId.trim()})` : ''}${senderName.trim() ? ` - From: ${senderName.trim()}` : ''}`;
      } else if (txType === 'OUT') {
        defaultDesc = 'Cash handed over by hand to owner (مالک کو نقد کیش دیا گیا)';
      } else {
        defaultDesc = 'Cash received from owner into shop (مالک سے نقد کیش وصول ہوا)';
      }

      const finalDescription = description.trim() || defaultDesc;

      const dataToSave = {
        branchId: branchToUse,
        date: timestamp,
        type: txType,
        amount: numAmount,
        ownerName: ownerName.trim() || 'Manzoor Ahmed (Owner)',
        handledBy: handledBy.trim() || user?.name || 'Cashier',
        paymentMode: finalPaymentMode,
        category: txCategory,
        accountHead: finalAccountHead,
        trxId: trxId.trim() || undefined,
        senderName: senderName.trim() || undefined,
        description: finalDescription,
        voucherNo: generatedVoucher,
        tenantId: user?.tenantId || user?.uid,
        updatedAt: Timestamp.now()
      };

      if (editTxId) {
        // Update existing transaction
        await updateDoc(doc(db, 'ownerTransactions', editTxId), dataToSave);
        toast.success("Transaction updated successfully!");
      } else {
        // Create new transaction in ownerTransactions
        const newDocRef = await addDoc(collection(db, 'ownerTransactions'), {
          ...dataToSave,
          createdAt: Timestamp.now()
        });

        // Mirror directly to central ledger collection for financial integrity
        let ledgerCategory = 'Owner Withdrawal';
        if (txCategory === 'Online Received') {
          ledgerCategory = 'Online Received';
        } else if (txType === 'IN') {
          ledgerCategory = 'Owner Capital';
        }

        await addDoc(collection(db, 'ledger'), {
          branchId: branchToUse,
          date: timestamp,
          description: `${finalAccountHead} | ${finalDescription} (${ownerName.trim()})`,
          category: ledgerCategory,
          type: txType,
          amount: numAmount,
          reference: generatedVoucher,
          accountName: finalAccountHead,
          ownerName: ownerName.trim(),
          createdAt: Timestamp.now(),
          tenantId: user?.tenantId || user?.uid,
          ownerTxId: newDocRef.id
        });

        // Record Activity Log
        await recordActivityLog({
          action: 'create',
          category: 'Ledger',
          details: `${txCategory === 'Online Received' ? 'Online Received into ' + finalAccountHead : (txType === 'OUT' ? 'Handed Cash to Owner' : 'Received Cash from Owner')}: PKR ${numAmount.toLocaleString()} (${generatedVoucher})`,
          branchId: branchToUse,
          user
        });

        toast.success(
          txCategory === 'Online Received'
            ? `Online receipt into ${finalAccountHead} recorded!`
            : (txType === 'OUT' ? "Cash handover recorded successfully!" : "Cash receipt recorded successfully!")
        );
      }

      setShowAddModal(false);
    } catch (err: any) {
      console.error(err);
      toast.error("Failed to save transaction: " + err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle Delete
  const handleDelete = async (item: any) => {
    if (item.source === 'sale') {
      toast.error("This transaction belongs to a Sale Invoice and must be deleted from Sales.");
      return;
    }

    if (!confirm(`Are you sure you want to delete Voucher ${item.voucherNo} of PKR ${item.amount.toLocaleString()}?`)) {
      return;
    }

    try {
      await deleteDoc(doc(db, 'ownerTransactions', item.id));

      await recordActivityLog({
        action: 'delete',
        category: 'Ledger',
        details: `Deleted Owner Transaction ${item.voucherNo} (PKR ${item.amount.toLocaleString()})`,
        branchId: item.branchId,
        user
      });

      toast.success("Transaction deleted successfully");
    } catch (err: any) {
      console.error(err);
      toast.error("Failed to delete transaction: " + err.message);
    }
  };

  // Handle Print Single Voucher Slip
  const handlePrintVoucher = (item: any) => {
    setPrintTx(item);
    setVoucherPrintFormat('thermal');
  };

  return (
    <>
      {/* Main On-Screen UI - COMPLETELY HIDDEN ON PRINT */}
      <div className="space-y-5 print:hidden">
        {/* Header Banner */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl bg-amber-500/10 dark:bg-amber-500/20 text-amber-600 dark:text-amber-400 flex items-center justify-center">
                <Landmark className="w-6 h-6" />
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-xl font-black text-slate-900 dark:text-slate-100 uppercase tracking-tight">
                    {currentBranch?.name || 'Branch'} - Owner Account
                  </h1>
                  <span className="bg-amber-100 dark:bg-amber-950/80 text-amber-800 dark:text-amber-300 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider font-urdu">
                    {currentBranch?.name} کا کھاتہ
                  </span>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Manage Cash-by-Hand handovers, Online Payments (JazzCash, Meezan Bank, EasyPaisa), and Sales settlements for {currentBranch?.name}.
                </p>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex items-center gap-2 flex-wrap">
              {activeTab === 'sale_type_dashboard' ? (
                <button
                  onClick={() => setShowSaleTypeStatementPreview(true)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 text-xs font-bold transition shadow-sm cursor-pointer"
                  title="Print Sale Type Comparison Report (In-Store vs Online Delivery)"
                >
                  <Printer className="w-4 h-4 text-indigo-600" />
                  <span>Print Sale Type Report (پرنٹ سیل ٹائپ رپورٹ)</span>
                </button>
              ) : activeTab === 'online_bills' ? (
                <button
                  onClick={() => setShowOnlineStatementPreview(true)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-sky-200 dark:border-sky-800 bg-sky-50 dark:bg-sky-950/60 text-sky-700 dark:text-sky-300 hover:bg-sky-100 text-xs font-bold transition shadow-sm cursor-pointer"
                  title="Print dedicated Online Bills Received Payments Statement"
                >
                  <Printer className="w-4 h-4 text-sky-600" />
                  <span>Print Online Bills Report (پرنٹ آن لائن بلز رپورٹ)</span>
                </button>
              ) : (
                <button
                  onClick={() => setShowStatementPreview(true)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-750 text-xs font-bold transition shadow-sm hover:border-slate-300 cursor-pointer"
                  title="Print full statement with running balance"
                >
                  <Printer className="w-4 h-4 text-sky-600" />
                  <span>Print Statement (پرنٹ کھاتہ)</span>
                </button>
              )}

              {/* Online Received Button */}
              <button
                onClick={() => handleOpenOnlineReceived('Meezan Bank')}
                className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold transition shadow-md shadow-sky-600/20 active:scale-95 cursor-pointer"
              >
                <CreditCard className="w-4 h-4" />
                <span>+ Online Received (آن لائن وصولی)</span>
              </button>

              {/* Cash Handover Button */}
              <button
                onClick={handleOpenCashHandover}
                className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold transition shadow-md shadow-amber-600/20 active:scale-95 cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>+ Cash Handover (نقد کیش)</span>
              </button>
            </div>
          </div>
        </div>

        {/* Active Logged-In Branch (صرف لاگ ان برانچ - کوئی سلیکشن نہیں) */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-sm flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center font-bold">
              <Building2 className="w-5 h-5" />
            </div>
            <div>
              <div className="text-xs font-black uppercase text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <span>Branch Account:</span>
                <span className="text-sm font-black text-amber-600 dark:text-amber-400">
                  {currentBranch?.name || 'Main Branch'}
                </span>
                <span className="text-[10px] text-emerald-700 dark:text-emerald-300 font-urdu font-bold bg-emerald-50 dark:bg-emerald-950/60 px-2.5 py-0.5 rounded-full border border-emerald-200 dark:border-emerald-800 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                  لاگ ان برانچ کھاتہ
                </span>
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 font-urdu">
                صرف اس لاگ ان برانچ کا کیش ہینڈ اوور، آن لائن وصولی، اسٹور کاؤنٹر سیلز اور مالک کھاتہ ٹرانزیکشنز دکھائی جا رہی ہیں
              </div>
            </div>
          </div>
        </div>

        {/* Navigation Tabs Bar: Sale Type Dashboard, Online Bills, In-Store Bills, All Records, Cash Handover, Bank & Wallets */}
        <div className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-800 pb-2 overflow-x-auto">
          {/* TAB 1: Sale Type Dashboard */}
          <button
            onClick={() => { setActiveTab('sale_type_dashboard'); setSaleTypeSubFilter('all'); }}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-xs transition whitespace-nowrap cursor-pointer ${
              activeTab === 'sale_type_dashboard'
                ? 'bg-gradient-to-r from-indigo-600 to-sky-600 text-white shadow-md shadow-indigo-600/25 ring-2 ring-indigo-400/40'
                : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
            }`}
          >
            <BarChart3 className="w-4 h-4 text-indigo-200" />
            <span>Sale Type Dashboard (سیل ٹائپ ڈیش بورڈ)</span>
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold ${activeTab === 'sale_type_dashboard' ? 'bg-white text-indigo-900' : 'bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300'}`}>
              In-Store vs Online
            </span>
          </button>

          {/* TAB 2: Online Delivery Bills */}
          <button
            onClick={() => setActiveTab('online_bills')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-xs transition whitespace-nowrap cursor-pointer ${
              activeTab === 'online_bills'
                ? 'bg-sky-600 text-white shadow-md shadow-sky-600/25 ring-2 ring-sky-400/40'
                : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
            }`}
          >
            <Globe className="w-4 h-4 text-sky-300" />
            <span>Online Delivery Bills (آن لائن بلز)</span>
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold ${activeTab === 'online_bills' ? 'bg-white text-sky-800' : 'bg-sky-100 dark:bg-sky-950 text-sky-700 dark:text-sky-300'}`}>
              {onlineBillsList.length} Bills
            </span>
          </button>

          {/* TAB 3: In-Store Bills */}
          <button
            onClick={() => { setActiveTab('instore_bills'); }}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-xs transition whitespace-nowrap cursor-pointer ${
              activeTab === 'instore_bills'
                ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/25 ring-2 ring-emerald-400/40'
                : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
            }`}
          >
            <Store className="w-4 h-4 text-emerald-300" />
            <span>In-Store Bills (اسٹور بلز)</span>
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold ${activeTab === 'instore_bills' ? 'bg-white text-emerald-800' : 'bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300'}`}>
              {inStoreBillsList.length} Bills
            </span>
          </button>

          {/* TAB 4: All Transactions */}
          <button
            onClick={() => setActiveTab('all')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-xs transition whitespace-nowrap cursor-pointer ${
              activeTab === 'all'
                ? 'bg-amber-600 text-white shadow-md shadow-amber-600/20'
                : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
            }`}
          >
            <Landmark className="w-4 h-4" />
            <span>All Transactions (تمام کھاتے)</span>
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold ${activeTab === 'all' ? 'bg-black/20 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-600'}`}>
              {filteredList.length}
            </span>
          </button>

          {/* TAB 5: Cash Handover */}
          <button
            onClick={() => { setActiveTab('cash_handover'); setTypeFilter('OUT'); }}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-xs transition whitespace-nowrap cursor-pointer ${
              activeTab === 'cash_handover'
                ? 'bg-rose-600 text-white shadow-md shadow-rose-600/20'
                : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
            }`}
          >
            <Banknote className="w-4 h-4 text-rose-300" />
            <span>Cash Handover (نقد کیش)</span>
          </button>

          {/* TAB 6: Bank & Digital Wallets */}
          <button
            onClick={() => setActiveTab('bank_accounts')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-xs transition whitespace-nowrap cursor-pointer ${
              activeTab === 'bank_accounts'
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/20'
                : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
            }`}
          >
            <Building2 className="w-4 h-4 text-indigo-300" />
            <span>Bank & Digital Wallets (بینک کھاتے)</span>
          </button>
        </div>

        {/* ========================================================================= */}
        {/* VIEW 1: DEDICATED SALE TYPE DASHBOARD (آن لائن اور اِن اسٹور الگ الگ ڈیش بورڈ) */}
        {/* ========================================================================= */}
        {activeTab === 'sale_type_dashboard' ? (
          <div className="space-y-5">
            {/* Top 3 Executive Overview Cards: Online vs In-Store vs Combined Distribution */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Card 1: Online Delivery Bills */}
              <div className="bg-gradient-to-br from-sky-500/10 via-sky-500/5 to-white dark:to-slate-900 border-2 border-sky-300 dark:border-sky-800 rounded-2xl p-4 shadow-sm relative overflow-hidden">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-xl bg-sky-500 text-white flex items-center justify-center shadow-xs">
                      <Globe className="w-4 h-4" />
                    </div>
                    <div>
                      <span className="text-xs font-black uppercase tracking-wider text-sky-900 dark:text-sky-200">
                        Online Delivery Bills
                      </span>
                      <div className="text-[10px] text-sky-700 dark:text-sky-400 font-urdu font-bold">آن لائن ڈیلیوری بلز وصولی</div>
                    </div>
                  </div>
                  <span className="px-2.5 py-1 rounded-full text-[11px] font-mono font-bold bg-sky-100 dark:bg-sky-950 text-sky-800 dark:text-sky-300 border border-sky-200 dark:border-sky-800">
                    {saleTypeMetrics.onlineBillsCount} Orders
                  </span>
                </div>

                <div className="text-2xl font-black text-sky-700 dark:text-sky-300 mt-3 font-mono">
                  PKR {saleTypeMetrics.onlineTotalReceived.toLocaleString()}
                </div>

                <div className="grid grid-cols-2 gap-2 mt-3 pt-3 border-t border-sky-200 dark:border-sky-800/60 text-[11px]">
                  <div>
                    <span className="text-slate-500 text-[10px] block">Total Order Value:</span>
                    <span className="font-mono font-bold text-slate-800 dark:text-slate-200">
                      PKR {saleTypeMetrics.onlineTotalBillValue.toLocaleString()}
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="text-slate-500 text-[10px] block">Pending COD / Bal:</span>
                    <span className="font-mono font-bold text-amber-600 dark:text-amber-400">
                      PKR {saleTypeMetrics.onlinePendingCOD.toLocaleString()}
                    </span>
                  </div>
                </div>

                <div className="mt-2 pt-2 border-t border-sky-100 dark:border-sky-900/40 flex items-center justify-between text-[10px] text-slate-500">
                  <span className="font-urdu">آج کی آن لائن وصولی</span>
                  <span className="font-mono font-bold text-sky-600">Today: PKR {saleTypeMetrics.onlineTodayReceived.toLocaleString()}</span>
                </div>
              </div>

              {/* Card 2: In-Store Counter Bills */}
              <div className="bg-gradient-to-br from-emerald-500/10 via-emerald-500/5 to-white dark:to-slate-900 border-2 border-emerald-300 dark:border-emerald-800 rounded-2xl p-4 shadow-sm relative overflow-hidden">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-xl bg-emerald-600 text-white flex items-center justify-center shadow-xs">
                      <Store className="w-4 h-4" />
                    </div>
                    <div>
                      <span className="text-xs font-black uppercase tracking-wider text-emerald-900 dark:text-emerald-200">
                        In-Store Counter Bills
                      </span>
                      <div className="text-[10px] text-emerald-700 dark:text-emerald-400 font-urdu font-bold">اسٹور کاؤنٹر سیل بلز وصولی</div>
                    </div>
                  </div>
                  <span className="px-2.5 py-1 rounded-full text-[11px] font-mono font-bold bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                    {saleTypeMetrics.inStoreBillsCount} Bills
                  </span>
                </div>

                <div className="text-2xl font-black text-emerald-700 dark:text-emerald-300 mt-3 font-mono">
                  PKR {saleTypeMetrics.inStoreTotalReceived.toLocaleString()}
                </div>

                <div className="grid grid-cols-2 gap-2 mt-3 pt-3 border-t border-emerald-200 dark:border-emerald-800/60 text-[11px]">
                  <div>
                    <span className="text-slate-500 text-[10px] block">Total Sales Value:</span>
                    <span className="font-mono font-bold text-slate-800 dark:text-slate-200">
                      PKR {saleTypeMetrics.inStoreTotalBillValue.toLocaleString()}
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="text-slate-500 text-[10px] block">Pending Balance:</span>
                    <span className="font-mono font-bold text-amber-600 dark:text-amber-400">
                      PKR {saleTypeMetrics.inStorePendingBalance.toLocaleString()}
                    </span>
                  </div>
                </div>

                <div className="mt-2 pt-2 border-t border-emerald-100 dark:border-emerald-900/40 flex items-center justify-between text-[10px] text-slate-500">
                  <span className="font-urdu">آج کی کاؤنٹر وصولی</span>
                  <span className="font-mono font-bold text-emerald-600">Today: PKR {saleTypeMetrics.inStoreTodayReceived.toLocaleString()}</span>
                </div>
              </div>

              {/* Card 3: Combined Total & Ratio Distribution */}
              <div className="bg-gradient-to-br from-indigo-500/10 via-indigo-500/5 to-white dark:to-slate-900 border-2 border-indigo-300 dark:border-indigo-800 rounded-2xl p-4 shadow-sm relative overflow-hidden">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-xl bg-indigo-600 text-white flex items-center justify-center shadow-xs">
                      <BarChart3 className="w-4 h-4" />
                    </div>
                    <div>
                      <span className="text-xs font-black uppercase tracking-wider text-indigo-900 dark:text-indigo-200">
                        Combined Total Collection
                      </span>
                      <div className="text-[10px] text-indigo-700 dark:text-indigo-400 font-urdu font-bold">مجموعی کل سیلز وصولی</div>
                    </div>
                  </div>
                  <span className="px-2.5 py-1 rounded-full text-[11px] font-mono font-bold bg-indigo-100 dark:bg-indigo-950 text-indigo-800 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
                    {saleTypeMetrics.grandTotalBills} Total Bills
                  </span>
                </div>

                <div className="text-2xl font-black text-indigo-700 dark:text-indigo-300 mt-3 font-mono">
                  PKR {saleTypeMetrics.grandTotalReceived.toLocaleString()}
                </div>

                {/* Dual Color Progress Bar */}
                <div className="mt-3 pt-3 border-t border-indigo-200 dark:border-indigo-800/60">
                  <div className="flex justify-between items-center text-[10px] font-bold mb-1.5">
                    <span className="text-sky-700 dark:text-sky-300 flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-sky-500"></span>
                      Online: {saleTypeMetrics.onlinePct.toFixed(1)}%
                    </span>
                    <span className="text-emerald-700 dark:text-emerald-300 flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                      In-Store: {saleTypeMetrics.inStorePct.toFixed(1)}%
                    </span>
                  </div>
                  <div className="h-3 w-full bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden flex">
                    <div 
                      style={{ width: `${saleTypeMetrics.onlinePct}%` }} 
                      className="bg-sky-500 h-full transition-all duration-500"
                      title={`Online Delivery: ${saleTypeMetrics.onlinePct.toFixed(1)}%`}
                    />
                    <div 
                      style={{ width: `${saleTypeMetrics.inStorePct}%` }} 
                      className="bg-emerald-500 h-full transition-all duration-500"
                      title={`In-Store Sales: ${saleTypeMetrics.inStorePct.toFixed(1)}%`}
                    />
                  </div>
                </div>

                <div className="mt-2 pt-2 border-t border-indigo-100 dark:border-indigo-900/40 flex items-center justify-between text-[10px] text-slate-500">
                  <span className="font-urdu">کل بلز آرڈر ویلیو</span>
                  <span className="font-mono font-bold text-slate-700 dark:text-slate-300">
                    PKR {saleTypeMetrics.grandTotalBillValue.toLocaleString()}
                  </span>
                </div>
              </div>
            </div>

            {/* ========================================================================= */}
            {/* ⭐ SAME ACCOUNT - SEPARATE BREAKDOWN GRID                                   */}
            {/* (چاہے ایک ہی اکاؤنٹ میں موصول ہو، مگر آن لائن اور اِن اسٹور الگ الگ دکھے)    */}
            {/* ========================================================================= */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-sm">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pb-3 mb-3 border-b border-slate-200 dark:border-slate-800">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-amber-500/10 text-amber-600 flex items-center justify-center">
                    <ArrowRightLeft className="w-4 h-4" />
                  </div>
                  <div>
                    <h2 className="text-sm font-black text-slate-900 dark:text-slate-100 uppercase tracking-tight flex items-center gap-2">
                      <span>Same Account - Separate Online & In-Store Breakdown</span>
                      <span className="text-[10px] font-urdu font-bold text-amber-600 bg-amber-50 dark:bg-amber-950/60 px-2 py-0.5 rounded-full border border-amber-200 dark:border-amber-800">
                        ہر اکاؤنٹ میں آن لائن اور اِن اسٹور الگ الگ رقم
                      </span>
                    </h2>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 font-urdu mt-0.5">
                      چاہے ایک ہی بینک (مثلاً میزان بینک یا جاز کیش) میں دونوں طرح کی پیمنٹس آئی ہوں، یہاں ہر اکاؤنٹ کی آن لائن ڈیلیوری اور اِن اسٹور کاؤنٹر رقم بالکل الگ الگ اور درست دکھائی گئی ہے
                    </p>
                  </div>
                </div>
              </div>

              {/* Grid of Accounts showing Online vs In-Store Side by Side */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
                {(Object.entries(saleTypeMetrics.accountBreakdown) as [string, AccountSaleBreakdown][])
                  .filter(([k, data]) => k !== 'other' || data.total > 0)
                  .map(([key, data]) => {
                    const onlineRatio = data.total > 0 ? (data.online / data.total) * 100 : 0;
                    const inStoreRatio = data.total > 0 ? (data.inStore / data.total) * 100 : 0;

                    return (
                      <div 
                        key={key} 
                        className={`border rounded-xl p-3 transition hover:shadow-md cursor-pointer ${
                          accountFilter.toLowerCase().includes(key.toLowerCase())
                            ? 'border-indigo-500 bg-indigo-50/40 dark:bg-indigo-950/40 ring-2 ring-indigo-400/40'
                            : 'border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-850 hover:border-slate-300'
                        }`}
                        onClick={() => {
                          if (key === 'meezan') setAccountFilter(accountFilter === 'Meezan Bank' ? 'all' : 'Meezan Bank');
                          else if (key === 'jazzCash') setAccountFilter(accountFilter === 'JazzCash' ? 'all' : 'JazzCash');
                          else if (key === 'easyPaisa') setAccountFilter(accountFilter === 'EasyPaisa' ? 'all' : 'EasyPaisa');
                          else if (key === 'ubl') setAccountFilter(accountFilter === 'UBL Bank' ? 'all' : 'UBL Bank');
                          else if (key === 'cash') setAccountFilter(accountFilter === 'Cash by Hand' ? 'all' : 'Cash by Hand');
                          else if (key === 'ownerAcc') setAccountFilter(accountFilter === 'Owner Account' ? 'all' : 'Owner Account');
                        }}
                        title={`Click to filter list by ${data.label}`}
                      >
                        {/* Account Name Header */}
                        <div className="flex items-center justify-between pb-2 border-b border-slate-200 dark:border-slate-700/60">
                          <span className="text-xs font-black text-slate-800 dark:text-slate-100 flex items-center gap-1.5 truncate">
                            {data.iconType === 'bank' ? (
                              <Building2 className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                            ) : data.iconType === 'mobile' ? (
                              <Smartphone className="w-3.5 h-3.5 text-orange-600 shrink-0" />
                            ) : data.iconType === 'wallet' ? (
                              <CreditCard className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                            ) : data.iconType === 'cash' ? (
                              <Banknote className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                            ) : (
                              <Landmark className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                            )}
                            <span className="truncate">{data.label.split(' ')[0]}</span>
                          </span>
                          <span className="text-[10px] font-urdu text-slate-500 font-bold shrink-0">
                            {data.label.includes('میزان') ? 'میزان' : data.label.includes('جاز') ? 'جاز کیش' : data.label.includes('ایزی') ? 'ایزی پیسہ' : data.label.includes('یو بی ایل') ? 'یو بی ایل' : data.label.includes('نقد') ? 'نقد' : 'کھاتہ'}
                          </span>
                        </div>

                        {/* Combined Account Total */}
                        <div className="mt-2">
                          <span className="text-[9px] font-bold text-slate-500 uppercase tracking-wider block">Total In Account:</span>
                          <div className="text-base font-black font-mono text-slate-900 dark:text-slate-100">
                            PKR {data.total.toLocaleString()}
                          </div>
                        </div>

                        {/* Separate Online vs In-Store rows */}
                        <div className="mt-2.5 pt-2 border-t border-slate-200 dark:border-slate-700/60 space-y-1.5 text-[11px]">
                          {/* Row 1: Online Delivery Portion */}
                          <div className="flex items-center justify-between bg-sky-50 dark:bg-sky-950/50 px-2 py-1 rounded border border-sky-100 dark:border-sky-900/40">
                            <span className="text-[10px] font-bold text-sky-800 dark:text-sky-300 flex items-center gap-1">
                              <span>🚚 Online:</span>
                            </span>
                            <span className="font-mono font-black text-sky-700 dark:text-sky-300 text-xs">
                              PKR {data.online.toLocaleString()}
                            </span>
                          </div>

                          {/* Row 2: In-Store Counter Portion */}
                          <div className="flex items-center justify-between bg-emerald-50 dark:bg-emerald-950/50 px-2 py-1 rounded border border-emerald-100 dark:border-emerald-900/40">
                            <span className="text-[10px] font-bold text-emerald-800 dark:text-emerald-300 flex items-center gap-1">
                              <span>🏪 In-Store:</span>
                            </span>
                            <span className="font-mono font-black text-emerald-700 dark:text-emerald-300 text-xs">
                              PKR {data.inStore.toLocaleString()}
                            </span>
                          </div>
                        </div>

                        {/* Mini Comparison Bar for this Account */}
                        {data.total > 0 && (
                          <div className="mt-2 pt-1">
                            <div className="h-1.5 w-full bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden flex">
                              <div style={{ width: `${onlineRatio}%` }} className="bg-sky-500 h-full" />
                              <div style={{ width: `${inStoreRatio}%` }} className="bg-emerald-500 h-full" />
                            </div>
                            <div className="flex justify-between items-center text-[8px] font-mono text-slate-500 mt-0.5">
                              <span>Onl: {onlineRatio.toFixed(0)}%</span>
                              <span>Store: {inStoreRatio.toFixed(0)}%</span>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
              </div>
            </div>

            {/* Staff & Sales Representative Collection Audit Card */}
            {Object.keys(saleTypeMetrics.staffBreakdown).length > 0 && (
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-sm">
                <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-200 dark:border-slate-800">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-indigo-500/10 text-indigo-600 flex items-center justify-center font-bold">
                      <Hash className="w-4 h-4" />
                    </div>
                    <div>
                      <h3 className="text-sm font-black text-slate-900 dark:text-slate-100 uppercase tracking-tight">
                        Staff & Sales Representative Collection Audit
                      </h3>
                      <div className="text-[11px] text-slate-500 font-urdu font-semibold">
                        ہر آن لائن نمائندے اور کاؤنٹر سیلزمین کی برانچ وار وصولی
                      </div>
                    </div>
                  </div>
                  <span className="text-xs font-mono font-bold bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 px-2.5 py-1 rounded-full border border-indigo-200 dark:border-indigo-800">
                    {Object.keys(saleTypeMetrics.staffBreakdown).length} Staff Reps
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  {(Object.entries(saleTypeMetrics.staffBreakdown) as [string, StaffSaleBreakdown][])
                    .sort((a, b) => b[1].total - a[1].total)
                    .map(([sName, sData], sIdx) => {
                      const sharePct = saleTypeMetrics.grandTotalReceived > 0 ? (sData.total / saleTypeMetrics.grandTotalReceived) * 100 : 0;
                      return (
                        <div key={sIdx} className="bg-slate-50/70 dark:bg-slate-850 border border-slate-200 dark:border-slate-800 rounded-xl p-3">
                          <div className="flex items-center justify-between pb-1.5 border-b border-slate-200 dark:border-slate-700">
                            <div>
                              <span className="text-xs font-black text-slate-800 dark:text-slate-100 block">
                                {sName}
                              </span>
                              {sData.code && (
                                <span className="text-[10px] font-mono text-sky-600 dark:text-sky-400 font-bold block">
                                  Code: {sData.code}
                                </span>
                              )}
                            </div>
                            <span className="text-[10px] font-mono font-bold bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 px-2 py-0.5 rounded">
                              {sData.count} Bills
                            </span>
                          </div>

                          <div className="mt-2 text-sm font-black font-mono text-slate-900 dark:text-slate-100">
                            PKR {sData.total.toLocaleString()}
                          </div>

                          <div className="mt-2 pt-2 border-t border-slate-200 dark:border-slate-700/60 space-y-1 text-[10px]">
                            <div className="flex justify-between items-center text-sky-700 dark:text-sky-300">
                              <span>🚚 Online:</span>
                              <span className="font-mono font-bold">PKR {sData.online.toLocaleString()}</span>
                            </div>
                            <div className="flex justify-between items-center text-emerald-700 dark:text-emerald-300">
                              <span>🏪 In-Store:</span>
                              <span className="font-mono font-bold">PKR {sData.inStore.toLocaleString()}</span>
                            </div>
                          </div>

                          <div className="mt-2 text-[9px] font-mono text-slate-500 text-right">
                            Share: {sharePct.toFixed(1)}%
                          </div>
                        </div>
                      );
                    })}
                </div>
              </div>
            )}

            {/* Filter Toolbar: Sale Type Sub-filters, Account Head, Date Filter, and Search */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-sm space-y-3">
              <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
                {/* Sub-Filter: All vs Online Only vs In-Store Only */}
                <div className="flex items-center gap-2 overflow-x-auto pb-1">
                  <span className="text-xs font-bold uppercase text-slate-500 shrink-0">Sale Filter:</span>
                  <button
                    onClick={() => setSaleTypeSubFilter('all')}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition shrink-0 cursor-pointer ${
                      saleTypeSubFilter === 'all'
                        ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900 shadow-sm'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200'
                    }`}
                  >
                    <span>All Sale Bills (تمام بلز)</span>
                    <span className="px-1.5 py-0.2 rounded-full text-[10px] font-mono bg-black/10 dark:bg-white/20">
                      {saleTypeMetrics.grandTotalBills}
                    </span>
                  </button>

                  <button
                    onClick={() => setSaleTypeSubFilter('Online')}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition shrink-0 cursor-pointer ${
                      saleTypeSubFilter === 'Online'
                        ? 'bg-sky-600 text-white shadow-sm ring-2 ring-sky-400/40'
                        : 'bg-sky-50 dark:bg-sky-950/60 text-sky-700 dark:text-sky-300 hover:bg-sky-100 border border-sky-200 dark:border-sky-800'
                    }`}
                  >
                    <Globe className="w-3.5 h-3.5" />
                    <span>🚚 Online Delivery Only (صرف آن لائن)</span>
                    <span className="px-1.5 py-0.2 rounded-full text-[10px] font-mono bg-white/20">
                      {saleTypeMetrics.onlineBillsCount}
                    </span>
                  </button>

                  <button
                    onClick={() => setSaleTypeSubFilter('In-Store')}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition shrink-0 cursor-pointer ${
                      saleTypeSubFilter === 'In-Store'
                        ? 'bg-emerald-600 text-white shadow-sm ring-2 ring-emerald-400/40'
                        : 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 border border-emerald-200 dark:border-emerald-800'
                    }`}
                  >
                    <Store className="w-3.5 h-3.5" />
                    <span>🏪 In-Store Only (صرف اسٹور کاؤنٹر)</span>
                    <span className="px-1.5 py-0.2 rounded-full text-[10px] font-mono bg-white/20">
                      {saleTypeMetrics.inStoreBillsCount}
                    </span>
                  </button>
                </div>

                {/* Date Filter selector */}
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs font-bold text-slate-500 uppercase">Period:</span>
                  <select
                    value={dateFilter}
                    onChange={(e: any) => setDateFilter(e.target.value)}
                    className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-bold text-slate-700 dark:text-slate-200 cursor-pointer"
                  >
                    <option value="today">Today (آج)</option>
                    <option value="yesterday">Yesterday (گزشتہ روز)</option>
                    <option value="week">This Week (موجودہ ہفتہ)</option>
                    <option value="month">This Month (موجودہ مہینہ)</option>
                    <option value="custom">Custom Range (تاریخ منتخب کریں)</option>
                    <option value="all">All Time (تمام ریکارڈ)</option>
                  </select>

                  {dateFilter === 'custom' && (
                    <div className="flex items-center gap-1.5">
                      <input
                        type="date"
                        value={startDate}
                        onChange={(e) => setStartDate(e.target.value)}
                        className="px-2 py-1 rounded border border-slate-200 dark:border-slate-700 text-xs font-mono bg-white dark:bg-slate-800"
                      />
                      <span className="text-xs text-slate-400">to</span>
                      <input
                        type="date"
                        value={endDate}
                        onChange={(e) => setEndDate(e.target.value)}
                        className="px-2 py-1 rounded border border-slate-200 dark:border-slate-700 text-xs font-mono bg-white dark:bg-slate-800"
                      />
                    </div>
                  )}
                </div>
              </div>

              {/* Account Quick Heads and Search Bar */}
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pt-2 border-t border-slate-100 dark:border-slate-800">
                <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs font-semibold">
                  <span className="text-slate-400 text-[10px] uppercase font-bold shrink-0">Account:</span>
                  <button
                    onClick={() => setAccountFilter('all')}
                    className={`px-2.5 py-1 rounded-md text-[11px] font-bold transition shrink-0 cursor-pointer ${
                      accountFilter === 'all'
                        ? 'bg-indigo-600 text-white'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200'
                    }`}
                  >
                    All Accounts
                  </button>
                  <button
                    onClick={() => setAccountFilter('Meezan Bank')}
                    className={`px-2.5 py-1 rounded-md text-[11px] font-bold transition shrink-0 cursor-pointer ${
                      accountFilter === 'Meezan Bank'
                        ? 'bg-blue-600 text-white'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200'
                    }`}
                  >
                    Meezan Bank
                  </button>
                  <button
                    onClick={() => setAccountFilter('JazzCash')}
                    className={`px-2.5 py-1 rounded-md text-[11px] font-bold transition shrink-0 cursor-pointer ${
                      accountFilter === 'JazzCash'
                        ? 'bg-orange-600 text-white'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200'
                    }`}
                  >
                    JazzCash
                  </button>
                  <button
                    onClick={() => setAccountFilter('EasyPaisa')}
                    className={`px-2.5 py-1 rounded-md text-[11px] font-bold transition shrink-0 cursor-pointer ${
                      accountFilter === 'EasyPaisa'
                        ? 'bg-emerald-600 text-white'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200'
                    }`}
                  >
                    EasyPaisa
                  </button>
                  <button
                    onClick={() => setAccountFilter('UBL Bank')}
                    className={`px-2.5 py-1 rounded-md text-[11px] font-bold transition shrink-0 cursor-pointer ${
                      accountFilter === 'UBL Bank'
                        ? 'bg-indigo-600 text-white'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200'
                    }`}
                  >
                    UBL Bank
                  </button>
                  <button
                    onClick={() => setAccountFilter('Cash by Hand')}
                    className={`px-2.5 py-1 rounded-md text-[11px] font-bold transition shrink-0 cursor-pointer ${
                      accountFilter === 'Cash by Hand'
                        ? 'bg-rose-600 text-white'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200'
                    }`}
                  >
                    Cash by Hand
                  </button>
                </div>

                {/* Search Bar */}
                <div className="relative w-full md:w-72 shrink-0">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search Inv #, Customer, Phone, Staff..."
                    className="w-full pl-9 pr-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                  {searchQuery && (
                    <button 
                      onClick={() => setSearchQuery('')}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs"
                    >
                      ✕
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Comprehensive Sale Type Transactions Table */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-850">
                <div className="flex items-center gap-2">
                  <Layers className="w-4 h-4 text-indigo-600" />
                  <span className="font-black text-xs uppercase tracking-wider text-slate-800 dark:text-slate-200">
                    Detailed Sales Itemized Ledger ({saleBillsList.length} Records)
                  </span>
                </div>
                <div className="text-[11px] text-slate-500 font-urdu font-semibold">
                  آن لائن ڈیلیوری اور کاؤنٹر سیلز کی مکمل فہرست
                </div>
              </div>

              {saleBillsList.length === 0 ? (
                <div className="p-10 text-center text-slate-500 space-y-2">
                  <div className="w-12 h-12 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center mx-auto text-slate-400">
                    <Receipt className="w-6 h-6" />
                  </div>
                  <div className="text-sm font-bold">No sale transactions found</div>
                  <p className="text-xs text-slate-400 font-urdu">
                    منتخب تاریخ یا فلٹر کے مطابق کوئی سیلز بل نہیں ملا
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 text-[10px] font-black uppercase tracking-wider text-slate-600 dark:text-slate-300">
                        <th className="py-3 px-3 text-center w-8">#</th>
                        <th className="py-3 px-3">Sale Type (ٹائپ)</th>
                        <th className="py-3 px-3">Invoice # / Slip</th>
                        <th className="py-3 px-3">Date & Time</th>
                        <th className="py-3 px-3">Customer / City</th>
                        <th className="py-3 px-3">Staff / Handled</th>
                        <th className="py-3 px-3">Account Head</th>
                        <th className="py-3 px-3">Trx ID / Courier</th>
                        <th className="py-3 px-3 text-right">Bill Value</th>
                        <th className="py-3 px-4 text-right">Received (وصولی)</th>
                        <th className="py-3 px-3 text-right">Balance / COD</th>
                        <th className="py-3 px-3 text-center w-16">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {saleBillsList.map((item, idx) => {
                        const isOnline = item.isOnlineBill || item.saleType === 'Online';
                        const recAmt = Number(item.amount) || 0;
                        const billTot = Number(item.billTotal) || recAmt;
                        const bal = Number(item.balance) || 0;
                        const accName = item.accountHead || item.paymentMode || 'Cash by Hand';

                        return (
                          <tr 
                            key={item.id || idx} 
                            className={`transition hover:bg-slate-50/80 dark:hover:bg-slate-800/40 ${
                              isOnline ? 'bg-sky-50/20 dark:bg-sky-950/10' : ''
                            }`}
                          >
                            <td className="py-3 px-3 text-center font-mono text-slate-400 text-[11px]">
                              {idx + 1}
                            </td>

                            {/* Sale Type Badge: Online Delivery vs In-Store Counter */}
                            <td className="py-3 px-3 whitespace-nowrap">
                              {isOnline ? (
                                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-black bg-sky-100 dark:bg-sky-950/80 text-sky-800 dark:text-sky-300 border border-sky-300 dark:border-sky-800 shadow-2xs">
                                  <Globe className="w-3 h-3 text-sky-600" />
                                  <span>🚚 Online Delivery</span>
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-black bg-emerald-100 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800 shadow-2xs">
                                  <Store className="w-3 h-3 text-emerald-600" />
                                  <span>🏪 In-Store Sale</span>
                                </span>
                              )}
                            </td>

                            {/* Invoice # */}
                            <td className="py-3 px-3 whitespace-nowrap">
                              <span className="font-mono font-bold text-slate-900 dark:text-slate-100">
                                {item.saleInvoiceNo ? `#${item.saleInvoiceNo}` : item.voucherNo}
                              </span>
                            </td>

                            {/* Date */}
                            <td className="py-3 px-3 whitespace-nowrap text-slate-600 dark:text-slate-400 font-mono text-[11px]">
                              <div>{safeFormat(item.date, 'dd/MM/yyyy')}</div>
                              <div className="text-[10px] text-slate-400">{safeFormat(item.date, 'hh:mm a')}</div>
                            </td>

                            {/* Customer */}
                            <td className="py-3 px-3 text-slate-800 dark:text-slate-200">
                              <div className="font-bold">{item.customerName || (isOnline ? 'Online Customer' : 'Walk-in')}</div>
                              {item.customerPhone && (
                                <div className="text-[10px] text-slate-500 font-mono">{item.customerPhone}</div>
                              )}
                              {item.shippingAddress && (
                                <div className="text-[9px] text-slate-400 truncate max-w-[140px]" title={item.shippingAddress}>
                                  📍 {item.shippingAddress}
                                </div>
                              )}
                            </td>

                            {/* Staff */}
                            <td className="py-3 px-3 whitespace-nowrap text-slate-700 dark:text-slate-300">
                              <div className="font-semibold">{item.onlineEmployeeName || item.handledBy || '-'}</div>
                              {item.onlineEmployeeCode && (
                                <div className="text-[10px] text-indigo-600 font-mono">{item.onlineEmployeeCode}</div>
                              )}
                            </td>

                            {/* Account Head */}
                            <td className="py-3 px-3 whitespace-nowrap">
                              {accName.includes('Meezan') ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                                  <Building2 className="w-3 h-3" />
                                  <span>Meezan Bank</span>
                                </span>
                              ) : accName.includes('JazzCash') ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold bg-orange-50 dark:bg-orange-950/40 text-orange-700 dark:text-orange-300 border border-orange-200 dark:border-orange-800">
                                  <Smartphone className="w-3 h-3" />
                                  <span>JazzCash</span>
                                </span>
                              ) : accName.includes('EasyPaisa') ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                                  <CreditCard className="w-3 h-3" />
                                  <span>EasyPaisa</span>
                                </span>
                              ) : accName.includes('UBL') ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
                                  <Building2 className="w-3 h-3" />
                                  <span>UBL Bank</span>
                                </span>
                              ) : accName.includes('Cash') ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800">
                                  <Banknote className="w-3 h-3" />
                                  <span>Cash by Hand</span>
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                                  <CreditCard className="w-3 h-3" />
                                  <span>{accName}</span>
                                </span>
                              )}
                            </td>

                            {/* Trx ID / Courier */}
                            <td className="py-3 px-3 whitespace-nowrap font-mono text-[11px]">
                              {item.trxId ? (
                                <span className="bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded text-[10px] font-bold text-sky-600 dark:text-sky-400 border border-slate-200 dark:border-slate-700">
                                  {item.trxId}
                                </span>
                              ) : item.courier ? (
                                <span className="text-slate-500 text-[10px]">🚚 {item.courier}</span>
                              ) : (
                                <span className="text-slate-400 text-[10px]">-</span>
                              )}
                            </td>

                            {/* Bill Value */}
                            <td className="py-3 px-3 whitespace-nowrap text-right font-mono font-semibold text-slate-700 dark:text-slate-300">
                              PKR {billTot.toLocaleString()}
                            </td>

                            {/* Received Payment */}
                            <td className="py-3 px-4 whitespace-nowrap text-right font-mono font-black text-sm bg-emerald-50/50 dark:bg-emerald-950/20">
                              <span className="text-emerald-600 dark:text-emerald-400">
                                PKR {recAmt.toLocaleString()}
                              </span>
                            </td>

                            {/* Balance / Pending COD */}
                            <td className="py-3 px-3 whitespace-nowrap text-right font-mono font-bold">
                              {bal > 0 ? (
                                <span className="text-amber-600 dark:text-amber-400">
                                  PKR {bal.toLocaleString()}
                                </span>
                              ) : (
                                <span className="text-emerald-600 dark:text-emerald-400 text-[10px] font-sans">
                                  ✓ Cleared
                                </span>
                              )}
                            </td>

                            {/* Action: Slip */}
                            <td className="py-3 px-3 whitespace-nowrap text-center">
                              <button
                                onClick={() => handlePrintVoucher(item)}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-slate-100 hover:bg-indigo-50 dark:bg-slate-800 dark:hover:bg-indigo-950/40 text-slate-700 hover:text-indigo-600 dark:text-slate-300 transition text-[11px] font-bold border border-slate-200 dark:border-slate-700 cursor-pointer"
                                title="Print Slip"
                              >
                                <Printer className="w-3.5 h-3.5 text-indigo-600" />
                                <span>Slip</span>
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot className="bg-slate-50 dark:bg-slate-800/80 font-bold border-t-2 border-slate-300 dark:border-slate-700">
                      <tr>
                        <td colSpan={8} className="py-3 px-4 text-right uppercase text-[11px] text-slate-600 dark:text-slate-300">
                          Total For Filtered Sales ({saleBillsList.length} Bills):
                        </td>
                        <td className="py-3 px-3 text-right font-mono text-slate-800 dark:text-slate-200">
                          PKR {saleBillsList.reduce((sum, i) => sum + (Number(i.billTotal) || Number(i.amount) || 0), 0).toLocaleString()}
                        </td>
                        <td className="py-3 px-4 text-right font-mono font-black text-sm text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40">
                          PKR {saleBillsList.reduce((sum, i) => sum + (Number(i.amount) || 0), 0).toLocaleString()}
                        </td>
                        <td className="py-3 px-3 text-right font-mono text-amber-600 dark:text-amber-400">
                          PKR {saleBillsList.reduce((sum, i) => sum + (Number(i.balance) || 0), 0).toLocaleString()}
                        </td>
                        <td></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>
          </div>
        ) : activeTab === 'instore_bills' ? (
          /* ========================================================================= */
          /* VIEW 2: DEDICATED IN-STORE COUNTER BILLS (اسٹور کاؤنٹر بلز وصولیاں)       */
          /* ========================================================================= */
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="bg-white dark:bg-slate-900 border border-emerald-200 dark:border-emerald-800 rounded-xl p-3.5 shadow-sm">
                <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-800 dark:text-emerald-300 block">
                  In-Store Received (کاؤنٹر وصولی)
                </span>
                <div className="text-xl font-black text-emerald-700 dark:text-emerald-300 mt-1 font-mono">
                  PKR {saleTypeMetrics.inStoreTotalReceived.toLocaleString()}
                </div>
                <div className="text-[10px] text-slate-500 mt-1 flex justify-between">
                  <span>Today: PKR {saleTypeMetrics.inStoreTodayReceived.toLocaleString()}</span>
                </div>
              </div>

              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3.5 shadow-sm">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">
                  Total Counter Bills (کل کاؤنٹر بلز)
                </span>
                <div className="text-xl font-black text-slate-800 dark:text-slate-100 mt-1 font-mono">
                  {saleTypeMetrics.inStoreBillsCount} Bills
                </div>
                <div className="text-[10px] text-slate-500 mt-1">In-Store Walk-in Sales</div>
              </div>

              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3.5 shadow-sm">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">
                  Total Counter Sales Value (کل سیلز ویلیو)
                </span>
                <div className="text-xl font-black text-indigo-600 mt-1 font-mono">
                  PKR {saleTypeMetrics.inStoreTotalBillValue.toLocaleString()}
                </div>
                <div className="text-[10px] text-slate-500 mt-1">Gross Bill Value</div>
              </div>

              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3.5 shadow-sm">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">
                  Unpaid Balance (بقایا ادھار)
                </span>
                <div className="text-xl font-black text-amber-600 mt-1 font-mono">
                  PKR {saleTypeMetrics.inStorePendingBalance.toLocaleString()}
                </div>
                <div className="text-[10px] text-slate-500 mt-1">Pending Customer Balance</div>
              </div>
            </div>

            {/* In-Store Bills Table */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-850">
                <div className="flex items-center gap-2">
                  <Store className="w-4 h-4 text-emerald-600" />
                  <span className="font-black text-xs uppercase tracking-wider text-slate-800 dark:text-slate-200">
                    In-Store Counter Bills ({inStoreBillsList.length} Records)
                  </span>
                </div>
              </div>

              {inStoreBillsList.length === 0 ? (
                <div className="p-10 text-center text-slate-500">
                  <Store className="w-10 h-10 mx-auto text-slate-400 mb-2" />
                  <div className="font-bold text-sm">No in-store counter bills found</div>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 text-[10px] font-black uppercase text-slate-600 dark:text-slate-300">
                        <th className="py-3 px-3 text-center w-8">#</th>
                        <th className="py-3 px-3">Invoice #</th>
                        <th className="py-3 px-3">Date</th>
                        <th className="py-3 px-3">Customer</th>
                        <th className="py-3 px-3">Salesman</th>
                        <th className="py-3 px-3">Payment Account</th>
                        <th className="py-3 px-3 text-right">Bill Total</th>
                        <th className="py-3 px-4 text-right">Received (وصولی)</th>
                        <th className="py-3 px-3 text-right">Balance</th>
                        <th className="py-3 px-3 text-center">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {inStoreBillsList.map((item, idx) => (
                        <tr key={item.id || idx} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                          <td className="py-3 px-3 text-center font-mono text-slate-400">{idx + 1}</td>
                          <td className="py-3 px-3 font-mono font-bold">#{item.saleInvoiceNo || item.voucherNo}</td>
                          <td className="py-3 px-3 font-mono text-[11px] text-slate-600">{safeFormat(item.date, 'dd/MM/yyyy')}</td>
                          <td className="py-3 px-3 font-semibold">{item.customerName || 'Walk-in'}</td>
                          <td className="py-3 px-3 text-slate-600">{item.onlineEmployeeName || item.handledBy || '-'}</td>
                          <td className="py-3 px-3 font-bold">{item.accountHead || item.paymentMode}</td>
                          <td className="py-3 px-3 text-right font-mono">PKR {Number(item.billTotal || item.amount).toLocaleString()}</td>
                          <td className="py-3 px-4 text-right font-mono font-black text-emerald-600 bg-emerald-50/50">
                            PKR {Number(item.amount || 0).toLocaleString()}
                          </td>
                          <td className="py-3 px-3 text-right font-mono font-bold text-amber-600">
                            {Number(item.balance || 0) > 0 ? `PKR ${Number(item.balance).toLocaleString()}` : 'Nil'}
                          </td>
                          <td className="py-3 px-3 text-center">
                            <button
                              onClick={() => handlePrintVoucher(item)}
                              className="px-2.5 py-1 rounded bg-slate-100 hover:bg-emerald-50 text-slate-700 hover:text-emerald-600 font-bold text-[11px] border border-slate-200"
                            >
                              Slip
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        ) : activeTab === 'online_bills' ? (
          <div className="space-y-4">
            {/* Online Bills Executive KPI Metrics */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
              {/* Metric 1: Total Online Received */}
              <div className="bg-gradient-to-br from-sky-500/10 to-sky-600/5 dark:from-sky-950/40 dark:to-slate-900 border border-sky-200 dark:border-sky-800 rounded-xl p-3.5 shadow-sm">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-sky-800 dark:text-sky-300">
                    Online Received
                  </span>
                  <div className="w-7 h-7 rounded-lg bg-sky-500 text-white flex items-center justify-center shadow-xs">
                    <CreditCard className="w-4 h-4" />
                  </div>
                </div>
                <div className="text-lg font-black text-sky-700 dark:text-sky-300 mt-2 font-mono">
                  PKR {onlineBillsMetrics.totalOnlineReceived.toLocaleString()}
                </div>
                <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-1 flex items-center justify-between font-urdu">
                  <span>آن لائن موصول رقم</span>
                  <span className="text-sky-600 font-sans font-bold text-[10px]">Today: {onlineBillsMetrics.todayOnlineReceived.toLocaleString()}</span>
                </div>
              </div>

              {/* Metric 2: Total Online Bills Count */}
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3.5 shadow-sm">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Total Online Bills
                  </span>
                  <div className="w-7 h-7 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 flex items-center justify-center">
                    <Receipt className="w-4 h-4" />
                  </div>
                </div>
                <div className="text-lg font-black text-slate-800 dark:text-slate-100 mt-2 font-mono">
                  {onlineBillsMetrics.totalBillsCount} Bills
                </div>
                <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-1 flex items-center justify-between font-urdu">
                  <span>کل آن لائن بلز</span>
                  <span className="text-slate-500 font-sans font-semibold text-[10px]">Orders Booked</span>
                </div>
              </div>

              {/* Metric 3: Total Bill Value */}
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3.5 shadow-sm">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Total Order Value
                  </span>
                  <div className="w-7 h-7 rounded-lg bg-indigo-100 dark:bg-indigo-950/60 text-indigo-600 flex items-center justify-center">
                    <Smartphone className="w-4 h-4" />
                  </div>
                </div>
                <div className="text-lg font-black text-indigo-600 dark:text-indigo-400 mt-2 font-mono">
                  PKR {onlineBillsMetrics.totalBillValue.toLocaleString()}
                </div>
                <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-1 flex items-center justify-between font-urdu">
                  <span>کل آرڈر رقم</span>
                  <span className="text-indigo-500 font-sans font-bold text-[10px]">Total Sales</span>
                </div>
              </div>

              {/* Metric 4: Meezan Bank Online */}
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3.5 shadow-sm">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Meezan Bank
                  </span>
                  <div className="w-7 h-7 rounded-lg bg-blue-100 dark:bg-blue-950/60 text-blue-600 flex items-center justify-center">
                    <Building2 className="w-4 h-4" />
                  </div>
                </div>
                <div className="text-lg font-black text-blue-600 dark:text-blue-400 mt-2 font-mono">
                  PKR {onlineBillsMetrics.meezanTotal.toLocaleString()}
                </div>
                <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-1 flex items-center justify-between font-urdu">
                  <span>میزان بینک کھاتہ</span>
                  <span className="text-blue-500 font-sans font-semibold text-[10px]">Bank Transfer</span>
                </div>
              </div>

              {/* Metric 5: JazzCash & EasyPaisa */}
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3.5 shadow-sm">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    JazzCash & Wallets
                  </span>
                  <div className="w-7 h-7 rounded-lg bg-orange-100 dark:bg-orange-950/60 text-orange-600 flex items-center justify-center">
                    <Smartphone className="w-4 h-4" />
                  </div>
                </div>
                <div className="text-lg font-black text-orange-600 dark:text-orange-400 mt-2 font-mono">
                  PKR {(onlineBillsMetrics.jazzCashTotal + onlineBillsMetrics.easyPaisaTotal).toLocaleString()}
                </div>
                <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-1 flex items-center justify-between font-urdu">
                  <span>جاز کیش و ایزی پیسہ</span>
                  <span className="text-orange-500 font-sans font-semibold text-[10px]">Mobile Wallets</span>
                </div>
              </div>

              {/* Metric 6: Pending COD / Courier Balances */}
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3.5 shadow-sm">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Pending COD / Bal
                  </span>
                  <div className="w-7 h-7 rounded-lg bg-amber-100 dark:bg-amber-950/60 text-amber-600 flex items-center justify-center">
                    <Truck className="w-4 h-4" />
                  </div>
                </div>
                <div className="text-lg font-black text-amber-600 dark:text-amber-400 mt-2 font-mono">
                  PKR {onlineBillsMetrics.totalPendingCOD.toLocaleString()}
                </div>
                <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-1 flex items-center justify-between font-urdu">
                  <span>بقایا سی او ڈی بیلنس</span>
                  <span className="text-amber-500 font-sans font-semibold text-[10px]">On Delivery</span>
                </div>
              </div>
            </div>

            {/* Quick Channel / Bank Filter */}
            <div className="flex items-center gap-2 overflow-x-auto pb-1 text-xs font-semibold">
              <span className="text-slate-500 font-bold uppercase tracking-wider text-[11px] shrink-0">Channel / Bank:</span>
              <button
                onClick={() => setAccountFilter('all')}
                className={`px-3 py-1.5 rounded-lg border transition shrink-0 ${
                  accountFilter === 'all'
                    ? 'bg-sky-600 text-white border-sky-600 font-bold shadow-xs'
                    : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50'
                }`}
              >
                All Online Channels (تمام چینلز)
              </button>

              <button
                onClick={() => setAccountFilter('Meezan Bank')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border transition shrink-0 ${
                  accountFilter === 'Meezan Bank'
                    ? 'bg-blue-600 text-white border-blue-600 font-bold shadow-xs'
                    : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50'
                }`}
              >
                <Building2 className="w-3.5 h-3.5" />
                <span>Meezan Bank (میزان بینک)</span>
                <span className="ml-1 px-1.5 py-0.2 bg-black/10 rounded-full text-[10px] font-mono">
                  PKR {onlineBillsMetrics.meezanTotal.toLocaleString()}
                </span>
              </button>

              <button
                onClick={() => setAccountFilter('UBL Bank')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border transition shrink-0 ${
                  accountFilter === 'UBL Bank'
                    ? 'bg-indigo-600 text-white border-indigo-600 font-bold shadow-xs'
                    : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50'
                }`}
              >
                <Building2 className="w-3.5 h-3.5" />
                <span>UBL Bank (یو بی ایل)</span>
                <span className="ml-1 px-1.5 py-0.2 bg-black/10 rounded-full text-[10px] font-mono">
                  PKR {onlineBillsMetrics.ublTotal.toLocaleString()}
                </span>
              </button>

              <button
                onClick={() => setAccountFilter('JazzCash')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border transition shrink-0 ${
                  accountFilter === 'JazzCash'
                    ? 'bg-orange-600 text-white border-orange-600 font-bold shadow-xs'
                    : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50'
                }`}
              >
                <Smartphone className="w-3.5 h-3.5" />
                <span>JazzCash (جاز کیش)</span>
                <span className="ml-1 px-1.5 py-0.2 bg-black/10 rounded-full text-[10px] font-mono">
                  PKR {onlineBillsMetrics.jazzCashTotal.toLocaleString()}
                </span>
              </button>

              <button
                onClick={() => setAccountFilter('EasyPaisa')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border transition shrink-0 ${
                  accountFilter === 'EasyPaisa'
                    ? 'bg-emerald-600 text-white border-emerald-600 font-bold shadow-xs'
                    : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50'
                }`}
              >
                <CreditCard className="w-3.5 h-3.5" />
                <span>EasyPaisa (ایزی پیسہ)</span>
                <span className="ml-1 px-1.5 py-0.2 bg-black/10 rounded-full text-[10px] font-mono">
                  PKR {onlineBillsMetrics.easyPaisaTotal.toLocaleString()}
                </span>
              </button>
            </div>

            {/* Filter and Search Bar for Online Bills - (NO BRANCH SELECTOR) */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-sm">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {/* Search Box */}
                <div className="relative md:col-span-1">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    placeholder="Search invoice #, customer, mobile, Trx ID, staff..."
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs focus:bg-white focus:border-sky-500 focus:outline-none"
                  />
                  {searchQuery && (
                    <button onClick={() => setSearchQuery('')} className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600">
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>

                {/* Date Filter Range */}
                <div>
                  <select
                    value={dateFilter}
                    onChange={(e: any) => setDateFilter(e.target.value)}
                    className="w-full py-2 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-medium focus:bg-white focus:border-sky-500 focus:outline-none"
                  >
                    <option value="today">Today (آج)</option>
                    <option value="yesterday">Yesterday (گزشتہ کل)</option>
                    <option value="week">This Week (یہ ہفتہ)</option>
                    <option value="month">This Month (موجودہ مہینہ)</option>
                    <option value="custom">Custom Date Range (تاریخ منتخب کریں)</option>
                    <option value="all">All Time (تمام ریکارڈز)</option>
                  </select>
                </div>

                {/* Online Bill Payment Status Filter */}
                <div>
                  <select
                    value={onlineBillStatusFilter}
                    onChange={(e: any) => setOnlineBillStatusFilter(e.target.value)}
                    className="w-full py-2 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-medium focus:bg-white focus:border-sky-500 focus:outline-none"
                  >
                    <option value="all">All Bills (تمام آن لائن بلز)</option>
                    <option value="advance">Advance Received Only (صرف ایڈوانس وصول شدہ)</option>
                    <option value="cleared">Fully Cleared / Paid (مکمل ادا شدہ بلز)</option>
                    <option value="pending_cod">Pending COD to Collect (بقایا سی او ڈی)</option>
                  </select>
                </div>
              </div>

              {/* Custom Date Range Picker */}
              {dateFilter === 'custom' && (
                <div className="flex items-center gap-3 mt-3 pt-3 border-t border-slate-100 dark:border-slate-800 flex-wrap">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-500 font-medium">From:</span>
                    <input
                      type="date"
                      value={startDate}
                      onChange={e => setStartDate(e.target.value)}
                      className="py-1.5 px-2.5 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-500 font-medium">To:</span>
                    <input
                      type="date"
                      value={endDate}
                      onChange={e => setEndDate(e.target.value)}
                      className="py-1.5 px-2.5 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs"
                    />
                  </div>
                  <span className="text-xs text-slate-400">Showing records between selected interval</span>
                </div>
              )}
            </div>

            {/* Dedicated Online Bills Received Payments Table */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-sm">
              <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full bg-sky-500 animate-pulse"></div>
                  <h2 className="text-sm font-bold text-slate-800 dark:text-slate-100 uppercase tracking-wider">
                    Online Billing Received Payments (آن لائن بلز موصولہ رقم)
                  </h2>
                  <span className="bg-sky-100 dark:bg-sky-950 text-sky-700 dark:text-sky-300 text-xs px-2.5 py-0.5 rounded-full font-bold">
                    {onlineBillsList.length} Online Bills
                  </span>
                </div>

                <div className="text-xs font-bold text-slate-600 dark:text-slate-300">
                  Total Online Received:{' '}
                  <span className="text-emerald-600 dark:text-emerald-400 font-mono font-black text-sm ml-1">
                    PKR {onlineBillsMetrics.totalOnlineReceived.toLocaleString()}
                  </span>
                </div>
              </div>

              {onlineBillsList.length === 0 ? (
                <div className="py-16 text-center text-slate-400">
                  <Globe className="w-12 h-12 mx-auto mb-3 opacity-30 text-sky-500" />
                  <p className="text-sm font-medium text-slate-600 dark:text-slate-300">No online billing payments found for this period</p>
                  <p className="text-xs text-slate-400 mt-1">Online bills booked with advance payments or cleared courier amounts will be listed here</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 dark:bg-slate-800/70 text-slate-600 dark:text-slate-300 uppercase tracking-wider font-bold border-b border-slate-200 dark:border-slate-800">
                      <tr>
                        <th className="py-3 px-4">Date & Time</th>
                        <th className="py-3 px-3">Bill / Invoice #</th>
                        <th className="py-3 px-3">Branch (برانچ)</th>
                        <th className="py-3 px-3">Customer Details</th>
                        <th className="py-3 px-3">Online Booking Staff</th>
                        <th className="py-3 px-3">Channel / Bank Head</th>
                        <th className="py-3 px-3">Trx ID / Ref</th>
                        <th className="py-3 px-3 text-right">Bill Total (PKR)</th>
                        <th className="py-3 px-4 text-right bg-emerald-50/50 dark:bg-emerald-950/20">Online Received (PKR)</th>
                        <th className="py-3 px-3 text-right">COD / Balance</th>
                        <th className="py-3 px-3 text-center">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-sans">
                      {onlineBillsList.map((item, idx) => {
                        const recAmt = Number(item.onlineReceivedAmount || item.amount) || 0;
                        const billTotal = Number(item.billTotal) || 0;
                        const bal = Number(item.balance) || 0;
                        const isCleared = bal <= 0 || item.codCashReceived;
                        const accName = item.accountHead || item.paymentMode || 'Meezan Bank';

                        return (
                          <tr 
                            key={item.id || idx}
                            className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition"
                          >
                            <td className="py-3 px-4 whitespace-nowrap text-slate-600 dark:text-slate-300 font-mono">
                              <div>{safeFormat(item.date, 'dd MMM yyyy')}</div>
                              <div className="text-[10px] text-slate-400">{safeFormat(item.date, 'hh:mm a')}</div>
                            </td>

                            <td className="py-3 px-3 whitespace-nowrap font-mono font-bold">
                              <div className="flex items-center gap-1.5">
                                <span className="bg-sky-50 dark:bg-sky-950/70 text-sky-800 dark:text-sky-300 px-2 py-0.5 rounded border border-sky-200 dark:border-sky-800">
                                  #{item.voucherNo}
                                </span>
                                <span className="text-[9px] px-1.5 py-0.2 bg-sky-100 dark:bg-sky-900 text-sky-700 dark:text-sky-300 font-sans rounded-full font-bold">
                                  Online
                                </span>
                              </div>
                            </td>

                            <td className="py-3 px-3 whitespace-nowrap">
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                                <Building2 className="w-3 h-3 text-amber-600" />
                                <span>{branches.find(b => b.id === (item.branchId || branches[0]?.id || 'main'))?.name || 'Main Branch'}</span>
                              </span>
                            </td>

                            <td className="py-3 px-3">
                              <div className="font-bold text-slate-900 dark:text-slate-100">
                                {item.customerName || 'Online Customer'}
                              </div>
                              {item.customerPhone && (
                                <div className="text-[10px] font-mono text-slate-500 dark:text-slate-400">
                                  📞 {item.customerPhone}
                                </div>
                              )}
                              {item.shippingAddress && (
                                <div className="text-[9px] text-slate-400 truncate max-w-[150px]" title={item.shippingAddress}>
                                  📍 {item.shippingAddress}
                                </div>
                              )}
                            </td>

                            <td className="py-3 px-3 whitespace-nowrap text-slate-700 dark:text-slate-200">
                              <div className="font-semibold">{item.onlineEmployeeName || item.handledBy || '-'}</div>
                              {item.onlineEmployeeCode && (
                                <div className="text-[10px] text-sky-600 font-mono">{item.onlineEmployeeCode}</div>
                              )}
                            </td>

                            <td className="py-3 px-3 whitespace-nowrap">
                              {accName.includes('Meezan') ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                                  <Building2 className="w-3 h-3" />
                                  <span>Meezan Bank</span>
                                </span>
                              ) : accName.includes('UBL') ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
                                  <Building2 className="w-3 h-3" />
                                  <span>UBL Bank</span>
                                </span>
                              ) : accName.includes('JazzCash') ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold bg-orange-50 dark:bg-orange-950/40 text-orange-700 dark:text-orange-300 border border-orange-200 dark:border-orange-800">
                                  <Smartphone className="w-3 h-3" />
                                  <span>JazzCash</span>
                                </span>
                              ) : accName.includes('EasyPaisa') ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                                  <CreditCard className="w-3 h-3" />
                                  <span>EasyPaisa</span>
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                                  <CreditCard className="w-3 h-3" />
                                  <span>{accName}</span>
                                </span>
                              )}
                            </td>

                            <td className="py-3 px-3 whitespace-nowrap font-mono">
                              {item.trxId ? (
                                <span className="bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded text-[10px] font-bold text-sky-600 dark:text-sky-400 border border-slate-200 dark:border-slate-700">
                                  {item.trxId}
                                </span>
                              ) : (
                                <span className="text-slate-400 text-[10px]">-</span>
                              )}
                            </td>

                            <td className="py-3 px-3 whitespace-nowrap text-right font-mono font-semibold text-slate-700 dark:text-slate-300">
                              PKR {billTotal.toLocaleString()}
                            </td>

                            <td className="py-3 px-4 whitespace-nowrap text-right font-mono font-black text-sm bg-emerald-50/50 dark:bg-emerald-950/20">
                              <span className="text-emerald-600 dark:text-emerald-400 flex items-center justify-end gap-1">
                                <span>PKR {recAmt.toLocaleString()}</span>
                              </span>
                              <span className="text-[9px] font-sans font-bold block text-emerald-700 dark:text-emerald-300">
                                {isCleared ? '✓ Cleared' : 'Advance Paid'}
                              </span>
                            </td>

                            <td className="py-3 px-3 whitespace-nowrap text-right">
                              {bal > 0 ? (
                                <div>
                                  <span className="font-mono font-bold text-amber-600 dark:text-amber-400">
                                    PKR {bal.toLocaleString()}
                                  </span>
                                  {item.courier && (
                                    <div className="text-[9px] text-slate-400 truncate max-w-[120px]" title={`${item.courier} ${item.trackingNumber ? `#${item.trackingNumber}` : ''}`}>
                                      🚚 {item.courier} {item.trackingNumber ? `(${item.trackingNumber})` : ''}
                                    </div>
                                  )}
                                </div>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-600">
                                  <CheckCircle2 className="w-3 h-3" />
                                  <span>Nil (Paid)</span>
                                </span>
                              )}
                            </td>

                            <td className="py-3 px-3 whitespace-nowrap text-center">
                              <button
                                onClick={() => handlePrintVoucher(item)}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-slate-100 hover:bg-sky-50 dark:bg-slate-800 dark:hover:bg-sky-950/40 text-slate-700 hover:text-sky-600 dark:text-slate-300 transition text-[11px] font-bold border border-slate-200 dark:border-slate-700 cursor-pointer"
                                title="Print 80mm / A4 Online Payment Receipt Slip"
                              >
                                <Printer className="w-3.5 h-3.5 text-sky-600" />
                                <span>Slip</span>
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot className="bg-slate-50 dark:bg-slate-800/80 font-bold border-t-2 border-slate-300 dark:border-slate-700">
                      <tr>
                        <td colSpan={7} className="py-3 px-4 text-right uppercase text-[11px] text-slate-600 dark:text-slate-300">
                          Total Online Bills Received (کل آن لائن وصولی):
                        </td>
                        <td className="py-3 px-3 text-right font-mono text-slate-800 dark:text-slate-200">
                          PKR {onlineBillsMetrics.totalBillValue.toLocaleString()}
                        </td>
                        <td className="py-3 px-4 text-right font-mono font-black text-sm text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40">
                          PKR {onlineBillsMetrics.totalOnlineReceived.toLocaleString()}
                        </td>
                        <td className="py-3 px-3 text-right font-mono text-amber-600 dark:text-amber-400">
                          PKR {onlineBillsMetrics.totalPendingCOD.toLocaleString()}
                        </td>
                        <td></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>
          </div>
        ) : (
          /* ========================================================================= */
          /* GENERAL VIEW: ALL TRANSACTIONS & CASH HANDOVERS (NO BRANCH SELECTOR)       */
          /* ========================================================================= */
          <div className="space-y-4">
            {/* Summary KPI Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5">
              {/* Card 1: Cash Given By Hand */}
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-sm relative overflow-hidden">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Cash Given By Hand
                  </span>
                  <div className="w-7 h-7 rounded-lg bg-rose-100 dark:bg-rose-950/60 text-rose-600 flex items-center justify-center">
                    <Banknote className="w-4 h-4" />
                  </div>
                </div>
                <div className="text-xl font-black text-rose-600 mt-2 font-mono">
                  PKR {metrics.totalCashGivenOut.toLocaleString()}
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 flex items-center justify-between font-urdu">
                  <span>مالک کو نقد کیش دیا</span>
                  <span className="text-rose-500 font-sans font-bold text-[10px]">Today: {metrics.todayGivenOut.toLocaleString()}</span>
                </div>
              </div>

              {/* Card 2: Online Received in Owner Acc */}
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-sm relative overflow-hidden">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Online Received (Meezan / UBL / Wallets)
                  </span>
                  <div className="w-7 h-7 rounded-lg bg-sky-100 dark:bg-sky-950/60 text-sky-600 flex items-center justify-center">
                    <CreditCard className="w-4 h-4" />
                  </div>
                </div>
                <div className="text-xl font-black text-sky-600 mt-2 font-mono">
                  PKR {metrics.totalOnlineReceived.toLocaleString()}
                </div>
                <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-1 flex items-center justify-between">
                  <span className="font-urdu">آن لائن کھاتے میں وصولی</span>
                  <span className="text-sky-600 font-bold">Meezan: {metrics.meezanTotal.toLocaleString()} | UBL: {metrics.ublTotal.toLocaleString()}</span>
                </div>
              </div>

              {/* Card 3: Sales via Owner Account */}
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-sm relative overflow-hidden">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Sales In Owner Account
                  </span>
                  <div className="w-7 h-7 rounded-lg bg-indigo-100 dark:bg-indigo-950/60 text-indigo-600 flex items-center justify-center">
                    <Smartphone className="w-4 h-4" />
                  </div>
                </div>
                <div className="text-xl font-black text-indigo-600 mt-2 font-mono">
                  PKR {metrics.totalSalesInOwnerAccount.toLocaleString()}
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 flex items-center justify-between font-urdu">
                  <span>سیل سے جمع رقم</span>
                  <span className="text-indigo-500 font-sans font-bold text-[10px]">Invoices</span>
                </div>
              </div>

              {/* Card 4: Cash Received From Owner */}
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-sm relative overflow-hidden">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Received From Owner
                  </span>
                  <div className="w-7 h-7 rounded-lg bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 flex items-center justify-center">
                    <ArrowDownRight className="w-4 h-4" />
                  </div>
                </div>
                <div className="text-xl font-black text-emerald-600 mt-2 font-mono">
                  PKR {metrics.totalReceivedBackIn.toLocaleString()}
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 flex items-center justify-between font-urdu">
                  <span>مالک سے واپس ملا کیش</span>
                  <span className="text-emerald-500 font-sans font-bold text-[10px]">Capital In</span>
                </div>
              </div>

              {/* Card 5: Net Balance with Owner */}
              <div className="bg-gradient-to-br from-amber-500/10 to-amber-600/5 dark:from-amber-950/30 dark:to-slate-900 border border-amber-200 dark:border-amber-800/60 rounded-xl p-4 shadow-sm relative overflow-hidden">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-amber-800 dark:text-amber-300">
                    Net Total With Owner
                  </span>
                  <div className="w-7 h-7 rounded-lg bg-amber-500 text-white flex items-center justify-center shadow-sm">
                    <Landmark className="w-4 h-4" />
                  </div>
                </div>
                <div className="text-xl font-black text-amber-700 dark:text-amber-400 mt-2 font-mono">
                  PKR {metrics.netOwnerBalance.toLocaleString()}
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 flex items-center justify-between font-urdu">
                  <span>مالک کے پاس کل بیلنس</span>
                  <span className="text-amber-600 font-sans font-bold text-[10px]">Net Total</span>
                </div>
              </div>
            </div>

            {/* Account Quick Heads Bar */}
            <div className="flex items-center gap-2 overflow-x-auto pb-1 text-xs font-semibold">
              <span className="text-slate-500 font-bold uppercase tracking-wider text-[11px] shrink-0">Account Head:</span>
              <button
                onClick={() => setAccountFilter('all')}
                className={`px-3 py-1.5 rounded-lg border transition shrink-0 ${
                  accountFilter === 'all'
                    ? 'bg-amber-600 text-white border-amber-600 font-bold shadow-sm'
                    : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50'
                }`}
              >
                All Accounts (تمام کھاتے)
              </button>

              <button
                onClick={() => setAccountFilter('Meezan Bank')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border transition shrink-0 ${
                  accountFilter === 'Meezan Bank'
                    ? 'bg-sky-600 text-white border-sky-600 font-bold shadow-sm'
                    : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50'
                }`}
              >
                <Building2 className="w-3.5 h-3.5" />
                <span>Meezan Bank (میزان بینک)</span>
                <span className="ml-1 px-1.5 py-0.2 bg-black/10 rounded-full text-[10px] font-mono">
                  PKR {metrics.meezanTotal.toLocaleString()}
                </span>
              </button>

              <button
                onClick={() => setAccountFilter('UBL Bank')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border transition shrink-0 ${
                  accountFilter === 'UBL Bank'
                    ? 'bg-indigo-600 text-white border-indigo-600 font-bold shadow-sm'
                    : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50'
                }`}
              >
                <Building2 className="w-3.5 h-3.5" />
                <span>UBL Bank (یو بی ایل بینک)</span>
                <span className="ml-1 px-1.5 py-0.2 bg-black/10 rounded-full text-[10px] font-mono">
                  PKR {metrics.ublTotal.toLocaleString()}
                </span>
              </button>

              <button
                onClick={() => setAccountFilter('JazzCash')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border transition shrink-0 ${
                  accountFilter === 'JazzCash'
                    ? 'bg-orange-600 text-white border-orange-600 font-bold shadow-sm'
                    : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50'
                }`}
              >
                <Smartphone className="w-3.5 h-3.5" />
                <span>JazzCash (جاز کیش)</span>
                <span className="ml-1 px-1.5 py-0.2 bg-black/10 rounded-full text-[10px] font-mono">
                  PKR {metrics.jazzCashTotal.toLocaleString()}
                </span>
              </button>

              <button
                onClick={() => setAccountFilter('EasyPaisa')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border transition shrink-0 ${
                  accountFilter === 'EasyPaisa'
                    ? 'bg-emerald-600 text-white border-emerald-600 font-bold shadow-sm'
                    : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50'
                }`}
              >
                <CreditCard className="w-3.5 h-3.5" />
                <span>EasyPaisa (ایزی پیسہ)</span>
                <span className="ml-1 px-1.5 py-0.2 bg-black/10 rounded-full text-[10px] font-mono">
                  PKR {metrics.easyPaisaTotal.toLocaleString()}
                </span>
              </button>

              <button
                onClick={() => setAccountFilter('Cash by Hand')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border transition shrink-0 ${
                  accountFilter === 'Cash by Hand'
                    ? 'bg-rose-600 text-white border-rose-600 font-bold shadow-sm'
                    : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50'
                }`}
              >
                <Banknote className="w-3.5 h-3.5" />
                <span>Cash By Hand (نقد کیش)</span>
              </button>

              <button
                onClick={() => setAccountFilter('Owner Account')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border transition shrink-0 ${
                  accountFilter === 'Owner Account'
                    ? 'bg-purple-600 text-white border-purple-600 font-bold shadow-sm'
                    : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50'
                }`}
              >
                <Landmark className="w-3.5 h-3.5" />
                <span>Owner Account (مالک کھاتہ)</span>
              </button>
            </div>

            {/* Filter and Search Bar - (NO BRANCH FILTER) */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-sm">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {/* Search Box */}
                <div className="relative md:col-span-1">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    placeholder="Search voucher, Trx ID, sender, note..."
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs focus:bg-white focus:border-amber-500 focus:outline-none"
                  />
                  {searchQuery && (
                    <button onClick={() => setSearchQuery('')} className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600">
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>

                {/* Date Filter Range */}
                <div>
                  <select
                    value={dateFilter}
                    onChange={(e: any) => setDateFilter(e.target.value)}
                    className="w-full py-2 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-medium focus:bg-white focus:border-amber-500 focus:outline-none"
                  >
                    <option value="today">Today (آج)</option>
                    <option value="yesterday">Yesterday (گزشتہ کل)</option>
                    <option value="week">This Week (یہ ہفتہ)</option>
                    <option value="month">This Month (موجودہ مہینہ)</option>
                    <option value="custom">Custom Date Range (تاریخ منتخب کریں)</option>
                    <option value="all">All Time (تمام ریکارڈز)</option>
                  </select>
                </div>

                {/* Type Filter */}
                <div>
                  <select
                    value={typeFilter}
                    onChange={(e: any) => setTypeFilter(e.target.value)}
                    className="w-full py-2 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-medium focus:bg-white focus:border-amber-500 focus:outline-none"
                  >
                    <option value="all">All Types (تمام لین دین)</option>
                    <option value="ONLINE">Online Received (آن لائن وصولی - Meezan / JazzCash)</option>
                    <option value="OUT">Cash Given to Owner (مالک کو دیا گیا نقد کیش)</option>
                    <option value="IN">Cash Received from Owner (مالک سے وصول شدہ کیش)</option>
                    <option value="SALE">Sales via Owner Account (سیلز سے جمع شدہ)</option>
                  </select>
                </div>
              </div>

              {/* Custom Date Range Picker */}
              {dateFilter === 'custom' && (
                <div className="flex items-center gap-3 mt-3 pt-3 border-t border-slate-100 dark:border-slate-800 flex-wrap">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-500 font-medium">From:</span>
                    <input
                      type="date"
                      value={startDate}
                      onChange={e => setStartDate(e.target.value)}
                      className="py-1.5 px-2.5 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-500 font-medium">To:</span>
                    <input
                      type="date"
                      value={endDate}
                      onChange={e => setEndDate(e.target.value)}
                      className="py-1.5 px-2.5 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs"
                    />
                  </div>
                  <span className="text-xs text-slate-400">Showing records between selected interval</span>
                </div>
              )}
            </div>

            {/* Transactions List Table */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-sm">
              <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-bold text-slate-800 dark:text-slate-100 uppercase tracking-wider">
                    Owner Transactions & Cash Handover Records
                  </h2>
                  <span className="bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-xs px-2 py-0.5 rounded-full font-bold">
                    {filteredList.length} Entries
                  </span>
                </div>
              </div>

              {filteredList.length === 0 ? (
                <div className="py-16 text-center text-slate-400">
                  <Landmark className="w-12 h-12 mx-auto mb-3 opacity-30 text-amber-500" />
                  <p className="text-sm font-medium text-slate-600 dark:text-slate-300">No owner transactions found for this selection</p>
                  <p className="text-xs text-slate-400 mt-1">Click the buttons above to record cash handed over or online payment received</p>
                  <div className="flex items-center justify-center gap-2 mt-4">
                    <button
                      onClick={() => handleOpenOnlineReceived('Meezan Bank')}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-sky-600 text-white text-xs font-bold hover:bg-sky-700 transition"
                    >
                      <CreditCard className="w-4 h-4" />
                      <span>Record Online Received</span>
                    </button>
                    <button
                      onClick={handleOpenCashHandover}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-amber-600 text-white text-xs font-bold hover:bg-amber-700 transition"
                    >
                      <Plus className="w-4 h-4" />
                      <span>Record Cash Handover</span>
                    </button>
                  </div>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 dark:bg-slate-800/70 text-slate-600 dark:text-slate-300 uppercase tracking-wider font-bold border-b border-slate-200 dark:border-slate-800">
                      <tr>
                        <th className="py-3 px-4">Date & Time</th>
                        <th className="py-3 px-3">Voucher / Ref #</th>
                        <th className="py-3 px-3">Branch (برانچ)</th>
                        <th className="py-3 px-3">Type (قسم)</th>
                        <th className="py-3 px-3">Account Head</th>
                        <th className="py-3 px-4">Description / Details</th>
                        <th className="py-3 px-3">Handled By</th>
                        <th className="py-3 px-4 text-right">Amount (PKR)</th>
                        <th className="py-3 px-3 text-center">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-sans">
                      {filteredList.map((item, idx) => {
                        const isOut = item.type === 'OUT';
                        const isSale = item.category === 'Sale Payment' || item.source === 'sale';
                        const isOnline = item.category === 'Online Received' || (item.accountHead || '').includes('Meezan') || (item.accountHead || '').includes('JazzCash') || (item.accountHead || '').includes('EasyPaisa');

                        const accName = item.accountHead || item.paymentMode || 'Cash by Hand';

                        return (
                          <tr 
                            key={item.id || idx}
                            className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition"
                          >
                            <td className="py-3 px-4 whitespace-nowrap text-slate-600 dark:text-slate-300 font-mono">
                              <div>{safeFormat(item.date, 'dd MMM yyyy')}</div>
                              <div className="text-[10px] text-slate-400">{safeFormat(item.date, 'hh:mm a')}</div>
                            </td>

                            <td className="py-3 px-3 whitespace-nowrap font-mono font-bold">
                              <span className="bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700">
                                {item.voucherNo}
                              </span>
                            </td>

                            <td className="py-3 px-3 whitespace-nowrap">
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                                <Building2 className="w-3 h-3 text-amber-600" />
                                <span>{branches.find(b => b.id === (item.branchId || branches[0]?.id || 'main'))?.name || 'Main Branch'}</span>
                              </span>
                            </td>

                            <td className="py-3 px-3 whitespace-nowrap">
                              {isOnline ? (
                                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-sky-100 dark:bg-sky-950/60 text-sky-700 dark:text-sky-300 border border-sky-200 dark:border-sky-800">
                                  <CreditCard className="w-3 h-3" />
                                  <span>Online Received (آن لائن)</span>
                                </span>
                              ) : isSale ? (
                                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-indigo-100 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
                                  <Smartphone className="w-3 h-3" />
                                  <span>Sale Invoice</span>
                                </span>
                              ) : isOut ? (
                                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800">
                                  <ArrowUpRight className="w-3 h-3" />
                                  <span>Handover (نقد دیا)</span>
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                                  <ArrowDownRight className="w-3 h-3" />
                                  <span>Received (وصول ہوا)</span>
                                </span>
                              )}
                            </td>

                            <td className="py-3 px-3 whitespace-nowrap">
                              {accName.includes('Meezan') ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                                  <Building2 className="w-3 h-3" />
                                  <span>Meezan Bank</span>
                                </span>
                              ) : accName.includes('UBL') ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
                                  <Building2 className="w-3 h-3" />
                                  <span>UBL Bank</span>
                                </span>
                              ) : accName.includes('JazzCash') ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold bg-orange-50 dark:bg-orange-950/40 text-orange-700 dark:text-orange-300 border border-orange-200 dark:border-orange-800">
                                  <Smartphone className="w-3 h-3" />
                                  <span>JazzCash</span>
                                </span>
                              ) : accName.includes('EasyPaisa') ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                                  <CreditCard className="w-3 h-3" />
                                  <span>EasyPaisa</span>
                                </span>
                              ) : accName.includes('Cash') ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                                  <Banknote className="w-3 h-3" />
                                  <span>Cash by Hand</span>
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800">
                                  <Landmark className="w-3 h-3" />
                                  <span>{accName}</span>
                                </span>
                              )}
                            </td>

                            <td className="py-3 px-4">
                              <div className="font-medium text-slate-800 dark:text-slate-200 leading-snug max-w-sm line-clamp-2">
                                {item.description}
                              </div>
                              <div className="flex items-center gap-3 text-[10px] text-slate-400 mt-0.5">
                                {item.trxId && (
                                  <span className="font-mono text-sky-600 dark:text-sky-400 font-bold">
                                    Trx #{item.trxId}
                                  </span>
                                )}
                                {item.senderName && (
                                  <span>
                                    From: <span className="font-semibold text-slate-600 dark:text-slate-300">{item.senderName}</span>
                                  </span>
                                )}
                                <span>
                                  Owner: <span className="font-semibold text-slate-600 dark:text-slate-300">{item.ownerName}</span>
                                </span>
                              </div>
                            </td>

                            <td className="py-3 px-3 whitespace-nowrap text-slate-600 dark:text-slate-300">
                              {item.handledBy || '-'}
                            </td>

                            <td className="py-3 px-4 whitespace-nowrap text-right font-mono font-bold text-sm">
                              <span className={isOut ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}>
                                {isOut ? '-' : '+'} PKR {item.amount.toLocaleString()}
                              </span>
                            </td>

                            <td className="py-3 px-3 whitespace-nowrap text-center">
                              <div className="flex items-center justify-center gap-1">
                                <button
                                  onClick={() => handlePrintVoucher(item)}
                                  className="p-1.5 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition"
                                  title="Print Cash Voucher Slip"
                                >
                                  <Printer className="w-4 h-4" />
                                </button>

                                {item.source !== 'sale' && (
                                  <>
                                    <button
                                      onClick={() => handleEdit(item)}
                                      className="p-1.5 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 text-blue-500 hover:text-blue-700 transition"
                                      title="Edit Transaction"
                                    >
                                      <Edit className="w-4 h-4" />
                                    </button>

                                    {enableDeletion && (
                                      <button
                                        onClick={() => handleDelete(item)}
                                        className="p-1.5 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 text-rose-500 hover:text-rose-700 transition"
                                        title="Delete Voucher"
                                      >
                                        <Trash2 className="w-4 h-4" />
                                      </button>
                                    )}
                                  </>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Add / Edit Transaction Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden border border-slate-200 dark:border-slate-800 animate-in fade-in zoom-in duration-150">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-850">
              <div className="flex items-center gap-2.5">
                <div className={`w-8 h-8 rounded-lg text-white flex items-center justify-center ${txCategory === 'Online Received' ? 'bg-sky-600' : 'bg-amber-500'}`}>
                  {txCategory === 'Online Received' ? <CreditCard className="w-4 h-4" /> : <Landmark className="w-4 h-4" />}
                </div>
                <div>
                  <h3 className="text-sm font-black text-slate-800 dark:text-slate-100 uppercase tracking-wider">
                    {editTxId ? 'Edit Owner Transaction' : (txCategory === 'Online Received' ? 'Record Online Payment Received' : 'Record Cash Handover')}
                  </h3>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 font-urdu">
                    {txCategory === 'Online Received' ? 'آن لائن کھاتے میں وصول شدہ رقم (میزان بینک / جاز کیش وغیرہ)' : 'مالک کو نقد کیش کی ادائیگی یا وصولی کا اندراج'}
                  </div>
                </div>
              </div>
              <button
                onClick={() => setShowAddModal(false)}
                className="text-slate-400 hover:text-slate-600 p-1.5 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveTransaction} className="p-6 space-y-4 max-h-[85vh] overflow-y-auto">
              {/* Transaction Type Radio Selector */}
              <div>
                <label className="block text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400 font-bold mb-1.5">
                  Transaction Type (لین دین کی نوعیت) *
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setTxType('OUT');
                      setTxCategory('Cash Handover');
                      setAccountHead('Cash by Hand');
                      setPaymentMode('Cash by Hand');
                    }}
                    className={`flex items-center justify-center gap-2 p-2.5 rounded-xl border font-bold text-xs transition ${
                      txType === 'OUT' && txCategory === 'Cash Handover'
                        ? 'border-rose-500 bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 ring-1 ring-rose-500 shadow-sm'
                        : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    <ArrowUpRight className="w-4 h-4 text-rose-500 shrink-0" />
                    <div className="text-left">
                      <div>Cash Given (OUT)</div>
                      <div className="text-[10px] font-normal text-rose-600/80 font-urdu">مالک کو نقد دیا</div>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setTxType('IN');
                      setTxCategory('Online Received');
                      if (accountHead === 'Cash by Hand') {
                        setAccountHead('Meezan Bank');
                        setPaymentMode('Meezan Bank');
                      }
                    }}
                    className={`flex items-center justify-center gap-2 p-2.5 rounded-xl border font-bold text-xs transition ${
                      txCategory === 'Online Received'
                        ? 'border-sky-500 bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300 ring-1 ring-sky-500 shadow-sm'
                        : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    <CreditCard className="w-4 h-4 text-sky-500 shrink-0" />
                    <div className="text-left">
                      <div>Online Received</div>
                      <div className="text-[10px] font-normal text-sky-600/80 font-urdu">آن لائن وصولی</div>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setTxType('IN');
                      setTxCategory('Owner Capital');
                      setAccountHead('Cash by Hand');
                      setPaymentMode('Cash by Hand');
                    }}
                    className={`flex items-center justify-center gap-2 p-2.5 rounded-xl border font-bold text-xs transition ${
                      txType === 'IN' && txCategory === 'Owner Capital'
                        ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 ring-1 ring-emerald-500 shadow-sm'
                        : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    <ArrowDownRight className="w-4 h-4 text-emerald-500 shrink-0" />
                    <div className="text-left">
                      <div>Cash Received (IN)</div>
                      <div className="text-[10px] font-normal text-emerald-600/80 font-urdu">مالک سے نقد ملا</div>
                    </div>
                  </button>
                </div>
              </div>

              {/* Branch Display (صرف لاگ ان برانچ - سلیکشن ختم) */}
              <div className="bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl p-3 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <Building2 className="w-4 h-4 text-amber-600 shrink-0" />
                  <div>
                    <div className="text-[10px] uppercase font-bold text-slate-500 dark:text-slate-400 tracking-wider">Branch (برانچ)</div>
                    <div className="text-xs font-black text-slate-900 dark:text-slate-100">{currentBranch?.name || 'Main Branch'}</div>
                  </div>
                </div>
                <span className="text-[10px] font-urdu font-bold bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 px-2.5 py-1 rounded-full border border-amber-200 dark:border-amber-800">
                  لاگ ان برانچ کھاتہ
                </span>
              </div>

              {/* Account Head Selector (Especially for Online Received) */}
              <div>
                <label className="block text-[11px] uppercase tracking-wider text-slate-700 dark:text-slate-200 font-bold mb-1.5 flex items-center justify-between">
                  <span>Account Head / Deposit Channel (کھاتہ / اکاؤنٹ ہیڈ) *</span>
                  <span className="text-[10px] text-sky-600 dark:text-sky-400 font-normal">Meezan, JazzCash, EasyPaisa, etc.</span>
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-2">
                  <button
                    type="button"
                    onClick={() => {
                      setAccountHead('Meezan Bank');
                      setPaymentMode('Meezan Bank');
                    }}
                    className={`flex items-center gap-2 p-2 rounded-lg border text-left text-xs font-bold transition ${
                      accountHead === 'Meezan Bank'
                        ? 'border-sky-500 bg-sky-50 dark:bg-sky-950/50 text-sky-700 dark:text-sky-300 ring-1 ring-sky-500'
                        : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    <Building2 className="w-4 h-4 text-sky-600 shrink-0" />
                    <div>
                      <div className="leading-tight">Meezan Bank</div>
                      <div className="text-[10px] font-normal text-slate-400 font-urdu">میزان بینک</div>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setAccountHead('UBL Bank');
                      setPaymentMode('UBL Bank');
                    }}
                    className={`flex items-center gap-2 p-2 rounded-lg border text-left text-xs font-bold transition ${
                      accountHead === 'UBL Bank'
                        ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300 ring-1 ring-indigo-500'
                        : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    <Building2 className="w-4 h-4 text-indigo-600 shrink-0" />
                    <div>
                      <div className="leading-tight">UBL Bank</div>
                      <div className="text-[10px] font-normal text-slate-400 font-urdu">یو بی ایل</div>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setAccountHead('JazzCash');
                      setPaymentMode('JazzCash');
                    }}
                    className={`flex items-center gap-2 p-2 rounded-lg border text-left text-xs font-bold transition ${
                      accountHead === 'JazzCash'
                        ? 'border-orange-500 bg-orange-50 dark:bg-orange-950/50 text-orange-700 dark:text-orange-300 ring-1 ring-orange-500'
                        : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    <Smartphone className="w-4 h-4 text-orange-500 shrink-0" />
                    <div>
                      <div className="leading-tight">JazzCash</div>
                      <div className="text-[10px] font-normal text-slate-400 font-urdu">جاز کیش</div>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setAccountHead('EasyPaisa');
                      setPaymentMode('EasyPaisa');
                    }}
                    className={`flex items-center gap-2 p-2 rounded-lg border text-left text-xs font-bold transition ${
                      accountHead === 'EasyPaisa'
                        ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 ring-1 ring-emerald-500'
                        : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    <CreditCard className="w-4 h-4 text-emerald-600 shrink-0" />
                    <div>
                      <div className="leading-tight">EasyPaisa</div>
                      <div className="text-[10px] font-normal text-slate-400 font-urdu">ایزی پیسہ</div>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setAccountHead('Owner Account');
                      setPaymentMode('Online Account');
                    }}
                    className={`flex items-center gap-2 p-2 rounded-lg border text-left text-xs font-bold transition ${
                      accountHead === 'Owner Account'
                        ? 'border-purple-500 bg-purple-50 dark:bg-purple-950/50 text-purple-700 dark:text-purple-300 ring-1 ring-purple-500'
                        : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    <Landmark className="w-4 h-4 text-purple-600 shrink-0" />
                    <div>
                      <div className="leading-tight">Owner Account</div>
                      <div className="text-[10px] font-normal text-slate-400 font-urdu">مالک کھاتہ</div>
                    </div>
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  <select
                    value={['Meezan Bank', 'UBL Bank', 'JazzCash', 'EasyPaisa', 'Owner Account', 'Cash by Hand'].includes(accountHead) ? accountHead : 'custom'}
                    onChange={e => {
                      const val = e.target.value;
                      if (val === 'custom') {
                        setAccountHead('custom');
                        setPaymentMode('Online Account');
                      } else {
                        setAccountHead(val);
                        setPaymentMode(val);
                      }
                    }}
                    className="flex-1 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-bold text-slate-700 dark:text-slate-200 focus:border-amber-500 focus:outline-none"
                  >
                    <option value="Meezan Bank">🏦 Meezan Bank (Shop Main Account / میزان بینک)</option>
                    <option value="UBL Bank">🏦 UBL Bank (Shop Account / یو بی ایل بینک)</option>
                    <option value="JazzCash">📱 JazzCash (جاز کیش)</option>
                    <option value="EasyPaisa">📱 EasyPaisa (ایزی پیسہ)</option>
                    <option value="Owner Account">👑 Owner Personal Account (مالک کا ذاتی کھاتہ)</option>
                    <option value="Cash by Hand">💵 Cash by Hand (نقد کیش کاؤنٹر)</option>
                    <option value="custom">✏️ Other / Custom Account Head...</option>
                  </select>
                </div>

                {accountHead === 'custom' && (
                  <input
                    type="text"
                    placeholder="Enter Custom Account Name (e.g. Faysal Bank, HBL, UBL)..."
                    value={customAccountHead}
                    onChange={e => setCustomAccountHead(e.target.value)}
                    className="w-full mt-2 px-3 py-2 rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50/30 dark:bg-amber-950/20 text-xs font-bold focus:outline-none"
                  />
                )}
              </div>

              {/* Amount Input */}
              <div>
                <label className="block text-[11px] uppercase tracking-wider text-slate-700 dark:text-slate-200 font-bold mb-1">
                  Amount (PKR) (رقم) *
                </label>
                <div className="relative">
                  <span className="absolute left-3.5 top-3 text-slate-400 font-bold text-sm">PKR</span>
                  <input
                    type="number"
                    min="1"
                    required
                    placeholder="e.g. 50000"
                    value={txAmount}
                    onChange={e => setTxAmount(e.target.value === '' ? '' : Number(e.target.value))}
                    className="w-full pl-14 pr-4 py-2.5 rounded-xl border-2 border-amber-300 dark:border-amber-700 bg-amber-50/40 dark:bg-amber-950/20 text-slate-900 dark:text-slate-100 font-mono text-lg font-black focus:border-amber-500 focus:bg-white dark:focus:bg-slate-900 focus:outline-none"
                  />
                </div>
              </div>

              {/* Trx ID and Sender Name (Useful for Online Received & Bank Transfers) */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400 font-bold mb-1">
                    Online Trx ID / Reference # (اختیاری)
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. TID-984210 / Bank Ref"
                    value={trxId}
                    onChange={e => setTrxId(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-mono focus:border-amber-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400 font-bold mb-1">
                    Sender / Customer Name (بھیجنے والا)
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Customer Name / Client"
                    value={senderName}
                    onChange={e => setSenderName(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs focus:border-amber-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                {/* Date & Time */}
                <div>
                  <label className="block text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400 font-bold mb-1">
                    Date & Time
                  </label>
                  <input
                    type="datetime-local"
                    value={txDate}
                    onChange={e => setTxDate(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-medium focus:border-amber-500 focus:outline-none"
                  />
                </div>

                {/* Handled By / Cashier */}
                <div>
                  <label className="block text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400 font-bold mb-1">
                    Handled By / Cashier
                  </label>
                  <input
                    type="text"
                    value={handledBy}
                    onChange={e => setHandledBy(e.target.value)}
                    placeholder="e.g. Cashier"
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-medium focus:border-amber-500 focus:outline-none"
                  />
                </div>
              </div>

              {/* Quick Description Templates */}
              <div>
                <label className="block text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400 font-bold mb-1.5 flex items-center justify-between">
                  <span>Purpose / Description (تفصیل / وجہ)</span>
                  <span className="text-[10px] text-amber-600 font-normal">Click quick tag below:</span>
                </label>
                
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {(txCategory === 'Online Received' ? [
                    `Online Payment into ${accountHead === 'custom' ? customAccountHead || 'Bank' : accountHead}`,
                    "Customer JazzCash Payment (کسٹمر جاز کیش ٹرانسفر)",
                    "Meezan Bank Online Transfer (میزان بینک میں وصولی)",
                    "Online Advance Received in Owner Account",
                    "EasyPaisa Online Deposit to Shop"
                  ] : [
                    "Daily Shop Cash Handover (شاپ کا روزانہ نقد کیش)",
                    "Owner Personal Drawings (ذاتی خرچ)",
                    "Cash Given for Fabric Purchase (کپڑے کی خریداری)",
                    "Emergency Cash Given",
                    "Capital Inflow (دکان میں انویسٹمنٹ)",
                    "Excess Cash Returned"
                  ]).map((tag, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => setDescription(tag)}
                      className="text-[10px] px-2 py-0.5 bg-slate-100 dark:bg-slate-800 hover:bg-amber-100 dark:hover:bg-amber-950/50 hover:text-amber-800 dark:hover:text-amber-200 text-slate-600 dark:text-slate-300 rounded-md border border-slate-200 dark:border-slate-700 transition"
                    >
                      {tag}
                    </button>
                  ))}
                </div>

                <textarea
                  rows={2}
                  required
                  placeholder="Enter details, reason or remarks..."
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs focus:border-amber-500 focus:outline-none"
                />
              </div>

              {/* Voucher Reference */}
              <div className="pt-1">
                <label className="block text-[10px] uppercase tracking-wider text-slate-400 font-bold mb-1">
                  Voucher # (Auto)
                </label>
                <input
                  type="text"
                  value={voucherNo}
                  onChange={e => setVoucherNo(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-mono font-bold"
                />
              </div>

              {/* Form Action Buttons */}
              <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 text-xs font-bold hover:bg-slate-50 dark:hover:bg-slate-800 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className={`px-5 py-2 rounded-lg text-white text-xs font-bold shadow-md transition disabled:opacity-50 ${
                    txCategory === 'Online Received'
                      ? 'bg-sky-600 hover:bg-sky-700 shadow-sky-600/20'
                      : 'bg-amber-600 hover:bg-amber-700 shadow-amber-600/20'
                  }`}
                >
                  {isSubmitting ? 'Saving...' : (editTxId ? 'Update Voucher' : (txCategory === 'Online Received' ? 'Save Online Receipt' : 'Save Handover Voucher'))}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* STATEMENT PRINT PREVIEW MODAL (A4 مکمل کھاتہ گوشوارہ)                    */}
      {/* ========================================================================= */}
      {showStatementPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm print:bg-transparent print:static print:inset-auto print:block print:z-auto print:p-0 print:m-0">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl max-w-5xl w-full max-h-[95vh] flex flex-col print:shadow-none print:rounded-none print:max-h-none print:max-w-none print:w-full print:block print:m-0 print:p-0 print:border-none">
            {/* Modal Header Bar - Hidden on print */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-850 rounded-t-2xl print:hidden shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-sky-500/10 text-sky-600 flex items-center justify-center">
                  <Printer className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 dark:text-slate-100 text-sm">
                    Owner Account Statement - Print Preview (مالک کا کھاتہ گوشوارہ)
                  </h3>
                  <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    <span>Period: {dateFilter === 'all' ? 'All Time' : `${format(getDateRange().start, 'dd MMM yyyy')} - ${format(getDateRange().end, 'dd MMM yyyy')}`}</span>
                    <span>•</span>
                    <span>{chronologicalList.length} Total Records</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => printInvoice('owner-statement-print', `Owner_Statement_${safeFormat(new Date(), 'yyyyMMdd')}`, 'a4')}
                  className="flex items-center gap-2 px-4 py-2 bg-sky-600 hover:bg-sky-700 text-white rounded-lg text-xs font-bold shadow-md shadow-sky-600/20 transition active:scale-95 cursor-pointer"
                >
                  <Printer className="w-4 h-4" />
                  <span>Print A4 Statement (پرنٹ نکالیں)</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowStatementPreview(false)}
                  className="p-2 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
                  title="Close Preview"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Modal Body: Scrollable A4 Document Preview */}
            <div className="overflow-y-auto p-4 md:p-8 bg-slate-200 dark:bg-slate-950 print:bg-white print:p-0 print:m-0 print:overflow-visible flex justify-center flex-1">
              <div id="owner-statement-print" className="bg-white w-full max-w-[210mm] min-h-[297mm] p-8 shadow-xl print:shadow-none print:p-0 print:max-w-full text-black font-sans text-xs">
                {/* Official Store Letterhead */}
                <div className="border-b-[3px] border-black pb-4 mb-4">
                  <div className="flex justify-between items-start">
                    <div>
                      <h1 className="text-3xl font-black uppercase tracking-wider text-black font-sans">
                        {(currentBranch?.name || 'MANZOOR COLLECTION').toUpperCase()}
                      </h1>
                      <div className="text-xs font-bold text-slate-800 mt-1 space-y-0.5">
                        {currentBranch?.address ? (
                          <p>{currentBranch?.address}</p>
                        ) : (
                          <p>Main Commercial Market • Pakistan</p>
                        )}
                        <p className="flex items-center gap-3">
                          {currentBranch?.phone && (
                            <span>Tel: {currentBranch?.phone}</span>
                          )}
                          {currentBranch?.phone2 && (
                            <span>| Mobile: {currentBranch?.phone2}</span>
                          )}
                          {currentBranch?.onlinePhone && (
                            <span>| Online: {currentBranch?.onlinePhone}</span>
                          )}
                        </p>
                      </div>
                    </div>

                    <div className="text-right">
                      <div className="inline-block border-2 border-black px-3 py-1 text-center mb-1">
                        <div className="text-[9px] uppercase font-mono font-bold tracking-widest text-slate-600">Document Type</div>
                        <div className="text-xs font-black uppercase">Official Ledger</div>
                      </div>
                      <div className="text-[10px] font-mono text-slate-700">
                        Date: {safeFormat(new Date(), 'dd/MM/yyyy hh:mm a')}
                      </div>
                      <div className="text-[10px] font-mono text-slate-700">
                        Ref: STMT-OWN-{safeFormat(new Date(), 'yyMMdd-HHmm')}
                      </div>
                    </div>
                  </div>

                  {/* Statement Title */}
                  <div className="text-center pt-3 mt-2 border-t border-slate-300">
                    <h2 className="text-lg font-black uppercase tracking-wider text-black">
                      OWNER ACCOUNT & CASH / ONLINE STATEMENT
                    </h2>
                    <p className="text-xs font-bold font-urdu text-slate-800 mt-0.5">
                      مالک کا کھاتہ و کیش ہینڈ اوور / آن لائن وصولی گوشوارہ
                    </p>
                    <div className="text-[11px] font-bold text-slate-700 mt-1">
                      Statement Period: {dateFilter === 'all' ? 'All Time (تمام ریکارڈ)' : `${format(getDateRange().start, 'dd MMM yyyy')} - ${format(getDateRange().end, 'dd MMM yyyy')}`}
                      {accountFilter !== 'all' && <span className="ml-2 font-black">• Filter: {accountFilter}</span>}
                      <span className="ml-2 text-slate-500">• Printed By: {user?.name || 'Admin'}</span>
                    </div>
                  </div>
                </div>

                {/* 5-Column Executive Financial Summary KPI Box */}
                <div className="grid grid-cols-5 gap-2 p-3 bg-slate-50 border-2 border-black rounded mb-4 text-xs">
                  <div className="border-r border-slate-300 pr-2">
                    <div className="text-slate-600 text-[9px] uppercase font-bold">Cash Given by Hand:</div>
                    <div className="text-[10px] font-urdu font-semibold text-slate-500">نقد کیش دیا گیا</div>
                    <div className="text-sm font-black text-rose-600 font-mono mt-0.5">PKR {metrics.totalCashGivenOut.toLocaleString()}</div>
                  </div>
                  <div className="border-r border-slate-300 pr-2">
                    <div className="text-slate-600 text-[9px] uppercase font-bold">Online Received:</div>
                    <div className="text-[10px] font-urdu font-semibold text-slate-500">آن لائن کھاتے میں وصولی</div>
                    <div className="text-sm font-black text-sky-600 font-mono mt-0.5">PKR {metrics.totalOnlineReceived.toLocaleString()}</div>
                  </div>
                  <div className="border-r border-slate-300 pr-2">
                    <div className="text-slate-600 text-[9px] uppercase font-bold">Sales Transferred:</div>
                    <div className="text-[10px] font-urdu font-semibold text-slate-500">سیل سے جمع رقم</div>
                    <div className="text-sm font-black text-indigo-600 font-mono mt-0.5">PKR {metrics.totalSalesInOwnerAccount.toLocaleString()}</div>
                  </div>
                  <div className="border-r border-slate-300 pr-2">
                    <div className="text-slate-600 text-[9px] uppercase font-bold">Received from Owner:</div>
                    <div className="text-[10px] font-urdu font-semibold text-slate-500">مالک سے واپس وصول</div>
                    <div className="text-sm font-black text-emerald-600 font-mono mt-0.5">PKR {metrics.totalReceivedBackIn.toLocaleString()}</div>
                  </div>
                  <div>
                    <div className="text-slate-900 text-[9px] uppercase font-black">Net Cash with Owner:</div>
                    <div className="text-[10px] font-urdu font-bold text-slate-700">خالص بقایا بیلنس</div>
                    <div className="text-sm font-black text-amber-700 font-mono mt-0.5">PKR {metrics.netOwnerBalance.toLocaleString()}</div>
                  </div>
                </div>

                {/* Head-wise Summary Breakdown Strip */}
                <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5 bg-slate-100 border border-slate-300 rounded mb-3 text-[10px] font-bold">
                  <div>
                    <span className="text-slate-500">Meezan Bank:</span>{' '}
                    <span className="font-mono font-black text-black">PKR {metrics.meezanTotal.toLocaleString()}</span>
                  </div>
                  <div>
                    <span className="text-slate-500">UBL Bank:</span>{' '}
                    <span className="font-mono font-black text-black">PKR {metrics.ublTotal.toLocaleString()}</span>
                  </div>
                  <div>
                    <span className="text-slate-500">JazzCash:</span>{' '}
                    <span className="font-mono font-black text-black">PKR {metrics.jazzCashTotal.toLocaleString()}</span>
                  </div>
                  <div>
                    <span className="text-slate-500">EasyPaisa:</span>{' '}
                    <span className="font-mono font-black text-black">PKR {metrics.easyPaisaTotal.toLocaleString()}</span>
                  </div>
                  <div>
                    <span className="text-slate-500">Cash Handover:</span>{' '}
                    <span className="font-mono font-black text-black">PKR {metrics.cashTotal.toLocaleString()}</span>
                  </div>
                </div>

                {/* Detailed Chronological Ledger Table */}
                <table className="w-full text-left border-collapse text-[11px] mb-6">
                  <thead>
                    <tr className="border-y-2 border-black bg-slate-100 font-black uppercase text-[9px]">
                      <th className="py-2 px-1 text-center w-7">#</th>
                      <th className="py-2 px-2 w-24">Date</th>
                      <th className="py-2 px-2 w-28">Voucher #</th>
                      <th className="py-2 px-2 w-24">Category</th>
                      <th className="py-2 px-2 w-28">Account Head</th>
                      <th className="py-2 px-2">Particulars / Trx ID / Sender</th>
                      <th className="py-2 px-2 w-20">Handled By</th>
                      <th className="py-2 px-2 text-right w-24">Debit (Given)</th>
                      <th className="py-2 px-2 text-right w-24">Credit (Recv)</th>
                      <th className="py-2 px-2 text-right w-28">Balance (PKR)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-300">
                    {chronologicalList.length === 0 ? (
                      <tr>
                        <td colSpan={10} className="py-6 text-center text-slate-500 italic">
                          No transactions recorded for the selected period.
                        </td>
                      </tr>
                    ) : (
                      chronologicalList.map((row, rIdx) => {
                        const isOut = row.type === 'OUT' || row.category === 'Online Received' || row.category === 'Sale Payment' || row.source === 'sale';
                        return (
                          <tr key={rIdx} className="hover:bg-slate-50">
                            <td className="py-1.5 px-1 text-center font-mono text-slate-500">{row.seqNo || rIdx + 1}</td>
                            <td className="py-1.5 px-2 whitespace-nowrap font-mono">{safeFormat(row.date, 'dd/MM/yyyy')}</td>
                            <td className="py-1.5 px-2 font-mono font-bold">{row.voucherNo}</td>
                            <td className="py-1.5 px-2 font-semibold">
                              {row.category === 'Online Received' 
                                ? 'Online Recv' 
                                : (row.type === 'OUT' ? 'Cash Given' : (row.source === 'sale' ? 'Sale Trans' : 'Cash Recv'))}
                            </td>
                            <td className="py-1.5 px-2 font-bold">{row.accountHead || row.paymentMode}</td>
                            <td className="py-1.5 px-2 text-slate-800">
                              <div>{row.description}</div>
                              {(row.trxId || row.senderName) && (
                                <div className="text-[9px] font-mono text-slate-600 mt-0.5">
                                  {row.trxId && <span>Trx: {row.trxId} </span>}
                                  {row.senderName && <span>(From: {row.senderName})</span>}
                                </div>
                              )}
                            </td>
                            <td className="py-1.5 px-2 text-slate-600">{row.handledBy || '-'}</td>
                            <td className="py-1.5 px-2 text-right font-mono font-bold text-rose-600">
                              {isOut ? Number(row.amount || 0).toLocaleString() : '-'}
                            </td>
                            <td className="py-1.5 px-2 text-right font-mono font-bold text-emerald-600">
                              {!isOut ? Number(row.amount || 0).toLocaleString() : '-'}
                            </td>
                            <td className="py-1.5 px-2 text-right font-mono font-black text-black">
                              {Number(row.runningBalance || 0).toLocaleString()}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-black bg-slate-100 font-black text-xs">
                      <td colSpan={7} className="py-2.5 px-2 text-right uppercase">
                        Total Sums / Net Balance (خالص کل ٹوٹل):
                      </td>
                      <td className="py-2.5 px-2 text-right font-mono text-rose-700">
                        PKR {(metrics.totalCashGivenOut + metrics.totalOnlineReceived + metrics.totalSalesInOwnerAccount).toLocaleString()}
                      </td>
                      <td className="py-2.5 px-2 text-right font-mono text-emerald-700">
                        PKR {metrics.totalReceivedBackIn.toLocaleString()}
                      </td>
                      <td className="py-2.5 px-2 text-right font-mono text-amber-800 text-sm">
                        PKR {metrics.netOwnerBalance.toLocaleString()}
                      </td>
                    </tr>
                  </tfoot>
                </table>

                {/* Official Signatures Block */}
                <div className="pt-10 grid grid-cols-3 gap-6 text-center text-xs mt-6 border-t border-slate-300">
                  <div>
                    <div className="border-t-2 border-black pt-1.5 font-bold">Prepared By / Cashier</div>
                    <div className="text-[10px] font-urdu font-semibold text-slate-600">تیار کنندہ (کیشیئر)</div>
                    <div className="text-[10px] text-slate-500 font-mono mt-0.5">{user?.name || 'Staff'}</div>
                  </div>
                  <div>
                    <div className="border-t-2 border-black pt-1.5 font-bold">Verified By / Accountant</div>
                    <div className="text-[10px] font-urdu font-semibold text-slate-600">تصدیق کنندہ (اکاؤنٹنٹ)</div>
                    <div className="text-[10px] text-slate-500 font-mono mt-0.5">Accounts Office</div>
                  </div>
                  <div>
                    <div className="border-t-2 border-black pt-1.5 font-bold">Owner Signature & Stamp</div>
                    <div className="text-[10px] font-urdu font-semibold text-slate-600">دستخط و مہر مالک</div>
                    <div className="text-[10px] text-slate-500 font-mono mt-0.5">Manzoor Ahmed</div>
                  </div>
                </div>

                {/* Computer Generated Notice */}
                <div className="mt-8 pt-2 border-t border-slate-200 flex justify-between items-center text-[9px] text-slate-500 font-mono">
                  <span>System Generated Official Financial Statement • Valid without alteration</span>
                  <span>Generated on: {safeFormat(new Date(), 'dd/MM/yyyy HH:mm:ss')}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* SINGLE VOUCHER PRINT PREVIEW MODAL (تھرمل یا A4 واؤچر سلپ)               */}
      {/* ========================================================================= */}
      {printTx && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm print:bg-transparent print:static print:inset-auto print:block print:z-auto print:p-0 print:m-0">
          <div className={`bg-white dark:bg-slate-900 rounded-2xl shadow-2xl ${voucherPrintFormat === 'thermal' ? 'w-[90mm] max-w-[95vw]' : 'max-w-2xl w-full'} max-h-[95vh] flex flex-col print:shadow-none print:rounded-none print:max-h-none print:max-w-none print:w-full print:block print:m-0 print:p-0 print:border-none`}>
            {/* Modal Header Bar - Hidden in print */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-850 rounded-t-2xl print:hidden shrink-0">
              <div className="flex items-center gap-2">
                <div className="flex rounded-lg bg-slate-200 dark:bg-slate-800 p-0.5">
                  <button
                    type="button"
                    onClick={() => setVoucherPrintFormat('thermal')}
                    className={`px-3 py-1 rounded-md text-xs font-bold transition ${
                      voucherPrintFormat === 'thermal'
                        ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                    }`}
                  >
                    Thermal 80mm (رسید)
                  </button>
                  <button
                    type="button"
                    onClick={() => setVoucherPrintFormat('a4')}
                    className={`px-3 py-1 rounded-md text-xs font-bold transition ${
                      voucherPrintFormat === 'a4'
                        ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                    }`}
                  >
                    A4 Slip (واؤچر)
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => printInvoice('owner-voucher-print', `Owner_Voucher_${printTx.voucherNo}`, voucherPrintFormat)}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-bold shadow-md shadow-amber-600/20 transition active:scale-95 cursor-pointer"
                >
                  <Printer className="w-4 h-4" />
                  <span>Print Voucher (پرنٹ کریں)</span>
                </button>
                <button
                  type="button"
                  onClick={() => setPrintTx(null)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Modal Body: Scrollable Voucher Preview */}
            <div className="overflow-y-auto p-4 md:p-6 bg-slate-200 dark:bg-slate-950 print:bg-white print:p-0 print:m-0 print:overflow-visible flex justify-center flex-1">
              <div id="owner-voucher-print" className="bg-white text-black font-sans shadow-lg print:shadow-none print:p-0">
                {voucherPrintFormat === 'thermal' ? (
                  /* THERMAL 80MM POS RECEIPT LAYOUT */
                  <div className="w-[76mm] max-w-[80mm] mx-auto p-4 text-center space-y-2 text-xs">
                    <h1 className="text-3xl print:text-4xl font-black uppercase tracking-wider">
                      {branches.find(b => b.id === (printTx.branchId || currentBranchId))?.name || currentBranch?.name || 'Manzoor Collection'}
                    </h1>
                    {(branches.find(b => b.id === (printTx.branchId || currentBranchId))?.phone || branches.find(b => b.id === (printTx.branchId || currentBranchId))?.address) && (
                      <p className="text-[10px] font-bold text-slate-700">
                        {branches.find(b => b.id === (printTx.branchId || currentBranchId))?.address && <span>{branches.find(b => b.id === (printTx.branchId || currentBranchId))?.address}</span>}
                        {branches.find(b => b.id === (printTx.branchId || currentBranchId))?.phone && <span> • Tel: {branches.find(b => b.id === (printTx.branchId || currentBranchId))?.phone}</span>}
                      </p>
                    )}

                    <div className="text-[11px] font-black border-y-2 border-black py-1 uppercase tracking-wider mt-1">
                      {printTx.category === 'Online Received' 
                        ? 'ONLINE PAYMENT RECEIPT' 
                        : (printTx.type === 'OUT' ? 'CASH HANDOVER VOUCHER' : 'CASH RECEIPT VOUCHER')}
                    </div>
                    <div className="text-[10px] font-urdu font-bold">
                      {printTx.category === 'Online Received'
                        ? 'سند برائے آن لائن رقم وصولی بحوالہ کھاتہ'
                        : (printTx.type === 'OUT' ? 'سند برائے ادائیگی نقد کیش بحوالہ مالک' : 'سند برائے وصولی نقد کیش از مالک')}
                    </div>

                    <div className="text-left text-xs space-y-1 pt-2 border-b border-black pb-2">
                      <div className="flex justify-between">
                        <span className="font-bold">Voucher #:</span>
                        <span className="font-mono font-black">{printTx.voucherNo}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Date & Time:</span>
                        <span className="font-mono">{safeFormat(printTx.date, 'dd/MM/yyyy hh:mm a')}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Account / Channel:</span>
                        <span className="font-bold">{printTx.accountHead || printTx.paymentMode || 'Meezan Bank'}</span>
                      </div>
                      {printTx.trxId && (
                        <div className="flex justify-between">
                          <span>Trx ID / Ref:</span>
                          <span className="font-mono font-bold">{printTx.trxId}</span>
                        </div>
                      )}
                      {printTx.senderName && (
                        <div className="flex justify-between">
                          <span>Sender / Customer:</span>
                          <span className="font-bold">{printTx.senderName}</span>
                        </div>
                      )}
                      <div className="flex justify-between">
                        <span>Owner / Party:</span>
                        <span className="font-bold">{printTx.ownerName}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Handed By:</span>
                        <span>{printTx.handledBy || user?.name}</span>
                      </div>
                    </div>

                    <div className="text-left pt-2 pb-2 border-b border-black">
                      <div className="font-bold uppercase text-[9px] text-slate-600">Particulars / Reason:</div>
                      <div className="text-xs font-semibold mt-0.5">{printTx.description}</div>
                    </div>

                    <div className="py-2 text-center border-b-2 border-black">
                      <div className="text-[9px] uppercase font-bold text-slate-500">Transacted Amount</div>
                      <div className="text-2xl font-black mt-0.5 font-mono">
                        PKR {Number(printTx.amount || 0).toLocaleString()}
                      </div>
                      <div className="text-[10px] font-semibold italic text-slate-700 mt-1">
                        {numberToWords(Number(printTx.amount || 0))}
                      </div>
                    </div>

                    <div className="pt-6 grid grid-cols-2 gap-4 text-center text-[10px]">
                      <div>
                        <div className="border-t border-black pt-1 font-bold">Staff Signature</div>
                        <div className="text-[9px] text-slate-500 mt-0.5">دستخط کیشیئر</div>
                      </div>
                      <div>
                        <div className="border-t border-black pt-1 font-bold">Owner Signature</div>
                        <div className="text-[9px] text-slate-500 mt-0.5">دستخط مالک</div>
                      </div>
                    </div>

                    <div className="text-[8px] text-slate-500 pt-2 text-center font-mono">
                      System Generated Voucher &bull; {safeFormat(new Date(), 'dd/MM/yyyy HH:mm')}
                    </div>
                  </div>
                ) : (
                  /* A4 VOUCHER CARD LAYOUT */
                  <div className="w-full max-w-[180mm] p-6 text-left border-2 border-black rounded-lg space-y-4 text-xs">
                    <div className="flex justify-between items-start border-b-2 border-black pb-3">
                      <div>
                        <h2 className="text-3xl font-black uppercase tracking-wider">
                          {branches.find(b => b.id === (printTx.branchId || currentBranchId))?.name || currentBranch?.name || 'Manzoor Collection'}
                        </h2>
                        <p className="text-[11px] text-slate-700 font-bold">
                          {branches.find(b => b.id === (printTx.branchId || currentBranchId))?.address} • Tel: {branches.find(b => b.id === (printTx.branchId || currentBranchId))?.phone}
                        </p>
                      </div>
                      <div className="text-right">
                        <div className="text-base font-black font-mono">{printTx.voucherNo}</div>
                        <div className="text-[11px] font-mono text-slate-600">{safeFormat(printTx.date, 'dd/MM/yyyy hh:mm a')}</div>
                      </div>
                    </div>

                    <div className="text-center py-1 bg-slate-100 border border-slate-300 font-black uppercase text-sm">
                      {printTx.category === 'Online Received'
                        ? 'ONLINE PAYMENT RECEIPT (آن لائن وصولی سند)'
                        : (printTx.type === 'OUT' ? 'CASH HANDOVER VOUCHER (مالک کو نقد کیش واؤچر)' : 'CASH RECEIPT VOUCHER (مالک سے نقد وصولی)')}
                    </div>

                    <div className="grid grid-cols-2 gap-4 p-3 bg-slate-50 border border-slate-200 rounded">
                      <div>
                        <span className="text-slate-500 uppercase text-[10px] font-bold block">Account / Channel Head:</span>
                        <span className="font-bold text-sm text-black">{printTx.accountHead || printTx.paymentMode}</span>
                      </div>
                      <div>
                        <span className="text-slate-500 uppercase text-[10px] font-bold block">Owner / Beneficiary:</span>
                        <span className="font-bold text-sm text-black">{printTx.ownerName}</span>
                      </div>
                      {printTx.trxId && (
                        <div>
                          <span className="text-slate-500 uppercase text-[10px] font-bold block">Trx ID / Ref:</span>
                          <span className="font-mono font-bold text-black">{printTx.trxId}</span>
                        </div>
                      )}
                      {printTx.senderName && (
                        <div>
                          <span className="text-slate-500 uppercase text-[10px] font-bold block">Sender / Customer:</span>
                          <span className="font-bold text-black">{printTx.senderName}</span>
                        </div>
                      )}
                      <div>
                        <span className="text-slate-500 uppercase text-[10px] font-bold block">Handled By:</span>
                        <span className="font-semibold text-black">{printTx.handledBy || user?.name}</span>
                      </div>
                      <div>
                        <span className="text-slate-500 uppercase text-[10px] font-bold block">Transaction Category:</span>
                        <span className="font-semibold text-black">{printTx.category}</span>
                      </div>
                    </div>

                    <div className="p-3 border border-slate-200 rounded">
                      <span className="text-slate-500 uppercase text-[10px] font-bold block">Particulars / Reason:</span>
                      <p className="font-semibold text-black mt-1">{printTx.description}</p>
                    </div>

                    <div className="p-4 bg-slate-100 border-2 border-black rounded text-center">
                      <span className="text-slate-600 uppercase text-[10px] font-bold block">Total Amount Transacted</span>
                      <div className="text-2xl font-black font-mono text-black mt-0.5">
                        PKR {Number(printTx.amount || 0).toLocaleString()}
                      </div>
                      <div className="text-xs font-bold italic text-slate-800 mt-1">
                        Amount in Words: {numberToWords(Number(printTx.amount || 0))}
                      </div>
                    </div>

                    <div className="pt-10 grid grid-cols-2 gap-8 text-center text-xs">
                      <div>
                        <div className="border-t-2 border-black pt-1 font-bold">Staff / Cashier Signature</div>
                        <div className="text-[10px] text-slate-500 mt-0.5">دستخط کیشیئر</div>
                      </div>
                      <div>
                        <div className="border-t-2 border-black pt-1 font-bold">Owner Signature & Stamp</div>
                        <div className="text-[10px] text-slate-500 mt-0.5">دستخط و مہر مالک</div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* ONLINE BILLS STATEMENT PRINT PREVIEW MODAL (A4 آن لائن بلز رپورٹ)           */}
      {/* ========================================================================= */}
      {showOnlineStatementPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm print:bg-transparent print:static print:inset-auto print:block print:z-auto print:p-0 print:m-0">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl max-w-5xl w-full max-h-[95vh] flex flex-col print:shadow-none print:rounded-none print:max-h-none print:max-w-none print:w-full print:block print:m-0 print:p-0 print:border-none">
            {/* Modal Header Bar - Hidden on print */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-850 rounded-t-2xl print:hidden shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-sky-500/10 text-sky-600 flex items-center justify-center">
                  <Globe className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 dark:text-slate-100 text-sm">
                    Online Bills Received Payments - Print Preview (آن لائن بلز رپورٹ)
                  </h3>
                  <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    <span>Period: {dateFilter === 'all' ? 'All Time' : `${format(getDateRange().start, 'dd MMM yyyy')} - ${format(getDateRange().end, 'dd MMM yyyy')}`}</span>
                    <span>•</span>
                    <span>{onlineBillsList.length} Total Online Bills</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => printInvoice('online-statement-print', `Online_Bills_Statement_${safeFormat(new Date(), 'yyyyMMdd')}`, 'a4')}
                  className="flex items-center gap-2 px-4 py-2 bg-sky-600 hover:bg-sky-700 text-white rounded-lg text-xs font-bold shadow-md shadow-sky-600/20 transition active:scale-95 cursor-pointer"
                >
                  <Printer className="w-4 h-4" />
                  <span>Print A4 Report (پرنٹ نکالیں)</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowOnlineStatementPreview(false)}
                  className="p-2 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer"
                  title="Close Preview"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Modal Body: Scrollable A4 Document Preview */}
            <div className="overflow-y-auto p-4 md:p-8 bg-slate-200 dark:bg-slate-950 print:bg-white print:p-0 print:m-0 print:overflow-visible flex justify-center flex-1">
              <div id="online-statement-print" className="bg-white w-full max-w-[210mm] min-h-[297mm] p-8 shadow-xl print:shadow-none print:p-0 print:max-w-full text-black font-sans text-xs">
                {/* Official Store Letterhead */}
                <div className="border-b-[3px] border-black pb-4 mb-4">
                  <div className="flex justify-between items-start">
                    <div>
                      <h1 className="text-3xl font-black uppercase tracking-wider text-black font-sans">
                        {(currentBranch?.name || 'MANZOOR COLLECTION').toUpperCase()}
                      </h1>
                      <div className="text-xs font-bold text-slate-800 mt-1 space-y-0.5">
                        {currentBranch?.address ? (
                          <p>{currentBranch?.address}</p>
                        ) : (
                          <p>Main Commercial Market • Pakistan</p>
                        )}
                        <p className="flex items-center gap-3">
                          {currentBranch?.phone && (
                            <span>Tel: {currentBranch?.phone}</span>
                          )}
                          {currentBranch?.phone2 && (
                            <span>| Mobile: {currentBranch?.phone2}</span>
                          )}
                          {currentBranch?.onlinePhone && (
                            <span>| Online: {currentBranch?.onlinePhone}</span>
                          )}
                        </p>
                      </div>
                    </div>

                    <div className="text-right">
                      <div className="inline-block border-2 border-black px-3 py-1 text-center mb-1">
                        <div className="text-[9px] uppercase font-mono font-bold tracking-widest text-slate-600">Document Type</div>
                        <div className="text-xs font-black uppercase">Online Billing Statement</div>
                      </div>
                      <div className="text-[10px] font-mono text-slate-700">
                        Date: {safeFormat(new Date(), 'dd/MM/yyyy hh:mm a')}
                      </div>
                      <div className="text-[10px] font-mono text-slate-700">
                        Ref: ONL-STMT-{safeFormat(new Date(), 'yyMMdd-HHmm')}
                      </div>
                    </div>
                  </div>

                  {/* Statement Title */}
                  <div className="text-center pt-3 mt-2 border-t border-slate-300">
                    <h2 className="text-lg font-black uppercase tracking-wider text-black">
                      ONLINE BILLS RECEIVED PAYMENTS STATEMENT
                    </h2>
                    <p className="text-xs font-bold font-urdu text-slate-800 mt-0.5">
                      آن لائن بلز و موصول شدہ ایڈوانس و مکمل پیمنٹس گوشوارہ
                    </p>
                    <div className="text-[11px] font-bold text-slate-700 mt-1">
                      Statement Period: {dateFilter === 'all' ? 'All Time (تمام ریکارڈ)' : `${format(getDateRange().start, 'dd MMM yyyy')} - ${format(getDateRange().end, 'dd MMM yyyy')}`}
                      {accountFilter !== 'all' && <span className="ml-2 font-black">• Channel: {accountFilter}</span>}
                      <span className="ml-2 text-slate-500">• Printed By: {user?.name || 'Admin'}</span>
                    </div>
                  </div>
                </div>

                {/* 4-Column Summary Box */}
                <div className="grid grid-cols-4 gap-2 p-3 bg-slate-50 border-2 border-black rounded mb-4 text-xs">
                  <div className="border-r border-slate-300 pr-2">
                    <div className="text-slate-600 text-[9px] uppercase font-bold">Total Online Received:</div>
                    <div className="text-[10px] font-urdu font-semibold text-slate-500">آن لائن وصول شدہ رقم</div>
                    <div className="text-sm font-black text-emerald-600 font-mono mt-0.5">PKR {onlineBillsMetrics.totalOnlineReceived.toLocaleString()}</div>
                  </div>
                  <div className="border-r border-slate-300 pr-2">
                    <div className="text-slate-600 text-[9px] uppercase font-bold">Total Orders Booked:</div>
                    <div className="text-[10px] font-urdu font-semibold text-slate-500">کل آن لائن بلز</div>
                    <div className="text-sm font-black text-slate-900 font-mono mt-0.5">{onlineBillsMetrics.totalBillsCount} Bills</div>
                  </div>
                  <div className="border-r border-slate-300 pr-2">
                    <div className="text-slate-600 text-[9px] uppercase font-bold">Total Orders Value:</div>
                    <div className="text-[10px] font-urdu font-semibold text-slate-500">کل سیلز رقم</div>
                    <div className="text-sm font-black text-indigo-600 font-mono mt-0.5">PKR {onlineBillsMetrics.totalBillValue.toLocaleString()}</div>
                  </div>
                  <div>
                    <div className="text-slate-900 text-[9px] uppercase font-black">Pending COD / Bal:</div>
                    <div className="text-[10px] font-urdu font-bold text-slate-700">بقایا سی او ڈی رقم</div>
                    <div className="text-sm font-black text-amber-700 font-mono mt-0.5">PKR {onlineBillsMetrics.totalPendingCOD.toLocaleString()}</div>
                  </div>
                </div>

                {/* Channel Breakdown */}
                <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5 bg-slate-100 border border-slate-300 rounded mb-3 text-[10px] font-bold">
                  <div>
                    <span className="text-slate-500">Meezan Bank:</span>{' '}
                    <span className="font-mono font-black text-black">PKR {onlineBillsMetrics.meezanTotal.toLocaleString()}</span>
                  </div>
                  <div>
                    <span className="text-slate-500">UBL Bank:</span>{' '}
                    <span className="font-mono font-black text-black">PKR {onlineBillsMetrics.ublTotal.toLocaleString()}</span>
                  </div>
                  <div>
                    <span className="text-slate-500">JazzCash:</span>{' '}
                    <span className="font-mono font-black text-black">PKR {onlineBillsMetrics.jazzCashTotal.toLocaleString()}</span>
                  </div>
                  <div>
                    <span className="text-slate-500">EasyPaisa:</span>{' '}
                    <span className="font-mono font-black text-black">PKR {onlineBillsMetrics.easyPaisaTotal.toLocaleString()}</span>
                  </div>
                </div>

                {/* Detailed Online Bills Table */}
                <table className="w-full text-left border-collapse text-[11px] mb-6">
                  <thead>
                    <tr className="border-y-2 border-black bg-slate-100 font-black uppercase text-[9px]">
                      <th className="py-2 px-1 text-center w-7">#</th>
                      <th className="py-2 px-2 w-20">Date</th>
                      <th className="py-2 px-2 w-24">Bill #</th>
                      <th className="py-2 px-2">Customer Details</th>
                      <th className="py-2 px-2 w-24">Staff / Booker</th>
                      <th className="py-2 px-2 w-24">Channel</th>
                      <th className="py-2 px-2 w-20">Trx ID</th>
                      <th className="py-2 px-2 text-right w-20">Bill Total</th>
                      <th className="py-2 px-2 text-right w-24">Online Recv</th>
                      <th className="py-2 px-2 text-right w-20">Balance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-300">
                    {onlineBillsList.length === 0 ? (
                      <tr>
                        <td colSpan={10} className="py-6 text-center text-slate-500 italic">
                          No online bills found for the selected period.
                        </td>
                      </tr>
                    ) : (
                      onlineBillsList.map((row, rIdx) => {
                        const recAmt = Number(row.onlineReceivedAmount || row.amount) || 0;
                        const billTot = Number(row.billTotal) || 0;
                        const bal = Number(row.balance) || 0;

                        return (
                          <tr key={rIdx} className="hover:bg-slate-50">
                            <td className="py-1.5 px-1 text-center font-mono text-slate-500">{rIdx + 1}</td>
                            <td className="py-1.5 px-2 whitespace-nowrap font-mono">{safeFormat(row.date, 'dd/MM/yyyy')}</td>
                            <td className="py-1.5 px-2 font-mono font-bold">#{row.voucherNo}</td>
                            <td className="py-1.5 px-2 font-semibold">
                              <div>{row.customerName || 'Online Customer'}</div>
                              {row.customerPhone && <div className="text-[9px] text-slate-500 font-mono">{row.customerPhone}</div>}
                            </td>
                            <td className="py-1.5 px-2 text-slate-700">
                              <div>{row.onlineEmployeeName || row.handledBy || '-'}</div>
                              {row.onlineEmployeeCode && <div className="text-[9px] text-slate-400 font-mono">{row.onlineEmployeeCode}</div>}
                            </td>
                            <td className="py-1.5 px-2 font-bold">{row.accountHead || row.paymentMode}</td>
                            <td className="py-1.5 px-2 font-mono text-[9px]">{row.trxId || '-'}</td>
                            <td className="py-1.5 px-2 text-right font-mono text-slate-700">
                              {billTot > 0 ? billTot.toLocaleString() : '-'}
                            </td>
                            <td className="py-1.5 px-2 text-right font-mono font-black text-emerald-700">
                              PKR {recAmt.toLocaleString()}
                            </td>
                            <td className="py-1.5 px-2 text-right font-mono font-bold text-amber-700">
                              {bal > 0 ? bal.toLocaleString() : 'Nil'}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-black bg-slate-100 font-black text-xs">
                      <td colSpan={7} className="py-2.5 px-2 text-right uppercase">
                        Total Online Bills Received (کل وصولی):
                      </td>
                      <td className="py-2.5 px-2 text-right font-mono text-slate-800">
                        PKR {onlineBillsMetrics.totalBillValue.toLocaleString()}
                      </td>
                      <td className="py-2.5 px-2 text-right font-mono text-emerald-700 text-sm">
                        PKR {onlineBillsMetrics.totalOnlineReceived.toLocaleString()}
                      </td>
                      <td className="py-2.5 px-2 text-right font-mono text-amber-800">
                        PKR {onlineBillsMetrics.totalPendingCOD.toLocaleString()}
                      </td>
                    </tr>
                  </tfoot>
                </table>

                {/* Signatures Block */}
                <div className="pt-10 grid grid-cols-3 gap-6 text-center text-xs mt-6 border-t border-slate-300">
                  <div>
                    <div className="border-t-2 border-black pt-1.5 font-bold">Online Department / Lead</div>
                    <div className="text-[10px] font-urdu font-semibold text-slate-600">آن لائن سیلز ٹیم</div>
                    <div className="text-[10px] text-slate-500 font-mono mt-0.5">{user?.name || 'Staff'}</div>
                  </div>
                  <div>
                    <div className="border-t-2 border-black pt-1.5 font-bold">Verified By / Accountant</div>
                    <div className="text-[10px] font-urdu font-semibold text-slate-600">تصدیق کنندہ (اکاؤنٹنٹ)</div>
                    <div className="text-[10px] text-slate-500 font-mono mt-0.5">Accounts Office</div>
                  </div>
                  <div>
                    <div className="border-t-2 border-black pt-1.5 font-bold">Owner Signature & Stamp</div>
                    <div className="text-[10px] font-urdu font-semibold text-slate-600">دستخط و مہر مالک</div>
                    <div className="text-[10px] text-slate-500 font-mono mt-0.5">Manzoor Ahmed</div>
                  </div>
                </div>

                {/* Computer Generated Notice */}
                <div className="mt-8 pt-2 border-t border-slate-200 flex justify-between items-center text-[9px] text-slate-500 font-mono">
                  <span>System Generated Online Billing Statement • Valid without alteration</span>
                  <span>Generated on: {safeFormat(new Date(), 'dd/MM/yyyy HH:mm:ss')}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* ========================================================================= */}
      {/* SALE TYPE STATEMENT PRINT PREVIEW MODAL (A4 سیل ٹائپ موازنہ رپورٹ)         */}
      {/* ========================================================================= */}
      {showSaleTypeStatementPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm print:bg-transparent print:static print:inset-auto print:block print:z-auto print:p-0 print:m-0">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl max-w-5xl w-full max-h-[95vh] flex flex-col print:shadow-none print:rounded-none print:max-h-none print:max-w-none print:w-full print:block print:m-0 print:p-0 print:border-none">
            {/* Modal Header Bar - Hidden on print */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-850 rounded-t-2xl print:hidden shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-indigo-500/10 text-indigo-600 flex items-center justify-center">
                  <BarChart3 className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 dark:text-slate-100 text-sm">
                    Sale Type Comparison Report - Print Preview (سیل ٹائپ موازنہ رپورٹ)
                  </h3>
                  <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    <span>Period: {dateFilter === 'all' ? 'All Time' : `${format(getDateRange().start, 'dd MMM yyyy')} - ${format(getDateRange().end, 'dd MMM yyyy')}`}</span>
                    <span>•</span>
                    <span>{saleBillsList.length} Total Sale Bills</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => printInvoice('sale-type-statement-print', `Sale_Type_Statement_${safeFormat(new Date(), 'yyyyMMdd')}`, 'a4')}
                  className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold shadow-md shadow-indigo-600/20 transition active:scale-95 cursor-pointer"
                >
                  <Printer className="w-4 h-4" />
                  <span>Print A4 Report (پرنٹ نکالیں)</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowSaleTypeStatementPreview(false)}
                  className="p-2 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer"
                  title="Close Preview"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Modal Body: Scrollable A4 Document Preview */}
            <div className="overflow-y-auto p-4 md:p-8 bg-slate-200 dark:bg-slate-950 print:bg-white print:p-0 print:m-0 print:overflow-visible flex justify-center flex-1">
              <div id="sale-type-statement-print" className="bg-white w-full max-w-[210mm] min-h-[297mm] p-8 shadow-xl print:shadow-none print:p-0 print:max-w-full text-black font-sans text-xs">
                {/* Official Store Letterhead */}
                <div className="border-b-[3px] border-black pb-4 mb-4">
                  <div className="flex justify-between items-start">
                    <div>
                      <h1 className="text-3xl font-black uppercase tracking-wider text-black font-sans">
                        {(currentBranch?.name || 'MANZOOR COLLECTION').toUpperCase()}
                      </h1>
                      <div className="text-xs font-bold text-slate-800 mt-1 space-y-0.5">
                        {currentBranch?.address ? (
                          <p>{currentBranch?.address}</p>
                        ) : (
                          <p>Main Commercial Market • Pakistan</p>
                        )}
                        <p className="flex items-center gap-3">
                          {currentBranch?.phone && (
                            <span>Tel: {currentBranch?.phone}</span>
                          )}
                          {currentBranch?.phone2 && (
                            <span>| Mobile: {currentBranch?.phone2}</span>
                          )}
                          {currentBranch?.onlinePhone && (
                            <span>| Online: {currentBranch?.onlinePhone}</span>
                          )}
                        </p>
                      </div>
                    </div>

                    <div className="text-right">
                      <div className="inline-block border-2 border-black px-3 py-1 text-center mb-1">
                        <div className="text-[9px] uppercase font-mono font-bold tracking-widest text-slate-600">Document Type</div>
                        <div className="text-xs font-black uppercase">Sale Type Statement</div>
                      </div>
                      <div className="text-[10px] font-mono text-slate-700">
                        Date: {safeFormat(new Date(), 'dd/MM/yyyy hh:mm a')}
                      </div>
                      <div className="text-[10px] font-mono text-slate-700">
                        Ref: ST-STMT-{safeFormat(new Date(), 'yyMMdd-HHmm')}
                      </div>
                    </div>
                  </div>

                  {/* Statement Title */}
                  <div className="text-center pt-3 mt-2 border-t border-slate-300">
                    <h2 className="text-lg font-black uppercase tracking-wider text-black">
                      SALE TYPE AUDIT & REVENUE COMPARISON STATEMENT
                    </h2>
                    <p className="text-xs font-bold font-urdu text-slate-800 mt-0.5">
                      آن لائن ڈیلیوری اور اِن اسٹور کاؤنٹر سیلز اور کھاتہ وصولی کا تفصیلی موازنہ
                    </p>
                    <div className="text-[11px] font-bold text-slate-700 mt-1">
                      Statement Period: {dateFilter === 'all' ? 'All Time (تمام ریکارڈ)' : `${format(getDateRange().start, 'dd MMM yyyy')} - ${format(getDateRange().end, 'dd MMM yyyy')}`}
                      {accountFilter !== 'all' && <span className="ml-2 font-black">• Filtered Account: {accountFilter}</span>}
                      {saleTypeSubFilter !== 'all' && <span className="ml-2 font-black">• Sale Type: {saleTypeSubFilter}</span>}
                      <span className="ml-2 text-slate-500">• Printed By: {user?.name || 'Admin'}</span>
                    </div>
                  </div>
                </div>

                {/* 3-Column Executive Summary Box */}
                <div className="grid grid-cols-3 gap-2 p-3 bg-slate-50 border-2 border-black rounded mb-4 text-xs">
                  <div className="border-r border-slate-300 pr-2">
                    <div className="text-slate-600 text-[9px] uppercase font-bold">Online Delivery Received:</div>
                    <div className="text-[10px] font-urdu font-semibold text-slate-500">آن لائن وصولی</div>
                    <div className="text-sm font-black text-sky-700 font-mono mt-0.5">
                      PKR {saleTypeMetrics.onlineTotalReceived.toLocaleString()}
                    </div>
                    <div className="text-[9px] text-slate-600 mt-0.5">
                      {saleTypeMetrics.onlineBillsCount} Orders • {saleTypeMetrics.onlinePct.toFixed(1)}% Share
                    </div>
                  </div>

                  <div className="border-r border-slate-300 pr-2">
                    <div className="text-slate-600 text-[9px] uppercase font-bold">In-Store Counter Received:</div>
                    <div className="text-[10px] font-urdu font-semibold text-slate-500">کاؤنٹر سیل وصولی</div>
                    <div className="text-sm font-black text-emerald-700 font-mono mt-0.5">
                      PKR {saleTypeMetrics.inStoreTotalReceived.toLocaleString()}
                    </div>
                    <div className="text-[9px] text-slate-600 mt-0.5">
                      {saleTypeMetrics.inStoreBillsCount} Bills • {saleTypeMetrics.inStorePct.toFixed(1)}% Share
                    </div>
                  </div>

                  <div>
                    <div className="text-slate-900 text-[9px] uppercase font-black">Grand Total Collection:</div>
                    <div className="text-[10px] font-urdu font-bold text-slate-700">مجموعی کل وصولی</div>
                    <div className="text-sm font-black text-indigo-800 font-mono mt-0.5">
                      PKR {saleTypeMetrics.grandTotalReceived.toLocaleString()}
                    </div>
                    <div className="text-[9px] text-slate-600 mt-0.5">
                      {saleTypeMetrics.grandTotalBills} Total Bills • Gross: PKR {saleTypeMetrics.grandTotalBillValue.toLocaleString()}
                    </div>
                  </div>
                </div>

                {/* Dedicated Account-by-Account Breakdown Table */}
                <div className="mb-4">
                  <div className="text-[11px] font-black uppercase tracking-wider text-black mb-1 flex items-center justify-between">
                    <span>Account-Wise Separation: Online Delivery vs In-Store (ہر کھاتے میں الگ الگ وصولی)</span>
                    <span className="text-[10px] font-urdu font-bold text-slate-600">ایک ہی بینک کے اندر دونوں کی علیحدہ رقوم</span>
                  </div>
                  <table className="w-full text-left border-collapse text-[10px]">
                    <thead>
                      <tr className="bg-slate-200 border-y-2 border-black font-black uppercase">
                        <th className="py-1.5 px-2">Account Head</th>
                        <th className="py-1.5 px-2 text-right">Online Delivery (PKR)</th>
                        <th className="py-1.5 px-2 text-right">In-Store Sales (PKR)</th>
                        <th className="py-1.5 px-2 text-right">Combined Total (PKR)</th>
                        <th className="py-1.5 px-2 text-center w-24">Ratio (Onl / Store)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-300">
                      {(Object.entries(saleTypeMetrics.accountBreakdown) as [string, AccountSaleBreakdown][])
                        .filter(([k, d]) => k !== 'other' || d.total > 0)
                        .map(([k, d], idx) => {
                          const onlPct = d.total > 0 ? (d.online / d.total) * 100 : 0;
                          const strPct = d.total > 0 ? (d.inStore / d.total) * 100 : 0;
                          return (
                            <tr key={idx} className="hover:bg-slate-50 font-medium">
                              <td className="py-1.5 px-2 font-bold">{d.label}</td>
                              <td className="py-1.5 px-2 text-right font-mono font-bold text-sky-800">
                                {d.online > 0 ? d.online.toLocaleString() : '-'}
                              </td>
                              <td className="py-1.5 px-2 text-right font-mono font-bold text-emerald-800">
                                {d.inStore > 0 ? d.inStore.toLocaleString() : '-'}
                              </td>
                              <td className="py-1.5 px-2 text-right font-mono font-black text-black">
                                {d.total.toLocaleString()}
                              </td>
                              <td className="py-1.5 px-2 text-center font-mono text-[9px]">
                                {d.total > 0 ? `${onlPct.toFixed(0)}% / ${strPct.toFixed(0)}%` : '-'}
                              </td>
                            </tr>
                          );
                        })}
                    </tbody>
                    <tfoot>
                      <tr className="bg-slate-100 border-t-2 border-black font-black text-[11px]">
                        <td className="py-1.5 px-2 uppercase">Total All Accounts:</td>
                        <td className="py-1.5 px-2 text-right font-mono text-sky-900">
                          PKR {saleTypeMetrics.onlineTotalReceived.toLocaleString()}
                        </td>
                        <td className="py-1.5 px-2 text-right font-mono text-emerald-900">
                          PKR {saleTypeMetrics.inStoreTotalReceived.toLocaleString()}
                        </td>
                        <td className="py-1.5 px-2 text-right font-mono text-indigo-950">
                          PKR {saleTypeMetrics.grandTotalReceived.toLocaleString()}
                        </td>
                        <td className="py-1.5 px-2 text-center font-mono text-[9px]">
                          {saleTypeMetrics.onlinePct.toFixed(0)}% / {saleTypeMetrics.inStorePct.toFixed(0)}%
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>

                {/* Staff & Sales Representative Collection Audit Table */}
                {Object.keys(saleTypeMetrics.staffBreakdown).length > 0 && (
                  <div className="mb-4">
                    <div className="text-[11px] font-black uppercase tracking-wider text-black mb-1 flex items-center justify-between">
                      <span>Staff & Sales Representative Collection Audit (اسٹاف و سیلز نمائندگان کی وصولی)</span>
                      <span className="text-[10px] font-urdu font-bold text-slate-600">ہر نمائندے کی آن لائن اور کاؤنٹر سیلز</span>
                    </div>
                    <table className="w-full text-left border-collapse text-[10px]">
                      <thead>
                        <tr className="bg-slate-200 border-y-2 border-black font-black uppercase">
                          <th className="py-1.5 px-2">Staff Member / Rep</th>
                          <th className="py-1.5 px-2 text-center w-20">Bills Count</th>
                          <th className="py-1.5 px-2 text-right">Online Delivery (PKR)</th>
                          <th className="py-1.5 px-2 text-right">In-Store Sales (PKR)</th>
                          <th className="py-1.5 px-2 text-right">Total Collection (PKR)</th>
                          <th className="py-1.5 px-2 text-center w-20">Share %</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-300">
                        {(Object.entries(saleTypeMetrics.staffBreakdown) as [string, StaffSaleBreakdown][])
                          .sort((a, b) => b[1].total - a[1].total)
                          .map(([sName, sData], sIdx) => {
                            const sharePct = saleTypeMetrics.grandTotalReceived > 0 ? (sData.total / saleTypeMetrics.grandTotalReceived) * 100 : 0;
                            return (
                              <tr key={sIdx} className="hover:bg-slate-50 font-medium">
                                <td className="py-1.5 px-2 font-bold">
                                  <span>{sName}</span>
                                  {sData.code && <span className="ml-1 text-[9px] font-mono text-slate-600">({sData.code})</span>}
                                </td>
                                <td className="py-1.5 px-2 text-center font-mono font-bold">{sData.count}</td>
                                <td className="py-1.5 px-2 text-right font-mono font-bold text-sky-800">
                                  {sData.online > 0 ? sData.online.toLocaleString() : '-'}
                                </td>
                                <td className="py-1.5 px-2 text-right font-mono font-bold text-emerald-800">
                                  {sData.inStore > 0 ? sData.inStore.toLocaleString() : '-'}
                                </td>
                                <td className="py-1.5 px-2 text-right font-mono font-black text-black">
                                  {sData.total.toLocaleString()}
                                </td>
                                <td className="py-1.5 px-2 text-center font-mono text-[9px]">
                                  {sharePct.toFixed(1)}%
                                </td>
                              </tr>
                            );
                          })}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Itemized Sale Bills Table */}
                <table className="w-full text-left border-collapse text-[10px] mb-4">
                  <thead>
                    <tr className="border-y-2 border-black bg-slate-100 font-black uppercase text-[9px]">
                      <th className="py-2 px-1 text-center w-6">#</th>
                      <th className="py-2 px-2 w-20">Type</th>
                      <th className="py-2 px-2 w-20">Invoice #</th>
                      <th className="py-2 px-2 w-20">Date</th>
                      <th className="py-2 px-2">Customer / Details</th>
                      <th className="py-2 px-2 w-24">Staff / Rep</th>
                      <th className="py-2 px-2 w-24">Account Head</th>
                      <th className="py-2 px-2 text-right w-20">Bill Total</th>
                      <th className="py-2 px-2 text-right w-22">Received</th>
                      <th className="py-2 px-2 text-right w-20">Balance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-300">
                    {saleBillsList.length === 0 ? (
                      <tr>
                        <td colSpan={10} className="py-6 text-center text-slate-500 italic">
                          No sales bills recorded for the selected period.
                        </td>
                      </tr>
                    ) : (
                      saleBillsList.map((row, rIdx) => {
                        const isOnline = row.isOnlineBill || row.saleType === 'Online';
                        const recAmt = Number(row.amount) || 0;
                        const billTot = Number(row.billTotal) || recAmt;
                        const bal = Number(row.balance) || 0;

                        return (
                          <tr key={rIdx} className="hover:bg-slate-50">
                            <td className="py-1 px-1 text-center font-mono text-slate-500">{rIdx + 1}</td>
                            <td className="py-1 px-2 font-bold whitespace-nowrap">
                              {isOnline ? '🚚 Online' : '🏪 In-Store'}
                            </td>
                            <td className="py-1 px-2 font-mono font-bold whitespace-nowrap">
                              #{row.saleInvoiceNo || row.voucherNo}
                            </td>
                            <td className="py-1 px-2 whitespace-nowrap font-mono">{safeFormat(row.date, 'dd/MM/yyyy')}</td>
                            <td className="py-1 px-2">
                              <div className="font-semibold">{row.customerName || (isOnline ? 'Online Customer' : 'Walk-in')}</div>
                              {row.customerPhone && <div className="text-[8px] text-slate-500 font-mono">{row.customerPhone}</div>}
                            </td>
                            <td className="py-1 px-2 text-slate-700">
                              <div>{row.onlineEmployeeName || row.handledBy || '-'}</div>
                            </td>
                            <td className="py-1 px-2 font-bold">{row.accountHead || row.paymentMode}</td>
                            <td className="py-1 px-2 text-right font-mono text-slate-700">
                              {billTot > 0 ? billTot.toLocaleString() : '-'}
                            </td>
                            <td className="py-1 px-2 text-right font-mono font-black text-emerald-800">
                              PKR {recAmt.toLocaleString()}
                            </td>
                            <td className="py-1 px-2 text-right font-mono font-bold text-amber-800">
                              {bal > 0 ? bal.toLocaleString() : 'Nil'}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-black bg-slate-100 font-black text-[11px]">
                      <td colSpan={7} className="py-2 px-2 text-right uppercase">
                        Total Sums ({saleBillsList.length} Bills):
                      </td>
                      <td className="py-2 px-2 text-right font-mono text-slate-800">
                        PKR {saleBillsList.reduce((s, i) => s + (Number(i.billTotal) || Number(i.amount) || 0), 0).toLocaleString()}
                      </td>
                      <td className="py-2 px-2 text-right font-mono text-emerald-800">
                        PKR {saleBillsList.reduce((s, i) => s + (Number(i.amount) || 0), 0).toLocaleString()}
                      </td>
                      <td className="py-2 px-2 text-right font-mono text-amber-800">
                        PKR {saleBillsList.reduce((s, i) => s + (Number(i.balance) || 0), 0).toLocaleString()}
                      </td>
                    </tr>
                  </tfoot>
                </table>

                {/* Signatures Block */}
                <div className="pt-8 grid grid-cols-3 gap-6 text-center text-xs mt-4 border-t border-slate-300">
                  <div>
                    <div className="border-t-2 border-black pt-1.5 font-bold">Billing & Cashier</div>
                    <div className="text-[10px] font-urdu font-semibold text-slate-600">بلنگ و کیشیئر</div>
                    <div className="text-[10px] text-slate-500 font-mono mt-0.5">{user?.name || 'Staff'}</div>
                  </div>
                  <div>
                    <div className="border-t-2 border-black pt-1.5 font-bold">Accounts Officer</div>
                    <div className="text-[10px] font-urdu font-semibold text-slate-600">اکاؤنٹس آفیسر</div>
                    <div className="text-[10px] text-slate-500 font-mono mt-0.5">Accounts Office</div>
                  </div>
                  <div>
                    <div className="border-t-2 border-black pt-1.5 font-bold">Owner Signature & Stamp</div>
                    <div className="text-[10px] font-urdu font-semibold text-slate-600">دستخط و مہر مالک</div>
                    <div className="text-[10px] text-slate-500 font-mono mt-0.5">Manzoor Ahmed</div>
                  </div>
                </div>

                {/* Computer Generated Notice */}
                <div className="mt-6 pt-2 border-t border-slate-200 flex justify-between items-center text-[9px] text-slate-500 font-mono">
                  <span>Official Sale Type Ledger Audit Statement • Valid without alteration</span>
                  <span>Generated on: {safeFormat(new Date(), 'dd/MM/yyyy HH:mm:ss')}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
