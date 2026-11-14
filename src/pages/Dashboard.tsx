import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useBranch } from '../context/BranchContext';
import { useSettings } from '../context/SettingsContext';
import { collection, where, orderBy, limit, addDoc, setDoc, updateDoc, deleteDoc, getDocs, getDoc, runTransaction, writeBatch, onSnapshot, query, doc } from '../lib/customFirestore';
import { db, safeGetDocs, safeCollectionSnapshot } from '../lib/firebase';
import { Link, useNavigate } from 'react-router';
import { Settings, Save, X, Calendar, Lock, Eye, EyeOff, Printer, TrendingDown, TrendingUp, BarChart3, Wallet, Package, ShoppingBag, ArrowDownLeft, Landmark, CreditCard, Receipt, ExternalLink, Search, Coins, Edit2, Banknote, ArrowDownRight, ArrowUpRight } from 'lucide-react';
import toast from 'react-hot-toast';
import { startOfMonth, endOfMonth, startOfDay, parse, format, isValid } from 'date-fns';
import { calculateCashDrawer, resolveOpeningGallaForDate } from '../lib/cashDrawer';

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

const safeParse = (dateStr: string, formatStr: string, baseDate: Date) => {
  if (!dateStr) return baseDate;
  try {
    const d = parse(dateStr, formatStr, baseDate);
    if (!isValid(d)) return baseDate;
    return d;
  } catch (e) {
    return baseDate;
  }
};

export function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { activeBranchId, setActiveBranchId, branches } = useBranch();
  const currentBranch = branches.find(b => b.id === activeBranchId) || (branches.length > 0 ? branches[0] : null);
  const { enableDashboardEdit, enableBillEdit, dashboardOffsets, updateDashboardOffsets } = useSettings();
  
  const [sales, setSales] = useState<any[]>([]);
  const [inventory, setInventory] = useState<any[]>([]);
  const [vendors, setVendors] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [ledgerEntries, setLedgerEntries] = useState<any[]>([]);
  const [ownerTransactions, setOwnerTransactions] = useState<any[]>([]);
  const [purchases, setPurchases] = useState<any[]>([]);
  const [onlineEmployees, setOnlineEmployees] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  
  const now = new Date();
  const todayDateStr = `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, '0')}-${now.getDate().toString().padStart(2, '0')}`;
  const [selectedDailyDateStr, setSelectedDailyDateStr] = useState<string>(todayDateStr);
  const [selectedMonthStr, setSelectedMonthStr] = useState(`${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, '0')}`);

  // Daily Opening Galla Balance State
  const [dailyOpeningBalances, setDailyOpeningBalances] = useState<Record<string, number>>({});
  const [showOpeningCashModal, setShowOpeningCashModal] = useState(false);
  const [showDrawerBreakdownModal, setShowDrawerBreakdownModal] = useState(false);
  const [openingCashInput, setOpeningCashInput] = useState<number | ''>('');
  const [isSavingOpeningCash, setIsSavingOpeningCash] = useState(false);

  const resolvedBranchId = activeBranchId || currentBranch?.id || user?.branchId || 'main';

  useEffect(() => {
    let qOpening: any = collection(db, 'dailyOpeningCash');
    if (resolvedBranchId) {
      qOpening = query(qOpening, where('branchId', '==', resolvedBranchId));
    }
    const unsubOpening = safeCollectionSnapshot(qOpening, (snap) => {
      const map: Record<string, number> = {};
      snap.docs.forEach(d => {
        const data = d.data() as any;
        if (data.date && data.openingBalance !== undefined) {
          map[data.date] = Number(data.openingBalance) || 0;
        }
      });
      setDailyOpeningBalances(map);
    });
    return () => unsubOpening();
  }, [resolvedBranchId]);

  const handleSaveDailyOpeningBalance = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingOpeningCash(true);
    try {
      const val = Number(openingCashInput) || 0;
      const bId = resolvedBranchId || 'main';
      const qExist = query(collection(db, 'dailyOpeningCash'), where('branchId', '==', bId), where('date', '==', selectedDailyDateStr));
      const snap = await safeGetDocs(qExist);
      if (snap.docs.length > 0) {
        await updateDoc(doc(db, 'dailyOpeningCash', snap.docs[0].id), {
          openingBalance: val,
          updatedAt: Date.now(),
          updatedBy: user?.name || 'Admin'
        });
      } else {
        await addDoc(collection(db, 'dailyOpeningCash'), {
          branchId: bId,
          date: selectedDailyDateStr,
          openingBalance: val,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          updatedBy: user?.name || 'Admin'
        });
      }
      toast.success('Opening Galla Balance Saved! Auto carry-forward active for next days.');
      setShowOpeningCashModal(false);
    } catch (err: any) {
      console.error('Error saving opening balance:', err);
      toast.error('Failed to save opening balance: ' + (err?.message || 'Unknown error'));
    } finally {
      setIsSavingOpeningCash(false);
    }
  };

  const handleRevertOpeningToAuto = async () => {
    setIsSavingOpeningCash(true);
    try {
      const bId = resolvedBranchId || 'main';
      const qExist = query(collection(db, 'dailyOpeningCash'), where('branchId', '==', bId), where('date', '==', selectedDailyDateStr));
      const snap = await safeGetDocs(qExist);
      for (const dDoc of snap.docs) {
        await deleteDoc(doc(db, 'dailyOpeningCash', dDoc.id));
      }
      toast.success('Reverted to Auto Carry-Forward from previous day Actual Galla!');
      setShowOpeningCashModal(false);
    } catch (err: any) {
      console.error('Error reverting opening balance:', err);
      toast.error('Failed to revert: ' + (err?.message || 'Unknown error'));
    } finally {
      setIsSavingOpeningCash(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    setError(null);
    // Don't clear states immediately to avoid flickering "empty" states if data comes back fast
    // Only reset if loading takes too long or when explicitly necessary
    
    let qSales: any = collection(db, 'sales');
    let qInv: any = collection(db, 'inventory');
    let qVendors: any = collection(db, 'vendors');
    let qCustomers: any = collection(db, 'customers');
    let qLedger: any = collection(db, 'ledger');
    let qOwnerTx: any = collection(db, 'ownerTransactions');
        
    if (activeBranchId) {
      qSales = query(qSales, where('branchId', '==', activeBranchId));
      qInv = query(qInv, where('branchId', '==', activeBranchId));
      qLedger = query(qLedger, where('branchId', '==', activeBranchId));
      qOwnerTx = query(qOwnerTx, where('branchId', '==', activeBranchId));
    }
    
    const tenantId = user?.tenantId || user?.uid;
    
    let salesLoaded = false;
    let invLoaded = false;
    let vendorsLoaded = false;
    let customersLoaded = false;
    let ledgerLoaded = false;
    let purchasesLoaded = false;

    const checkAllLoaded = () => {
      if (salesLoaded && invLoaded && vendorsLoaded && customersLoaded && ledgerLoaded && purchasesLoaded) {
        setLoading(false);
      }
    };
    
    const unsubSales = safeCollectionSnapshot(qSales, (snap) => {
      setSales(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
      salesLoaded = true;
      checkAllLoaded();
    }, (err) => {
      console.error("Dashboard sales snapshot error:", err);
      setError(`Sales database query failed: ${err?.message || err}`);
      setLoading(false);
    });

    const unsubVendors = safeCollectionSnapshot(qVendors, (snap) => {
      let list = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
      if (tenantId) {
        list = list.filter(v => !v.tenantId || v.tenantId === tenantId);
      }
      if (activeBranchId) {
        list = list.filter(v => !v.branchId || v.branchId === activeBranchId || (activeBranchId === 'main' && !v.branchId) || v.isCourier || v.isGlobal);
      }
      setVendors(list);
      vendorsLoaded = true;
      checkAllLoaded();
    });

    const unsubCustomers = safeCollectionSnapshot(qCustomers, (snap) => {
      let list = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
      if (tenantId) {
        list = list.filter(c => !c.tenantId || c.tenantId === tenantId);
      }
      if (activeBranchId) {
        // Support customers with matching branch, no branch (global), or main branch fallback
        list = list.filter(c => !c.branchId || c.branchId === activeBranchId || (activeBranchId === 'main' && !c.branchId));
      }
      setCustomers(list);
      customersLoaded = true;
      checkAllLoaded();
    });

    const unsubLedger = safeCollectionSnapshot(qLedger, (snap) => {
      setLedgerEntries(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
      ledgerLoaded = true;
      checkAllLoaded();
    });

    const unsubOwnerTx = safeCollectionSnapshot(qOwnerTx, (snap) => {
      setOwnerTransactions(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
    });

    let qPurchases: any = collection(db, 'purchases');
    if (tenantId) {
      qPurchases = query(qPurchases, where('tenantId', '==', tenantId));
    }
    if (activeBranchId) {
      qPurchases = query(qPurchases, where('branchId', '==', activeBranchId));
    }

    const unsubPurchases = safeCollectionSnapshot(qPurchases, (snap) => {
      setPurchases(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
      purchasesLoaded = true;
      checkAllLoaded();
    });

    let qOnlineEmp: any = collection(db, 'onlineSalesEmployees');
    if (user?.tenantId || user?.uid) {
      qOnlineEmp = query(qOnlineEmp, where('tenantId', '==', user.tenantId || user.uid));
    }
    
    const unsubOnlineEmp = safeCollectionSnapshot(qOnlineEmp, (snap) => {
      let emps = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
      if (activeBranchId) {
        emps = emps.filter(e => e.branchId === activeBranchId || (!e.branchId && activeBranchId === 'main'));
      }
      setOnlineEmployees(emps);
    });

    const unsubInv = safeCollectionSnapshot(qInv, (snap) => {
      setInventory(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
      invLoaded = true;
      checkAllLoaded();
    }, (err) => {
      console.error("Dashboard inventory snapshot error:", err);
      setError(`Inventory database query failed: ${err?.message || err}`);
      setLoading(false);
    });
    
    // Set a safety timeout so if database is connecting slowly it doesn't get stuck forever
    const safetyTimer = setTimeout(() => {
      setLoading(false);
    }, 5000);
    
    return () => {
      clearTimeout(safetyTimer);
      unsubSales();
      unsubInv();
      unsubOnlineEmp();
      unsubVendors();
      unsubCustomers();
      unsubLedger();
      unsubOwnerTx();
      unsubPurchases();
    };
  }, [user, activeBranchId]);

  // Calculations
  const getSaleTime = (v: any) => {
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
  };

  const isSaleOnDate = (saleDate: number, targetDateStr: string = selectedDailyDateStr) => {
    if (!saleDate) return false;
    const d = new Date(saleDate);
    if (isNaN(d.getTime())) return false;
    const dYear = d.getFullYear();
    const dMonth = (d.getMonth() + 1).toString().padStart(2, '0');
    const dDay = d.getDate().toString().padStart(2, '0');
    return `${dYear}-${dMonth}-${dDay}` === targetDateStr;
  };

  const isSaleInMonth = (saleDate: number, targetMonthStr: string = selectedMonthStr) => {
    if (!saleDate) return false;
    const d = new Date(saleDate);
    if (isNaN(d.getTime())) return false;
    const dYear = d.getFullYear();
    const dMonth = (d.getMonth() + 1).toString().padStart(2, '0');
    return `${dYear}-${dMonth}` === targetMonthStr;
  };

  let dailySales = 0;
  let dailyProfit = 0;
  let dailyOnlineSales = 0;
  let dailyInStoreSales = 0;
  let dailyOnlineProfit = 0;
  let dailyInStoreProfit = 0;
  let dailyBills = 0;
  let dailySuits = 0;
  let lastDailyBillDate = '';
  let lastDailyOnlineDate = '';
  let lastDailyOnlineAmount = 0;
  let lastDailyInStoreDate = '';
  let lastDailyInStoreAmount = 0;

  let monthlySales = 0;
  let monthlyOnlineSales = 0;
  let monthlyInStoreSales = 0;
  let monthlyProfit = 0;
  let monthlyOnlineProfit = 0;
  let monthlyInStoreProfit = 0;
  let monthlyBills = 0;
  let monthlySuits = 0;
  let lastMonthlyBillDate = '';

  let totalSales = 0;
  let totalOnlineSales = 0;
  let totalInStoreSales = 0;
  let totalProfit = 0;
  let totalOnlineProfit = 0;
  let totalInStoreProfit = 0;
  let totalBills = 0;
  let totalSuits = 0;
  let lastTotalBillDate = '';

  let dailyLoss = 0;
  let dailyLossBills = 0;
  let dailyLossSuits = 0;

  let monthlyLoss = 0;
  let monthlyLossBills = 0;
  let monthlyLossSuits = 0;

  let totalLoss = 0;
  let totalLossBills = 0;
  let totalLossSuits = 0;

  const lossSalesList: Array<{
    sale: any;
    saleCost: number;
    saleSubtotal: number;
    discount: number;
    netRevenue: number;
    lossAmount: number;
    totalSuitsInBill: number;
    lossItems: Array<{
      id: string;
      name: string;
      qty: number;
      price: number;
      cost: number;
      itemLoss: number;
    }>;
  }> = [];

  const sortedSales = [...sales].sort((a, b) => {
    const da = getSaleTime(a);
    const db = getSaleTime(b);
    if (db !== da) return db - da; // Descending by time
    const getSeq = (inv: string) => {
      if (!inv) return 0;
      const p = String(inv).split('-');
      const s = parseInt(p[p.length - 1], 10);
      return isNaN(s) ? 0 : s;
    };
    return getSeq(b.invoiceNo) - getSeq(a.invoiceNo);
  });

  const formatDate = (ts: number) => {
    if (!ts || isNaN(ts)) return '';
    const d = new Date(ts);
    return `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getFullYear()}`;
  };

  const getRealValues = (monthStr: string, dailyDateStr: string = selectedDailyDateStr) => {
    let rD = 0, rDP = 0, rDB = 0;
    let rM = 0, rMP = 0, rMB = 0;
    let rT = 0, rTP = 0, rTB = 0;

    sortedSales.forEach(sale => {
       const saleDate = getSaleTime(sale);
       const isReturn = sale.transactionType === 'Return';
       const amount = isReturn ? -Math.abs(Number(sale.total) || 0) : (Number(sale.total) || 0);
       let profit = 0;
       if (!isReturn) {
         const saleSubtotal = (sale.items || []).reduce((acc: number, item: any) => acc + ((Number(item.price) || 0) * (Number(item.qty) || 0)), 0);
         const cost = (sale.items || []).reduce((acc: number, item: any) => {
           let unitCost = item.cost;
           if (unitCost === undefined || unitCost === 0 || unitCost === null) {
             const invItem = inventory.find(inv => inv.id === item.id);
             unitCost = Number(invItem?.cost || 0);
           }
           return acc + (unitCost * (item.qty || 0));
         }, 0);
         const discount = Number(sale.discount) || 0;
         profit = Math.max(0, saleSubtotal - cost - discount);
       }
       
       rT += amount;
       rTP += profit;
       rTB++;
       
       if (isSaleInMonth(saleDate, monthStr)) {
         rM += amount;
         rMP += profit;
         rMB++;
       }
       
       if (isSaleOnDate(saleDate, dailyDateStr)) {
         rD += amount;
         rDP += profit;
         rDB++;
       }
    });
    
    return { rD, rDP, rDB, rM, rMP, rMB, rT, rTP, rTB };
  };

  if (sortedSales.length > 0) {
    const ts = getSaleTime(sortedSales[0]);
    lastTotalBillDate = formatDate(ts);
    
    // Find last daily bill on selected date
    const dailySale = sortedSales.find(s => {
      const saleDate = getSaleTime(s);
      return isSaleOnDate(saleDate, selectedDailyDateStr);
    });
    if (dailySale) {
      const ts = getSaleTime(dailySale);
      lastDailyBillDate = formatDate(ts);
    } else {
      const targetTs = safeParse(selectedDailyDateStr, 'yyyy-MM-dd', new Date()).getTime();
      lastDailyBillDate = formatDate(targetTs);
    }

    const absoluteLastOnlineSale = sortedSales.find(s => s.saleType === 'Online' && s.transactionType !== 'Return');
    if (absoluteLastOnlineSale) {
      lastDailyOnlineDate = formatDate(getSaleTime(absoluteLastOnlineSale));
      lastDailyOnlineAmount = Number(absoluteLastOnlineSale.total) || 0;
    }

    const absoluteLastInStoreSale = sortedSales.find(s => s.saleType !== 'Online' && s.transactionType !== 'Return');
    if (absoluteLastInStoreSale) {
      lastDailyInStoreDate = formatDate(getSaleTime(absoluteLastInStoreSale));
      lastDailyInStoreAmount = Number(absoluteLastInStoreSale.total) || 0;
    }

    // Find last monthly bill within selected month
    const monthlySale = sortedSales.find(s => {
      const saleDate = getSaleTime(s);
      return isSaleInMonth(saleDate, selectedMonthStr);
    });
    if (monthlySale) {
      const ts = getSaleTime(monthlySale);
      lastMonthlyBillDate = formatDate(ts);
    }
  }

  sortedSales.forEach(sale => {
    const saleDate = getSaleTime(sale);
    const isReturn = sale.transactionType === 'Return';
    const amount = isReturn ? -Math.abs(Number(sale.total) || 0) : (Number(sale.total) || 0);
    
    // Suit count
    const suitsInSale = (sale.items || []).reduce((acc: number, item: any) => acc + (Number(item.qty) || 0), 0);
    const suitsInReturn = (sale.returnItems || []).reduce((acc: number, item: any) => acc + (Number(item.qty) || 0), 0);
    const netSuits = isReturn ? -Math.abs(suitsInSale || suitsInReturn) : (suitsInSale - suitsInReturn);

    let profit = 0;
    let saleCost = 0;
    let saleSubtotal = 0;
    const discount = Number(sale.discount) || 0;
    const lossItems: Array<{ id: string; name: string; qty: number; price: number; cost: number; itemLoss: number }> = [];

    if (!isReturn && sale.items && sale.items.length > 0) {
      sale.items.forEach((item: any) => {
        const itemPrice = Number(item.price) || 0;
        const itemQty = Number(item.qty) || 0;
        let unitCost = item.cost;
        if (unitCost === undefined || unitCost === 0 || unitCost === null || isNaN(Number(unitCost))) {
          const invItem = inventory.find(inv => inv.id === item.id);
          unitCost = Number(invItem?.cost || 0);
        } else {
          unitCost = Number(unitCost);
        }
        const totalItemCost = unitCost * itemQty;
        const totalItemPrice = itemPrice * itemQty;
        
        saleSubtotal += totalItemPrice;
        saleCost += totalItemCost;

        if (itemPrice < unitCost) {
          lossItems.push({
            id: item.id || item.name,
            name: item.name,
            qty: itemQty,
            price: itemPrice,
            cost: unitCost,
            itemLoss: (unitCost - itemPrice) * itemQty
          });
        }
      });

      profit = Math.max(0, saleSubtotal - saleCost - discount);

      const netRevenue = Math.max(0, saleSubtotal - discount);
      const margin = netRevenue - saleCost;
      const isBillLoss = margin < 0;
      const billLossAmount = isBillLoss ? Math.abs(margin) : 0;
      const itemsLossTotal = lossItems.reduce((acc, i) => acc + i.itemLoss, 0);

      if (isBillLoss || lossItems.length > 0) {
        const effectiveLossAmt = isBillLoss ? billLossAmount : itemsLossTotal;
        const effectiveLossSuits = isBillLoss ? suitsInSale : lossItems.reduce((acc, i) => acc + i.qty, 0);

        lossSalesList.push({
          sale,
          saleCost,
          saleSubtotal,
          discount,
          netRevenue,
          lossAmount: effectiveLossAmt,
          totalSuitsInBill: suitsInSale,
          lossItems
        });

        totalLoss += effectiveLossAmt;
        totalLossBills += 1;
        totalLossSuits += effectiveLossSuits;

        if (isSaleInMonth(saleDate, selectedMonthStr)) {
          monthlyLoss += effectiveLossAmt;
          monthlyLossBills += 1;
          monthlyLossSuits += effectiveLossSuits;
        }

        if (isSaleOnDate(saleDate, selectedDailyDateStr)) {
          dailyLoss += effectiveLossAmt;
          dailyLossBills += 1;
          dailyLossSuits += effectiveLossSuits;
        }
      }
    }

    totalSales += amount;
    totalSuits += netSuits;
    if (sale.saleType === 'Online') {
      totalOnlineSales += amount;
      totalOnlineProfit += profit;
    } else {
      totalInStoreSales += amount;
      totalInStoreProfit += profit;
    }
    totalProfit += profit;
    totalBills++;

    if (isSaleInMonth(saleDate, selectedMonthStr)) {
      monthlySales += amount;
      monthlySuits += netSuits;
      if (sale.saleType === 'Online') {
        monthlyOnlineSales += amount;
        monthlyOnlineProfit += profit;
      } else {
        monthlyInStoreSales += amount;
        monthlyInStoreProfit += profit;
      }
      monthlyProfit += profit;
      monthlyBills++;
    }
    
    if (isSaleOnDate(saleDate, selectedDailyDateStr)) {
      dailySales += amount;
      dailyProfit += profit;
      dailySuits += netSuits;
      if (sale.saleType === 'Online') { 
        dailyOnlineProfit += profit; 
        dailyOnlineSales += amount; 
      } else { 
        dailyInStoreProfit += profit; 
        dailyInStoreSales += amount; 
      }
      dailyBills++;
    }
  });

  // Only apply offsets if dashboard editing is explicitly enabled by Super Admin
  const activeOffsets = (enableDashboardEdit && activeBranchId) 
    ? (dashboardOffsets?.branches?.[activeBranchId] || {}) 
    : (enableDashboardEdit ? dashboardOffsets : null);

  if (enableDashboardEdit && activeOffsets) {
    if (activeOffsets.dailyOffsetDate === selectedDailyDateStr) {
      dailySales += Number(activeOffsets.dailySales || 0);
      dailyProfit += Number(activeOffsets.dailyProfit || 0);
      if (activeOffsets.dailyBills !== undefined && activeOffsets.dailyBills !== '') dailyBills += Number(activeOffsets.dailyBills);
      if (activeOffsets.lastDailyBillDate) lastDailyBillDate = activeOffsets.lastDailyBillDate;
    }
    
    totalSales += Number(activeOffsets.totalSales || 0);
    totalProfit += Number(activeOffsets.totalProfit || 0);
    
    let mSales = Number(activeOffsets[`monthlySales_${selectedMonthStr}`] || 0);
    let mProfit = Number(activeOffsets[`monthlyProfit_${selectedMonthStr}`] || 0);
    
    monthlySales += mSales;
    monthlyProfit += mProfit;

    let mBills = activeOffsets[`monthlyBills_${selectedMonthStr}`];
    if (mBills !== undefined && mBills !== '') monthlyBills += Number(mBills);

    let mBillDate = activeOffsets[`lastMonthlyBillDate_${selectedMonthStr}`];
    if (mBillDate) lastMonthlyBillDate = mBillDate;

    if (activeOffsets.totalBills !== undefined && activeOffsets.totalBills !== '') totalBills += Number(activeOffsets.totalBills);
    if (activeOffsets.lastTotalBillDate) lastTotalBillDate = activeOffsets.lastTotalBillDate;
  }

  // Prevent profit from displaying as negative
  dailyProfit = Math.max(0, dailyProfit);
  monthlyProfit = Math.max(0, monthlyProfit);
  totalProfit = Math.max(0, totalProfit);

  const formatCurrency = (val: number) => {
    return val.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 1 });
  };

  const [activeModal, setActiveModal] = useState<string | null>(null);
  const [modalSaleTab, setModalSaleTab] = useState<'all' | 'instore' | 'online'>('all');
  const [payableModalTab, setPayableModalTab] = useState<'vendors' | 'customers' | 'all'>('vendors');
  const [receivableModalTab, setReceivableModalTab] = useState<'customers' | 'vendors' | 'all'>('customers');
  const [lossModalFilter, setLossModalFilter] = useState<'daily' | 'monthly' | 'all'>('daily');
  const [lossSearchQuery, setLossSearchQuery] = useState('');
  const [isEditingOffsets, setIsEditingOffsets] = useState(false);

  const formatMonthName = (monthStr: string) => {
    if (!monthStr) return '';
    try {
      const d = safeParse(monthStr, 'yyyy-MM', new Date());
      return safeFormat(d, 'MMMM yyyy');
    } catch (e) {
      return monthStr;
    }
  };

  const formatDateTime = (ts: number) => {
    if (!ts) return '-';
    try {
      const d = new Date(ts);
      return `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getFullYear()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    } catch (e) {
      return '-';
    }
  };

  const getSuitsInSale = (sale: any) => {
    const suitsInSale = (sale.items || []).reduce((acc: number, item: any) => acc + (Number(item.qty) || 0), 0);
    const suitsInReturn = (sale.returnItems || []).reduce((acc: number, item: any) => acc + (Number(item.qty) || 0), 0);
    const isReturn = sale.transactionType === 'Return';
    return isReturn ? -Math.abs(suitsInSale || suitsInReturn) : (suitsInSale - suitsInReturn);
  };

  const getNetSaleAmount = (sale: any) => {
    const isReturn = sale.transactionType === 'Return';
    return isReturn ? -Math.abs(Number(sale.total) || 0) : (Number(sale.total) || 0);
  };

  const monthlyTransactions = sortedSales.filter(sale => {
    const saleDate = getSaleTime(sale);
    return isSaleInMonth(saleDate, selectedMonthStr);
  });

  const monthlyInStoreTransactions = monthlyTransactions.filter(sale => sale.saleType !== 'Online');
  const monthlyOnlineTransactions = monthlyTransactions.filter(sale => sale.saleType === 'Online');

  const inStoreSuitsCount = monthlyInStoreTransactions.reduce((acc, s) => {
    const suitsInSale = (s.items || []).reduce((sum: number, it: any) => sum + (Number(it.qty) || 0), 0);
    const suitsInReturn = (s.returnItems || []).reduce((sum: number, it: any) => sum + (Number(it.qty) || 0), 0);
    const isReturn = s.transactionType === 'Return';
    return acc + (isReturn ? -Math.abs(suitsInSale || suitsInReturn) : (suitsInSale - suitsInReturn));
  }, 0);

  const onlineSuitsCount = monthlyOnlineTransactions.reduce((acc, s) => {
    const suitsInSale = (s.items || []).reduce((sum: number, it: any) => sum + (Number(it.qty) || 0), 0);
    const suitsInReturn = (s.returnItems || []).reduce((sum: number, it: any) => sum + (Number(it.qty) || 0), 0);
    const isReturn = s.transactionType === 'Return';
    return acc + (isReturn ? -Math.abs(suitsInSale || suitsInReturn) : (suitsInSale - suitsInReturn));
  }, 0);

  const activeBranch = branches.find((b: any) => b.id === activeBranchId) || (branches.length > 0 ? branches[0] : null);
  const branchDisplayName = activeBranch?.name || 'Branch';
  
  // Profit Password Lock State
  const [showProfitPrompt, setShowProfitPrompt] = useState(false);
  const [profitPasswordInput, setProfitPasswordInput] = useState('');
  const [showProfitPassword, setShowProfitPassword] = useState(false);
  const [profitPromptError, setProfitPromptError] = useState('');
  const [pendingBoxId, setPendingBoxId] = useState<string | null>(null);

  const handleUnlockProfitBox = (e: React.FormEvent) => {
    e.preventDefault();
    if (profitPasswordInput === 'superadmin@@') {
      sessionStorage.setItem('profit_loss_unlocked', 'true');
      setShowProfitPrompt(false);
      setProfitPasswordInput('');
      setProfitPromptError('');
      if (pendingBoxId) {
        setModalSaleTab('all');
        setActiveModal(pendingBoxId);
        setPendingBoxId(null);
      }
    } else {
      setProfitPromptError('Incorrect password! Please try again.');
    }
  };

  const handleBoxClick = (boxId: string) => {
    if (enableDashboardEdit) {
      handleEditClick();
    } else {
      if (boxId.includes('profit') && sessionStorage.getItem('profit_loss_unlocked') !== 'true') {
        setPendingBoxId(boxId);
        setProfitPasswordInput('');
        setProfitPromptError('');
        setShowProfitPrompt(true);
        return;
      }
      setModalSaleTab('all');
      setActiveModal(boxId);
    }
  };
  const [offsetsForm, setOffsetsForm] = useState<any>({});
  const [editMonth, setEditMonth] = useState('');

  useEffect(() => {
    if (isEditingOffsets) {
      const activeOffsets = activeBranchId 
        ? (dashboardOffsets?.branches?.[activeBranchId] || {}) 
        : dashboardOffsets;
      
      const reals = getRealValues(editMonth);
      let mSalesOffset = Number(activeOffsets?.[`monthlySales_${editMonth}`] || 0);
      let mProfitOffset = Number(activeOffsets?.[`monthlyProfit_${editMonth}`] || 0);
      let mBillsOffset = Number(activeOffsets?.[`monthlyBills_${editMonth}`] || 0);
      
      if (editMonth === '2026-05') {
         if (activeOffsets?.monthlySales !== undefined && !activeOffsets?.[`monthlySales_${editMonth}`]) mSalesOffset = Number(activeOffsets.monthlySales || 0);
         if (activeOffsets?.monthlyProfit !== undefined && !activeOffsets?.[`monthlyProfit_${editMonth}`]) mProfitOffset = Number(activeOffsets.monthlyProfit || 0);
         if (activeOffsets?.monthlyBills !== undefined && activeOffsets?.[`monthlyBills_${editMonth}`] === undefined) mBillsOffset = Number(activeOffsets.monthlyBills || 0);
      }
      
      setOffsetsForm({
        dailySales: reals.rD + Number(activeOffsets?.dailySales || 0),
        dailyProfit: reals.rDP + Number(activeOffsets?.dailyProfit || 0),
        dailyBills: reals.rDB + Number(activeOffsets?.dailyBills || 0),
        
        [`monthlySales_${editMonth}`]: reals.rM + mSalesOffset,
        [`monthlyProfit_${editMonth}`]: reals.rMP + mProfitOffset,
        [`monthlyBills_${editMonth}`]: reals.rMB + mBillsOffset,
        
        totalSales: reals.rT + Number(activeOffsets?.totalSales || 0),
        totalProfit: reals.rTP + Number(activeOffsets?.totalProfit || 0),
        totalBills: reals.rTB + Number(activeOffsets?.totalBills || 0),
      });
    }
  }, [isEditingOffsets, editMonth, dashboardOffsets, activeBranchId]);

  const handleEditClick = () => {
    setEditMonth(selectedMonthStr);
    setIsEditingOffsets(true);
  };

  const handleSaveOffsets = () => {
    const reals = getRealValues(editMonth);
    const newOffsets = { ...dashboardOffsets };
    const activeOffsets = activeBranchId ? { ...(newOffsets.branches?.[activeBranchId] || {}) } : newOffsets;
    
    if (offsetsForm.dailySales === '' || isNaN(Number(offsetsForm.dailySales))) activeOffsets.dailySales = 0; else activeOffsets.dailySales = Number(offsetsForm.dailySales) - reals.rD;
    if (offsetsForm.dailyProfit === '' || isNaN(Number(offsetsForm.dailyProfit))) activeOffsets.dailyProfit = 0; else activeOffsets.dailyProfit = Number(offsetsForm.dailyProfit) - reals.rDP;
    if (offsetsForm.dailyBills === '' || isNaN(Number(offsetsForm.dailyBills))) activeOffsets.dailyBills = 0; else activeOffsets.dailyBills = Number(offsetsForm.dailyBills) - reals.rDB;
    activeOffsets.dailyOffsetDate = todayDateStr;
    
    if (offsetsForm[`monthlySales_${editMonth}`] === '' || isNaN(Number(offsetsForm[`monthlySales_${editMonth}`]))) activeOffsets[`monthlySales_${editMonth}`] = 0; else activeOffsets[`monthlySales_${editMonth}`] = Number(offsetsForm[`monthlySales_${editMonth}`]) - reals.rM;
    if (offsetsForm[`monthlyProfit_${editMonth}`] === '' || isNaN(Number(offsetsForm[`monthlyProfit_${editMonth}`]))) activeOffsets[`monthlyProfit_${editMonth}`] = 0; else activeOffsets[`monthlyProfit_${editMonth}`] = Number(offsetsForm[`monthlyProfit_${editMonth}`]) - reals.rMP;
    if (offsetsForm[`monthlyBills_${editMonth}`] === '' || isNaN(Number(offsetsForm[`monthlyBills_${editMonth}`]))) activeOffsets[`monthlyBills_${editMonth}`] = 0; else activeOffsets[`monthlyBills_${editMonth}`] = Number(offsetsForm[`monthlyBills_${editMonth}`]) - reals.rMB;
    
    if (offsetsForm.totalSales === '' || isNaN(Number(offsetsForm.totalSales))) activeOffsets.totalSales = 0; else activeOffsets.totalSales = Number(offsetsForm.totalSales) - reals.rT;
    if (offsetsForm.totalProfit === '' || isNaN(Number(offsetsForm.totalProfit))) activeOffsets.totalProfit = 0; else activeOffsets.totalProfit = Number(offsetsForm.totalProfit) - reals.rTP;
    if (offsetsForm.totalBills === '' || isNaN(Number(offsetsForm.totalBills))) activeOffsets.totalBills = 0; else activeOffsets.totalBills = Number(offsetsForm.totalBills) - reals.rTB;
    
    if (activeBranchId) {
      if (!newOffsets.branches) newOffsets.branches = {};
      newOffsets.branches[activeBranchId] = activeOffsets;
    }
    
    updateDashboardOffsets(newOffsets);
    setIsEditingOffsets(false);
  };

  const handleResetToReal = () => {
    const newOffsets = { ...dashboardOffsets };
    if (activeBranchId) {
      if (newOffsets.branches) {
        delete newOffsets.branches[activeBranchId];
      }
    } else {
      updateDashboardOffsets({});
      setIsEditingOffsets(false);
      return;
    }
    updateDashboardOffsets(newOffsets);
    setIsEditingOffsets(false);
  };

  let stockValue = 0;
  const lowStockItems: any[] = [];
  
  inventory.forEach(item => {
    stockValue += (item.stock || 0) * (item.cost || 0);
    if ((item.stock || 0) <= (item.minStockLevel || 0)) {
      lowStockItems.push(item);
    }
  });

  // Optimized Party Balances Calculation
  const { customerBalMap, vendorBalMap } = React.useMemo(() => {
    const cMap: Record<string, number> = {};
    const vMap: Record<string, number> = {};
    
    ledgerEntries.forEach(e => {
      const amount = Number(e.amount) || 0;
      if (e.customerId) {
        if (!cMap[e.customerId]) cMap[e.customerId] = 0;
        cMap[e.customerId] += (e.type === 'IN' ? amount : -amount);
      }
      if (e.vendorId) {
        if (!vMap[e.vendorId]) vMap[e.vendorId] = 0;
        vMap[e.vendorId] += (e.type === 'IN' ? amount : -amount);
      }
    });
    return { customerBalMap: cMap, vendorBalMap: vMap };
  }, [ledgerEntries]);

  const getVendorBalance = (vendorId: string) => {
    return vendorBalMap[vendorId] || 0;
  };

  const vendorBalances = React.useMemo(() => vendors.map(v => ({
    ...v,
    balance: getVendorBalance(v.id)
  })), [vendors, vendorBalMap]);

  const totalVendorPayableOnly = React.useMemo(() => vendorBalances.filter(v => v.balance < 0).reduce((sum, v) => sum + Math.abs(v.balance), 0), [vendorBalances]);
  const totalVendorReceivableOnly = React.useMemo(() => vendorBalances.filter(v => v.balance > 0).reduce((sum, v) => sum + v.balance, 0), [vendorBalances]);
  const totalVendorPayable = React.useMemo(() => vendorBalances.reduce((sum, v) => sum + v.balance, 0), [vendorBalances]);

  const getCustomerBalance = (customerId: string) => {
    return customerBalMap[customerId] || 0;
  };

  const customerBalances = React.useMemo(() => customers.map(c => ({
    ...c,
    balance: getCustomerBalance(c.id)
  })), [customers, customerBalMap]);

  const totalCustomerReceivable = React.useMemo(() => customerBalances.filter(c => c.balance < 0).reduce((sum, c) => sum + Math.abs(c.balance), 0), [customerBalances]);
  const totalCustomerPrepaid = React.useMemo(() => customerBalances.filter(c => c.balance > 0).reduce((sum, c) => sum + c.balance, 0), [customerBalances]);
  
  // Expenses, Labour & Purchase Calculations
  const expenseEntries = React.useMemo(() => {
    return ledgerEntries.filter(entry => {
      const cat = entry.category || '';
      return cat === 'Expense' || cat === 'General Expense' || (cat.toLowerCase().includes('expense') && entry.type === 'OUT');
    });
  }, [ledgerEntries]);

  const dailyExpenseEntries = React.useMemo(() => {
    return expenseEntries.filter(entry => {
      const entryDate = getSaleTime(entry);
      return isSaleOnDate(entryDate, selectedDailyDateStr);
    });
  }, [expenseEntries, selectedDailyDateStr]);

  const monthlyExpenseEntries = React.useMemo(() => {
    return expenseEntries.filter(entry => {
      const entryDate = getSaleTime(entry);
      return isSaleInMonth(entryDate, selectedMonthStr);
    });
  }, [expenseEntries, selectedMonthStr]);

  const dailyExpenses = React.useMemo(() => {
    return dailyExpenseEntries.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
  }, [dailyExpenseEntries]);

  const monthlyExpenses = React.useMemo(() => {
    return monthlyExpenseEntries.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
  }, [monthlyExpenseEntries]);

  const totalExpenses = React.useMemo(() => {
    return expenseEntries.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
  }, [expenseEntries]);

  let totalLabour = 0;
  let monthlyLabour = 0;
  let dailyLabour = 0;

  ledgerEntries.forEach(entry => {
    const entryDate = getSaleTime(entry);
    const amount = Number(entry.amount) || 0;
    
    if (entry.category === 'Salary' || entry.category === 'Advance') {
      totalLabour += amount;
      if (isSaleInMonth(entryDate, selectedMonthStr)) monthlyLabour += amount;
      if (isSaleOnDate(entryDate, selectedDailyDateStr)) dailyLabour += amount;
    }
  });
  
  let totalPurchasesValue = 0;
  let monthlyPurchasesValue = 0;
  let dailyPurchasesValue = 0;
  
  purchases.forEach(p => {
    const pDate = p.date || 0;
    const amount = Number(p.total) || 0;
    totalPurchasesValue += amount;
    if (isSaleInMonth(pDate)) monthlyPurchasesValue += amount;
    if (isSaleOnDate(pDate)) dailyPurchasesValue += amount;
  });

  // Dynamic Opening Galla (starts auto carry-forward only after first manual entry exists)
  const openingGallaInfo = React.useMemo(() => {
    return resolveOpeningGallaForDate({
      targetDateStr: selectedDailyDateStr,
      dailyOpeningBalances,
      sales,
      ledgerEntries,
      ownerTransactions,
      branchId: resolvedBranchId,
      fallbackBranchId: branches[0]?.id || 'main',
    });
  }, [selectedDailyDateStr, dailyOpeningBalances, sales, ledgerEntries, ownerTransactions, resolvedBranchId, branches]);

  const todayOpeningBalance = openingGallaInfo.openingGalla;

  // Actual Galla / Drawer Cash Calculation (DAILY DRAWER CASH - strictly for selected daily date)
  const drawerSummary = React.useMemo(() => {
    return calculateCashDrawer({
      sales,
      ledgerEntries,
      ownerTransactions,
      openingGalla: todayOpeningBalance,
      openingGallaDescription: openingGallaInfo.isAuto && openingGallaInfo.previousDateStr
        ? `Auto Carry-Forward from ${openingGallaInfo.previousDateStr} Actual Galla`
        : 'Manual Opening Galla Balance',
      branchId: resolvedBranchId,
      fallbackBranchId: branches[0]?.id || 'main',
      isWithinDate: (ts) => isSaleOnDate(ts, selectedDailyDateStr),
    });
  }, [sales, ledgerEntries, ownerTransactions, todayOpeningBalance, openingGallaInfo, resolvedBranchId, branches, selectedDailyDateStr]);

  const netDrawerCash = drawerSummary.netDrawerCash;

  return (
    <div className="max-w-[1600px] mx-auto space-y-5">
      {/* Main on-screen Dashboard UI (hidden in print when monthly sale modal is printing) */}
      <div className={activeModal === 'monthly-sale' ? "space-y-5 print:hidden" : "space-y-5"}>
        {error && (
        <div className="bg-rose-50 dark:bg-rose-950/40 text-rose-800 dark:text-rose-200 p-4 rounded-xl border border-rose-200 dark:border-rose-900/60 shadow-xs flex flex-col gap-1">
          <p className="font-bold flex items-center gap-2 text-sm">
            <X className="w-4 h-4 text-rose-600" /> Database Connection Error
          </p>
          <p className="text-xs font-mono whitespace-pre-wrap">{error}</p>
          {error.includes('session issue') && (
            <div className="mt-1 border-t border-rose-200 dark:border-rose-800 pt-2">
               <button 
                onClick={() => window.open(window.location.href, '_blank')}
                className="bg-rose-600 text-white px-3 py-1 rounded-md text-xs font-semibold hover:bg-rose-700"
              >
                Open in New Tab to Fix Auth
              </button>
            </div>
          )}
        </div>
      )}

      {loading && !error && (
        <div className="bg-white dark:bg-[#111827] text-slate-600 dark:text-slate-300 px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-800 flex items-center gap-3 text-xs font-medium">
          <div className="w-4 h-4 rounded-full border-2 border-blue-600 border-t-transparent animate-spin shrink-0" />
          <span>Loading business metrics...</span>
        </div>
      )}

      {/* Top Right-to-Left Low Stock Alert Ticker */}
      {user?.role !== 'limited_access' && user?.role !== 'cashier' && lowStockItems.length > 0 && (
        <div className="marquee-container bg-rose-50/90 dark:bg-rose-950/35 border border-rose-200/90 dark:border-rose-900/70 rounded-xl overflow-hidden flex items-center shadow-[0_1px_2px_rgba(225,29,72,0.05)]">
          {/* Fixed Left Alert Label */}
          <div className="flex items-center gap-2 px-3.5 py-2.5 bg-rose-600 dark:bg-rose-700 text-white text-xs font-semibold whitespace-nowrap shrink-0 z-10">
            <Package className="w-3.5 h-3.5 shrink-0" />
            <span>Low Stock Alert</span>
            <span className="font-mono text-[11px] bg-white/20 px-1.5 py-0.5 rounded tabular-nums">
              {lowStockItems.length}
            </span>
          </div>

          {/* Continuous Right-to-Left Sliding Ticker Track */}
          <div className="flex-1 overflow-hidden relative py-2">
            <div
              className="animate-marquee-rtl items-center"
              style={{ animationDuration: `${Math.max(18, lowStockItems.length * 4)}s` }}
            >
              {[0, 1].map((dupIndex) => (
                <div key={dupIndex} className="flex items-center shrink-0" aria-hidden={dupIndex === 1}>
                  {lowStockItems.map((item, idx) => (
                    <Link
                      key={`${dupIndex}-${item.id || idx}`}
                      to="/inventory"
                      className="inline-flex items-center gap-2 px-4 text-xs text-rose-900 dark:text-rose-200 hover:text-rose-600 dark:hover:text-white transition-colors whitespace-nowrap"
                    >
                      <span className="font-semibold">{item.name}</span>
                      <span className="font-mono font-bold text-rose-600 dark:text-rose-400 tabular-nums">
                        (Stock: {item.stock ?? 0})
                      </span>
                      <span className="text-rose-300 dark:text-rose-700 pl-2" aria-hidden="true">&bull;</span>
                    </Link>
                  ))}
                </div>
              ))}
            </div>
          </div>

          {/* Fixed Right Action Link */}
          <Link
            to="/inventory"
            className="px-3.5 py-2.5 text-xs font-semibold text-rose-700 dark:text-rose-300 hover:text-rose-900 dark:hover:text-white hover:bg-rose-100/70 dark:hover:bg-rose-900/40 border-l border-rose-200/80 dark:border-rose-900/70 whitespace-nowrap shrink-0 transition-colors z-10"
          >
            Review Inventory &rarr;
          </Link>
        </div>
      )}

        {/* Executive Overview Toolbar */}
        <div className="bg-white dark:bg-[#111827] border border-slate-200/90 dark:border-slate-800 rounded-xl p-4 sm:p-5 shadow-[0_1px_3px_rgba(15,23,42,0.03)] flex flex-col xl:flex-row justify-between items-start xl:items-center gap-4">
          <div className="flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-xl bg-blue-600/10 dark:bg-blue-500/15 border border-blue-600/20 dark:border-blue-400/20 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
              <BarChart3 className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-lg sm:text-xl font-display font-bold text-slate-900 dark:text-slate-50 tracking-tight">
                Overview Dashboard
              </h1>
              <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                <span className="font-semibold text-slate-700 dark:text-slate-300">{currentBranch?.name || 'Main Branch'}</span>
                <span aria-hidden="true">&middot;</span>
                <span>Real-time revenue, inventory, and cash drawer summary</span>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 w-full xl:w-auto xl:justify-end">
            {/* Opening Galla Control */}
            <button
              type="button"
              onClick={() => {
                setOpeningCashInput(todayOpeningBalance !== 0 ? todayOpeningBalance : (openingGallaInfo.isManual ? 0 : ''));
                setShowOpeningCashModal(true);
              }}
              className="flex items-center gap-2.5 bg-amber-50/80 hover:bg-amber-100/70 dark:bg-amber-950/35 dark:hover:bg-amber-950/55 text-amber-950 dark:text-amber-100 px-3.5 py-2 rounded-lg text-xs border border-amber-200/90 dark:border-amber-800/70 transition-colors cursor-pointer whitespace-nowrap shrink-0"
              title="Click to set or edit daily opening cash balance (روزانہ کا ابتدائی گلہ)"
            >
              <Coins className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
              <span className="font-medium text-slate-600 dark:text-slate-300">Opening Galla</span>
              <span className="font-mono text-sm font-bold text-slate-900 dark:text-white tabular-nums">
                PKR {todayOpeningBalance.toLocaleString()}
              </span>
              {openingGallaInfo.isAuto && (
                <span className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
                  Auto
                </span>
              )}
              {openingGallaInfo.isManual && (
                <span className="text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">
                  Manual
                </span>
              )}
              <Edit2 className="w-3.5 h-3.5 text-amber-600/80 dark:text-amber-400/80 shrink-0" />
            </button>

            {/* Actual Galla / Drawer Cash */}
            <button
              type="button"
              onClick={() => setShowDrawerBreakdownModal(true)}
              className="flex items-center gap-2.5 bg-emerald-600 hover:bg-emerald-700 dark:bg-emerald-600 dark:hover:bg-emerald-500 text-white px-3.5 py-2 rounded-lg text-xs transition-colors cursor-pointer whitespace-nowrap shrink-0 shadow-xs"
              title="Actual Galla / Cash in Drawer (اصل دراز کیش) - Click to view full breakdown"
            >
              <Banknote className="w-4 h-4 text-emerald-100 shrink-0" />
              <span className="font-medium text-emerald-50">Actual Galla</span>
              <span className="font-mono text-sm font-bold tabular-nums">
                PKR {netDrawerCash.toLocaleString()}
              </span>
            </button>

            {/* Date & Month Filter Capsule */}
            <div className="flex flex-wrap items-center gap-2 bg-slate-50 dark:bg-[#0B1120] px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-800 shrink-0">
              <div className="flex items-center gap-1.5 pr-2 border-r border-slate-200 dark:border-slate-800">
                <label className="text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center gap-1 whitespace-nowrap">
                  <Calendar className="w-3.5 h-3.5 text-slate-400" />
                  <span>Date</span>
                </label>
                <input
                  type="date"
                  value={selectedDailyDateStr}
                  onChange={(e) => setSelectedDailyDateStr(e.target.value)}
                  className="rounded-md border-0 px-1 py-0.5 bg-transparent text-xs font-semibold text-slate-800 dark:text-slate-100 outline-none cursor-pointer"
                />
                {selectedDailyDateStr !== todayDateStr && (
                  <button
                    type="button"
                    onClick={() => setSelectedDailyDateStr(todayDateStr)}
                    className="text-[11px] text-blue-600 hover:text-blue-700 dark:text-blue-400 font-semibold px-1 rounded transition-colors cursor-pointer"
                    title="Reset to Today"
                  >
                    Today
                  </button>
                )}
              </div>

              <div className="flex items-center gap-1.5">
                <label className="text-xs font-medium text-slate-500 dark:text-slate-400 whitespace-nowrap">Month</label>
                <input
                  type="month"
                  value={selectedMonthStr}
                  onChange={(e) => setSelectedMonthStr(e.target.value)}
                  className="rounded-md border-0 px-1 py-0.5 bg-transparent text-xs font-semibold text-slate-800 dark:text-slate-100 outline-none cursor-pointer"
                />
              </div>
            </div>

            {user?.role === 'super_admin' && enableDashboardEdit && (
              <button
                type="button"
                onClick={handleEditClick}
                className="flex items-center gap-1.5 px-3 py-2 bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 rounded-lg text-xs font-semibold hover:bg-slate-800 dark:hover:bg-slate-200 transition-colors shrink-0 cursor-pointer"
              >
                <Settings className="w-3.5 h-3.5" />
                <span>Edit</span>
              </button>
            )}
          </div>
        </div>

      {/* Executive KPI Grid — Strictly 4 Boxes Per Line on Desktop (lg:grid-cols-4) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* 1. Daily Sale */}
        <div
          onClick={() => handleBoxClick("daily-sale")}
          className="kpi-card p-4 xl:p-5 flex flex-col justify-between min-h-[148px] cursor-pointer relative overflow-hidden group"
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <h3 className="text-xs font-semibold text-slate-600 dark:text-slate-300">Daily Sale</h3>
              <span className="text-[11px] font-medium text-slate-400 dark:text-slate-500 font-mono tabular-nums block mt-0.5">
                {formatDate(parse(selectedDailyDateStr, 'yyyy-MM-dd', new Date()).getTime())}
                {selectedDailyDateStr === todayDateStr ? ' · Today' : ''}
              </span>
            </div>
            <div className="w-8 h-8 rounded-lg bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
              <TrendingUp className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-xl xl:text-[22px] font-bold font-mono tabular-nums text-slate-900 dark:text-slate-50 tracking-tight truncate">
              PKR {formatCurrency(dailySales)}
            </div>
            <div className="mt-2.5 pt-2 border-t border-slate-100 dark:border-slate-800/80 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-500 dark:text-slate-400">
              <span className="font-semibold text-slate-700 dark:text-slate-200 tabular-nums">{dailySuits} Suits ({dailyBills} Bills)</span>
              <span aria-hidden="true">&middot;</span>
              <span className="text-emerald-600 dark:text-emerald-400 tabular-nums">Store {formatCurrency(dailyInStoreSales)}</span>
              <span aria-hidden="true">&middot;</span>
              <span className="text-blue-600 dark:text-blue-400 tabular-nums">Online {formatCurrency(dailyOnlineSales)}</span>
            </div>
          </div>
        </div>

        {/* 2. Daily Profit */}
        {user?.role !== 'limited_access' && user?.role !== 'sales_stock_only' && user?.role !== 'new_limited_access' && user?.role !== 'cashier' && (
        <div
          onClick={() => handleBoxClick("daily-profit")}
          className="kpi-card p-4 xl:p-5 flex flex-col justify-between min-h-[148px] cursor-pointer relative overflow-hidden group"
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <h3 className="text-xs font-semibold text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
                <span>Daily Profit</span>
                <Lock className="w-3 h-3 text-amber-500 shrink-0" />
              </h3>
              <span className="text-[11px] font-medium text-slate-400 dark:text-slate-500 block mt-0.5">
                Net Margin
              </span>
            </div>
            <div className="w-8 h-8 rounded-lg bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
              <Wallet className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-xl xl:text-[22px] font-bold font-mono tabular-nums text-emerald-700 dark:text-emerald-400 tracking-tight truncate">
              PKR {formatCurrency(dailyProfit)}
            </div>
            <div className="mt-2.5 pt-2 border-t border-slate-100 dark:border-slate-800/80 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-500 dark:text-slate-400">
              <span className="text-emerald-600 dark:text-emerald-400 tabular-nums font-medium">Store {formatCurrency(dailyInStoreProfit)}</span>
              <span aria-hidden="true">&middot;</span>
              <span className="text-blue-600 dark:text-blue-400 tabular-nums font-medium">Online {formatCurrency(dailyOnlineProfit)}</span>
            </div>
          </div>
        </div>
        )}

        {/* 3. Daily Expense */}
        {user?.role !== 'sales_stock_only' && user?.role !== 'limited_access' && (
        <div
          onClick={() => handleBoxClick("daily-expense")}
          className="kpi-card p-4 xl:p-5 flex flex-col justify-between min-h-[148px] cursor-pointer relative overflow-hidden group"
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <h3 className="text-xs font-semibold text-slate-600 dark:text-slate-300">Daily Expense</h3>
              <span className="text-[11px] font-urdu text-slate-400 dark:text-slate-500 block mt-0.5">آج کا خرچہ</span>
            </div>
            <div className="w-8 h-8 rounded-lg bg-rose-50 dark:bg-rose-500/10 text-rose-600 dark:text-rose-400 flex items-center justify-center shrink-0">
              <Receipt className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <div className={`text-xl xl:text-[22px] font-bold font-mono tabular-nums tracking-tight truncate ${dailyExpenses > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-900 dark:text-slate-50'}`}>
              PKR {formatCurrency(dailyExpenses)}
            </div>
            <div className="mt-2.5 pt-2 border-t border-slate-100 dark:border-slate-800/80 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-500 dark:text-slate-400">
              <span className="font-semibold text-rose-600 dark:text-rose-400 tabular-nums">{dailyExpenseEntries.length} Entries</span>
              <span aria-hidden="true">&middot;</span>
              <span>{formatDate(parse(selectedDailyDateStr, 'yyyy-MM-dd', new Date()).getTime())}</span>
            </div>
          </div>
        </div>
        )}

        {/* 4. Daily Loss Bills */}
        {user?.role !== 'limited_access' && user?.role !== 'sales_stock_only' && (
        <div
          onClick={() => { setLossModalFilter('daily'); handleBoxClick("loss-suites"); }}
          className="kpi-card p-4 xl:p-5 flex flex-col justify-between min-h-[148px] cursor-pointer relative overflow-hidden group"
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <h3 className="text-xs font-semibold text-slate-600 dark:text-slate-300">Daily Loss Bills</h3>
              <span className="text-[11px] font-urdu text-rose-600 dark:text-rose-400 block mt-0.5">آج کا نقصان</span>
            </div>
            <div className="w-8 h-8 rounded-lg bg-rose-50 dark:bg-rose-500/10 text-rose-600 dark:text-rose-400 flex items-center justify-center shrink-0">
              <TrendingDown className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <div className={`text-xl xl:text-[22px] font-bold font-mono tabular-nums tracking-tight truncate ${dailyLoss > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-900 dark:text-slate-50'}`}>
              PKR {formatCurrency(dailyLoss)}
            </div>
            <div className="mt-2.5 pt-2 border-t border-slate-100 dark:border-slate-800/80 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-500 dark:text-slate-400">
              <span className="font-semibold text-rose-600 dark:text-rose-400 tabular-nums">
                {dailyLossBills} Bills ({dailyLossSuits} Suits)
              </span>
              <span aria-hidden="true">&middot;</span>
              <span className="tabular-nums">Month {formatCurrency(monthlyLoss)}</span>
            </div>
          </div>
        </div>
        )}

        {/* 5. Monthly Sale */}
        {user?.role !== 'sales_stock_only' && user?.role !== 'cashier' && user?.role !== 'limited_access' && (
        <div
          onClick={() => handleBoxClick("monthly-sale")}
          className="kpi-card p-4 xl:p-5 flex flex-col justify-between min-h-[148px] cursor-pointer relative overflow-hidden group"
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <h3 className="text-xs font-semibold text-slate-600 dark:text-slate-300">Monthly Sale</h3>
              <span className="text-[11px] font-medium text-slate-400 dark:text-slate-500 block mt-0.5">
                {formatMonthName(selectedMonthStr)}
              </span>
            </div>
            <div className="w-8 h-8 rounded-lg bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0">
              <BarChart3 className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-xl xl:text-[22px] font-bold font-mono tabular-nums text-slate-900 dark:text-slate-50 tracking-tight truncate">
              PKR {formatCurrency(monthlySales)}
            </div>
            <div className="mt-2.5 pt-2 border-t border-slate-100 dark:border-slate-800/80 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-500 dark:text-slate-400">
              <span className="font-semibold text-slate-700 dark:text-slate-200 tabular-nums">{monthlySuits} Suits ({monthlyBills} Bills)</span>
              <span aria-hidden="true">&middot;</span>
              <span className="text-blue-600 dark:text-blue-400 tabular-nums">Online {formatCurrency(monthlyOnlineSales)}</span>
            </div>
          </div>
        </div>
        )}

        {/* 6. Monthly Profit */}
        {user?.role !== 'limited_access' && user?.role !== 'sales_stock_only' && user?.role !== 'new_limited_access' && user?.role !== 'cashier' && (
        <div
          onClick={() => handleBoxClick("monthly-profit")}
          className="kpi-card p-4 xl:p-5 flex flex-col justify-between min-h-[148px] cursor-pointer relative overflow-hidden group"
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <h3 className="text-xs font-semibold text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
                <span>Monthly Profit</span>
                <Lock className="w-3 h-3 text-amber-500 shrink-0" />
              </h3>
              <span className="text-[11px] font-medium text-slate-400 dark:text-slate-500 block mt-0.5">
                {formatMonthName(selectedMonthStr)}
              </span>
            </div>
            <div className="w-8 h-8 rounded-lg bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
              <TrendingUp className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-xl xl:text-[22px] font-bold font-mono tabular-nums text-emerald-700 dark:text-emerald-400 tracking-tight truncate">
              PKR {formatCurrency(monthlyProfit)}
            </div>
            <div className="mt-2.5 pt-2 border-t border-slate-100 dark:border-slate-800/80 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-500 dark:text-slate-400">
              <span className="text-emerald-600 dark:text-emerald-400 tabular-nums font-medium">Sales {formatCurrency(monthlySales)}</span>
              <span aria-hidden="true">&middot;</span>
              <span className="text-blue-600 dark:text-blue-400 tabular-nums font-medium">Online {formatCurrency(monthlyOnlineProfit)}</span>
            </div>
          </div>
        </div>
        )}

        {/* 7. Monthly Expense */}
        {user?.role !== 'sales_stock_only' && user?.role !== 'limited_access' && (
        <div
          onClick={() => handleBoxClick("monthly-expense")}
          className="kpi-card p-4 xl:p-5 flex flex-col justify-between min-h-[148px] cursor-pointer relative overflow-hidden group"
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <h3 className="text-xs font-semibold text-slate-600 dark:text-slate-300">Monthly Expense</h3>
              <span className="text-[11px] font-urdu text-slate-400 dark:text-slate-500 block mt-0.5">اس ماہ کا خرچہ</span>
            </div>
            <div className="w-8 h-8 rounded-lg bg-rose-50 dark:bg-rose-500/10 text-rose-600 dark:text-rose-400 flex items-center justify-center shrink-0">
              <Receipt className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <div className={`text-xl xl:text-[22px] font-bold font-mono tabular-nums tracking-tight truncate ${monthlyExpenses > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-900 dark:text-slate-50'}`}>
              PKR {formatCurrency(monthlyExpenses)}
            </div>
            <div className="mt-2.5 pt-2 border-t border-slate-100 dark:border-slate-800/80 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-500 dark:text-slate-400">
              <span className="font-semibold text-rose-600 dark:text-rose-400 tabular-nums">{monthlyExpenseEntries.length} Entries</span>
              <span aria-hidden="true">&middot;</span>
              <span className="tabular-nums">{Array.from(new Set(monthlyExpenseEntries.map(e => e.reference || 'General'))).length} Accounts</span>
            </div>
          </div>
        </div>
        )}

        {/* 8. Monthly Loss Bills */}
        {user?.role !== 'limited_access' && user?.role !== 'sales_stock_only' && (
        <div
          onClick={() => { setLossModalFilter('monthly'); handleBoxClick("loss-suites"); }}
          className="kpi-card p-4 xl:p-5 flex flex-col justify-between min-h-[148px] cursor-pointer relative overflow-hidden group"
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <h3 className="text-xs font-semibold text-slate-600 dark:text-slate-300">Monthly Loss Bills</h3>
              <span className="text-[11px] font-urdu text-rose-600 dark:text-rose-400 block mt-0.5">اس ماہ کا نقصان</span>
            </div>
            <div className="w-8 h-8 rounded-lg bg-rose-50 dark:bg-rose-500/10 text-rose-600 dark:text-rose-400 flex items-center justify-center shrink-0">
              <TrendingDown className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <div className={`text-xl xl:text-[22px] font-bold font-mono tabular-nums tracking-tight truncate ${monthlyLoss > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-900 dark:text-slate-50'}`}>
              PKR {formatCurrency(monthlyLoss)}
            </div>
            <div className="mt-2.5 pt-2 border-t border-slate-100 dark:border-slate-800/80 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-500 dark:text-slate-400">
              <span className="font-semibold text-rose-600 dark:text-rose-400 tabular-nums">
                {monthlyLossBills} Bills ({monthlyLossSuits} Suits)
              </span>
              <span aria-hidden="true">&middot;</span>
              <span className="tabular-nums">All {formatCurrency(totalLoss)} ({totalLossBills})</span>
            </div>
          </div>
        </div>
        )}

        {/* 9. Total Revenue */}
        {((user?.role !== 'limited_access' && user?.role !== 'sales_stock_only' && user?.role !== 'cashier') || user?.role === 'new_limited_access') && (
        <div
          onClick={() => handleBoxClick("total-sale")}
          className="kpi-card p-4 xl:p-5 flex flex-col justify-between min-h-[148px] cursor-pointer relative overflow-hidden group"
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <h3 className="text-xs font-semibold text-slate-600 dark:text-slate-300">Total Revenue</h3>
              <span className="text-[11px] font-mono text-slate-400 dark:text-slate-500 tabular-nums block mt-0.5">
                {lastTotalBillDate ? `Updated ${lastTotalBillDate}` : 'Cumulative'}
              </span>
            </div>
            <div className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 flex items-center justify-center shrink-0">
              <Landmark className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-xl xl:text-[22px] font-bold font-mono tabular-nums text-slate-900 dark:text-slate-50 tracking-tight truncate">
              PKR {formatCurrency(totalSales)}
            </div>
            <div className="mt-2.5 pt-2 border-t border-slate-100 dark:border-slate-800/80 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-500 dark:text-slate-400">
              <span className="font-semibold text-slate-700 dark:text-slate-200 tabular-nums">{totalSuits} Suits ({totalBills} Bills)</span>
              <span aria-hidden="true">&middot;</span>
              <span className="text-blue-600 dark:text-blue-400 tabular-nums">Online {formatCurrency(totalOnlineSales)}</span>
            </div>
          </div>
        </div>
        )}

        {/* 10. Overall Profit */}
        {user?.role !== 'limited_access' && user?.role !== 'sales_stock_only' && user?.role !== 'new_limited_access' && user?.role !== 'cashier' && (
        <div
          onClick={() => handleBoxClick("total-profit")}
          className="kpi-card p-4 xl:p-5 flex flex-col justify-between min-h-[148px] cursor-pointer relative overflow-hidden group"
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <h3 className="text-xs font-semibold text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
                <span>Overall Profit</span>
                <Lock className="w-3 h-3 text-amber-500 shrink-0" />
              </h3>
              <span className="text-[11px] font-medium text-slate-400 dark:text-slate-500 block mt-0.5">
                Cumulative Net
              </span>
            </div>
            <div className="w-8 h-8 rounded-lg bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
              <Wallet className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-xl xl:text-[22px] font-bold font-mono tabular-nums text-emerald-700 dark:text-emerald-400 tracking-tight truncate">
              PKR {formatCurrency(totalProfit)}
            </div>
            <div className="mt-2.5 pt-2 border-t border-slate-100 dark:border-slate-800/80 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-500 dark:text-slate-400">
              <span className="text-emerald-600 dark:text-emerald-400 tabular-nums font-medium">Sales {formatCurrency(totalSales)}</span>
              <span aria-hidden="true">&middot;</span>
              <span className="text-blue-600 dark:text-blue-400 tabular-nums font-medium">Online {formatCurrency(totalOnlineProfit)}</span>
            </div>
          </div>
        </div>
        )}

        {/* 11. Stock Value */}
        {((user?.role !== 'limited_access' && user?.role !== 'sales_stock_only' && user?.role !== 'cashier') || user?.role === 'new_limited_access') && (
        <div
          onClick={() => handleBoxClick("stock")}
          className="kpi-card p-4 xl:p-5 flex flex-col justify-between min-h-[148px] cursor-pointer relative overflow-hidden group"
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <h3 className="text-xs font-semibold text-slate-600 dark:text-slate-300">Stock Value</h3>
              <span className="text-[11px] font-medium text-slate-400 dark:text-slate-500 block mt-0.5">Inventory Cost</span>
            </div>
            <div className="w-8 h-8 rounded-lg bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
              <Package className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-xl xl:text-[22px] font-bold font-mono tabular-nums text-slate-900 dark:text-slate-50 tracking-tight truncate">
              PKR {formatCurrency(stockValue)}
            </div>
            <div className="mt-2.5 pt-2 border-t border-slate-100 dark:border-slate-800/80 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-500 dark:text-slate-400">
              <span className="font-semibold text-slate-700 dark:text-slate-200 tabular-nums">{inventory.length} Items</span>
              <span aria-hidden="true">&middot;</span>
              <span className="text-rose-600 dark:text-rose-400 tabular-nums font-medium">{lowStockItems.length} Low Stock</span>
            </div>
          </div>
        </div>
        )}

        {/* 12. Monthly Purchases */}
        {((user?.role !== 'limited_access' && user?.role !== 'sales_stock_only' && user?.role !== 'cashier') || user?.role === 'new_limited_access') && (
        <div
          onClick={() => navigate('/purchases')}
          className="kpi-card p-4 xl:p-5 flex flex-col justify-between min-h-[148px] cursor-pointer relative overflow-hidden group"
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <h3 className="text-xs font-semibold text-slate-600 dark:text-slate-300">Monthly Purchases</h3>
              <span className="text-[11px] font-medium text-slate-400 dark:text-slate-500 block mt-0.5">
                {formatMonthName(selectedMonthStr)}
              </span>
            </div>
            <div className="w-8 h-8 rounded-lg bg-sky-50 dark:bg-sky-500/10 text-sky-600 dark:text-sky-400 flex items-center justify-center shrink-0">
              <ShoppingBag className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-xl xl:text-[22px] font-bold font-mono tabular-nums text-slate-900 dark:text-slate-50 tracking-tight truncate">
              PKR {formatCurrency(monthlyPurchasesValue)}
            </div>
            <div className="mt-2.5 pt-2 border-t border-slate-100 dark:border-slate-800/80 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-500 dark:text-slate-400">
              <span className="font-medium text-slate-700 dark:text-slate-200 tabular-nums">Daily {formatCurrency(dailyPurchasesValue)}</span>
              <span aria-hidden="true">&middot;</span>
              <span className="tabular-nums">All {formatCurrency(totalPurchasesValue)}</span>
            </div>
          </div>
        </div>
        )}

        {/* 13. Actual Galla / Cash Drawer */}
        <div
          onClick={() => setShowDrawerBreakdownModal(true)}
          className="kpi-card p-4 xl:p-5 flex flex-col justify-between min-h-[148px] cursor-pointer relative overflow-hidden group"
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <h3 className="text-xs font-semibold text-slate-600 dark:text-slate-300">Actual Galla</h3>
              <span className="text-[11px] font-urdu text-emerald-600 dark:text-emerald-400 block mt-0.5">آج کا دراز کیش</span>
            </div>
            <div className="w-8 h-8 rounded-lg bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
              <Banknote className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-xl xl:text-[22px] font-bold font-mono tabular-nums text-emerald-700 dark:text-emerald-400 tracking-tight truncate">
              PKR {netDrawerCash.toLocaleString()}
            </div>
            <div className="mt-2.5 pt-2 border-t border-slate-100 dark:border-slate-800/80 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-500 dark:text-slate-400">
              <span className="text-amber-600 dark:text-amber-400 font-medium tabular-nums">Open {formatCurrency(todayOpeningBalance)}</span>
              <span aria-hidden="true">&middot;</span>
              <span className="tabular-nums">Cash {formatCurrency(drawerSummary.inStoreCashSales)}</span>
            </div>
          </div>
        </div>

        {/* 14. Vendor Payable */}
        {((user?.role !== 'limited_access' && user?.role !== 'sales_stock_only' && user?.role !== 'cashier') || user?.role === 'new_limited_access') && (
        <div
          onClick={() => { setPayableModalTab('vendors'); handleBoxClick("vendor-payable"); }}
          className="kpi-card p-4 xl:p-5 flex flex-col justify-between min-h-[148px] cursor-pointer relative overflow-hidden group"
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <h3 className="text-xs font-semibold text-slate-600 dark:text-slate-300">Vendor Payable</h3>
              <span className="text-[11px] font-urdu text-rose-600 dark:text-rose-400 block mt-0.5">دینا ہے</span>
            </div>
            <div className="w-8 h-8 rounded-lg bg-rose-50 dark:bg-rose-500/10 text-rose-600 dark:text-rose-400 flex items-center justify-center shrink-0">
              <ArrowUpRight className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <div className={`text-xl xl:text-[22px] font-bold font-mono tabular-nums tracking-tight truncate ${totalVendorPayableOnly > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-900 dark:text-slate-50'}`}>
              PKR {formatCurrency(totalVendorPayableOnly)}
            </div>
            <div className="mt-2.5 pt-2 border-t border-slate-100 dark:border-slate-800/80 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-500 dark:text-slate-400">
              <span className="font-semibold text-slate-700 dark:text-slate-200 tabular-nums">
                {vendorBalances.filter(v => v.balance < 0).length} Vendors
              </span>
              {totalCustomerPrepaid > 0 && (
                <>
                  <span aria-hidden="true">&middot;</span>
                  <span className="text-amber-600 dark:text-amber-400 tabular-nums">
                    +PKR {formatCurrency(totalCustomerPrepaid)} Adv.
                  </span>
                </>
              )}
            </div>
          </div>
        </div>
        )}

        {/* 15. Customer Receivable */}
        {((user?.role !== 'limited_access' && user?.role !== 'sales_stock_only' && user?.role !== 'cashier') || user?.role === 'new_limited_access') && (
        <div
          onClick={() => { setReceivableModalTab('customers'); handleBoxClick("vendor-receivable"); }}
          className="kpi-card p-4 xl:p-5 flex flex-col justify-between min-h-[148px] cursor-pointer relative overflow-hidden group"
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <h3 className="text-xs font-semibold text-slate-600 dark:text-slate-300">Customer Receivable</h3>
              <span className="text-[11px] font-urdu text-emerald-600 dark:text-emerald-400 block mt-0.5">وصولی</span>
            </div>
            <div className="w-8 h-8 rounded-lg bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
              <ArrowDownLeft className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <div className={`text-xl xl:text-[22px] font-bold font-mono tabular-nums tracking-tight truncate ${totalCustomerReceivable > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-900 dark:text-slate-50'}`}>
              PKR {formatCurrency(totalCustomerReceivable)}
            </div>
            <div className="mt-2.5 pt-2 border-t border-slate-100 dark:border-slate-800/80 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-500 dark:text-slate-400">
              <span className="font-semibold text-slate-700 dark:text-slate-200 tabular-nums">
                {customerBalances.filter(c => c.balance < 0).length} Customers
              </span>
              {totalVendorReceivableOnly > 0 && (
                <>
                  <span aria-hidden="true">&middot;</span>
                  <span className="text-blue-600 dark:text-blue-400 tabular-nums">
                    +PKR {formatCurrency(totalVendorReceivableOnly)} Adv.
                  </span>
                </>
              )}
            </div>
          </div>
        </div>
        )}

        {/* 16. Total Overall Expense */}
        {user?.role !== 'sales_stock_only' && user?.role !== 'limited_access' && (
        <div
          onClick={() => navigate('/expenses')}
          className="kpi-card p-4 xl:p-5 flex flex-col justify-between min-h-[148px] cursor-pointer relative overflow-hidden group"
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <h3 className="text-xs font-semibold text-slate-600 dark:text-slate-300">Overall Expenses</h3>
              <span className="text-[11px] font-urdu text-slate-400 dark:text-slate-500 block mt-0.5">کل اخراجات</span>
            </div>
            <div className="w-8 h-8 rounded-lg bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
              <CreditCard className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-xl xl:text-[22px] font-bold font-mono tabular-nums text-slate-900 dark:text-slate-50 tracking-tight truncate">
              PKR {formatCurrency(totalExpenses)}
            </div>
            <div className="mt-2.5 pt-2 border-t border-slate-100 dark:border-slate-800/80 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-500 dark:text-slate-400">
              <span className="font-medium text-rose-600 dark:text-rose-400 tabular-nums">{expenseEntries.length} Entries</span>
              <span aria-hidden="true">&middot;</span>
              <span className="tabular-nums">Month {formatCurrency(monthlyExpenses)}</span>
            </div>
          </div>
        </div>
        )}
      </div>

      {/* Real-Time Sales Activity Table */}
      {user?.role !== 'limited_access' && user?.role !== 'sales_stock_only' && (
      <div className="card overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center bg-slate-50/70 dark:bg-slate-900/50">
          <div>
            <h2 className="text-sm font-display font-bold text-slate-900 dark:text-slate-100 tracking-tight">Recent Sales Activity</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Latest counter and online transactions</p>
          </div>
          <Link
            to="/sales"
            className="px-3.5 py-1.5 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 rounded-lg text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors whitespace-nowrap shrink-0"
          >
            View All &rarr;
          </Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] uppercase tracking-wider font-semibold text-slate-500 dark:text-slate-400 bg-slate-50/40 dark:bg-slate-900/30">
                <th className="py-3 px-5">Invoice / Ref</th>
                <th className="py-3 px-5">Customer</th>
                <th className="py-3 px-5">Date &amp; Time</th>
                <th className="py-3 px-5 text-right">Amount</th>
                <th className="py-3 px-5 text-right">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 text-xs">
              {sortedSales.slice(0, 5).map(sale => {
                const saleTs = getSaleTime(sale);
                const isReturn = sale.transactionType === 'Return';
                return (
                  <tr key={sale.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors">
                    <td className="py-3.5 px-5 font-mono font-semibold text-slate-800 dark:text-slate-200">
                      {sale.invoiceNo ? `#${sale.invoiceNo}` : sale.id.slice(-6).toUpperCase()}
                    </td>
                    <td className="py-3.5 px-5 text-slate-700 dark:text-slate-300 font-medium">
                      {sale.customerName || 'Walk-in'}
                    </td>
                    <td className="py-3.5 px-5 text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                      {formatDateTime(saleTs)}
                    </td>
                    <td className="py-3.5 px-5 text-right font-mono font-bold tabular-nums text-slate-900 dark:text-slate-100">
                      PKR {formatCurrency(sale.total || 0)}
                    </td>
                    <td className="py-3.5 px-5 text-right font-semibold">
                      <span className={`inline-flex items-center gap-1.5 ${isReturn ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${isReturn ? 'bg-rose-500' : 'bg-emerald-500'}`} />
                        {isReturn ? 'Returned' : 'Completed'}
                      </span>
                    </td>
                  </tr>
                );
              })}
              {sortedSales.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-10 px-5 text-center text-xs text-slate-500 dark:text-slate-400">
                    No recent sales recorded yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      )}

      {/* Edit Offsets Modal */}
      {isEditingOffsets && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50">
          <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800/50 flex justify-between items-center bg-slate-50 dark:bg-slate-800/50">
              <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100">Edit Dashboard Values</h2>
              <button onClick={() => setIsEditingOffsets(false)} className="text-slate-400 hover:text-slate-600 transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div className="bg-sky-50 p-3 rounded border border-sky-100 mb-4">
                <p className="text-xs text-slate-700 dark:text-slate-200">
                  <strong>How it works:</strong> Enter the exact final value you want to see on the dashboard. It will automatically update as you make new sales. To revert a field to its real calculated value, <strong>clear it completely</strong> (leave it empty).
                </p>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                {enableDashboardEdit && (
                  <>
                    <div>
                      <label className="block text-xs font-bold text-slate-700 dark:text-slate-200 uppercase tracking-wide mb-1">Daily Sales</label>
                      <input type="number" value={offsetsForm.dailySales ?? ''} onChange={e => setOffsetsForm({...offsetsForm, dailySales: e.target.value})} className="w-full border border-slate-300 dark:border-slate-600 rounded px-3 py-2 text-sm focus:border-sky-500 dark:focus:border-sky-400 focus:ring-1 focus:ring-sky-500 dark:focus:ring-sky-400 outline-none" />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-700 dark:text-slate-200 uppercase tracking-wide mb-1">Daily Profit</label>
                      <input type="number" value={offsetsForm.dailyProfit ?? ''} onChange={e => setOffsetsForm({...offsetsForm, dailyProfit: e.target.value})} className="w-full border border-slate-300 dark:border-slate-600 rounded px-3 py-2 text-sm focus:border-sky-500 dark:focus:border-sky-400 focus:ring-1 focus:ring-sky-500 dark:focus:ring-sky-400 outline-none" />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-700 dark:text-slate-200 uppercase tracking-wide mb-1">Total Revenue</label>
                      <input type="number" value={offsetsForm.totalSales ?? ''} onChange={e => setOffsetsForm({...offsetsForm, totalSales: e.target.value})} className="w-full border border-slate-300 dark:border-slate-600 rounded px-3 py-2 text-sm focus:border-sky-500 dark:focus:border-sky-400 focus:ring-1 focus:ring-sky-500 dark:focus:ring-sky-400 outline-none" />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-700 dark:text-slate-200 uppercase tracking-wide mb-1">Overall Profit</label>
                      <input type="number" value={offsetsForm.totalProfit ?? ''} onChange={e => setOffsetsForm({...offsetsForm, totalProfit: e.target.value})} className="w-full border border-slate-300 dark:border-slate-600 rounded px-3 py-2 text-sm focus:border-sky-500 dark:focus:border-sky-400 focus:ring-1 focus:ring-sky-500 dark:focus:ring-sky-400 outline-none" />
                    </div>
                  </>
                )}
                
                {enableDashboardEdit && (
                  <>
                    <div>
                      <label className="block text-xs font-bold text-slate-700 dark:text-slate-200 uppercase tracking-wide mb-1">Daily Bills Count</label>
                      <input type="number" value={offsetsForm.dailyBills ?? ''} onChange={e => setOffsetsForm({...offsetsForm, dailyBills: e.target.value})} className="w-full border border-slate-300 dark:border-slate-600 rounded px-3 py-2 text-sm focus:border-sky-500 dark:focus:border-sky-400 focus:ring-1 focus:ring-sky-500 dark:focus:ring-sky-400 outline-none" placeholder="Auto" />
                    </div>
                    
                    <div>
                      <label className="block text-xs font-bold text-slate-700 dark:text-slate-200 uppercase tracking-wide mb-1">Total Bills Count</label>
                      <input type="number" value={offsetsForm.totalBills ?? ''} onChange={e => setOffsetsForm({...offsetsForm, totalBills: e.target.value})} className="w-full border border-slate-300 dark:border-slate-600 rounded px-3 py-2 text-sm focus:border-sky-500 dark:focus:border-sky-400 focus:ring-1 focus:ring-sky-500 dark:focus:ring-sky-400 outline-none" placeholder="Auto" />
                    </div>
                    
                  </>
                )}
              </div>
              <div className="mt-6 pt-4 border-t border-slate-100 dark:border-slate-800/50">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="font-semibold text-slate-800 dark:text-slate-100">Monthly Offsets</h3>
                  <input 
                    type="month" 
                    value={editMonth} 
                    onChange={(e) => setEditMonth(e.target.value)} 
                    className="text-sm border border-slate-300 dark:border-slate-600 rounded px-2 py-1 outline-none focus:border-sky-500 dark:focus:border-sky-400" 
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  {enableDashboardEdit && (
                    <>
                      <div>
                        <label className="block text-xs font-bold text-slate-700 dark:text-slate-200 uppercase tracking-wide mb-1">Monthly Sales</label>
                        <input 
                          type="number" 
                          value={offsetsForm[`monthlySales_${editMonth}`] ?? (editMonth === '2026-05' ? offsetsForm.monthlySales : '') ?? ''} 
                          onChange={e => setOffsetsForm({
                            ...offsetsForm, 
                            [`monthlySales_${editMonth}`]: e.target.value,
                            ...(editMonth === '2026-05' && { monthlySales: e.target.value })
                          })} 
                          className="w-full border border-slate-300 dark:border-slate-600 rounded px-3 py-2 text-sm focus:border-sky-500 dark:focus:border-sky-400 focus:ring-1 focus:ring-sky-500 dark:focus:ring-sky-400 outline-none" 
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-slate-700 dark:text-slate-200 uppercase tracking-wide mb-1">Monthly Profit</label>
                        <input 
                          type="number" 
                          value={offsetsForm[`monthlyProfit_${editMonth}`] ?? (editMonth === '2026-05' ? offsetsForm.monthlyProfit : '') ?? ''} 
                          onChange={e => setOffsetsForm({
                            ...offsetsForm, 
                            [`monthlyProfit_${editMonth}`]: e.target.value,
                            ...(editMonth === '2026-05' && { monthlyProfit: e.target.value })
                          })} 
                          className="w-full border border-slate-300 dark:border-slate-600 rounded px-3 py-2 text-sm focus:border-sky-500 dark:focus:border-sky-400 focus:ring-1 focus:ring-sky-500 dark:focus:ring-sky-400 outline-none" 
                        />
                      </div>
                    </>
                  )}
                  {enableDashboardEdit && (
                    <>
                      <div>
                        <label className="block text-xs font-bold text-slate-700 dark:text-slate-200 uppercase tracking-wide mb-1">Monthly Bills Count</label>
                        <input 
                          type="number" 
                          value={offsetsForm[`monthlyBills_${editMonth}`] ?? (editMonth === '2026-05' ? offsetsForm.monthlyBills : '') ?? ''} 
                          onChange={e => setOffsetsForm({
                            ...offsetsForm, 
                            [`monthlyBills_${editMonth}`]: e.target.value,
                            ...(editMonth === '2026-05' && { monthlyBills: e.target.value })
                          })} 
                          className="w-full border border-slate-300 dark:border-slate-600 rounded px-3 py-2 text-sm focus:border-sky-500 dark:focus:border-sky-400 focus:ring-1 focus:ring-sky-500 dark:focus:ring-sky-400 outline-none" 
                          placeholder="Auto"
                        />
                      </div>
                      
                    </>
                  )}
                </div>
              </div>
            </div>
            <div className="px-6 py-4 bg-slate-50 dark:bg-slate-800/50 border-t border-slate-100 dark:border-slate-800/50 flex justify-between items-center gap-3">
              <button 
                type="button"
                onClick={handleResetToReal} 
                className="px-3 py-2 text-xs font-bold text-rose-600 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg transition-colors"
                title="تمام آفسیٹس ختم کریں اور حقیقی سیل پر واپس آئیں"
              >
                Reset to 100% Real Values (حقیقی سیل بحال کریں)
              </button>
              <div className="flex items-center gap-2">
                <button onClick={() => setIsEditingOffsets(false)} className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 hover:text-slate-800 dark:hover:text-slate-200 transition-colors">Cancel</button>
                <button onClick={handleSaveOffsets} className="px-6 py-2 bg-slate-800 dark:bg-slate-100 hover:bg-slate-900 text-white rounded text-sm font-medium transition-colors shadow-md flex items-center">
                  <Save className="w-4 h-4 mr-2" />
                  Save Changes
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      </div>

       {activeModal && activeModal !== 'vendor-payable' && activeModal !== 'vendor-receivable' && activeModal !== 'daily-expense' && activeModal !== 'monthly-expense' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 print:hidden">
          <div className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-xl">
            <div className="flex justify-between items-center p-4 border-b border-slate-100 dark:border-slate-800/50">
               <h2 className="font-bold text-lg text-slate-800 dark:text-slate-100">
                 {activeModal === 'monthly-sale' ? `Monthly Sales Details (${formatMonthName(selectedMonthStr)})` :
                  activeModal?.startsWith('daily') ? `Daily Transactions (${formatDate(parse(selectedDailyDateStr, 'yyyy-MM-dd', new Date()).getTime())})` : 
                  activeModal?.startsWith('monthly') ? 'Monthly Transactions' :
                  activeModal?.startsWith('total') ? 'All Transactions' : 'Stock Value Details'}
               </h2>
               <div className="flex items-center gap-2">
                 <button
                   id="btn-print-modal-header"
                   type="button"
                   onClick={() => window.print()}
                   className="flex items-center gap-1.5 px-3 py-1.5 bg-sky-600 hover:bg-sky-700 text-white rounded-lg text-xs font-bold shadow-sm transition cursor-pointer"
                   title="Print Report"
                 >
                   <Printer className="w-4 h-4" />
                   <span>Print (پرنٹ)</span>
                 </button>
                 <button onClick={() => setActiveModal(null)} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full text-slate-500 dark:text-slate-400">
                   <X className="w-5 h-5" />
                 </button>
               </div>
            </div>
            <div className="p-4 overflow-y-auto">
               {activeModal === 'monthly-sale' ? (
                 <div className="w-full flex flex-col gap-4">
                   {/* Print Action Box */}
                   <div className="bg-sky-50 dark:bg-sky-950/40 border border-sky-200 dark:border-sky-800/60 rounded-xl p-3.5 sm:p-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 shadow-sm">
                     <div className="flex items-center gap-3">
                       <div className="w-10 h-10 rounded-xl bg-sky-500 text-white flex items-center justify-center shrink-0 shadow-sm">
                         <Printer className="w-5 h-5" />
                       </div>
                       <div>
                         <h4 className="text-sm font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                           <span>Monthly Sales Print</span>
                           <span className="text-[10px] bg-sky-100 text-sky-800 dark:bg-sky-900 dark:text-sky-200 px-2 py-0.5 rounded-full font-bold uppercase">
                             {formatMonthName(selectedMonthStr)}
                           </span>
                         </h4>
                         <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                           پرنٹ ویو میں اسٹور سیل اور آن لائن سیل علیحدہ علیحدہ مکمل تفصیل کے ساتھ پرنٹ ہوں گی
                         </p>
                       </div>
                     </div>
                     <button
                       id="btn-print-monthly-box"
                       type="button"
                       onClick={() => window.print()}
                       className="w-full sm:w-auto flex items-center justify-center gap-2 px-4 py-2 bg-sky-600 hover:bg-sky-700 text-white rounded-xl text-xs font-bold shadow transition shrink-0 cursor-pointer"
                     >
                       <Printer className="w-4 h-4" />
                       <span>Print Monthly Sale Report (پرنٹ کریں)</span>
                     </button>
                   </div>

                   {/* Summary Stat Cards */}
                   <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                     <div className="bg-slate-50 dark:bg-slate-800/50 rounded-xl p-3.5 border border-slate-200 dark:border-slate-700">
                       <span className="text-xs font-bold tracking-wider text-slate-500 dark:text-slate-400 uppercase block">Total Monthly Sale</span>
                       <span className="text-xl font-black text-slate-800 dark:text-slate-100 block mt-1">PKR {formatCurrency(monthlySales)}</span>
                       <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 mt-1 block">{monthlySuits} Suits ({monthlyBills} Bills)</span>
                     </div>
                     <div className="bg-emerald-50 dark:bg-emerald-950/30 rounded-xl p-3.5 border border-emerald-200 dark:border-emerald-800/50">
                       <span className="text-xs font-bold tracking-wider text-emerald-600 dark:text-emerald-400 uppercase block">In-Store Sales (اسٹور سیل)</span>
                       <span className="text-xl font-black text-emerald-700 dark:text-emerald-300 block mt-1">PKR {formatCurrency(monthlyInStoreSales)}</span>
                       <span className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400 mt-1 block">{inStoreSuitsCount} Suits ({monthlyInStoreTransactions.length} Bills)</span>
                     </div>
                     <div className="bg-sky-50 dark:bg-sky-950/30 rounded-xl p-3.5 border border-sky-200 dark:border-sky-800/50">
                       <span className="text-xs font-bold tracking-wider text-sky-600 dark:text-sky-400 uppercase block">Online Sales (آن لائن سیل)</span>
                       <span className="text-xl font-black text-sky-700 dark:text-sky-300 block mt-1">PKR {formatCurrency(monthlyOnlineSales)}</span>
                       <span className="text-[11px] font-medium text-sky-600 dark:text-sky-400 mt-1 block">{onlineSuitsCount} Suits ({monthlyOnlineTransactions.length} Bills)</span>
                     </div>
                   </div>

                   {/* Tab Switcher */}
                   <div className="flex border-b border-slate-200 dark:border-slate-700 gap-2">
                     <button
                       type="button"
                       onClick={() => setModalSaleTab('all')}
                       className={`pb-2 px-3 text-xs font-bold transition border-b-2 cursor-pointer ${
                         modalSaleTab === 'all'
                           ? 'border-sky-600 text-sky-600 dark:text-sky-400'
                           : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400'
                       }`}
                     >
                       All Sales ({monthlyTransactions.length})
                     </button>
                     <button
                       type="button"
                       onClick={() => setModalSaleTab('instore')}
                       className={`pb-2 px-3 text-xs font-bold transition border-b-2 cursor-pointer ${
                         modalSaleTab === 'instore'
                           ? 'border-emerald-600 text-emerald-600 dark:text-emerald-400'
                           : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400'
                       }`}
                     >
                       In-Store Sales ({monthlyInStoreTransactions.length})
                     </button>
                     <button
                       type="button"
                       onClick={() => setModalSaleTab('online')}
                       className={`pb-2 px-3 text-xs font-bold transition border-b-2 cursor-pointer ${
                         modalSaleTab === 'online'
                           ? 'border-sky-600 text-sky-600 dark:text-sky-400'
                           : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400'
                       }`}
                     >
                       Online Sales ({monthlyOnlineTransactions.length})
                     </button>
                   </div>

                   {/* Tables based on selected tab */}
                   {modalSaleTab === 'all' ? (
                     <div className="space-y-6">
                       {/* In-Store Section */}
                       <div className="space-y-2">
                         <div className="flex justify-between items-center bg-emerald-50 dark:bg-emerald-950/40 p-2.5 rounded-lg border border-emerald-200 dark:border-emerald-800/40">
                           <span className="text-xs font-bold text-emerald-800 dark:text-emerald-300 uppercase tracking-wide">
                             In-Store Sales (اسٹور سیل) &bull; {monthlyInStoreTransactions.length} Bills ({inStoreSuitsCount} Suits)
                           </span>
                           <span className="text-xs font-black text-emerald-800 dark:text-emerald-200">
                             PKR {formatCurrency(monthlyInStoreSales)}
                           </span>
                         </div>
                         <div className="overflow-x-auto">
                           <table className="w-full text-left border-collapse">
                             <thead>
                               <tr className="border-b border-slate-100 dark:border-slate-800/50">
                                 <th className="p-2.5 text-xs font-bold text-slate-600 dark:text-slate-300 uppercase">TXN ID</th>
                                 <th className="p-2.5 text-xs font-bold text-slate-600 dark:text-slate-300 uppercase">Date</th>
                                 <th className="p-2.5 text-xs font-bold text-slate-600 dark:text-slate-300 uppercase">Customer</th>
                                 <th className="p-2.5 text-xs font-bold text-slate-600 dark:text-slate-300 uppercase text-center">Suits</th>
                                 <th className="p-2.5 text-xs font-bold text-slate-600 dark:text-slate-300 uppercase text-right">Amount</th>
                               </tr>
                             </thead>
                             <tbody>
                               {monthlyInStoreTransactions.map(sale => {
                                 const isReturn = sale.transactionType === 'Return';
                                 const saleDate = getSaleTime(sale);
                                 const suitsCount = getSuitsInSale(sale);
                                 const netAmt = getNetSaleAmount(sale);
                                 return (
                                   <tr key={sale.id} className="border-b border-slate-50 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                                     <td className="p-2.5 text-sm text-slate-700 dark:text-slate-200">
                                       <div className="flex items-center gap-1.5 font-mono">
                                         <span className="font-bold text-slate-800 dark:text-slate-100">{sale.invoiceNo || sale.id.slice(-6).toUpperCase()}</span>
                                         {isReturn && (
                                           <span className="px-1.5 py-0.5 rounded-sm bg-rose-100 text-rose-700 border border-rose-200 text-[10px] font-bold">Return</span>
                                         )}
                                       </div>
                                     </td>
                                     <td className="p-2.5 text-xs text-slate-500 dark:text-slate-400">{formatDateTime(saleDate)}</td>
                                     <td className="p-2.5 text-sm text-slate-600 dark:text-slate-300">{sale.customerName || 'Walk-in'}</td>
                                     <td className="p-2.5 text-sm text-slate-600 dark:text-slate-300 text-center font-medium">{suitsCount} suits</td>
                                     <td className="p-2.5 text-sm font-semibold text-slate-700 dark:text-slate-200 text-right">PKR {formatCurrency(netAmt)}</td>
                                   </tr>
                                 );
                               })}
                               {monthlyInStoreTransactions.length === 0 && (
                                 <tr>
                                   <td colSpan={5} className="p-4 text-center text-sm text-slate-500 italic">No in-store transactions this month</td>
                                 </tr>
                               )}
                             </tbody>
                           </table>
                         </div>
                       </div>

                       {/* Online Section */}
                       <div className="space-y-2">
                         <div className="flex justify-between items-center bg-sky-50 dark:bg-sky-950/40 p-2.5 rounded-lg border border-sky-200 dark:border-sky-800/40">
                           <span className="text-xs font-bold text-sky-800 dark:text-sky-300 uppercase tracking-wide">
                             Online Sales (آن لائن سیل) &bull; {monthlyOnlineTransactions.length} Bills ({onlineSuitsCount} Suits)
                           </span>
                           <span className="text-xs font-black text-sky-800 dark:text-sky-200">
                             PKR {formatCurrency(monthlyOnlineSales)}
                           </span>
                         </div>
                         <div className="overflow-x-auto">
                           <table className="w-full text-left border-collapse">
                             <thead>
                               <tr className="border-b border-slate-100 dark:border-slate-800/50">
                                 <th className="p-2.5 text-xs font-bold text-slate-600 dark:text-slate-300 uppercase">TXN ID</th>
                                 <th className="p-2.5 text-xs font-bold text-slate-600 dark:text-slate-300 uppercase">Date</th>
                                 <th className="p-2.5 text-xs font-bold text-slate-600 dark:text-slate-300 uppercase">Customer</th>
                                 <th className="p-2.5 text-xs font-bold text-slate-600 dark:text-slate-300 uppercase text-center">Suits</th>
                                 <th className="p-2.5 text-xs font-bold text-slate-600 dark:text-slate-300 uppercase text-right">Amount</th>
                               </tr>
                             </thead>
                             <tbody>
                               {monthlyOnlineTransactions.map(sale => {
                                 const isReturn = sale.transactionType === 'Return';
                                 const saleDate = getSaleTime(sale);
                                 const suitsCount = getSuitsInSale(sale);
                                 const netAmt = getNetSaleAmount(sale);
                                 return (
                                   <tr key={sale.id} className="border-b border-slate-50 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                                     <td className="p-2.5 text-sm text-slate-700 dark:text-slate-200">
                                       <div className="flex items-center gap-1.5 font-mono">
                                         <span className="font-bold text-slate-800 dark:text-slate-100">{sale.invoiceNo || sale.id.slice(-6).toUpperCase()}</span>
                                         {isReturn && (
                                           <span className="px-1.5 py-0.5 rounded-sm bg-rose-100 text-rose-700 border border-rose-200 text-[10px] font-bold">Return</span>
                                         )}
                                       </div>
                                     </td>
                                     <td className="p-2.5 text-xs text-slate-500 dark:text-slate-400">{formatDateTime(saleDate)}</td>
                                     <td className="p-2.5 text-sm text-slate-600 dark:text-slate-300">{sale.customerName || 'Online Order'}</td>
                                     <td className="p-2.5 text-sm text-slate-600 dark:text-slate-300 text-center font-medium">{suitsCount} suits</td>
                                     <td className="p-2.5 text-sm font-semibold text-slate-700 dark:text-slate-200 text-right">PKR {formatCurrency(netAmt)}</td>
                                   </tr>
                                 );
                               })}
                               {monthlyOnlineTransactions.length === 0 && (
                                 <tr>
                                   <td colSpan={5} className="p-4 text-center text-sm text-slate-500 italic">No online transactions this month</td>
                                 </tr>
                               )}
                             </tbody>
                           </table>
                         </div>
                       </div>
                     </div>
                   ) : (
                     <div className="overflow-x-auto">
                       <table className="w-full text-left border-collapse">
                         <thead>
                           <tr className="border-b border-slate-100 dark:border-slate-800/50">
                             <th className="p-3 text-xs font-bold text-slate-600 dark:text-slate-300 uppercase">TXN ID</th>
                             <th className="p-3 text-xs font-bold text-slate-600 dark:text-slate-300 uppercase">Date</th>
                             <th className="p-3 text-xs font-bold text-slate-600 dark:text-slate-300 uppercase">Customer</th>
                             <th className="p-3 text-xs font-bold text-slate-600 dark:text-slate-300 uppercase text-center">Suits</th>
                             <th className="p-3 text-xs font-bold text-slate-600 dark:text-slate-300 uppercase text-right">Amount</th>
                           </tr>
                         </thead>
                         <tbody>
                           {(modalSaleTab === 'instore' ? monthlyInStoreTransactions : monthlyOnlineTransactions).map(sale => {
                             const isReturn = sale.transactionType === 'Return';
                             const saleDate = getSaleTime(sale);
                             const suitsCount = getSuitsInSale(sale);
                             const netAmt = getNetSaleAmount(sale);
                             return (
                               <tr key={sale.id} className="border-b border-slate-50 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                                 <td className="p-3 text-sm text-slate-700 dark:text-slate-200">
                                   <div className="flex items-center gap-2 font-mono">
                                     <span className="font-bold text-slate-800 dark:text-slate-100">{sale.invoiceNo || sale.id.slice(-6).toUpperCase()}</span>
                                     {isReturn && (
                                       <span className="px-1.5 py-0.5 rounded-sm bg-rose-100 text-rose-700 border border-rose-200 text-[10px] font-bold">Return</span>
                                     )}
                                   </div>
                                 </td>
                                 <td className="p-3 text-sm text-slate-500 dark:text-slate-400">{formatDateTime(saleDate)}</td>
                                 <td className="p-3 text-sm text-slate-600 dark:text-slate-300">{sale.customerName || (sale.saleType === 'Online' ? 'Online Customer' : 'Walk-in')}</td>
                                 <td className="p-3 text-sm text-slate-600 dark:text-slate-300 text-center font-medium">{suitsCount} suits</td>
                                 <td className="p-3 text-sm font-semibold text-slate-700 dark:text-slate-200 text-right">PKR {formatCurrency(netAmt)}</td>
                               </tr>
                             );
                           })}
                           {(modalSaleTab === 'instore' ? monthlyInStoreTransactions : monthlyOnlineTransactions).length === 0 && (
                             <tr>
                               <td colSpan={5} className="p-4 text-center text-sm text-slate-500 italic">No transactions found</td>
                             </tr>
                           )}
                         </tbody>
                       </table>
                     </div>
                   )}
                 </div>
               ) : activeModal !== 'stock' ? (
                 <div className="w-full flex flex-col gap-4">
                   {['daily-sale', 'daily-profit', 'monthly-profit', 'total-sale', 'total-profit'].includes(activeModal) && (
                     <div className="flex bg-slate-50 dark:bg-slate-800/50 rounded-xl p-4 border border-slate-100 dark:border-slate-800/50 justify-between items-center shadow-sm">
                       <div className="flex flex-col">
                         <span className="text-xs font-bold tracking-wider text-slate-500 dark:text-slate-400 uppercase">In-Store {activeModal.includes('profit') ? 'Profit' : 'Sales'}</span>
                         <span className="text-lg font-black text-slate-800 dark:text-slate-100">PKR {formatCurrency(
                           activeModal === 'daily-profit' ? dailyInStoreProfit + (activeOffsets?.dailyOffsetDate === selectedDailyDateStr ? (Number(activeOffsets?.dailyProfit) || 0) : 0) :
                           activeModal === 'daily-sale' ? dailyInStoreSales + (activeOffsets?.dailyOffsetDate === selectedDailyDateStr ? (Number(activeOffsets?.dailySales) || 0) : 0) :
                           activeModal === 'monthly-profit' ? monthlyInStoreProfit :
                           activeModal === 'total-profit' ? totalInStoreProfit :
                           totalInStoreSales
                         )}</span>
                       </div>
                       <div className="h-10 w-px bg-slate-200"></div>
                       <div className="flex flex-col text-right">
                         <span className="text-xs font-bold tracking-wider text-sky-600 uppercase">Online {activeModal.includes('profit') ? 'Profit' : 'Sales'}</span>
                         <span className="text-lg font-black text-sky-700">PKR {formatCurrency(
                           activeModal === 'daily-profit' ? dailyOnlineProfit :
                           activeModal === 'daily-sale' ? dailyOnlineSales :
                           activeModal === 'monthly-profit' ? monthlyOnlineProfit :
                           activeModal === 'total-profit' ? totalOnlineProfit :
                           totalOnlineSales
                         )}</span>
                       </div>
                     </div>
                   )}
                   <div className="overflow-x-auto">
                   <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-slate-100 dark:border-slate-800/50">
                          <th className="p-3 text-xs font-bold text-slate-600 dark:text-slate-300 uppercase">TXN ID</th>
                          <th className="p-3 text-xs font-bold text-slate-600 dark:text-slate-300 uppercase">Date</th>
                          <th className="p-3 text-xs font-bold text-slate-600 dark:text-slate-300 uppercase">Customer</th>
                          <th className="p-3 text-xs font-bold text-slate-600 dark:text-slate-300 uppercase">Items</th>
                          <th className="p-3 text-xs font-bold text-slate-600 dark:text-slate-300 uppercase text-right">Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sortedSales.filter(sale => {
                            const saleDate = getSaleTime(sale);
                            if (activeModal?.startsWith('daily')) return isSaleOnDate(saleDate, selectedDailyDateStr);
                            if (activeModal?.startsWith('monthly')) return isSaleInMonth(saleDate, selectedMonthStr);
                            return true;
                        }).map(sale => (
                            <tr key={sale.id} className="border-b border-slate-50 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                              <td className="p-3 text-sm text-slate-700 dark:text-slate-200">
                                <div className="flex items-center gap-2">
                                  <span className="font-bold text-slate-800 dark:text-slate-100">{sale.invoiceNo || sale.id.slice(-6).toUpperCase()}</span>
                                  {sale.saleType === 'Online' && (
                                    <span className="px-1.5 py-0.5 rounded-sm bg-sky-100 text-sky-700 border border-sky-200 text-[10px] font-bold">Online</span>
                                  )}
                                </div>
                              </td>
                              <td className="p-3 text-sm text-slate-500 dark:text-slate-400">{new Date(getSaleTime(sale) || 0).toLocaleString()}</td>
                              <td className="p-3 text-sm text-slate-600 dark:text-slate-300">{sale.customerName || 'Walk-in'}</td>
                              <td className="p-3 text-sm text-slate-600 dark:text-slate-300">{sale.items?.length || 0} items</td>
                              <td className="p-3 text-sm font-semibold text-slate-700 dark:text-slate-200 text-right">PKR {formatCurrency(sale.total || 0)}</td>
                            </tr>
                        ))}
                      </tbody>
                   </table>
                 </div>
                 </div>
               ) : (
                 <div className="overflow-x-auto">
                   <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-slate-100 dark:border-slate-800/50">
                          <th className="p-3 text-xs font-bold text-slate-600 dark:text-slate-300 uppercase">Item Name</th>
                          <th className="p-3 text-xs font-bold text-slate-600 dark:text-slate-300 uppercase">SKU</th>
                          <th className="p-3 text-xs font-bold text-slate-600 dark:text-slate-300 uppercase text-right">Qty</th>
                          <th className="p-3 text-xs font-bold text-slate-600 dark:text-slate-300 uppercase text-right">Cost</th>
                          <th className="p-3 text-xs font-bold text-slate-600 dark:text-slate-300 uppercase text-right">Value</th>
                        </tr>
                      </thead>
                      <tbody>
                        {inventory.filter(i => (i.stock || 0) > 0).map(item => (
                            <tr key={item.id} className="border-b border-slate-50 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                              <td className="p-3 text-sm text-slate-700 dark:text-slate-200">{item.name}</td>
                              <td className="p-3 text-sm text-slate-500 dark:text-slate-400">{item.sku || '-'}</td>
                              <td className="p-3 text-sm text-slate-600 dark:text-slate-300 text-right">{item.stock || 0}</td>
                              <td className="p-3 text-sm text-slate-600 dark:text-slate-300 text-right">PKR {formatCurrency(item.cost || 0)}</td>
                              <td className="p-3 text-sm font-semibold text-slate-700 dark:text-slate-200 text-right">PKR {formatCurrency((item.stock || 0) * (item.cost || 0))}</td>
                            </tr>
                        ))}
                      </tbody>
                   </table>
                 </div>
               )}
            </div>
          </div>
        </div>
      )}

      {/* EXPENSE DETAILS MODAL */}
      {(activeModal === 'daily-expense' || activeModal === 'monthly-expense') && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs print:hidden">
          <div className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl border border-slate-200 dark:border-slate-800 animate-in fade-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="flex justify-between items-center p-4 sm:p-5 border-b border-slate-100 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/50 rounded-t-2xl">
              <div>
                <h2 className="font-bold text-base sm:text-lg text-slate-800 dark:text-slate-100 flex items-center gap-2">
                  <TrendingDown className="w-5 h-5 text-rose-600" />
                  <span>
                    {activeModal === 'daily-expense' 
                      ? `Daily Expenses Details (${formatDate(parse(selectedDailyDateStr, 'yyyy-MM-dd', new Date()).getTime())})`
                      : `Monthly Expenses Details (${formatMonthName(selectedMonthStr)})`}
                  </span>
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  {activeModal === 'daily-expense'
                    ? 'آج کے تمام ریکارڈ شدہ اخراجات کی تفصیل'
                    : `${formatMonthName(selectedMonthStr)} کے تمام اخراجات کی مکمل تفصیل`}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Link
                  to="/expenses"
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 hover:bg-rose-100 border border-rose-200 dark:border-rose-800 rounded-lg text-xs font-bold transition"
                  title="Go to Expenses Management"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>Manage Expenses</span>
                </Link>
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="flex items-center gap-1 px-3 py-1.5 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 text-slate-800 dark:text-slate-100 rounded-lg text-xs font-bold transition cursor-pointer"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>Print</span>
                </button>
                <button 
                  onClick={() => setActiveModal(null)} 
                  className="p-1.5 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-full text-slate-400 hover:text-slate-600 transition cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Summary Banner */}
            <div className="p-4 sm:p-5 border-b border-slate-100 dark:border-slate-800 bg-rose-50/50 dark:bg-rose-950/20 grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div className="p-3 bg-white dark:bg-slate-800/80 rounded-xl border border-rose-100 dark:border-rose-900/40">
                <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">Total Expenses</span>
                <span className="text-xl sm:text-2xl font-black text-rose-600 dark:text-rose-400 font-mono">
                  PKR {formatCurrency(activeModal === 'daily-expense' ? dailyExpenses : monthlyExpenses)}
                </span>
              </div>
              <div className="p-3 bg-white dark:bg-slate-800/80 rounded-xl border border-rose-100 dark:border-rose-900/40">
                <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">Total Entries</span>
                <span className="text-xl sm:text-2xl font-black text-slate-800 dark:text-slate-100 font-mono">
                  {activeModal === 'daily-expense' ? dailyExpenseEntries.length : monthlyExpenseEntries.length}
                </span>
              </div>
              <div className="col-span-2 sm:col-span-1 p-3 bg-white dark:bg-slate-800/80 rounded-xl border border-rose-100 dark:border-rose-900/40">
                <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">Status</span>
                <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400 block mt-1">
                  {activeModal === 'daily-expense' && selectedDailyDateStr === todayDateStr
                    ? '✓ Tracking Today (00:00 to 23:59)'
                    : '✓ Real-time Sync'}
                </span>
              </div>
            </div>

            {/* Table */}
            <div className="overflow-y-auto flex-1 p-4">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 text-xs uppercase font-bold tracking-wider">
                    <th className="py-2.5 px-3">Date & Time</th>
                    <th className="py-2.5 px-3">Account / Head</th>
                    <th className="py-2.5 px-3">Description / Details</th>
                    <th className="py-2.5 px-3 text-right">Amount (PKR)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/50 text-sm">
                  {(activeModal === 'daily-expense' ? dailyExpenseEntries : monthlyExpenseEntries).map((item, idx) => {
                    const itemTime = getSaleTime(item);
                    return (
                      <tr key={item.id || idx} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                        <td className="py-2.5 px-3 text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
                          {formatDateTime(itemTime)}
                        </td>
                        <td className="py-2.5 px-3">
                          <span className="px-2 py-0.5 rounded text-xs font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                            {item.reference || 'General Expense'}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-slate-700 dark:text-slate-300 text-xs sm:text-sm">
                          {item.description || '-'}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono font-bold text-rose-600 dark:text-rose-400 whitespace-nowrap">
                          PKR {formatCurrency(Number(item.amount) || 0)}
                        </td>
                      </tr>
                    );
                  })}
                  {(activeModal === 'daily-expense' ? dailyExpenseEntries : monthlyExpenseEntries).length === 0 && (
                    <tr>
                      <td colSpan={4} className="py-12 text-center text-slate-400 text-sm italic">
                        {activeModal === 'daily-expense' 
                          ? 'No expenses recorded for this day yet. (آج کوئی خرچہ ریکارڈ نہیں ہوا - PKR 0)'
                          : 'No expenses recorded for this month.'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 flex justify-between items-center rounded-b-2xl">
              <span className="text-xs text-slate-500">
                Daily expense automatically resets to 0 every day at midnight (00:00).
              </span>
              <button
                type="button"
                onClick={() => setActiveModal(null)}
                className="px-4 py-2 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 text-slate-700 dark:text-slate-200 rounded-lg text-xs font-bold transition cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Vendor Balances Modal */}
      {/* Vendor Balances Modal (Dynamic for Payable/Receivable) */}
      {(activeModal === 'vendor-payable' || activeModal === 'vendor-receivable') && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm print:hidden">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-4xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-slate-50 dark:bg-slate-800/50">
              <div>
                <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                  {activeModal === 'vendor-payable' ? (
                    <>
                      <span className="text-rose-600">Vendor Payables &amp; Outstanding Liabilities</span>
                      <span className="text-xs bg-rose-100 text-rose-700 px-2 py-0.5 rounded font-bold">دینا ہے</span>
                    </>
                  ) : (
                    <>
                      <span className="text-emerald-600">Customer Accounts Receivable &amp; Recovery</span>
                      <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded font-bold">وصولی (لینا ہے)</span>
                    </>
                  )}
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  {activeModal === 'vendor-payable' 
                    ? 'Amounts owed to suppliers and vendor accounts (matches Vendor Balances Statement)' 
                    : 'Amounts to be recovered from customer accounts (matches Customer Accounts Receivable Statement)'}
                </p>
              </div>
              <button onClick={() => setActiveModal(null)} className="text-slate-400 hover:text-slate-600 transition-colors p-2 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-full cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Tabs Header */}
            <div className="flex border-b border-slate-200 dark:border-slate-800 bg-slate-100/60 dark:bg-slate-900/40 px-6 pt-2">
              {activeModal === 'vendor-payable' ? (
                <>
                  <button
                    onClick={() => setPayableModalTab('vendors')}
                    className={`px-4 py-2 text-xs font-bold uppercase tracking-wider border-b-2 transition-colors cursor-pointer ${
                      payableModalTab === 'vendors'
                        ? 'border-rose-600 text-rose-600 bg-white dark:bg-slate-900 rounded-t-md'
                        : 'border-transparent text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    Vendors to Pay ({vendorBalances.filter(v => v.balance < 0).length})
                  </button>
                  <button
                    onClick={() => setPayableModalTab('customers')}
                    className={`px-4 py-2 text-xs font-bold uppercase tracking-wider border-b-2 transition-colors cursor-pointer ${
                      payableModalTab === 'customers'
                        ? 'border-amber-600 text-amber-600 bg-white dark:bg-slate-900 rounded-t-md'
                        : 'border-transparent text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    Customer Advances ({customerBalances.filter(c => c.balance > 0).length})
                  </button>
                  <button
                    onClick={() => setPayableModalTab('all')}
                    className={`px-4 py-2 text-xs font-bold uppercase tracking-wider border-b-2 transition-colors cursor-pointer ${
                      payableModalTab === 'all'
                        ? 'border-slate-800 text-slate-800 dark:text-slate-100 dark:border-slate-100 bg-white dark:bg-slate-900 rounded-t-md'
                        : 'border-transparent text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    All Combined
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={() => setReceivableModalTab('customers')}
                    className={`px-4 py-2 text-xs font-bold uppercase tracking-wider border-b-2 transition-colors cursor-pointer ${
                      receivableModalTab === 'customers'
                        ? 'border-emerald-600 text-emerald-600 bg-white dark:bg-slate-900 rounded-t-md'
                        : 'border-transparent text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    Customers with Due ({customerBalances.filter(c => c.balance < 0).length})
                  </button>
                  <button
                    onClick={() => setReceivableModalTab('vendors')}
                    className={`px-4 py-2 text-xs font-bold uppercase tracking-wider border-b-2 transition-colors cursor-pointer ${
                      receivableModalTab === 'vendors'
                        ? 'border-indigo-600 text-indigo-600 bg-white dark:bg-slate-900 rounded-t-md'
                        : 'border-transparent text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    Vendor Advances ({vendorBalances.filter(v => v.balance > 0).length})
                  </button>
                  <button
                    onClick={() => setReceivableModalTab('all')}
                    className={`px-4 py-2 text-xs font-bold uppercase tracking-wider border-b-2 transition-colors cursor-pointer ${
                      receivableModalTab === 'all'
                        ? 'border-slate-800 text-slate-800 dark:text-slate-100 dark:border-slate-100 bg-white dark:bg-slate-900 rounded-t-md'
                        : 'border-transparent text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    All Combined
                  </button>
                </>
              )}
            </div>
            
            <div className="p-0 overflow-y-auto flex-1">
              <table className="w-full text-left border-collapse">
                <thead className="sticky top-0 bg-white dark:bg-slate-900 z-10 shadow-xs">
                  <tr className="border-b border-slate-100 dark:border-slate-800 text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">
                    <th className="p-4">Party Name</th>
                    <th className="p-4">Phone / Contact</th>
                    <th className="p-4 text-right">Outstanding Amount</th>
                    <th className="p-4 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50 dark:divide-slate-800 text-sm">
                  {/* List generation based on active modal & selected tab */}
                  {(() => {
                    let items: any[] = [];
                    if (activeModal === 'vendor-payable') {
                      if (payableModalTab === 'vendors') {
                        items = vendorBalances
                          .filter(v => v.balance < 0)
                          .map(v => ({ ...v, partyType: 'Vendor', dueAmount: Math.abs(v.balance), isPayable: true }));
                      } else if (payableModalTab === 'customers') {
                        items = customerBalances
                          .filter(c => c.balance > 0)
                          .map(c => ({ ...c, partyType: 'Customer (Advance)', dueAmount: c.balance, isPayable: true }));
                      } else {
                        items = [
                          ...vendorBalances.filter(v => v.balance < 0).map(v => ({ ...v, partyType: 'Vendor', dueAmount: Math.abs(v.balance), isPayable: true })),
                          ...customerBalances.filter(c => c.balance > 0).map(c => ({ ...c, partyType: 'Customer (Advance)', dueAmount: c.balance, isPayable: true }))
                        ];
                      }
                    } else {
                      if (receivableModalTab === 'customers') {
                        items = customerBalances
                          .filter(c => c.balance < 0)
                          .map(c => ({ ...c, partyType: 'Customer', dueAmount: Math.abs(c.balance), isPayable: false }));
                      } else if (receivableModalTab === 'vendors') {
                        items = vendorBalances
                          .filter(v => v.balance > 0)
                          .map(v => ({ ...v, partyType: 'Vendor (Advance)', dueAmount: v.balance, isPayable: false }));
                      } else {
                        items = [
                          ...customerBalances.filter(c => c.balance < 0).map(c => ({ ...c, partyType: 'Customer', dueAmount: Math.abs(c.balance), isPayable: false })),
                          ...vendorBalances.filter(v => v.balance > 0).map(v => ({ ...v, partyType: 'Vendor (Advance)', dueAmount: v.balance, isPayable: false }))
                        ];
                      }
                    }

                    items.sort((a, b) => b.dueAmount - a.dueAmount);

                    if (items.length === 0) {
                      return (
                        <tr>
                          <td colSpan={4} className="p-8 text-center text-slate-500 italic">
                            No records found for this category.
                          </td>
                        </tr>
                      );
                    }

                    return items.map(item => (
                      <tr key={`${item.partyType}-${item.id}`} className="hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
                        <td className="p-4">
                          <div className="font-semibold text-slate-800 dark:text-slate-100">{item.name}</div>
                          <div className="text-[10px] text-slate-400 font-mono uppercase">{item.partyType} • ID: {item.id.slice(-6)}</div>
                        </td>
                        <td className="p-4 text-xs text-slate-600 dark:text-slate-300 font-mono">
                          {item.phone || '-'}
                          {item.city ? ` (${item.city})` : ''}
                        </td>
                        <td className="p-4 text-right">
                          <div className={`font-mono font-bold text-base ${item.isPayable ? 'text-rose-600' : 'text-emerald-600'}`}>
                            PKR {formatCurrency(item.dueAmount)}
                          </div>
                        </td>
                        <td className="p-4 text-center">
                          <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-tight ${
                            item.isPayable 
                              ? 'bg-rose-50 text-rose-700 dark:bg-rose-950 dark:text-rose-300 border border-rose-200' 
                              : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-200'
                          }`}>
                            {item.isPayable ? 'Payable (دینا ہے)' : 'Receivable (لینا ہے)'}
                          </span>
                        </td>
                      </tr>
                    ));
                  })()}
                </tbody>
              </table>
            </div>
            
            <div className="p-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/30 flex flex-col sm:flex-row justify-between items-center gap-3 shrink-0">
              <div className="flex items-center gap-3">
                {activeModal === 'vendor-payable' ? (
                  <button
                    onClick={() => { setActiveModal(null); navigate('/vendors'); }}
                    className="text-xs font-semibold text-rose-700 dark:text-rose-300 hover:underline flex items-center gap-1 cursor-pointer"
                  >
                    Open Vendors Directory &amp; Print Full Statement &rarr;
                  </button>
                ) : (
                  <button
                    onClick={() => { setActiveModal(null); navigate('/customers'); }}
                    className="text-xs font-semibold text-emerald-700 dark:text-emerald-300 hover:underline flex items-center gap-1 cursor-pointer"
                  >
                    Open Customers Directory &amp; Print Full Statement &rarr;
                  </button>
                )}
              </div>

              <div className="flex items-center gap-3">
                <div className="text-xs font-bold text-slate-500 uppercase">
                  {activeModal === 'vendor-payable' 
                    ? (payableModalTab === 'vendors' ? 'Total Vendor Payable:' : payableModalTab === 'customers' ? 'Total Customer Advance:' : 'Total Payable Liabilities:')
                    : (receivableModalTab === 'customers' ? 'Total Customer Receivable:' : receivableModalTab === 'vendors' ? 'Total Vendor Advance:' : 'Total Receivables:')}
                </div>
                <div className={`text-xl font-black font-mono ${activeModal === 'vendor-payable' ? 'text-rose-600' : 'text-emerald-600'}`}>
                  PKR {formatCurrency(
                    activeModal === 'vendor-payable'
                      ? (payableModalTab === 'vendors' ? totalVendorPayableOnly : payableModalTab === 'customers' ? totalCustomerPrepaid : (totalVendorPayableOnly + totalCustomerPrepaid))
                      : (receivableModalTab === 'customers' ? totalCustomerReceivable : receivableModalTab === 'vendors' ? totalVendorReceivableOnly : (totalCustomerReceivable + totalVendorReceivableOnly))
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Profit Password Prompt Modal */}
      {showProfitPrompt && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-200 print:hidden">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl max-w-md w-full p-6 border border-slate-200 dark:border-slate-800">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-amber-100 dark:bg-amber-950/50 text-amber-600 dark:text-amber-400 flex items-center justify-center">
                  <Lock className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100">Profit Details Locked</h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400">Enter password to view profit breakdown</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowProfitPrompt(false);
                  setProfitPasswordInput('');
                  setProfitPromptError('');
                  setPendingBoxId(null);
                }}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {profitPromptError && (
              <div className="mb-4 p-3 bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400 text-xs rounded-xl border border-red-200 dark:border-red-900/50 font-medium">
                {profitPromptError}
              </div>
            )}

            <form onSubmit={handleUnlockProfitBox} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
                  Enter Password
                </label>
                <div className="relative">
                  <input
                    type={showProfitPassword ? 'text' : 'password'}
                    required
                    autoFocus
                    value={profitPasswordInput}
                    onChange={(e) => {
                      setProfitPasswordInput(e.target.value);
                      setProfitPromptError('');
                    }}
                    placeholder="Enter password..."
                    className="w-full rounded-xl border border-slate-300 dark:border-slate-700 px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:ring-2 focus:ring-sky-500 outline-none pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowProfitPassword(!showProfitPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                  >
                    {showProfitPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowProfitPrompt(false);
                    setProfitPasswordInput('');
                    setProfitPromptError('');
                    setPendingBoxId(null);
                  }}
                  className="px-4 py-2 rounded-xl text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 text-sm font-medium transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 text-white font-semibold text-sm shadow-md transition-all flex items-center gap-2"
                >
                  <Lock className="w-4 h-4" />
                  Unlock
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* LOSS SUITES & BILLS MODAL */}
      {activeModal === 'loss-suites' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-slate-900/60 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden border border-slate-200 dark:border-slate-800">
            {/* Modal Header */}
            <div className="p-4 sm:p-5 bg-gradient-to-r from-rose-600 to-rose-700 text-white flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <TrendingDown className="w-6 h-6 text-rose-200" />
                  <h2 className="text-lg font-bold tracking-tight">Suites & Bills Sold at Loss (نقصان میں فروخت شدہ بلز اور سوٹس)</h2>
                </div>
                <p className="text-xs text-rose-100 mt-0.5">Showing all transactions and items where selling price was lower than cost price.</p>
              </div>
              <button 
                onClick={() => setActiveModal(null)}
                className="p-1.5 rounded-full bg-rose-800/60 hover:bg-rose-800 text-white transition-colors self-end sm:self-center"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Filter Tabs & Search Bar */}
            <div className="p-4 bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-700 flex flex-col sm:flex-row justify-between items-center gap-3">
              <div className="flex items-center gap-1.5 bg-white dark:bg-slate-900 p-1 rounded-xl border border-slate-200 dark:border-slate-700 w-full sm:w-auto">
                <button
                  onClick={() => setLossModalFilter('daily')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${lossModalFilter === 'daily' ? 'bg-rose-600 text-white shadow-sm' : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'}`}
                >
                  Selected Date ({selectedDailyDateStr})
                </button>
                <button
                  onClick={() => setLossModalFilter('monthly')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${lossModalFilter === 'monthly' ? 'bg-rose-600 text-white shadow-sm' : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'}`}
                >
                  Selected Month ({formatMonthName(selectedMonthStr)})
                </button>
                <button
                  onClick={() => setLossModalFilter('all')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${lossModalFilter === 'all' ? 'bg-rose-600 text-white shadow-sm' : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'}`}
                >
                  All Time ({lossSalesList.length})
                </button>
              </div>

              <div className="relative w-full sm:w-72">
                <input
                  type="text"
                  placeholder="Search invoice #, customer, suite..."
                  value={lossSearchQuery}
                  onChange={(e) => setLossSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-3 py-1.5 text-xs rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 outline-none focus:ring-2 focus:ring-rose-500"
                />
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              </div>
            </div>

            {/* KPI Banner inside Modal */}
            {(() => {
              const filteredList = lossSalesList.filter(item => {
                const sDate = getSaleTime(item.sale);
                if (lossModalFilter === 'daily' && !isSaleOnDate(sDate, selectedDailyDateStr)) return false;
                if (lossModalFilter === 'monthly' && !isSaleInMonth(sDate, selectedMonthStr)) return false;

                const q = lossSearchQuery.toLowerCase().trim();
                if (!q) return true;

                const invNo = (item.sale.invoiceNo || item.sale.id || '').toLowerCase();
                const custName = (item.sale.customerName || '').toLowerCase();
                const itemsStr = item.lossItems.map(i => i.name.toLowerCase()).join(' ');

                return invNo.includes(q) || custName.includes(q) || itemsStr.includes(q);
              });

              const totalLossInFilter = filteredList.reduce((acc, i) => acc + i.lossAmount, 0);
              const totalSuitsInFilter = filteredList.reduce((acc, i) => acc + (i.totalSuitsInBill || 0), 0);

              return (
                <>
                  <div className="grid grid-cols-3 gap-3 p-4 bg-rose-50/50 dark:bg-rose-950/20 border-b border-rose-100 dark:border-rose-900/50 text-center">
                    <div className="p-2.5 rounded-xl bg-white dark:bg-slate-800 border border-rose-200 dark:border-rose-800/60 shadow-sm">
                      <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase block">Total Loss Amount</span>
                      <span className="text-lg font-black text-rose-600 dark:text-rose-400 block">PKR {formatCurrency(totalLossInFilter)}</span>
                    </div>
                    <div className="p-2.5 rounded-xl bg-white dark:bg-slate-800 border border-rose-200 dark:border-rose-800/60 shadow-sm">
                      <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase block">Loss Invoices</span>
                      <span className="text-lg font-black text-rose-600 dark:text-rose-400 block">{filteredList.length} Bills</span>
                    </div>
                    <div className="p-2.5 rounded-xl bg-white dark:bg-slate-800 border border-rose-200 dark:border-rose-800/60 shadow-sm">
                      <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase block">Suits in Loss</span>
                      <span className="text-lg font-black text-rose-600 dark:text-rose-400 block">{totalSuitsInFilter} Suits</span>
                    </div>
                  </div>

                  {/* List Table */}
                  <div className="p-4 overflow-y-auto flex-1 space-y-3">
                    {filteredList.length === 0 ? (
                      <div className="p-8 text-center text-slate-500 dark:text-slate-400">
                        <TrendingDown className="w-8 h-8 text-slate-300 dark:text-slate-600 mx-auto mb-2" />
                        <p className="font-semibold text-sm">No Loss Bills or Suites Found</p>
                        <p className="text-xs text-slate-400 mt-1">All sales in this range were sold at or above cost price.</p>
                      </div>
                    ) : (
                      filteredList.map(({ sale, saleCost, saleSubtotal, discount, netRevenue, lossAmount, lossItems }) => {
                        const sDate = getSaleTime(sale);
                        const bName = branches.find(b => b.id === sale.branchId)?.name || 'Branch';

                        return (
                          <div key={sale.id} className="p-4 rounded-xl bg-white dark:bg-slate-800 border border-rose-200 dark:border-rose-900/60 shadow-sm space-y-3">
                            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 border-b border-slate-100 dark:border-slate-700/80 pb-2.5">
                              <div>
                                <div className="flex items-center gap-2">
                                  <span className="font-mono font-bold text-slate-800 dark:text-slate-100 text-sm">
                                    Invoice #{sale.invoiceNo || sale.id.slice(-6).toUpperCase()}
                                  </span>
                                  <span className="text-[10px] font-bold bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 px-2 py-0.5 rounded">
                                    {bName}
                                  </span>
                                  {sale.saleType === 'Online' && (
                                    <span className="text-[10px] font-bold bg-sky-100 dark:bg-sky-950 text-sky-700 dark:text-sky-300 px-2 py-0.5 rounded">
                                      Online
                                    </span>
                                  )}
                                </div>
                                <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                                  Customer: <strong className="text-slate-700 dark:text-slate-200">{sale.customerName || 'Walk-in'}</strong>
                                  {sale.customerPhone && <span className="ml-1">({sale.customerPhone})</span>}
                                  <span className="ml-3 font-mono text-[11px]">{formatDateTime(sDate)}</span>
                                </div>
                              </div>

                              <div className="text-right flex flex-col items-end">
                                <span className="text-xs font-bold text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/60 px-2.5 py-1 rounded-lg border border-rose-200 dark:border-rose-800">
                                  NET LOSS: -PKR {formatCurrency(lossAmount)}
                                </span>
                              </div>
                            </div>

                            {/* Suites / Items Breakdown */}
                            <div className="bg-slate-50 dark:bg-slate-900/50 p-2.5 rounded-lg border border-slate-100 dark:border-slate-800 text-xs space-y-1">
                              <span className="font-bold text-slate-500 dark:text-slate-400 uppercase text-[10px] block mb-1">
                                Suites / Items in Bill:
                              </span>
                              {(sale.items || []).map((it: any, idx: number) => {
                                let unitCost = it.cost;
                                if (unitCost === undefined || unitCost === 0 || unitCost === null || isNaN(Number(unitCost))) {
                                  const invItem = inventory.find(inv => inv.id === it.id);
                                  unitCost = Number(invItem?.cost || 0);
                                }
                                const isItemLoss = Number(it.price) < Number(unitCost);

                                return (
                                  <div key={idx} className="flex justify-between items-center font-mono py-0.5 border-b border-slate-100 dark:border-slate-800/40 last:border-none">
                                    <span className="font-semibold text-slate-800 dark:text-slate-200">
                                      {it.name} <span className="text-slate-400">x{it.qty}</span>
                                    </span>
                                    <div className="flex items-center gap-3">
                                      <span className="text-slate-500">Cost: PKR {formatCurrency(unitCost)}</span>
                                      <span className="text-slate-700 dark:text-slate-200 font-bold">Sale Rate: PKR {formatCurrency(it.price)}</span>
                                      {isItemLoss && (
                                        <span className="text-[10px] font-bold text-rose-600 bg-rose-100 dark:bg-rose-950 px-1.5 py-0.5 rounded">
                                          Loss: -PKR {formatCurrency((unitCost - Number(it.price)) * Number(it.qty))}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>

                            {/* Financial Totals summary row */}
                            <div className="flex justify-between items-center text-xs text-slate-600 dark:text-slate-400 pt-1">
                              <div>
                                Total Cost: <strong className="text-slate-800 dark:text-slate-200 font-mono">PKR {formatCurrency(saleCost)}</strong>
                                {discount > 0 && <span className="ml-2 text-amber-600">(Discount: PKR {formatCurrency(discount)})</span>}
                              </div>
                              <div>
                                Selling Total: <strong className="text-sky-600 font-mono font-bold">PKR {formatCurrency(sale.total || netRevenue)}</strong>
                              </div>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      )}

      {/* DEDICATED MONTHLY SALE PRINT VIEW (Visible only during printing when activeModal === 'monthly-sale') */}
      {activeModal === 'monthly-sale' && (
        <div id="monthly-sales-print-document" className="hidden print:block text-black bg-white p-4 font-sans text-xs">
          {/* Header */}
          <div className="border-b-2 border-black pb-3 mb-4 text-center">
            <h1 className="text-2xl font-black tracking-wide uppercase">MANZOOR COLLECTION</h1>
            <p className="text-sm font-bold text-gray-700">ماہانہ سیل رپورٹ (Monthly Sales Report)</p>
            <div className="flex justify-between items-center mt-2 text-xs text-gray-600 border-t border-gray-200 pt-1">
              <span><strong>Month:</strong> {formatMonthName(selectedMonthStr)}</span>
              <span><strong>Branch:</strong> {branchDisplayName}</span>
              <span><strong>Printed:</strong> {new Date().toLocaleString()}</span>
            </div>
          </div>

          {/* Executive Summary Cards */}
          <div className="grid grid-cols-3 gap-3 mb-4">
            <div className="border border-black p-2 rounded bg-gray-50 text-center">
              <span className="text-[10px] font-bold uppercase text-gray-600 block">Total Monthly Sale</span>
              <span className="text-base font-black block mt-0.5">PKR {formatCurrency(monthlySales)}</span>
              <span className="text-[10px] text-gray-600 block">{monthlySuits} Suits &bull; {monthlyBills} Bills</span>
            </div>
            <div className="border border-black p-2 rounded bg-gray-50 text-center">
              <span className="text-[10px] font-bold uppercase text-gray-600 block">In-Store Sales (اسٹور سیل)</span>
              <span className="text-base font-black block mt-0.5">PKR {formatCurrency(monthlyInStoreSales)}</span>
              <span className="text-[10px] text-gray-600 block">{inStoreSuitsCount} Suits &bull; {monthlyInStoreTransactions.length} Bills</span>
            </div>
            <div className="border border-black p-2 rounded bg-gray-50 text-center">
              <span className="text-[10px] font-bold uppercase text-gray-600 block">Online Sales (آن لائن سیل)</span>
              <span className="text-base font-black block mt-0.5">PKR {formatCurrency(monthlyOnlineSales)}</span>
              <span className="text-[10px] text-gray-600 block">{onlineSuitsCount} Suits &bull; {monthlyOnlineTransactions.length} Bills</span>
            </div>
          </div>

          {/* Section 1: In-Store Sales Table */}
          <div className="mb-6">
            <div className="flex justify-between items-center bg-gray-200 px-3 py-1.5 border border-black border-b-0 font-bold">
              <span className="text-xs uppercase">1. In-Store Sales &mdash; اسٹور سیل کی مکمل تفصیل</span>
              <span className="text-xs">
                Total: PKR {formatCurrency(monthlyInStoreSales)} ({inStoreSuitsCount} Suits / {monthlyInStoreTransactions.length} Bills)
              </span>
            </div>
            <table className="w-full text-left border-collapse border border-black text-[11px]">
              <thead>
                <tr className="bg-gray-100 border-b border-black">
                  <th className="p-1.5 border-r border-black w-8 text-center">#</th>
                  <th className="p-1.5 border-r border-black w-24">Inv #</th>
                  <th className="p-1.5 border-r border-black w-36">Date & Time</th>
                  <th className="p-1.5 border-r border-black">Customer</th>
                  <th className="p-1.5 border-r border-black text-center w-20">Suits</th>
                  <th className="p-1.5 text-right w-28">Amount (PKR)</th>
                </tr>
              </thead>
              <tbody>
                {monthlyInStoreTransactions.map((sale, idx) => {
                  const isReturn = sale.transactionType === 'Return';
                  const saleDate = getSaleTime(sale);
                  const suitsCount = getSuitsInSale(sale);
                  const netAmt = getNetSaleAmount(sale);
                  return (
                    <tr key={sale.id} className="border-b border-gray-300">
                      <td className="p-1.5 border-r border-black text-center">{idx + 1}</td>
                      <td className="p-1.5 border-r border-black font-mono font-bold">
                        {sale.invoiceNo || sale.id.slice(-6).toUpperCase()}
                        {isReturn && <span className="ml-1 text-[9px] text-red-600 font-bold">(Return)</span>}
                      </td>
                      <td className="p-1.5 border-r border-black">{formatDateTime(saleDate)}</td>
                      <td className="p-1.5 border-r border-black">{sale.customerName || 'Walk-in'}</td>
                      <td className="p-1.5 border-r border-black text-center">{suitsCount}</td>
                      <td className="p-1.5 text-right font-mono font-bold">{formatCurrency(netAmt)}</td>
                    </tr>
                  );
                })}
                {monthlyInStoreTransactions.length === 0 && (
                  <tr>
                    <td colSpan={6} className="p-3 text-center italic text-gray-500">No In-Store Transactions Recorded</td>
                  </tr>
                )}
              </tbody>
              <tfoot>
                <tr className="bg-gray-100 font-bold border-t border-black">
                  <td colSpan={4} className="p-1.5 border-r border-black text-right uppercase">In-Store Subtotal (ذیلی میزان):</td>
                  <td className="p-1.5 border-r border-black text-center">{inStoreSuitsCount} Suits</td>
                  <td className="p-1.5 text-right font-mono">PKR {formatCurrency(monthlyInStoreSales)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Section 2: Online Sales Table */}
          <div className="mb-6">
            <div className="flex justify-between items-center bg-gray-200 px-3 py-1.5 border border-black border-b-0 font-bold">
              <span className="text-xs uppercase">2. Online Sales &mdash; آن لائن سیل کی مکمل تفصیل</span>
              <span className="text-xs">
                Total: PKR {formatCurrency(monthlyOnlineSales)} ({onlineSuitsCount} Suits / {monthlyOnlineTransactions.length} Bills)
              </span>
            </div>
            <table className="w-full text-left border-collapse border border-black text-[11px]">
              <thead>
                <tr className="bg-gray-100 border-b border-black">
                  <th className="p-1.5 border-r border-black w-8 text-center">#</th>
                  <th className="p-1.5 border-r border-black w-24">Inv #</th>
                  <th className="p-1.5 border-r border-black w-36">Date & Time</th>
                  <th className="p-1.5 border-r border-black">Customer</th>
                  <th className="p-1.5 border-r border-black text-center w-20">Suits</th>
                  <th className="p-1.5 text-right w-28">Amount (PKR)</th>
                </tr>
              </thead>
              <tbody>
                {monthlyOnlineTransactions.map((sale, idx) => {
                  const isReturn = sale.transactionType === 'Return';
                  const saleDate = getSaleTime(sale);
                  const suitsCount = getSuitsInSale(sale);
                  const netAmt = getNetSaleAmount(sale);
                  return (
                    <tr key={sale.id} className="border-b border-gray-300">
                      <td className="p-1.5 border-r border-black text-center">{idx + 1}</td>
                      <td className="p-1.5 border-r border-black font-mono font-bold">
                        {sale.invoiceNo || sale.id.slice(-6).toUpperCase()}
                        {isReturn && <span className="ml-1 text-[9px] text-red-600 font-bold">(Return)</span>}
                      </td>
                      <td className="p-1.5 border-r border-black">{formatDateTime(saleDate)}</td>
                      <td className="p-1.5 border-r border-black">{sale.customerName || 'Online Order'}</td>
                      <td className="p-1.5 border-r border-black text-center">{suitsCount}</td>
                      <td className="p-1.5 text-right font-mono font-bold">{formatCurrency(netAmt)}</td>
                    </tr>
                  );
                })}
                {monthlyOnlineTransactions.length === 0 && (
                  <tr>
                    <td colSpan={6} className="p-3 text-center italic text-gray-500">No Online Transactions Recorded</td>
                  </tr>
                )}
              </tbody>
              <tfoot>
                <tr className="bg-gray-100 font-bold border-t border-black">
                  <td colSpan={4} className="p-1.5 border-r border-black text-right uppercase">Online Subtotal (ذیلی میزان):</td>
                  <td className="p-1.5 border-r border-black text-center">{onlineSuitsCount} Suits</td>
                  <td className="p-1.5 text-right font-mono">PKR {formatCurrency(monthlyOnlineSales)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Grand Summary Box */}
          <div className="border-2 border-black p-3 rounded mb-8 bg-gray-50">
            <div className="flex justify-between items-center text-sm font-black">
              <span>GRAND TOTAL MONTHLY SALES (کل ماہانہ سیل مع اسٹور و آن لائن):</span>
              <span className="text-base font-mono">PKR {formatCurrency(monthlySales)}</span>
            </div>
            <div className="flex justify-between items-center text-xs text-gray-700 mt-1">
              <span>Total Volume: {monthlySuits} Suits Across {monthlyBills} Invoices</span>
              <span>In-Store: PKR {formatCurrency(monthlyInStoreSales)} | Online: PKR {formatCurrency(monthlyOnlineSales)}</span>
            </div>
          </div>

          {/* Signatures & Footer */}
          <div className="grid grid-cols-3 gap-6 pt-6 border-t border-gray-400 text-center text-xs">
            <div>
              <div className="border-b border-black mb-1 w-32 mx-auto"></div>
              <span>Prepared By</span>
            </div>
            <div>
              <div className="border-b border-black mb-1 w-32 mx-auto"></div>
              <span>Store Manager</span>
            </div>
            <div>
              <div className="border-b border-black mb-1 w-32 mx-auto"></div>
              <span>Authorized Signature</span>
            </div>
          </div>
          <p className="text-[9px] text-gray-500 text-center mt-6">
            Computer generated report &bull; Manzoor Collection POS &bull; {new Date().toLocaleDateString()}
          </p>
        </div>
      )}

      {/* Modal for setting / editing Daily Opening Galla */}
      {showOpeningCashModal && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-[#111827] rounded-xl shadow-xl max-w-md w-full p-6 border border-slate-200 dark:border-slate-800">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-amber-50 dark:bg-amber-950/50 text-amber-600 dark:text-amber-400 flex items-center justify-center">
                  <Coins className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="text-base font-display font-semibold text-slate-900 dark:text-slate-100">Daily Opening Galla</h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400 font-urdu">روزانہ کا پہلا پرانا کیش گلہ درج کریں</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowOpeningCashModal(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveDailyOpeningBalance} className="space-y-4">
              <div className="bg-slate-50 dark:bg-[#0B1120] p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 text-xs text-slate-700 dark:text-slate-300 space-y-2">
                <div className="flex justify-between font-medium text-slate-900 dark:text-slate-100">
                  <span>Branch: {currentBranch?.name || 'Main Branch'}</span>
                  <span className="font-mono tabular-nums">{selectedDailyDateStr}</span>
                </div>
                {!openingGallaInfo.isActive ? (
                  <p className="text-[11px] font-urdu text-amber-700 dark:text-amber-400">
                    پہلی بار Manual Opening Galla درج کریں — اس کے بعد اگلے دن سے پچھلے دن کا Actual Galla خودبخود اگلے دن کے Opening Galla میں شامل ہوتا رہے گا۔
                  </p>
                ) : openingGallaInfo.isAuto ? (
                  <div className="bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200/80 dark:border-emerald-800/60 rounded-lg p-2.5 text-[11px] text-emerald-900 dark:text-emerald-200">
                    <div className="font-semibold">
                      Auto Carry-Forward Active (Anchor: {openingGallaInfo.anchorDate})
                    </div>
                    <div className="font-urdu mt-0.5">
                      گزشتہ روز ({openingGallaInfo.previousDateStr}) کا Actual Galla (PKR {openingGallaInfo.openingGalla.toLocaleString()}) خودبخود شامل ہوا ہے۔ تبدیل کرنے کے لیے نیچے نئی رقم محفوظ کریں۔
                    </div>
                  </div>
                ) : (
                  <div className="bg-blue-50 dark:bg-blue-950/40 border border-blue-200/80 dark:border-blue-800/60 rounded-lg p-2.5 text-[11px] text-blue-900 dark:text-blue-200">
                    <div className="font-semibold">
                      Manual Entry Saved for {selectedDailyDateStr}
                    </div>
                    <div className="font-urdu mt-0.5">
                      اس دن کے اختتامی Actual Galla سے اگلے دن کا Opening Galla خودبخود چلتا رہے گا۔
                    </div>
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  Opening Cash Amount (PKR)
                </label>
                <input
                  type="number"
                  min="0"
                  step="any"
                  required
                  autoFocus
                  placeholder="e.g. 5000"
                  value={openingCashInput}
                  onChange={(e) => setOpeningCashInput(e.target.value === '' ? '' : Number(e.target.value))}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 px-3.5 py-2.5 bg-slate-50 dark:bg-[#0B1120] text-slate-900 dark:text-slate-100 text-base font-mono font-bold tabular-nums focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 outline-none"
                />
              </div>

              {/* Quick suggestion buttons */}
              <div className="flex flex-wrap gap-1.5 pt-0.5">
                <span className="text-[11px] font-medium text-slate-400 w-full">Quick Set</span>
                {[0, 1000, 2000, 5000, 10000, 20000].map(amt => (
                  <button
                    key={amt}
                    type="button"
                    onClick={() => setOpeningCashInput(amt)}
                    className="px-2.5 py-1 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-mono font-semibold tabular-nums hover:border-amber-400 hover:text-amber-700 dark:hover:text-amber-300 transition-colors cursor-pointer"
                  >
                    {amt === 0 ? '0' : `${(amt/1000).toFixed(0)}k`}
                  </button>
                ))}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-slate-200 dark:border-slate-800">
                <div>
                  {openingGallaInfo.isManual && openingGallaInfo.hasEarlierAnchor && (
                    <button
                      type="button"
                      disabled={isSavingOpeningCash}
                      onClick={handleRevertOpeningToAuto}
                      className="px-3 py-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/60 dark:hover:bg-emerald-900/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 text-xs font-medium transition-colors disabled:opacity-50 cursor-pointer"
                    >
                      Revert to Auto
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowOpeningCashModal(false)}
                    className="px-4 py-2 rounded-lg text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSavingOpeningCash}
                    className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-medium text-xs transition-colors disabled:opacity-50 flex items-center gap-1.5 cursor-pointer"
                  >
                    <Save className="w-3.5 h-3.5" />
                    {isSavingOpeningCash ? 'Saving...' : 'Save Opening Galla'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal for Actual Galla / Drawer Cash Breakdown */}
      {showDrawerBreakdownModal && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-[#111827] rounded-xl shadow-xl max-w-2xl w-full p-6 border border-slate-200 dark:border-slate-800 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-200 dark:border-slate-800">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                  <Banknote className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="text-base font-display font-semibold text-slate-900 dark:text-slate-100">
                    Actual Galla Breakdown
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {currentBranch?.name || 'Main Branch'} &middot; <span className="font-mono tabular-nums">{selectedDailyDateStr}</span>
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowDrawerBreakdownModal(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="overflow-y-auto space-y-4 pr-1 flex-1">
              {/* Reconciliation Formula Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 text-xs">
                <div className="p-3 rounded-lg bg-slate-50 dark:bg-[#0B1120] border border-slate-200 dark:border-slate-800">
                  <div className="flex items-center justify-between text-[11px] font-medium text-amber-700 dark:text-amber-400">
                    <span className="flex items-center gap-1">
                      <span>1. Opening Galla (+)</span>
                      {openingGallaInfo.isAuto && (
                        <span className="text-[9px] font-semibold uppercase text-emerald-600 dark:text-emerald-400">AUTO</span>
                      )}
                      {openingGallaInfo.isManual && (
                        <span className="text-[9px] font-semibold uppercase text-amber-600 dark:text-amber-400">MANUAL</span>
                      )}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setShowDrawerBreakdownModal(false);
                        setOpeningCashInput(todayOpeningBalance !== 0 ? todayOpeningBalance : (openingGallaInfo.isManual ? 0 : ''));
                        setShowOpeningCashModal(true);
                      }}
                      className="underline hover:text-amber-800 dark:hover:text-amber-300 cursor-pointer"
                    >
                      Edit
                    </button>
                  </div>
                  <div className="text-base font-mono font-bold tabular-nums text-slate-900 dark:text-white mt-1">
                    PKR {drawerSummary.openingGalla.toLocaleString()}
                  </div>
                  <div className="text-[10px] text-slate-500 dark:text-slate-400 font-urdu mt-0.5">
                    {openingGallaInfo.isAuto && openingGallaInfo.previousDateStr
                      ? `گزشتہ روز (${openingGallaInfo.previousDateStr}) سے خودکار`
                      : 'افتتاحی گلہ'}
                  </div>
                </div>

                <div className="p-3 rounded-lg bg-slate-50 dark:bg-[#0B1120] border border-slate-200 dark:border-slate-800">
                  <div className="text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
                    2. In-Store Cash Sale (+)
                  </div>
                  <div className="text-base font-mono font-bold tabular-nums text-slate-900 dark:text-white mt-1">
                    PKR {drawerSummary.inStoreCashSales.toLocaleString()}
                  </div>
                  <div className="text-[10px] text-slate-500 dark:text-slate-400 font-urdu mt-0.5">
                    نقد کاؤنٹر سیل (آن لائن شامل نہیں)
                  </div>
                </div>

                <div className="p-3 rounded-lg bg-slate-50 dark:bg-[#0B1120] border border-slate-200 dark:border-slate-800">
                  <div className="text-[11px] font-medium text-blue-700 dark:text-blue-400">
                    3. Owner Cash In (+)
                  </div>
                  <div className="text-base font-mono font-bold tabular-nums text-slate-900 dark:text-white mt-1">
                    PKR {drawerSummary.ownerCashIn.toLocaleString()}
                  </div>
                  <div className="text-[10px] text-slate-500 dark:text-slate-400 font-urdu mt-0.5">مالک سے کیش وصول</div>
                </div>

                <div className="p-3 rounded-lg bg-slate-50 dark:bg-[#0B1120] border border-slate-200 dark:border-slate-800">
                  <div className="text-[11px] font-medium text-rose-600 dark:text-rose-400">
                    4. Cash Handover (-)
                  </div>
                  <div className="text-base font-mono font-bold tabular-nums text-slate-900 dark:text-white mt-1">
                    - PKR {drawerSummary.cashHandoversToOwner.toLocaleString()}
                  </div>
                  <div className="text-[10px] text-slate-500 dark:text-slate-400 font-urdu mt-0.5">مالک کو نقد دیا</div>
                </div>

                <div className="p-3 rounded-lg bg-slate-50 dark:bg-[#0B1120] border border-slate-200 dark:border-slate-800">
                  <div className="text-[11px] font-medium text-amber-700 dark:text-amber-400">
                    5. Cash Expenses (-)
                  </div>
                  <div className="text-base font-mono font-bold tabular-nums text-slate-900 dark:text-white mt-1">
                    - PKR {drawerSummary.shopCashExpenses.toLocaleString()}
                  </div>
                  <div className="text-[10px] text-slate-500 dark:text-slate-400 font-urdu mt-0.5">دکان کے نقد اخراجات</div>
                </div>

                <div className="p-3 rounded-lg bg-slate-50 dark:bg-[#0B1120] border border-slate-200 dark:border-slate-800">
                  <div className="text-[11px] font-medium text-rose-600 dark:text-rose-400">
                    6. Cash Returns (-)
                  </div>
                  <div className="text-base font-mono font-bold tabular-nums text-slate-900 dark:text-white mt-1">
                    - PKR {drawerSummary.inStoreCashReturns.toLocaleString()}
                  </div>
                  <div className="text-[10px] text-slate-500 dark:text-slate-400 font-urdu mt-0.5">واپسی نقد کیش</div>
                </div>
              </div>

              {/* Net Result Bar */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-4 rounded-lg bg-emerald-600 text-white">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-emerald-100">
                    Actual Galla / Net Cash in Drawer (=)
                  </div>
                  <div className="text-[11px] font-urdu text-emerald-100/90">
                    کل سیل (PKR {formatCurrency(dailySales)}) میں سے بینک/آن لائن، اخراجات اور ہینڈ اوور نکال کر اصل دراز کیش
                  </div>
                </div>
                <div className="text-xl font-mono font-bold tabular-nums">
                  PKR {drawerSummary.netDrawerCash.toLocaleString()}
                </div>
              </div>

              {/* Itemized Drawer Entries */}
              <div className="border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
                <div className="bg-slate-50 dark:bg-slate-800/60 px-3.5 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 border-b border-slate-200 dark:border-slate-800 flex justify-between">
                  <span>Today's Drawer Cash Entries ({drawerSummary.rows.length})</span>
                  <span className="font-urdu text-slate-500 dark:text-slate-400">آج کے دراز کیش کا ریکارڈ</span>
                </div>
                {drawerSummary.rows.length === 0 ? (
                  <div className="p-6 text-center text-xs text-slate-500 dark:text-slate-400">
                    No cash drawer entries recorded for {selectedDailyDateStr}.
                  </div>
                ) : (
                  <div className="max-h-60 overflow-y-auto">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead className="sticky top-0 bg-slate-50 dark:bg-[#0B1120] text-[11px] font-medium text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                        <tr>
                          <th className="py-2 px-3">Type</th>
                          <th className="py-2 px-3">Ref</th>
                          <th className="py-2 px-3">Description</th>
                          <th className="py-2 px-3 text-right">In (+)</th>
                          <th className="py-2 px-3 text-right">Out (-)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {drawerSummary.rows.map((r) => (
                          <tr key={r.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                            <td className="py-2 px-3 font-medium">
                              <span className={`inline-flex items-center gap-1 text-[11px] ${
                                r.inflow > 0
                                  ? 'text-emerald-700 dark:text-emerald-400'
                                  : 'text-rose-600 dark:text-rose-400'
                              }`}>
                                {r.inflow > 0 ? <ArrowDownRight className="w-3 h-3" /> : <ArrowUpRight className="w-3 h-3" />}
                                {r.label}
                              </span>
                            </td>
                            <td className="py-2 px-3 font-mono text-slate-600 dark:text-slate-300">{r.voucherNo}</td>
                            <td className="py-2 px-3 text-slate-700 dark:text-slate-300 max-w-[200px] truncate" title={r.description}>
                              {r.description}
                            </td>
                            <td className="py-2 px-3 text-right font-mono font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                              {r.inflow > 0 ? `+${r.inflow.toLocaleString()}` : '-'}
                            </td>
                            <td className="py-2 px-3 text-right font-mono font-semibold tabular-nums text-rose-600 dark:text-rose-400">
                              {r.outflow > 0 ? `-${r.outflow.toLocaleString()}` : '-'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>

            <div className="flex justify-between items-center gap-3 pt-4 mt-4 border-t border-slate-200 dark:border-slate-800">
              <button
                type="button"
                onClick={() => {
                  setShowDrawerBreakdownModal(false);
                  navigate('/owner-account');
                }}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium transition-colors cursor-pointer"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>Full Cash Flow & Record Handover</span>
              </button>
              <button
                type="button"
                onClick={() => setShowDrawerBreakdownModal(false)}
                className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 text-xs font-medium transition-colors cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

