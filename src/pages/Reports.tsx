import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { useBranch } from '../context/BranchContext';
import { useAuth } from '../context/AuthContext';
import { collection, query, where, onSnapshot, addDoc, setDoc, updateDoc, deleteDoc, getDocs, getDoc, runTransaction, writeBatch } from '../lib/customFirestore';
import { db, safeGetDocs, safeCollectionSnapshot } from '../lib/firebase';
import { BarChart3, Printer, Boxes, Download, ArrowDownUp, Search, Filter, Layers, Calendar, ChevronDown, ChevronUp, ExternalLink, CreditCard } from 'lucide-react';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { format, startOfWeek, parseISO, isWithinInterval, startOfDay, endOfDay, subDays, isValid } from 'date-fns';
import { safeFormat } from '../lib/utils';
import { printInvoice } from '../lib/print';
import clsx from 'clsx';

interface Sale {
  id: string;
  branchId: string;
  customerName?: string;
  customerId?: string;
  total: number;
  transactionType?: string; saleType?: string;
  returnedValue?: number;
  paymentMethod?: string;
  items: Array<{ id: string, name: string, qty: number, price: number, cost?: number, category?: string }>;
  returnItems?: Array<{ id: string, name: string, qty: number, price: number, cost?: number, category?: string }>;
  createdAt: any;
  date?: any;
  invoiceNo?: string;
}

interface Purchase {
  id: string;
  branchId: string;
  vendorName?: string;
  vendorId?: string;
  total: number;
  items: Array<{ id: string, name: string, qty: number, price: number, cost?: number, sku?: string, category?: string }>;
  createdAt: any;
  date?: any;
  billNo?: string;
  invoiceNo?: string;
}

interface Employee {
  id: string;
  name: string;
  role: string;
  advanceBalance?: number;
  branchId: string;
}

interface Payslip {
  id: string;
  employeeId: string;
  employeeName: string;
  advances: number;
  recentAdvance?: number;
  recentAdvanceDate?: number;
  month: string;
  date: number;
  branchId: string;
}

export function Reports() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { activeBranchId, setActiveBranchId, branches } = useBranch();
  const [sales, setSales] = useState<Sale[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [inventory, setInventory] = useState<any[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [payslips, setPayslips] = useState<Payslip[]>([]);
  const [ledger, setLedger] = useState<any[]>([]);
  const [transfers, setTransfers] = useState<any[]>([]);
  const [empPurchases, setEmpPurchases] = useState<any[]>([]);
  const [empReturns, setEmpReturns] = useState<any[]>([]);
  const [vendorsList, setVendorsList] = useState<any[]>([]);
  const [customersList, setCustomersList] = useState<any[]>([]);

  const [startDate, setStartDate] = useState(() => {
    const now = new Date();
    return format(new Date(now.getFullYear(), now.getMonth(), 1), 'yyyy-MM-dd');
  });
  const [endDate, setEndDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [aggregation, setAggregation] = useState<'daily' | 'weekly' | 'monthly' | 'yearly'>('daily');
  const [selectedReportVendorName, setSelectedReportVendorName] = useState<string>('ALL');
  const [expandedAdvanceId, setExpandedAdvanceId] = useState<string | null>(null);
  const [advanceSearchTerm, setAdvanceSearchTerm] = useState('');
  
  // Vendor Payables & Customer Receivables filter states
  const [vendorPayableFilter, setVendorPayableFilter] = useState<'all' | 'payable' | 'advance'>('all');
  const [vendorPayableSearch, setVendorPayableSearch] = useState('');
  const [customerReceivableFilter, setCustomerReceivableFilter] = useState<'all' | 'receivable' | 'advance'>('all');
  const [customerReceivableSearch, setCustomerReceivableSearch] = useState('');

  // Monthly Vendor Payments Report state
  const [vendorPaymentFilterVendor, setVendorPaymentFilterVendor] = useState<string>('ALL');
  const [vendorPaymentSearch, setVendorPaymentSearch] = useState('');
  const [vendorPaymentViewMode, setVendorPaymentViewMode] = useState<'summary' | 'detailed'>('summary');
  const [expandedVendorPaymentId, setExpandedVendorPaymentId] = useState<string | null>(null);
  const [selectedPaymentMonth, setSelectedPaymentMonth] = useState<string>(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });

  // Stock Movement Report state
  const [stockMovementTypeFilter, setStockMovementTypeFilter] = useState<'all' | 'purchase' | 'sale' | 'transfer_in' | 'transfer_out' | 'return'>('all');
  const [stockSearchTerm, setStockSearchTerm] = useState('');
  const [stockCategoryFilter, setStockCategoryFilter] = useState('ALL');
  const [stockViewMode, setStockViewMode] = useState<'summary' | 'ledger'>('summary');

  const [reportType, setReportType] = useState<'stock_movement' | 'sales' | 'daily_sales' | 'detailed_sales' | 'detailed_purchases' | 'items' | 'categories' | 'payments' | 'customers' | 'vendors' | 'vendor_payables' | 'customer_receivables' | 'vendor_payments' | 'vendor_items' | 'profitability' | 'advances'>('stock_movement');

  const getDocTimestamp = (doc: any): number => {
    if (!doc) return 0;
    if (typeof doc.date === 'number' && !isNaN(doc.date) && doc.date > 0) return doc.date;
    if (typeof doc.date === 'string') {
      const num = Number(doc.date);
      if (!isNaN(num) && num > 1000000000) return num;
      const p = new Date(doc.date).getTime();
      if (!isNaN(p) && p > 0) return p;
    }
    if (doc.date?.toDate && typeof doc.date.toDate === 'function') return doc.date.toDate().getTime();
    if (doc.date?.toMillis && typeof doc.date.toMillis === 'function') return doc.date.toMillis();
    if (typeof doc.date?.seconds === 'number') return doc.date.seconds * 1000;
    if (typeof doc.date?._seconds === 'number') return doc.date._seconds * 1000;

    if (doc.createdAt?.toDate && typeof doc.createdAt.toDate === 'function') return doc.createdAt.toDate().getTime();
    if (doc.createdAt?.toMillis && typeof doc.createdAt.toMillis === 'function') return doc.createdAt.toMillis();
    if (typeof doc.createdAt?.seconds === 'number') return doc.createdAt.seconds * 1000;
    if (typeof doc.createdAt?._seconds === 'number') return doc.createdAt._seconds * 1000;
    if (typeof doc.createdAt === 'string') {
      const num = Number(doc.createdAt);
      if (!isNaN(num) && num > 1000000000) return num;
      const p = new Date(doc.createdAt).getTime();
      if (!isNaN(p) && p > 0) return p;
    }
    if (typeof doc.createdAt === 'number' && !isNaN(doc.createdAt) && doc.createdAt > 0) return doc.createdAt;

    if (doc.updatedAt?.toDate && typeof doc.updatedAt.toDate === 'function') return doc.updatedAt.toDate().getTime();
    if (doc.updatedAt?.toMillis && typeof doc.updatedAt.toMillis === 'function') return doc.updatedAt.toMillis();
    if (typeof doc.updatedAt?.seconds === 'number') return doc.updatedAt.seconds * 1000;
    if (typeof doc.updatedAt === 'number') return doc.updatedAt;
    return 0;
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tab = params.get('tab') as any;
    if (tab && ['stock_movement', 'sales', 'daily_sales', 'detailed_sales', 'detailed_purchases', 'items', 'categories', 'payments', 'customers', 'vendors', 'vendor_payables', 'customer_receivables', 'vendor_payments', 'vendor_items', 'profitability', 'advances'].includes(tab)) {
      setReportType(tab);
    }
  }, []);

  useEffect(() => {
    const branchToUse = activeBranchId || (branches.length > 0 ? branches[0].id : '');
    if (!branchToUse) return;

    let qSales = query(collection(db, 'sales'), where('branchId', '==', branchToUse));
    let qPurchases = query(collection(db, 'purchases'), where('branchId', '==', branchToUse));
    let qInventory = query(collection(db, 'inventory'), where('branchId', '==', branchToUse));
    let qEmployees = query(collection(db, 'employees'), where('branchId', '==', branchToUse));
    let qPayroll = query(collection(db, 'payroll'), where('branchId', '==', branchToUse));
    let qLedger = query(collection(db, 'ledger'), where('branchId', '==', branchToUse));
    let qTransfers = collection(db, 'stock_transfers');
    let qEmpPurchases = query(collection(db, 'employeePurchases'), where('branchId', '==', branchToUse));
    let qEmpReturns = query(collection(db, 'employeeReturns'), where('branchId', '==', branchToUse));
    let qVendors = collection(db, 'vendors');
    let qCustomers = collection(db, 'customers');

    const unsubSales = safeCollectionSnapshot(qSales, (snap) => setSales(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) } as Sale))));
    const unsubPurchases = safeCollectionSnapshot(qPurchases, (snap) => setPurchases(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) } as Purchase))));
    const unsubInventory = safeCollectionSnapshot(qInventory, (snap) => setInventory(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) } as any))));
    const unsubEmployees = safeCollectionSnapshot(qEmployees, (snap) => setEmployees(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) } as Employee))));
    const unsubPayroll = safeCollectionSnapshot(qPayroll, (snap) => setPayslips(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) } as Payslip))));
    const unsubLedger = safeCollectionSnapshot(qLedger, (snap) => setLedger(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }))));
    const unsubTransfers = safeCollectionSnapshot(qTransfers, (snap) => setTransfers(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }))));
    const unsubEmpPurchases = safeCollectionSnapshot(qEmpPurchases, (snap) => setEmpPurchases(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }))));
    const unsubEmpReturns = safeCollectionSnapshot(qEmpReturns, (snap) => setEmpReturns(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }))));
    const unsubVendors = safeCollectionSnapshot(qVendors, (snap) => setVendorsList(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }))));
    const unsubCustomers = safeCollectionSnapshot(qCustomers, (snap) => setCustomersList(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }))));
    
    return () => {
      unsubSales();
      unsubPurchases();
      unsubInventory();
      unsubEmployees();
      unsubPayroll();
      unsubLedger();
      unsubTransfers();
      unsubEmpPurchases();
      unsubEmpReturns();
      unsubVendors();
      unsubCustomers();
    };
  }, [user, activeBranchId, branches]);

  const reportData = () => {
    const startStr = format(startDate || new Date(), 'yyyy-MM-dd');
    const endStr = format(endDate || new Date(), 'yyyy-MM-dd');
    const [sy, sm, sd] = startStr.split('-');
    const start = new Date(Number(sy), Number(sm) - 1, Number(sd));
    start.setHours(0, 0, 0, 0);
    const [ey, em, ed] = endStr.split('-');
    const end = new Date(Number(ey), Number(em) - 1, Number(ed));
    end.setHours(23, 59, 59, 999);

    const filteredSales = sales.filter(s => {
      const sDate = getDocTimestamp(s);
      if (!sDate) return false;
      return sDate >= start.getTime() && sDate <= end.getTime();
    });

    const filteredPurchases = purchases.filter(p => {
      const pDate = getDocTimestamp(p);
      if (!pDate) return false;
      return pDate >= start.getTime() && pDate <= end.getTime();
    });

    const filteredPayslips = payslips.filter(p => {
      const pDate = getDocTimestamp(p);
      if (!pDate) return false;
      return pDate >= start.getTime() && pDate <= end.getTime();
    });

    const filteredLedger = ledger.filter(l => {
      const lDate = getDocTimestamp(l);
      if (!lDate) return false;
      return lDate >= start.getTime() && lDate <= end.getTime();
    });

    const totalRevenue = filteredSales.reduce((acc, sale) => {
      let r = sale.transactionType === 'Return' ? -Math.abs(sale.total || 0) : (sale.total || 0);
      return acc + r;
    }, 0);

    const trendMap = new Map<string, { display: string, total: number }>();
    const dailySalesMap = new Map<string, { display: string, inStore: number, online: number, total: number }>();
    const itemsMap = new Map<string, { 
      grossRevenue: number, 
      returnRevenue: number, 
      netRevenue: number, 
      grossQty: number, 
      returnQty: number, 
      netQty: number, 
      price?: number 
    }>();
    const profitMap = new Map<string, { revenue: number, cost: number, profit: number, qty: number }>();
    const branchMap = new Map<string, number>();
    const customerMap = new Map<string, { name: string, total: number, count: number }>();
    const vendorMap = new Map<string, { name: string, total: number, count: number }>();
    const vendorItemsMap = new Map<string, { vendorName: string, itemsMap: Map<string, { itemName: string, qty: number, total: number }>, totalQty: number, totalValue: number }>();
    const categoryMap = new Map<string, { revenue: number, qty: number }>();
    const paymentMap = new Map<string, { revenue: number, count: number }>();

    filteredSales.forEach(sale => {
      const sTime = getDocTimestamp(sale);
      const d = new Date(sTime || start.getTime());
      let sortKey = '', display = '';
      if (aggregation === 'daily') {
        sortKey = safeFormat(d, 'yyyy-MM-dd'); display = safeFormat(d, 'MMM dd');
      } else if (aggregation === 'weekly') {
        const sw = startOfWeek(d);
        sortKey = safeFormat(sw, 'yyyy-MM-dd'); display = `Wk ${safeFormat(sw, 'MMM dd')}`;
      } else if (aggregation === 'monthly') {
        sortKey = safeFormat(d, 'yyyy-MM'); display = safeFormat(d, 'MMM yyyy');
      } else {
        sortKey = safeFormat(d, 'yyyy'); display = safeFormat(d, 'yyyy');
      }

      const revenueOfThisSale = sale.transactionType === 'Return' ? -Math.abs(sale.total || 0) : (sale.total || 0);

      const existing = trendMap.get(sortKey) || { display, total: 0 };
      trendMap.set(sortKey, { display, total: existing.total + revenueOfThisSale });

      const existingDaily = dailySalesMap.get(sortKey) || { display, inStore: 0, online: 0, total: 0 };
      const inStoreAmt = sale.saleType !== 'Online' ? revenueOfThisSale : 0;
      const onlineAmt = sale.saleType === 'Online' ? revenueOfThisSale : 0;
      dailySalesMap.set(sortKey, {
         display,
         inStore: existingDaily.inStore + inStoreAmt,
         online: existingDaily.online + onlineAmt,
         total: existingDaily.total + revenueOfThisSale
      });
      const paymentMethod = sale.paymentMethod || 'Cash';
      const pm = paymentMap.get(paymentMethod) || { revenue: 0, count: 0 };
      paymentMap.set(paymentMethod, { revenue: pm.revenue + revenueOfThisSale, count: pm.count + 1 });

      const isPureReturn = sale.transactionType === 'Return' || (Number(sale.total) < 0 && (sale.items || []).length === 0);
      const saleNet = revenueOfThisSale;
      const items = sale.items || [];
      const returnItems = sale.returnItems || [];

      const recordItem = (item: any, isReturnItem: boolean, allocatedRevenue: number) => {
        const rawQty = Math.abs(Number(item.qty || 0));
        const price = Math.abs(Number(item.price || 0));
        let qty = rawQty;
        let revenue = allocatedRevenue;
        
        let unitCost = item.cost;
        if (unitCost === undefined || unitCost === 0 || unitCost === null) {
          const invItem = inventory.find(inv => inv.id === item.id);
          unitCost = Number(invItem?.cost || 0);
        }
        let cost = Math.round(qty * (unitCost || 0));

        const key = item.name || 'Unknown Item';
        const i = itemsMap.get(key) || { 
          grossRevenue: 0, 
          returnRevenue: 0, 
          netRevenue: 0, 
          grossQty: 0, 
          returnQty: 0, 
          netQty: 0, 
          price: price || 0 
        };

        if (isReturnItem) {
          i.returnRevenue += Math.abs(revenue);
          i.returnQty += Math.abs(qty);
          i.netRevenue -= Math.abs(revenue);
          i.netQty -= Math.abs(qty);
          
          qty = -Math.abs(qty);
          revenue = -Math.abs(revenue);
          cost = -Math.abs(cost);
        } else {
          i.grossRevenue += revenue;
          i.grossQty += qty;
          i.netRevenue += revenue;
          i.netQty += qty;
        }
        i.price = price || i.price;
        itemsMap.set(key, i);

        let category = 'Uncategorized';
        const invItem = inventory.find(inv => inv.id === item.id);
        if (item.category) {
          category = item.category;
        } else if (invItem?.category) {
          category = invItem.category;
        }
        
        const cat = categoryMap.get(category) || { revenue: 0, qty: 0 };
        categoryMap.set(category, { revenue: cat.revenue + revenue, qty: cat.qty + qty });

        const p = profitMap.get(key) || { revenue: 0, cost: 0, profit: 0, qty: 0 };
        profitMap.set(key, {
          revenue: p.revenue + revenue,
          cost: p.cost + (isReturnItem ? -Math.abs(cost) : cost),
          profit: p.profit + (revenue - cost),
          qty: p.qty + qty
        });
      };

      if (isPureReturn) {
        const allRetItems = [...items, ...returnItems];
        const retSub = allRetItems.reduce((acc: number, i: any) => acc + (Math.abs(Number(i.qty || 0)) * Math.abs(Number(i.price || 0))), 0);
        const targetRet = Math.abs(saleNet);

        let allocated = 0;
        allRetItems.forEach((item: any, idx: number) => {
          const base = Math.abs(Number(item.qty || 0)) * Math.abs(Number(item.price || 0));
          let rev = 0;
          if (idx === allRetItems.length - 1) {
            rev = targetRet - allocated;
          } else if (retSub > 0) {
            rev = Math.round((base / retSub) * targetRet);
            allocated += rev;
          } else {
            rev = base;
            allocated += rev;
          }
          recordItem(item, true, rev);
        });

        if (allRetItems.length === 0) {
          const dummyItem = { name: sale.description || 'Lump Sum Return', qty: 1, price: targetRet };
          recordItem(dummyItem, true, targetRet);
        }
      } else {
        const grossSub = items.reduce((acc: number, i: any) => acc + (Math.abs(Number(i.qty || 0)) * Math.abs(Number(i.price || 0))), 0);

        let allocatedReturnSum = 0;
        returnItems.forEach((item: any) => {
          const base = Math.abs(Number(item.qty || 0)) * Math.abs(Number(item.price || 0));
          allocatedReturnSum += base;
          recordItem(item, true, base);
        });

        const grossTargetTotal = saleNet + allocatedReturnSum;
        let allocatedGrossSum = 0;

        items.forEach((item: any, idx: number) => {
          const base = Math.abs(Number(item.qty || 0)) * Math.abs(Number(item.price || 0));
          let rev = 0;
          if (idx === items.length - 1) {
            rev = grossTargetTotal - allocatedGrossSum;
          } else if (grossSub > 0) {
            rev = Math.round((base / grossSub) * grossTargetTotal);
            allocatedGrossSum += rev;
          } else {
            rev = base;
            allocatedGrossSum += rev;
          }
          recordItem(item, false, rev);
        });

        if (items.length === 0 && returnItems.length === 0) {
          const dummyItem = { name: sale.description || 'Lump Sum Sale', qty: 1, price: Math.abs(saleNet) };
          recordItem(dummyItem, false, saleNet);
        }
      }

      if (!activeBranchId) {
        const bName = branches.find(b => b.id === sale.branchId)?.name || 'Unknown';
        branchMap.set(bName, (branchMap.get(bName) || 0) + revenueOfThisSale);
      }

      const customerName = sale.customerName || 'Walk-in Customer';
      const c = customerMap.get(customerName) || { name: customerName, total: 0, count: 0 };
      customerMap.set(customerName, { name: customerName, total: c.total + revenueOfThisSale, count: c.count + 1 });
    });

    filteredPurchases.forEach(purchase => {
      const vendorName = purchase.vendorName || 'Unknown Vendor';
      const v = vendorMap.get(vendorName) || { name: vendorName, total: 0, count: 0 };
      vendorMap.set(vendorName, { name: vendorName, total: v.total + purchase.total, count: v.count + 1 });
      
      const vi = vendorItemsMap.get(vendorName) || { vendorName, itemsMap: new Map<string, { itemName: string, qty: number, total: number }>(), totalQty: 0, totalValue: 0 };
      
      if (purchase.items && Array.isArray(purchase.items)) {
        purchase.items.forEach(item => {
           const iName = item.name || 'Unknown Item';
           const iCost = (item.qty * item.price) || 0;
           const existingItem = vi.itemsMap.get(iName) || { itemName: iName, qty: 0, total: 0 };
           vi.itemsMap.set(iName, { 
             itemName: iName, 
             qty: existingItem.qty + item.qty, 
             total: existingItem.total + iCost 
           });
           vi.totalQty += item.qty;
        });
      }
      vi.totalValue += purchase.total;
      vendorItemsMap.set(vendorName, vi);
    });

    const dailySalesReport = Array.from(dailySalesMap.entries())
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([_, val]) => val);
    const trendChart = Array.from(trendMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([_, val]) => ({ period: val.display, sales: val.total }));

    const allItems = Array.from(itemsMap.entries())
      .map(([name, data]) => ({ 
        name, 
        revenue: data.netRevenue, 
        qty: data.netQty, 
        price: data.price,
        grossRevenue: data.grossRevenue,
        returnRevenue: data.returnRevenue,
        grossQty: data.grossQty,
        returnQty: data.returnQty
      }))
      .sort((a,b) => b.revenue - a.revenue);
    
    const topItems = allItems.slice(0, 5);

    const branchChart = activeBranchId ? [] : Array.from(branchMap.entries())
      .map(([name, revenue]) => ({ name, revenue }))
      .sort((a,b) => b.revenue - a.revenue);

    const customerReport = Array.from(customerMap.values()).sort((a, b) => b.total - a.total);
    const vendorReport = Array.from(vendorMap.values()).sort((a, b) => b.total - a.total);
    const allPurchasesVendors = Array.from(new Set(filteredPurchases.map(p => p.vendorName || 'Unknown Vendor'))).sort();
    const vendorDetailedReport = Array.from(vendorItemsMap.values()).map(v => ({
      vendorName: v.vendorName,
      totalQty: v.totalQty,
      totalValue: v.totalValue,
      items: Array.from(v.itemsMap.values()).sort((a,b) => b.qty - a.qty)
    })).sort((a,b) => b.totalValue - a.totalValue);

    const profitabilityReport = Array.from(profitMap.entries())
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.profit - a.profit);

    const categoriesReport = Array.from(categoryMap.entries())
      .map(([name, data]) => ({ name, ...data }))
      .sort((a,b) => b.revenue - a.revenue);

    const detailedSales = [...filteredSales].sort((a, b) => { const getVal = (v: any) => {
                 if (v?.createdAt?.seconds) return v.createdAt.seconds * 1000;
                 if (v?.createdAt && typeof v.createdAt === 'string') return new Date(v.createdAt).getTime();
                 if (v?.createdAt && typeof v.createdAt === 'number') return v.createdAt;
                 if (v?.date && typeof v.date === 'string') return new Date(v.date).getTime();
                 if (v?.date && typeof v.date === 'number') return v.date;
                 return 0;
              };
              return getVal(b) - getVal(a); });
    const paymentsReport = Array.from(paymentMap.entries())
      .map(([name, data]) => ({ name, ...data }))
      .sort((a,b) => b.revenue - a.revenue);

    const advanceReport = employees.map(emp => {
      const empSlips = filteredPayslips.filter(s => s.employeeId === emp.id);
      const deducted = empSlips.reduce((sum, s) => sum + (s.advances || 0), 0);
      const slipGiven = empSlips.reduce((sum, s) => sum + (s.recentAdvance || 0), 0);
      
      const ledgerAdvances = filteredLedger.filter(l => 
        l.employeeId === emp.id && 
        l.reference === 'Advance' && 
        l.type === 'OUT' &&
        !(l.description && l.description.includes('with Salary'))
      );
      const ledgerGiven = ledgerAdvances.reduce((sum, l) => sum + (l.amount || 0), 0);
      
      const details: any[] = [];
      empSlips.forEach(s => {
        if (s.advances > 0) {
          details.push({
            date: s.date,
            type: 'Deduction',
            amount: s.advances,
            desc: `Payroll Deduction (${s.month})`
          });
        }
        if (s.recentAdvance && s.recentAdvance > 0) {
          details.push({
            date: s.recentAdvanceDate || s.date,
            type: 'Issue',
            amount: s.recentAdvance,
            desc: `Advance with Salary (${s.month})`
          });
        }
        details.push({
          date: s.date,
          type: 'Salary',
          amount: s.netPayable,
          desc: `Net Salary Paid (${s.month})`
        });
      });

      ledgerAdvances.forEach(l => {
        const lDate = l.date || (l.createdAt?.seconds ? l.createdAt.seconds * 1000 : 0);
        details.push({
          date: lDate,
          type: 'Issue',
          amount: l.amount,
          desc: l.description || 'Advance Issued'
        });
      });

      details.sort((a, b) => b.date - a.date);
      
      return {
        id: emp.id,
        name: emp.name,
        role: emp.role,
        currentBalance: emp.advanceBalance || 0,
        totalDeducted: deducted,
        totalGiven: slipGiven + ledgerGiven,
        details
      };
    }).sort((a, b) => b.currentBalance - a.currentBalance);

    const detailedPurchases = [...filteredPurchases].sort((a, b) => { 
      const getVal = (v: any) => {
         if (v?.createdAt?.seconds) return v.createdAt.seconds * 1000;
         if (v?.createdAt && typeof v.createdAt === 'string') return new Date(v.createdAt).getTime();
         if (v?.createdAt && typeof v.createdAt === 'number') return v.createdAt;
         if (v?.date && typeof v.date === 'string') return new Date(v.date).getTime();
         if (v?.date && typeof v.date === 'number') return v.date;
         return 0;
      };
      return getVal(b) - getVal(a); 
    });

    // --- INVENTORY STOCK MOVEMENT REPORT (IN / OUT / SALE / TRANSFER / PURCHASE) ---
    const allMovements: Array<{
      id: string;
      date: number;
      displayDate: string;
      itemName: string;
      sku: string;
      category: string;
      type: 'PURCHASE_IN' | 'SALE_OUT' | 'RETURN_IN' | 'TRANSFER_IN' | 'TRANSFER_OUT';
      typeLabel: string;
      refNo: string;
      party: string;
      qtyIn: number;
      qtyOut: number;
      netQty: number;
      rate: number;
      totalValue: number;
    }> = [];

    const itemStockMap = new Map<string, {
      id: string;
      itemName: string;
      sku: string;
      category: string;
      openingStock: number;
      closingStock: number;
      currentStock: number;
      postEndNetChange: number;
      purchasesInQty: number;
      purchasesInVal: number;
      transfersInQty: number;
      transfersInVal: number;
      returnsInQty: number;
      returnsInVal: number;
      totalInQty: number;
      totalInVal: number;
      salesOutQty: number;
      salesOutVal: number;
      transfersOutQty: number;
      transfersOutVal: number;
      totalOutQty: number;
      totalOutVal: number;
      netMovementQty: number;
      netMovementVal: number;
      cost: number;
      price: number;
      currentValuation: number;
    }>();

    // Helper to resolve an item across inventory by id, sku, or name
    const idToKeyMap = new Map<string, string>();
    const skuToKeyMap = new Map<string, string>();

    const getItemRecord = (name: string, sku = '', category = '', cost = 0, price = 0, itemId = '') => {
      if (itemId && idToKeyMap.has(String(itemId))) {
        const mappedKey = idToKeyMap.get(String(itemId))!;
        if (itemStockMap.has(mappedKey)) return itemStockMap.get(mappedKey)!;
      }
      if (sku && skuToKeyMap.has(sku.trim().toLowerCase())) {
        const mappedKey = skuToKeyMap.get(sku.trim().toLowerCase())!;
        if (itemStockMap.has(mappedKey)) return itemStockMap.get(mappedKey)!;
      }

      const cleanName = (name || 'Unknown Item').trim();
      const key = cleanName.toLowerCase();
      if (!itemStockMap.has(key)) {
        const invMatch = inventory.find(i =>
          (itemId && String(i.id) === String(itemId)) ||
          (i.name || '').trim().toLowerCase() === key ||
          (sku && (i.sku || '').trim().toLowerCase() === sku.trim().toLowerCase())
        );
        const liveStock = Number(invMatch?.stock || 0);
        const itemCost = Number(cost || invMatch?.cost || 0);
        const itemPrice = Number(price || invMatch?.price || 0);
        const itemCat = category || invMatch?.category || 'General';
        const itemSku = sku || invMatch?.sku || '';
        const resolvedId = invMatch?.id || itemId || key;

        if (invMatch?.id) idToKeyMap.set(String(invMatch.id), key);
        if (itemId) idToKeyMap.set(String(itemId), key);
        if (itemSku) skuToKeyMap.set(itemSku.trim().toLowerCase(), key);

        itemStockMap.set(key, {
          id: String(resolvedId),
          itemName: invMatch?.name ? invMatch.name.trim() : cleanName,
          sku: itemSku,
          category: itemCat,
          openingStock: liveStock,
          closingStock: liveStock,
          currentStock: liveStock,
          postEndNetChange: 0,
          purchasesInQty: 0,
          purchasesInVal: 0,
          transfersInQty: 0,
          transfersInVal: 0,
          returnsInQty: 0,
          returnsInVal: 0,
          totalInQty: 0,
          totalInVal: 0,
          salesOutQty: 0,
          salesOutVal: 0,
          transfersOutQty: 0,
          transfersOutVal: 0,
          totalOutQty: 0,
          totalOutVal: 0,
          netMovementQty: 0,
          netMovementVal: 0,
          cost: itemCost,
          price: itemPrice,
          currentValuation: liveStock * itemCost
        });
      }
      return itemStockMap.get(key)!;
    };

    // Pre-populate all inventory catalog items for branch
    inventory.forEach(invItem => {
      getItemRecord(invItem.name, invItem.sku, invItem.category, invItem.cost, invItem.price, invItem.id);
    });

    const startTimeMs = start.getTime();
    const endTimeMs = end.getTime();
    const activeBranchToUse = activeBranchId || (branches.length > 0 ? branches[0].id : '');

    // Helper to record any stock event across time (for accurate Opening Stock at startDate, Period Movements, and Current Stock)
    const recordStockEvent = (
      eventTime: number,
      it: any,
      type: 'PURCHASE_IN' | 'SALE_OUT' | 'RETURN_IN' | 'TRANSFER_IN' | 'TRANSFER_OUT',
      typeLabel: string,
      ref: string,
      party: string,
      txId: string,
      idx: number,
      defaultRate: number
    ) => {
      if (!it || it.id === 'lumpsum_sale') return;
      const qty = Math.abs(Number(it.qty || 0));
      if (qty <= 0) return;

      const rate = Number(defaultRate || it.price || it.cost || 0);
      const val = qty * rate;
      const iRec = getItemRecord(it.name, it.sku, it.category, it.cost || rate, it.price || rate, it.id);

      const isIn = type === 'PURCHASE_IN' || type === 'RETURN_IN' || type === 'TRANSFER_IN';

      // If transaction happened AFTER endDate, track postEndNetChange so we can back-calculate exact Opening & Closing stock
      if (eventTime > endTimeMs) {
        iRec.postEndNetChange += isIn ? qty : -qty;
        return;
      }

      // If transaction happened within [startDate, endDate]
      if (eventTime >= startTimeMs && eventTime <= endTimeMs) {
        if (type === 'PURCHASE_IN') {
          iRec.purchasesInQty += qty;
          iRec.purchasesInVal += val;
          iRec.totalInQty += qty;
          iRec.totalInVal += val;
          iRec.netMovementQty += qty;
          iRec.netMovementVal += val;
        } else if (type === 'TRANSFER_IN') {
          iRec.transfersInQty += qty;
          iRec.transfersInVal += val;
          iRec.totalInQty += qty;
          iRec.totalInVal += val;
          iRec.netMovementQty += qty;
          iRec.netMovementVal += val;
        } else if (type === 'RETURN_IN') {
          iRec.returnsInQty += qty;
          iRec.returnsInVal += val;
          iRec.totalInQty += qty;
          iRec.totalInVal += val;
          iRec.netMovementQty += qty;
          iRec.netMovementVal += val;
        } else if (type === 'SALE_OUT') {
          iRec.salesOutQty += qty;
          iRec.salesOutVal += val;
          iRec.totalOutQty += qty;
          iRec.totalOutVal += val;
          iRec.netMovementQty -= qty;
          iRec.netMovementVal -= val;
        } else if (type === 'TRANSFER_OUT') {
          iRec.transfersOutQty += qty;
          iRec.transfersOutVal += val;
          iRec.totalOutQty += qty;
          iRec.totalOutVal += val;
          iRec.netMovementQty -= qty;
          iRec.netMovementVal -= val;
        }

        const dStr = eventTime ? safeFormat(new Date(eventTime), 'dd-MMM-yyyy hh:mm a') : '-';
        allMovements.push({
          id: `${type}-${txId}-${idx}`,
          date: eventTime,
          displayDate: dStr,
          itemName: iRec.itemName || it.name || 'Unknown Item',
          sku: it.sku || iRec.sku || '-',
          category: it.category || iRec.category || 'General',
          type,
          typeLabel,
          refNo: ref,
          party,
          qtyIn: isIn ? qty : 0,
          qtyOut: isIn ? 0 : qty,
          netQty: isIn ? qty : -qty,
          rate,
          totalValue: val
        });
      }
    };

    // 1. All Purchases (IN)
    purchases.forEach(p => {
      const pTime = getDocTimestamp(p);
      if (!pTime) return;
      const ref = p.invoiceNo || p.billNo || ('PUR-' + (p.id ? p.id.slice(0, 6) : ''));
      const party = p.vendorName || 'Vendor';

      (p.items || []).forEach((it: any, idx: number) => {
        const rate = Number(it.price || it.cost || 0);
        recordStockEvent(pTime, it, 'PURCHASE_IN', 'Purchase (IN)', ref, `Vendor: ${party}`, p.id, idx, rate);
      });
    });

    // 2. All Sales (OUT) & Customer Returns (IN)
    sales.forEach(s => {
      const sTime = getDocTimestamp(s);
      if (!sTime) return;
      const ref = s.invoiceNo || ('BILL-' + (s.id ? s.id.slice(0, 6) : ''));
      const party = s.customerName || 'Walk-in Customer';
      const isReturnBill = s.transactionType === 'Return';

      (s.items || []).forEach((it: any, idx: number) => {
        const rate = Number(it.price || 0);
        if (isReturnBill) {
          recordStockEvent(sTime, it, 'RETURN_IN', 'Sale Return (IN)', ref + ' (Ret)', `Customer: ${party}`, s.id, idx, rate);
        } else {
          recordStockEvent(sTime, it, 'SALE_OUT', 'Sale (OUT)', ref, `Customer: ${party}`, s.id, idx, rate);
        }
      });

      (s.returnItems || []).forEach((it: any, idx: number) => {
        const rate = Number(it.price || 0);
        recordStockEvent(sTime, it, 'RETURN_IN', 'Return (IN)', ref + ' (Ret)', `Customer: ${party}`, `ret-${s.id}`, idx, rate);
      });
    });

    // 3. Employee Purchases (OUT) & Employee Returns (IN)
    empPurchases.forEach(ep => {
      const epTime = getDocTimestamp(ep);
      if (!epTime) return;
      const ref = ep.invoiceNo || ('EP-' + (ep.id ? ep.id.slice(0, 6) : ''));
      const party = ep.employeeName || 'Employee';
      (ep.items || []).forEach((it: any, idx: number) => {
        const rate = Number(it.price || 0);
        recordStockEvent(epTime, it, 'SALE_OUT', 'Emp. Purchase (OUT)', ref, `Employee: ${party}`, `ep-${ep.id}`, idx, rate);
      });
    });

    empReturns.forEach(er => {
      const erTime = getDocTimestamp(er);
      if (!erTime) return;
      const ref = er.returnNo || ('ER-' + (er.id ? er.id.slice(0, 6) : ''));
      const party = er.employeeName || 'Employee';
      (er.items || []).forEach((it: any, idx: number) => {
        const rate = Number(it.price || 0);
        recordStockEvent(erTime, it, 'RETURN_IN', 'Emp. Return (IN)', ref, `Employee: ${party}`, `er-${er.id}`, idx, rate);
      });
    });

    // 4. Stock Transfers (Transfer OUT & Transfer IN)
    transfers.forEach(t => {
      const statusUpper = String(t.status || 'PENDING').toUpperCase();
      // Cancelled transfers restore stock to source branch and never enter destination branch
      if (statusUpper === 'CANCELLED') return;

      const tDispatchTime = getDocTimestamp(t);
      const ref = t.transferNo || ('TRF-' + (t.id ? t.id.slice(0, 6) : ''));

      // Transfer OUT: deducts from source branch immediately upon dispatch
      if (t.fromBranchId === activeBranchToUse && tDispatchTime > 0) {
        const destName = t.toBranchName || branches.find(b => b.id === (t.toBranchId || t.destBranchId))?.name || 'Other Branch';
        (t.items || []).forEach((it: any, idx: number) => {
          const rate = Number(it.cost || it.price || 0);
          recordStockEvent(
            tDispatchTime,
            it,
            'TRANSFER_OUT',
            statusUpper === 'COMPLETED' ? 'Transfer OUT' : 'Transfer OUT (Sent)',
            ref,
            `To: ${destName}`,
            `out-${t.id}`,
            idx,
            rate
          );
        });
      }

      // Transfer IN: adds to destination branch inventory when received (COMPLETED)
      const isDestBranch = (t.toBranchId === activeBranchToUse || t.destBranchId === activeBranchToUse);
      if (isDestBranch && statusUpper === 'COMPLETED') {
        const acceptTime = (() => {
          if (typeof t.acceptedAt === 'number' && t.acceptedAt > 0) return t.acceptedAt;
          if (t.acceptedAt && typeof t.acceptedAt.toMillis === 'function') return t.acceptedAt.toMillis();
          if (t.acceptedAt && typeof t.acceptedAt.seconds === 'number') return t.acceptedAt.seconds * 1000;
          return tDispatchTime;
        })();
        if (acceptTime > 0) {
          const srcName = t.fromBranchName || branches.find(b => b.id === t.fromBranchId)?.name || 'Other Branch';
          (t.items || []).forEach((it: any, idx: number) => {
            const rate = Number(it.cost || it.price || 0);
            recordStockEvent(
              acceptTime,
              it,
              'TRANSFER_IN',
              'Transfer IN',
              ref,
              `From: ${srcName}`,
              `in-${t.id}`,
              idx,
              rate
            );
          });
        }
      }
    });

    // Reconcile Opening Stock (as of Start Date) and Closing Stock (as of End Date) from Current Stock
    // Formula: CurrentStock = OpeningStock + PeriodNetMovement + PostEndNetChange
    // => ClosingStock (at EndDate) = CurrentStock - PostEndNetChange
    // => OpeningStock (at StartDate) = ClosingStock - PeriodNetMovement
    itemStockMap.forEach((rec) => {
      rec.closingStock = rec.currentStock - rec.postEndNetChange;
      rec.openingStock = rec.closingStock - rec.netMovementQty;
      rec.currentValuation = rec.currentStock * rec.cost;
    });

    allMovements.sort((a, b) => b.date - a.date);

    const totalOpeningStock = Array.from(itemStockMap.values()).reduce((acc, i) => acc + i.openingStock, 0);
    const totalClosingStock = Array.from(itemStockMap.values()).reduce((acc, i) => acc + i.closingStock, 0);
    const totalPurchasesInQty = Array.from(itemStockMap.values()).reduce((acc, i) => acc + i.purchasesInQty, 0);
    const totalTransfersInQty = Array.from(itemStockMap.values()).reduce((acc, i) => acc + i.transfersInQty, 0);
    const totalReturnsInQty = Array.from(itemStockMap.values()).reduce((acc, i) => acc + i.returnsInQty, 0);
    const totalSalesOutQty = Array.from(itemStockMap.values()).reduce((acc, i) => acc + i.salesOutQty, 0);
    const totalTransfersOutQty = Array.from(itemStockMap.values()).reduce((acc, i) => acc + i.transfersOutQty, 0);

    const totalStockInQty = totalPurchasesInQty + totalTransfersInQty + totalReturnsInQty;
    const totalStockInValue = allMovements.reduce((acc, m) => acc + (m.qtyIn > 0 ? m.totalValue : 0), 0);
    const totalStockOutQty = totalSalesOutQty + totalTransfersOutQty;
    const totalStockOutValue = allMovements.reduce((acc, m) => acc + (m.qtyOut > 0 ? m.totalValue : 0), 0);
    const netMovementQty = totalStockInQty - totalStockOutQty;
    const currentBranchStockTotal = Array.from(itemStockMap.values()).reduce((acc, i) => acc + i.currentStock, 0);
    const currentBranchStockValuation = Array.from(itemStockMap.values()).reduce((acc, i) => acc + i.currentValuation, 0);

    const itemSummaryList = Array.from(itemStockMap.values()).sort((a, b) => a.itemName.localeCompare(b.itemName));

    const stockCategories = Array.from(new Set(itemSummaryList.map(i => i.category || 'General'))).sort();

    // Vendor Payables Calculation (Matches Dashboard and Vendors directory)
    const vendorPayablesList = vendorsList
      .filter(v => !activeBranchId || !v.branchId || v.branchId === activeBranchId || (activeBranchId === 'main' && !v.branchId) || v.isCourier || v.isGlobal)
      .map(v => {
        const vEntries = ledger.filter(e => e.vendorId === v.id);
        const totalIn = vEntries.filter(e => e.type === 'IN').reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0);
        const totalOut = vEntries.filter(e => e.type === 'OUT').reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0);
        const balance = totalIn - totalOut;
        return {
          id: v.id,
          name: v.name,
          phone: v.phone || '',
          balance,
          dueAmount: Math.abs(balance),
          isPayable: balance < 0
        };
      })
      .sort((a, b) => b.dueAmount - a.dueAmount);

    const totalVendorPayablesOnly = vendorPayablesList
      .filter(v => v.balance < 0)
      .reduce((sum, v) => sum + Math.abs(v.balance), 0);

    const totalVendorAdvanceOnly = vendorPayablesList
      .filter(v => v.balance > 0)
      .reduce((sum, v) => sum + v.balance, 0);

    // Customer Receivables Calculation (Matches Dashboard and Customers directory)
    const customerReceivablesList = customersList
      .filter(c => !activeBranchId || !c.branchId || c.branchId === activeBranchId || (activeBranchId === 'main' && !c.branchId))
      .map(c => {
        const cEntries = ledger.filter(e => e.customerId === c.id);
        let balance = 0;
        if (cEntries.length > 0) {
          const totalIn = cEntries.filter(e => e.type === 'IN').reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0);
          const totalOut = cEntries.filter(e => e.type === 'OUT').reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0);
          balance = totalIn - totalOut;
        } else {
          const cSales = sales.filter(s => s.customerId === c.id);
          cSales.forEach(s => {
            const tot = Number(s.total) || 0;
            const rec = Number(s.received !== undefined ? s.received : tot) || 0;
            balance += (rec - tot);
          });
        }
        return {
          id: c.id,
          name: c.name,
          phone: c.phone || '',
          city: c.city || '',
          balance,
          dueAmount: Math.abs(balance),
          isReceivable: balance < 0
        };
      })
      .sort((a, b) => b.dueAmount - a.dueAmount);

    const totalCustomerReceivablesOnly = customerReceivablesList
      .filter(c => c.balance < 0)
      .reduce((sum, c) => sum + Math.abs(c.balance), 0);

    const totalCustomerAdvanceOnly = customerReceivablesList
      .filter(c => c.balance > 0)
      .reduce((sum, c) => sum + c.balance, 0);

    // Monthly Vendor Payments Report Calculation
    const periodVendorPaymentEntries = filteredLedger
      .filter(e => {
        // User requested: pick Cash IN (type === 'IN') for vendor payment calculation
        if (e.type !== 'IN') return false;

        // Exclude customer transactions, owner capital, stock transfers, sale invoices
        if (e.customerId || e.category === 'Customer Payment' || e.category === 'Sale Payment' || e.category === 'Sale Invoice' || e.category === 'Owner Capital' || e.category === 'Owner Withdrawal' || e.category === 'Stock Transfer') {
          return false;
        }

        // Must be associated with a vendor
        const isVendorAssociated = !!e.vendorId || (e.category && e.category.toLowerCase().includes('vendor')) || (e.description && e.description.toLowerCase().includes('vendor'));
        if (!isVendorAssociated) return false;

        // Exclude purchase credit bills if any
        if (e.category === 'Vendor Bill' || e.category === 'Purchase Invoice') {
          return false;
        }

        return true;
      })
      .map(e => {
        const matchedVendor = vendorsList.find(v => v.id === e.vendorId);
        let vName = matchedVendor?.name;
        if (!vName) {
          if (e.reference && e.reference.startsWith('Bill #')) {
            const billId = e.reference.split(' ')[0].replace('Bill #', '');
            const pur = purchases.find(p => p.id && p.id.toUpperCase().startsWith(billId));
            if (pur?.vendorName) vName = pur.vendorName;
          }
        }
        if (!vName) {
          vName = e.vendorName || (e.description?.includes(':') ? e.description.split(':')[1]?.trim() : '') || e.reference || 'Unknown Vendor';
        }

        const amt = Number(e.amount) || 0;
        const entryDate = getDocTimestamp(e);
        return {
          id: e.id,
          vendorId: e.vendorId || matchedVendor?.id || 'unknown',
          vendorName: vName,
          vendorPhone: matchedVendor?.phone || '',
          amount: amt,
          date: entryDate,
          displayDate: safeFormat(new Date(entryDate), 'dd MMM yyyy, hh:mm a'),
          shortDate: safeFormat(new Date(entryDate), 'dd MMM yyyy'),
          category: e.category || 'Cash IN (Payment)',
          description: e.description || '',
          reference: e.reference || '',
          branchId: e.branchId
        };
      })
      .sort((a, b) => b.date - a.date);

    // Group by vendor
    const vendorPaymentSummaryMap = new Map<string, {
      vendorId: string;
      vendorName: string;
      vendorPhone: string;
      totalPaid: number;
      paymentsCount: number;
      transactions: typeof periodVendorPaymentEntries;
      currentBalance: number;
    }>();

    periodVendorPaymentEntries.forEach(entry => {
      const vKey = entry.vendorId !== 'unknown' ? entry.vendorId : entry.vendorName.trim().toLowerCase();
      const existing = vendorPaymentSummaryMap.get(vKey);
      
      if (existing) {
        existing.totalPaid += entry.amount;
        existing.paymentsCount += 1;
        existing.transactions.push(entry);
      } else {
        const vPayable = vendorPayablesList.find(vp => vp.id === entry.vendorId || vp.name.trim().toLowerCase() === entry.vendorName.trim().toLowerCase());
        vendorPaymentSummaryMap.set(vKey, {
          vendorId: entry.vendorId,
          vendorName: entry.vendorName,
          vendorPhone: entry.vendorPhone || vPayable?.phone || '',
          totalPaid: entry.amount,
          paymentsCount: 1,
          transactions: [entry],
          currentBalance: vPayable ? vPayable.balance : 0
        });
      }
    });

    const vendorPaymentSummaryList = Array.from(vendorPaymentSummaryMap.values())
      .sort((a, b) => b.totalPaid - a.totalPaid);

    const totalVendorPaidInPeriod = vendorPaymentSummaryList.reduce((acc, v) => acc + v.totalPaid, 0);
    const totalVendorPaymentTransactions = periodVendorPaymentEntries.length;
    const topPaidVendor = vendorPaymentSummaryList.length > 0 ? vendorPaymentSummaryList[0] : null;

    return { 
      detailedSales,
      detailedPurchases,
      dailySalesReport,
      advanceReport,
      filteredCount: filteredSales.length, 
      totalRevenue, 
      trendChart, 
      topItems, 
      allItems,
      branchChart,
      customerReport,
      vendorReport,
      vendorDetailedReport,
      vendorPayablesList,
      totalVendorPayablesOnly,
      totalVendorAdvanceOnly,
      customerReceivablesList,
      totalCustomerReceivablesOnly,
      totalCustomerAdvanceOnly,
      // Monthly Vendor Payments Report
      vendorPaymentSummaryList,
      periodVendorPaymentEntries,
      totalVendorPaidInPeriod,
      totalVendorPaymentTransactions,
      topPaidVendor,
      allPurchasesVendors,
      profitabilityReport,
      categoriesReport,
      paymentsReport,
      // Stock Movement Unified Report data
      stockMovement: {
        allMovements,
        itemSummaryList,
        stockCategories,
        totalOpeningStock,
        totalClosingStock,
        totalPurchasesInQty,
        totalTransfersInQty,
        totalReturnsInQty,
        totalSalesOutQty,
        totalTransfersOutQty,
        totalStockInQty,
        totalStockInValue,
        totalStockOutQty,
        totalStockOutValue,
        netMovementQty,
        currentBranchStockTotal,
        currentBranchStockValuation
      }
    };
  };

  const reports = reportData();

  // Helper list of recent months for fast monthly selection
  const generateMonthsList = () => {
    const list = [];
    const currDate = new Date();
    for (let i = 0; i < 18; i++) {
      const d = new Date(currDate.getFullYear(), currDate.getMonth() - i, 1);
      const label = d.toLocaleString('en-US', { month: 'long', year: 'numeric' });
      const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      list.push({ label, value, year: d.getFullYear(), month: d.getMonth() });
    }
    return list;
  };
  const monthsList = generateMonthsList();

  const handlePaymentMonthChange = (monthVal: string) => {
    setSelectedPaymentMonth(monthVal);
    if (monthVal === 'custom') return;
    const [yStr, mStr] = monthVal.split('-');
    const y = Number(yStr);
    const m = Number(mStr) - 1;
    const firstDay = new Date(y, m, 1);
    const lastDay = new Date(y, m + 1, 0);
    setStartDate(format(firstDay, 'yyyy-MM-dd'));
    setEndDate(format(lastDay, 'yyyy-MM-dd'));
  };

  const setQuickPeriod = (preset: 'this_month' | 'last_month' | 'last_30') => {
    const now = new Date();
    if (preset === 'this_month') {
      const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
      const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      const mVal = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      setSelectedPaymentMonth(mVal);
      setStartDate(format(firstDay, 'yyyy-MM-dd'));
      setEndDate(format(lastDay, 'yyyy-MM-dd'));
    } else if (preset === 'last_month') {
      const firstDay = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const lastDay = new Date(now.getFullYear(), now.getMonth(), 0);
      const mVal = `${firstDay.getFullYear()}-${String(firstDay.getMonth() + 1).padStart(2, '0')}`;
      setSelectedPaymentMonth(mVal);
      setStartDate(format(firstDay, 'yyyy-MM-dd'));
      setEndDate(format(lastDay, 'yyyy-MM-dd'));
    } else if (preset === 'last_30') {
      setSelectedPaymentMonth('custom');
      setStartDate(format(subDays(now, 30), 'yyyy-MM-dd'));
      setEndDate(format(now, 'yyyy-MM-dd'));
    }
  };

  const exportVendorPaymentsCSV = () => {
    const bName = (branches.find(b => b.id === activeBranchId)?.name || 'branch').replace(/[^a-zA-Z0-9]/g, '_');
    const headers = ['Date', 'Vendor Name', 'Phone', 'Reference / Voucher', 'Category', 'Description', 'Amount Paid (PKR)'];
    const rows = reports.periodVendorPaymentEntries.map(t => [
      `"${t.displayDate}"`,
      `"${(t.vendorName || '').replace(/"/g, '""')}"`,
      `"${t.vendorPhone || ''}"`,
      `"${(t.reference || '').replace(/"/g, '""')}"`,
      `"${t.category || ''}"`,
      `"${(t.description || '').replace(/"/g, '""')}"`,
      t.amount || 0
    ]);
    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `Vendor_Payments_${bName}_${startDate}_to_${endDate}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const exportStockMovementCSV = () => {
    const bName = (branches.find(b => b.id === activeBranchId)?.name || 'branch').replace(/[^a-zA-Z0-9]/g, '_');
    if (stockViewMode === 'summary') {
      const items = reports.stockMovement.itemSummaryList;
      if (!items || items.length === 0) return;
      const headers = [
        'Item Name',
        'SKU',
        'Category',
        `Opening Stock (${startDate})`,
        'Purchases (+)',
        'Transfer IN (+)',
        'Returns (+)',
        'Total IN (+)',
        'Sales (-)',
        'Transfer OUT (-)',
        'Total OUT (-)',
        'Net Change',
        `Closing Stock (${endDate})`,
        'Current Stock (Live)',
        'Unit Cost (PKR)',
        'Stock Valuation (PKR)'
      ];
      const rows = items.map(i => [
        `"${(i.itemName || '').replace(/"/g, '""')}"`,
        `"${i.sku || ''}"`,
        `"${i.category || ''}"`,
        i.openingStock,
        i.purchasesInQty,
        i.transfersInQty,
        i.returnsInQty,
        i.totalInQty,
        i.salesOutQty,
        i.transfersOutQty,
        i.totalOutQty,
        i.netMovementQty,
        i.closingStock,
        i.currentStock,
        i.cost || 0,
        i.currentValuation || 0
      ]);
      const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `Stock_Reconciliation_${bName}_${startDate}_to_${endDate}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      return;
    }

    const movements = reports.stockMovement.allMovements;
    if (!movements || movements.length === 0) return;
    const headers = ['Date', 'Item Name', 'SKU', 'Category', 'Movement Type', 'Reference / Bill #', 'Party / Branch', 'Rate (PKR)', 'Qty IN', 'Qty OUT', 'Net Qty', 'Total Value (PKR)'];
    const rows = movements.map(m => [
      `"${m.displayDate}"`,
      `"${(m.itemName || '').replace(/"/g, '""')}"`,
      `"${m.sku || ''}"`,
      `"${m.category || ''}"`,
      `"${m.typeLabel}"`,
      `"${m.refNo || ''}"`,
      `"${(m.party || '').replace(/"/g, '""')}"`,
      m.rate || 0,
      m.qtyIn || 0,
      m.qtyOut || 0,
      m.netQty || 0,
      m.totalValue || 0
    ]);
    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `Stock_Ledger_${bName}_${startDate}_to_${endDate}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center card p-4 print:hidden">
        <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100 flex items-center">
          <BarChart3 className="w-5 h-5 mr-2.5 text-slate-700 dark:text-slate-300" />
          Reports &amp; Stock Reconciliation
        </h2>
        <div className="flex items-center gap-2.5">
          {reportType === 'stock_movement' && (
            <button 
              onClick={exportStockMovementCSV} 
              className="flex items-center px-3.5 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-200 rounded hover:bg-slate-50 dark:hover:bg-slate-800 transition font-medium text-xs sm:text-sm cursor-pointer"
            >
              <Download className="w-4 h-4 mr-1.5" /> Export CSV
            </button>
          )}
          {reportType === 'vendor_payments' && (
            <button 
              onClick={exportVendorPaymentsCSV} 
              className="flex items-center px-3.5 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-200 rounded hover:bg-slate-50 dark:hover:bg-slate-800 transition font-medium text-xs sm:text-sm cursor-pointer"
            >
              <Download className="w-4 h-4 mr-1.5" /> Export CSV
            </button>
          )}
          <button 
            onClick={() => {
              const reportNames: Record<string, string> = {
                stock_movement: 'Inventory_Stock_Movement_Report',
                vendor_payables: 'Vendors_Outstanding_Balances_Report',
                customer_receivables: 'Customers_Outstanding_Balances_Report',
                vendor_payments: 'Monthly_Vendor_Payments_Report',
                vendors: 'Vendor_Purchases_Report',
                customers: 'Customer_Sales_Report',
                vendor_items: 'Vendor_Detailed_Purchases_Report',
                daily_sales: 'Daily_Sales_Report',
                detailed_sales: 'Detailed_Sales_Report',
                detailed_purchases: 'Detailed_Purchases_Report',
                profitability: 'Profitability_Report',
                advances: 'Employee_Advances_Report',
                sales: 'Sales_Overview_Report',
                items: 'Best_Selling_Items_Report',
                categories: 'Sales_By_Category_Report',
                payments: 'Sales_By_Payment_Method_Report'
              };
              const title = reportNames[reportType] || 'Business_Report';
              printInvoice('report-print-content', title, 'a4');
            }} 
            className="flex items-center px-4 py-2 bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 rounded hover:bg-slate-800 dark:hover:bg-slate-200 transition font-medium text-xs sm:text-sm cursor-pointer"
          >
            <Printer className="w-4 h-4 mr-1.5" /> Print Report
          </button>
        </div>
      </div>

      <div className="card p-4 flex flex-wrap gap-4 items-end bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 print:hidden">
        <div>
          <label className="block text-[10px] uppercase tracking-wider text-slate-600 dark:text-slate-400 mb-1 font-bold">Start Date (Opening Stock)</label>
          <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="text-sm border border-slate-300 dark:border-slate-600 rounded px-2.5 py-1.5 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 font-mono" />
        </div>
        <div>
          <label className="block text-[10px] uppercase tracking-wider text-slate-600 dark:text-slate-400 mb-1 font-bold">End Date (Closing Stock)</label>
          <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="text-sm border border-slate-300 dark:border-slate-600 rounded px-2.5 py-1.5 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 font-mono" />
        </div>

        {reportType === 'stock_movement' ? (
          <>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-slate-600 dark:text-slate-400 mb-1 font-bold">Report View</label>
              <div className="flex rounded border border-slate-300 dark:border-slate-600 overflow-hidden bg-white dark:bg-slate-900">
                <button
                  type="button"
                  onClick={() => setStockViewMode('summary')}
                  className={clsx("px-3 py-1.5 text-xs font-semibold transition cursor-pointer", stockViewMode === 'summary' ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900" : "text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800")}
                >
                  Item Stock Summary
                </button>
                <button
                  type="button"
                  onClick={() => setStockViewMode('ledger')}
                  className={clsx("px-3 py-1.5 text-xs font-semibold transition cursor-pointer border-l border-slate-300 dark:border-slate-600", stockViewMode === 'ledger' ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900" : "text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800")}
                >
                  Transaction Log
                </button>
              </div>
            </div>
            {stockViewMode === 'ledger' && (
              <div>
                <label className="block text-[10px] uppercase tracking-wider text-slate-600 dark:text-slate-400 mb-1 font-bold">Movement Type</label>
                <select
                  value={stockMovementTypeFilter}
                  onChange={(e: any) => setStockMovementTypeFilter(e.target.value)}
                  className="text-sm border border-slate-300 dark:border-slate-600 rounded px-2.5 py-1.5 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
                >
                  <option value="all">All Movements (In &amp; Out)</option>
                  <option value="purchase">Purchases Only (IN)</option>
                  <option value="sale">Sales Only (OUT)</option>
                  <option value="transfer_in">Transfers IN (Received)</option>
                  <option value="transfer_out">Transfers OUT (Sent)</option>
                  <option value="return">Returns Only (IN)</option>
                </select>
              </div>
            )}
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-slate-600 dark:text-slate-400 mb-1 font-bold">Category</label>
              <select
                value={stockCategoryFilter}
                onChange={(e) => setStockCategoryFilter(e.target.value)}
                className="text-sm border border-slate-300 dark:border-slate-600 rounded px-2.5 py-1.5 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
              >
                <option value="ALL">All Categories</option>
                {reports.stockMovement.stockCategories.map((c, i) => (
                  <option key={i} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-slate-600 dark:text-slate-400 mb-1 font-bold">Search Item / SKU</label>
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-400" />
                <input
                  type="text"
                  placeholder="Filter by item name or SKU..."
                  value={stockSearchTerm}
                  onChange={(e) => setStockSearchTerm(e.target.value)}
                  className="text-sm border border-slate-300 dark:border-slate-600 rounded pl-8 pr-2.5 py-1.5 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 w-full md:w-56"
                />
              </div>
            </div>
          </>
        ) : (
          <div>
            <label className="block text-[10px] uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-1 font-bold">Group By</label>
            <select value={aggregation} onChange={(e: any) => setAggregation(e.target.value)} className="text-sm border border-slate-300 dark:border-slate-600 rounded px-2 py-1.5 bg-white dark:bg-slate-900">
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
              <option value="yearly">Yearly</option>
            </select>
          </div>
        )}

        {reportType === 'vendor_payables' && (
          <>
            <div>
              <label className="block text-[10px] uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-1 font-bold">Filter By Status</label>
              <select 
                value={vendorPayableFilter} 
                onChange={(e: any) => setVendorPayableFilter(e.target.value)} 
                className="text-sm border border-slate-300 dark:border-slate-600 rounded px-2.5 py-1.5 bg-white dark:bg-slate-900"
              >
                <option value="all">All Vendors ({reports.vendorPayablesList.length})</option>
                <option value="payable">Payables Only (ہم نے دینا ہے)</option>
                <option value="advance">Advances Only (ہمارا ایڈوانس)</option>
              </select>
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-1 font-bold">Search Vendor</label>
              <input 
                type="text" 
                placeholder="Search vendor name or phone..."
                value={vendorPayableSearch}
                onChange={(e) => setVendorPayableSearch(e.target.value)}
                className="text-sm border border-slate-300 dark:border-slate-600 rounded px-2.5 py-1.5 bg-white dark:bg-slate-900 w-full md:w-56"
              />
            </div>
          </>
        )}

        {reportType === 'customer_receivables' && (
          <>
            <div>
              <label className="block text-[10px] uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-1 font-bold">Filter By Status</label>
              <select 
                value={customerReceivableFilter} 
                onChange={(e: any) => setCustomerReceivableFilter(e.target.value)} 
                className="text-sm border border-slate-300 dark:border-slate-600 rounded px-2.5 py-1.5 bg-white dark:bg-slate-900"
              >
                <option value="all">All Customers ({reports.customerReceivablesList.length})</option>
                <option value="receivable">Receivables Only (کسٹمر سے لینا ہے)</option>
                <option value="advance">Advance / Prepaid (کسٹمر ایڈوانس)</option>
              </select>
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-1 font-bold">Search Customer</label>
              <input 
                type="text" 
                placeholder="Search name, phone, city..."
                value={customerReceivableSearch}
                onChange={(e) => setCustomerReceivableSearch(e.target.value)}
                className="text-sm border border-slate-300 dark:border-slate-600 rounded px-2.5 py-1.5 bg-white dark:bg-slate-900 w-full md:w-56"
              />
            </div>
          </>
        )}

        {reportType === 'vendor_payments' && (
          <>
            <div>
              <label className="block text-[10px] uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-1 font-bold">Select Month (ماہانہ انتخاب)</label>
              <select 
                value={selectedPaymentMonth} 
                onChange={(e) => handlePaymentMonthChange(e.target.value)}
                className="text-sm border border-slate-300 dark:border-slate-600 rounded px-2.5 py-1.5 bg-white dark:bg-slate-900 font-medium"
              >
                <option value="custom">Custom Date Range (اپنی مرضی کی تاریخ)</option>
                {monthsList.map(m => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </div>
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={() => setQuickPeriod('this_month')}
                className="text-xs px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded font-medium border border-slate-300 dark:border-slate-600 transition cursor-pointer"
              >
                This Month
              </button>
              <button
                type="button"
                onClick={() => setQuickPeriod('last_month')}
                className="text-xs px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded font-medium border border-slate-300 dark:border-slate-600 transition cursor-pointer"
              >
                Last Month
              </button>
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-1 font-bold">Select Vendor (وینڈر)</label>
              <select 
                value={vendorPaymentFilterVendor} 
                onChange={(e) => setVendorPaymentFilterVendor(e.target.value)} 
                className="text-sm border border-slate-300 dark:border-slate-600 rounded px-2.5 py-1.5 bg-white dark:bg-slate-900 max-w-[200px]"
              >
                <option value="ALL">All Vendors ({vendorsList.length})</option>
                {vendorsList.map(v => (
                  <option key={v.id} value={v.id}>{v.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-1 font-bold">Search Payment / Ref</label>
              <input 
                type="text" 
                placeholder="Search vendor, voucher, note..."
                value={vendorPaymentSearch}
                onChange={(e) => setVendorPaymentSearch(e.target.value)}
                className="text-sm border border-slate-300 dark:border-slate-600 rounded px-2.5 py-1.5 bg-white dark:bg-slate-900 w-full md:w-56"
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-1 font-bold">View Mode (طرزِ نمائش)</label>
              <div className="flex rounded border border-slate-300 dark:border-slate-600 overflow-hidden bg-white dark:bg-slate-900">
                <button
                  type="button"
                  onClick={() => setVendorPaymentViewMode('summary')}
                  className={clsx("px-3 py-1.5 text-xs font-semibold transition cursor-pointer", vendorPaymentViewMode === 'summary' ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900" : "text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800")}
                >
                  Vendor Summary
                </button>
                <button
                  type="button"
                  onClick={() => setVendorPaymentViewMode('detailed')}
                  className={clsx("px-3 py-1.5 text-xs font-semibold transition cursor-pointer border-l border-slate-300 dark:border-slate-600", vendorPaymentViewMode === 'detailed' ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900" : "text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800")}
                >
                  Transactions Log
                </button>
              </div>
            </div>
          </>
        )}

        {reportType === 'vendor_items' && (
          <div>
            <label className="block text-[10px] uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-1 font-bold">Select Vendor</label>
            <select value={selectedReportVendorName} onChange={(e: any) => setSelectedReportVendorName(e.target.value)} className="text-sm border border-slate-300 dark:border-slate-600 rounded px-2 py-1.5 bg-white dark:bg-slate-900">
              <option value="ALL">All Vendors</option>
              {reports.allPurchasesVendors.map((v, i) => (
                <option key={i} value={v}>{v}</option>
              ))}
            </select>
          </div>
        )}
        {reportType === 'advances' && (
          <div>
            <label className="block text-[10px] uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-1 font-bold">Search Employee</label>
            <input 
              type="text" 
              placeholder="Enter name..."
              value={advanceSearchTerm}
              onChange={(e) => setAdvanceSearchTerm(e.target.value)}
              className="text-sm border border-slate-300 dark:border-slate-600 rounded px-2 py-1.5 bg-white dark:bg-slate-900 w-full md:w-64"
            />
          </div>
        )}

      </div>

      <div className="flex border-b border-slate-200 dark:border-slate-700 print:hidden overflow-x-auto">
        {( ['stock_movement', 'sales', 'daily_sales', 'detailed_sales', 'detailed_purchases', 'vendor_payables', 'vendor_payments', 'customer_receivables', 'vendors', 'customers', 'items', 'categories', 'payments', 'vendor_items', 'profitability', 'advances'] as const).map(type => (
          <button 
            key={type}
            onClick={() => setReportType(type)}
            className={`px-4 py-3 border-b-2 font-medium text-sm transition-colors whitespace-nowrap flex items-center gap-1.5 ${
              reportType === type ? 'border-slate-900 dark:border-slate-100 text-slate-900 dark:text-slate-100 font-bold' : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 hover:border-slate-300'
            }`}
          >
            {type === 'stock_movement' && 'Stock Movement Report'}
            {type === 'sales' && 'Sales Overview'}
            {type === 'daily_sales' && 'Daily Sales Report'}
            {type === 'detailed_sales' && 'Detailed Sales (Bills)'}
            {type === 'detailed_purchases' && 'Detailed Purchases (Bills)'}
            {type === 'vendor_payables' && 'Vendor Payables (وینڈرز واجبات)'}
            {type === 'vendor_payments' && 'Vendor Payments (ماہانہ ادائیگیاں)'}
            {type === 'customer_receivables' && 'Customer Receivables (کسٹمر وصولیاں)'}
            {type === 'vendors' && 'Vendor Purchases (خریداری)'}
            {type === 'customers' && 'Customer Sales (سیلز)'}
            {type === 'items' && 'Best Selling Items'}
            {type === 'categories' && 'Sales by Category'}
            {type === 'payments' && 'Sales by Payment Method'}
            {type === 'vendor_items' && 'Vendor Purchases (Detailed)'}
            {type === 'profitability' && 'Profitability by Item'}
            {type === 'advances' && 'Employee Advances'}
          </button>
        ))}
      </div>

      <div id="report-print-content" className="space-y-6 print:space-y-4 print:bg-white print:p-0 print:w-full print:static print:z-auto print:h-auto">
        <div className="hidden print:block text-center border-b-2 border-black pb-3 mb-4">
          <h1 className="text-xl font-bold uppercase tracking-wider text-black">
             {branches.find(b => b.id === activeBranchId)?.name || 'Main Branch'}
          </h1>
          <h2 className="text-sm font-bold text-black mt-1 uppercase tracking-wider">
            {reportType === 'stock_movement' && 'Inventory Stock Reconciliation & Movement Report'}
            {reportType === 'sales' && 'Sales Report'}
            {reportType === 'daily_sales' && 'Daily Sales Report'}
            {reportType === 'detailed_sales' && 'Detailed Sales (Bills)'}
            {reportType === 'detailed_purchases' && 'Detailed Purchases (Bills)'}
            {reportType === 'vendor_payables' && 'Vendors Outstanding Balances Statement (وینڈرز واجبات کھاتہ)'}
            {reportType === 'vendor_payments' && 'Monthly Vendor Payments Statement (ماہانہ وینڈرز ادائیگیاں رپورٹ)'}
            {reportType === 'customer_receivables' && 'Customers Outstanding Balances Statement (کسٹمرز وصولیاں کھاتہ)'}
            {reportType === 'items' && 'Best Selling Items Report'}
            {reportType === 'categories' && 'Sales by Category Report'}
            {reportType === 'payments' && 'Sales by Payment Method'}
            {reportType === 'customers' && 'Customer Sales Report (سیلز رپورٹ)'}
            {reportType === 'vendors' && 'Vendor Purchases Report (خریداری رپورٹ)'}
            {reportType === 'vendor_items' && 'Vendor Purchases (Detailed)'}
            {reportType === 'profitability' && 'Profitability Report'}
            {reportType === 'advances' && 'Employee Advance Report'}
            {' '}({safeFormat(new Date(startDate), 'dd MMM yyyy')} to {safeFormat(new Date(endDate), 'dd MMM yyyy')})
          </h2>
          <p className="text-[11px] text-black mt-1">Printed on {new Date().toLocaleString()}</p>
        </div>

        {reportType === 'stock_movement' && (
          <div className="space-y-5">
            {/* Professional Accounting Summary Strip */}
            <div className="grid grid-cols-2 md:grid-cols-6 border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 divide-y md:divide-y-0 md:divide-x divide-slate-200 dark:divide-slate-800 rounded">
              <div className="p-3.5">
                <div className="text-[10px] text-slate-500 dark:text-slate-400 uppercase tracking-wider font-semibold">
                  Opening Stock ({safeFormat(new Date(startDate), 'dd MMM')})
                </div>
                <div className="text-xl font-bold text-slate-900 dark:text-slate-100 font-mono mt-1">
                  {reports.stockMovement.totalOpeningStock.toLocaleString()}
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5">Stock at start of period</div>
              </div>

              <div className="p-3.5">
                <div className="text-[10px] text-slate-500 dark:text-slate-400 uppercase tracking-wider font-semibold">
                  Purchases &amp; Returns (+)
                </div>
                <div className="text-xl font-bold text-slate-900 dark:text-slate-100 font-mono mt-1">
                  +{(reports.stockMovement.totalPurchasesInQty + reports.stockMovement.totalReturnsInQty).toLocaleString()}
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5 font-mono">
                  Pur: {reports.stockMovement.totalPurchasesInQty} | Ret: {reports.stockMovement.totalReturnsInQty}
                </div>
              </div>

              <div className="p-3.5">
                <div className="text-[10px] text-slate-500 dark:text-slate-400 uppercase tracking-wider font-semibold">
                  Transfers IN / OUT
                </div>
                <div className="text-xl font-bold text-slate-900 dark:text-slate-100 font-mono mt-1">
                  +{reports.stockMovement.totalTransfersInQty.toLocaleString()} / &minus;{reports.stockMovement.totalTransfersOutQty.toLocaleString()}
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5">Inter-branch stock movement</div>
              </div>

              <div className="p-3.5">
                <div className="text-[10px] text-slate-500 dark:text-slate-400 uppercase tracking-wider font-semibold">
                  Sales Out (&minus;)
                </div>
                <div className="text-xl font-bold text-slate-900 dark:text-slate-100 font-mono mt-1">
                  &minus;{reports.stockMovement.totalSalesOutQty.toLocaleString()}
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5">Sold during selected period</div>
              </div>

              <div className="p-3.5">
                <div className="text-[10px] text-slate-500 dark:text-slate-400 uppercase tracking-wider font-semibold">
                  Closing Stock ({safeFormat(new Date(endDate), 'dd MMM')})
                </div>
                <div className="text-xl font-bold text-slate-900 dark:text-slate-100 font-mono mt-1">
                  {reports.stockMovement.totalClosingStock.toLocaleString()}
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5">Opening + Total IN &minus; Total OUT</div>
              </div>

              <div className="p-3.5 bg-slate-50 dark:bg-slate-800/40">
                <div className="text-[10px] text-slate-700 dark:text-slate-300 uppercase tracking-wider font-bold">
                  Current Stock (Live)
                </div>
                <div className="text-xl font-bold text-slate-900 dark:text-slate-100 font-mono mt-1">
                  {reports.stockMovement.currentBranchStockTotal.toLocaleString()}
                </div>
                <div className="text-[11px] text-slate-600 dark:text-slate-400 mt-0.5 font-mono">
                  Val: PKR {reports.stockMovement.currentBranchStockValuation.toLocaleString()}
                </div>
              </div>
            </div>

            {/* Content Table: Summary View or Ledger View */}
            {stockViewMode === 'summary' ? (
              <div className="border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 rounded overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-300 dark:border-slate-700 flex flex-wrap justify-between items-center gap-2 bg-slate-50 dark:bg-slate-800/60">
                  <div>
                    <h3 className="font-bold text-slate-900 dark:text-slate-100 text-sm uppercase tracking-wider">
                      Item-Wise Stock Reconciliation Statement ({safeFormat(new Date(startDate), 'dd MMM yyyy')} &ndash; {safeFormat(new Date(endDate), 'dd MMM yyyy')})
                    </h3>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                      Formula: Opening Stock ({safeFormat(new Date(startDate), 'dd MMM')}) + Purchases + Transfers IN + Returns &minus; Sales &minus; Transfers OUT = Closing Stock ({safeFormat(new Date(endDate), 'dd MMM')})
                    </p>
                  </div>
                  <span className="text-xs text-slate-600 dark:text-slate-400 font-mono font-semibold">
                    {reports.stockMovement.itemSummaryList.filter(item => {
                      if (stockCategoryFilter !== 'ALL' && item.category !== stockCategoryFilter) return false;
                      if (stockSearchTerm.trim()) {
                        const term = stockSearchTerm.toLowerCase();
                        if (!item.itemName.toLowerCase().includes(term) && !item.sku.toLowerCase().includes(term)) return false;
                      }
                      return true;
                    }).length} Items
                  </span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 uppercase font-bold border-b-2 border-slate-300 dark:border-slate-700">
                      <tr>
                        <th className="py-2.5 px-3 border-r border-slate-200 dark:border-slate-700">#</th>
                        <th className="py-2.5 px-3 border-r border-slate-200 dark:border-slate-700">Item Name</th>
                        <th className="py-2.5 px-2 border-r border-slate-200 dark:border-slate-700">SKU</th>
                        <th className="py-2.5 px-2.5 text-right border-r border-slate-300 dark:border-slate-600 bg-slate-200/60 dark:bg-slate-800">
                          Opening Stock<br />
                          <span className="text-[10px] font-normal text-slate-600 dark:text-slate-400">({safeFormat(new Date(startDate), 'dd MMM')})</span>
                        </th>
                        <th className="py-2.5 px-2 text-right border-r border-slate-200 dark:border-slate-700">Purchase (+)</th>
                        <th className="py-2.5 px-2 text-right border-r border-slate-200 dark:border-slate-700">Transfer IN (+)</th>
                        <th className="py-2.5 px-2 text-right border-r border-slate-200 dark:border-slate-700">Return (+)</th>
                        <th className="py-2.5 px-2 text-right border-r border-slate-300 dark:border-slate-600 bg-slate-100 dark:bg-slate-800/80">Total IN</th>
                        <th className="py-2.5 px-2 text-right border-r border-slate-200 dark:border-slate-700">Sale (&minus;)</th>
                        <th className="py-2.5 px-2 text-right border-r border-slate-200 dark:border-slate-700">Transfer OUT (&minus;)</th>
                        <th className="py-2.5 px-2 text-right border-r border-slate-300 dark:border-slate-600 bg-slate-100 dark:bg-slate-800/80">Total OUT</th>
                        <th className="py-2.5 px-2.5 text-right border-r border-slate-300 dark:border-slate-600 bg-slate-200/60 dark:bg-slate-800">
                          Closing Stock<br />
                          <span className="text-[10px] font-normal text-slate-600 dark:text-slate-400">({safeFormat(new Date(endDate), 'dd MMM')})</span>
                        </th>
                        <th className="py-2.5 px-2.5 text-right border-r border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800/90">
                          Current Stock<br />
                          <span className="text-[10px] font-normal text-slate-600 dark:text-slate-400">(Live Now)</span>
                        </th>
                        <th className="py-2.5 px-3 text-right">Stock Value</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-slate-800 text-slate-800 dark:text-slate-200">
                      {(() => {
                        const filteredSummary = reports.stockMovement.itemSummaryList.filter(item => {
                          if (stockCategoryFilter !== 'ALL' && item.category !== stockCategoryFilter) return false;
                          if (stockSearchTerm.trim()) {
                            const term = stockSearchTerm.toLowerCase();
                            if (!item.itemName.toLowerCase().includes(term) && !item.sku.toLowerCase().includes(term)) return false;
                          }
                          return true;
                        });

                        if (filteredSummary.length === 0) {
                          return (
                            <tr>
                              <td colSpan={14} className="py-8 text-center text-slate-500">
                                No inventory items found matching the selected filters.
                              </td>
                            </tr>
                          );
                        }

                        return filteredSummary.map((item, idx) => (
                          <tr key={item.id || idx} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                            <td className="py-2 px-3 font-mono text-[11px] text-slate-500 border-r border-slate-200 dark:border-slate-800">{idx + 1}</td>
                            <td className="py-2 px-3 font-semibold text-slate-900 dark:text-slate-100 border-r border-slate-200 dark:border-slate-800">
                              {item.itemName}
                              {item.category && item.category !== 'General' && (
                                <span className="ml-1.5 text-[10px] font-normal text-slate-500">({item.category})</span>
                              )}
                            </td>
                            <td className="py-2 px-2 font-mono text-[11px] text-slate-600 dark:text-slate-400 border-r border-slate-200 dark:border-slate-800">{item.sku || '-'}</td>
                            <td className="py-2 px-2.5 text-right font-mono font-bold text-slate-900 dark:text-slate-100 border-r border-slate-300 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/30">
                              {item.openingStock.toLocaleString()}
                            </td>
                            <td className="py-2 px-2 text-right font-mono text-slate-700 dark:text-slate-300 border-r border-slate-200 dark:border-slate-800">
                              {item.purchasesInQty > 0 ? `+${item.purchasesInQty.toLocaleString()}` : '0'}
                            </td>
                            <td className="py-2 px-2 text-right font-mono text-slate-700 dark:text-slate-300 border-r border-slate-200 dark:border-slate-800">
                              {item.transfersInQty > 0 ? `+${item.transfersInQty.toLocaleString()}` : '0'}
                            </td>
                            <td className="py-2 px-2 text-right font-mono text-slate-700 dark:text-slate-300 border-r border-slate-200 dark:border-slate-800">
                              {item.returnsInQty > 0 ? `+${item.returnsInQty.toLocaleString()}` : '0'}
                            </td>
                            <td className="py-2 px-2 text-right font-mono font-bold text-slate-900 dark:text-slate-100 border-r border-slate-300 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/20">
                              {item.totalInQty > 0 ? `+${item.totalInQty.toLocaleString()}` : '0'}
                            </td>
                            <td className="py-2 px-2 text-right font-mono text-slate-700 dark:text-slate-300 border-r border-slate-200 dark:border-slate-800">
                              {item.salesOutQty > 0 ? `-${item.salesOutQty.toLocaleString()}` : '0'}
                            </td>
                            <td className="py-2 px-2 text-right font-mono text-slate-700 dark:text-slate-300 border-r border-slate-200 dark:border-slate-800">
                              {item.transfersOutQty > 0 ? `-${item.transfersOutQty.toLocaleString()}` : '0'}
                            </td>
                            <td className="py-2 px-2 text-right font-mono font-bold text-slate-900 dark:text-slate-100 border-r border-slate-300 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/20">
                              {item.totalOutQty > 0 ? `-${item.totalOutQty.toLocaleString()}` : '0'}
                            </td>
                            <td className="py-2 px-2.5 text-right font-mono font-bold text-slate-900 dark:text-slate-100 border-r border-slate-300 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/30">
                              {item.closingStock.toLocaleString()}
                            </td>
                            <td className="py-2 px-2.5 text-right font-mono font-bold text-slate-900 dark:text-slate-100 border-r border-slate-200 dark:border-slate-800 bg-slate-100/70 dark:bg-slate-800/50">
                              {item.currentStock.toLocaleString()}
                            </td>
                            <td className="py-2 px-3 text-right font-mono text-slate-800 dark:text-slate-200">
                              PKR {item.currentValuation.toLocaleString()}
                            </td>
                          </tr>
                        ));
                      })()}
                    </tbody>
                    <tfoot className="bg-slate-100 dark:bg-slate-800 font-bold border-t-2 border-slate-400 dark:border-slate-600 text-slate-900 dark:text-slate-100">
                      {(() => {
                        const filteredSummary = reports.stockMovement.itemSummaryList.filter(item => {
                          if (stockCategoryFilter !== 'ALL' && item.category !== stockCategoryFilter) return false;
                          if (stockSearchTerm.trim()) {
                            const term = stockSearchTerm.toLowerCase();
                            if (!item.itemName.toLowerCase().includes(term) && !item.sku.toLowerCase().includes(term)) return false;
                          }
                          return true;
                        });
                        const sumOpening = filteredSummary.reduce((s, i) => s + i.openingStock, 0);
                        const sumPur = filteredSummary.reduce((s, i) => s + i.purchasesInQty, 0);
                        const sumTrfIn = filteredSummary.reduce((s, i) => s + i.transfersInQty, 0);
                        const sumRet = filteredSummary.reduce((s, i) => s + i.returnsInQty, 0);
                        const sumTotIn = filteredSummary.reduce((s, i) => s + i.totalInQty, 0);
                        const sumSale = filteredSummary.reduce((s, i) => s + i.salesOutQty, 0);
                        const sumTrfOut = filteredSummary.reduce((s, i) => s + i.transfersOutQty, 0);
                        const sumTotOut = filteredSummary.reduce((s, i) => s + i.totalOutQty, 0);
                        const sumClosing = filteredSummary.reduce((s, i) => s + i.closingStock, 0);
                        const sumCurrent = filteredSummary.reduce((s, i) => s + i.currentStock, 0);
                        const sumVal = filteredSummary.reduce((s, i) => s + i.currentValuation, 0);

                        return (
                          <tr>
                            <td colSpan={3} className="py-3 px-3 uppercase text-[11px] tracking-wider border-r border-slate-300 dark:border-slate-700">
                              Grand Total
                            </td>
                            <td className="py-3 px-2.5 text-right font-mono text-xs border-r border-slate-300 dark:border-slate-700">
                              {sumOpening.toLocaleString()}
                            </td>
                            <td className="py-3 px-2 text-right font-mono text-xs border-r border-slate-200 dark:border-slate-700">
                              +{sumPur.toLocaleString()}
                            </td>
                            <td className="py-3 px-2 text-right font-mono text-xs border-r border-slate-200 dark:border-slate-700">
                              +{sumTrfIn.toLocaleString()}
                            </td>
                            <td className="py-3 px-2 text-right font-mono text-xs border-r border-slate-200 dark:border-slate-700">
                              +{sumRet.toLocaleString()}
                            </td>
                            <td className="py-3 px-2 text-right font-mono text-xs border-r border-slate-300 dark:border-slate-700">
                              +{sumTotIn.toLocaleString()}
                            </td>
                            <td className="py-3 px-2 text-right font-mono text-xs border-r border-slate-200 dark:border-slate-700">
                              &minus;{sumSale.toLocaleString()}
                            </td>
                            <td className="py-3 px-2 text-right font-mono text-xs border-r border-slate-200 dark:border-slate-700">
                              &minus;{sumTrfOut.toLocaleString()}
                            </td>
                            <td className="py-3 px-2 text-right font-mono text-xs border-r border-slate-300 dark:border-slate-700">
                              &minus;{sumTotOut.toLocaleString()}
                            </td>
                            <td className="py-3 px-2.5 text-right font-mono text-xs border-r border-slate-300 dark:border-slate-700">
                              {sumClosing.toLocaleString()}
                            </td>
                            <td className="py-3 px-2.5 text-right font-mono text-xs border-r border-slate-200 dark:border-slate-700">
                              {sumCurrent.toLocaleString()}
                            </td>
                            <td className="py-3 px-3 text-right font-mono text-xs">
                              PKR {sumVal.toLocaleString()}
                            </td>
                          </tr>
                        );
                      })()}
                    </tfoot>
                  </table>
                </div>
              </div>
            ) : (
              <div className="border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 rounded overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-300 dark:border-slate-700 flex flex-wrap justify-between items-center gap-2 bg-slate-50 dark:bg-slate-800/60">
                  <h3 className="font-bold text-slate-900 dark:text-slate-100 text-sm uppercase tracking-wider">
                    Stock Movement Transaction Log ({safeFormat(new Date(startDate), 'dd MMM yyyy')} &ndash; {safeFormat(new Date(endDate), 'dd MMM yyyy')})
                  </h3>
                  <span className="text-xs text-slate-600 dark:text-slate-400 font-mono font-semibold">
                    {reports.stockMovement.allMovements.filter(m => {
                      if (stockMovementTypeFilter === 'purchase' && m.type !== 'PURCHASE_IN') return false;
                      if (stockMovementTypeFilter === 'sale' && m.type !== 'SALE_OUT') return false;
                      if (stockMovementTypeFilter === 'transfer_in' && m.type !== 'TRANSFER_IN') return false;
                      if (stockMovementTypeFilter === 'transfer_out' && m.type !== 'TRANSFER_OUT') return false;
                      if (stockMovementTypeFilter === 'return' && m.type !== 'RETURN_IN') return false;
                      if (stockCategoryFilter !== 'ALL' && m.category !== stockCategoryFilter) return false;
                      if (stockSearchTerm.trim()) {
                        const term = stockSearchTerm.toLowerCase();
                        if (!m.itemName.toLowerCase().includes(term) && !m.sku.toLowerCase().includes(term) && !m.refNo.toLowerCase().includes(term) && !m.party.toLowerCase().includes(term)) return false;
                      }
                      return true;
                    }).length} Entries
                  </span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 uppercase font-bold border-b-2 border-slate-300 dark:border-slate-700">
                      <tr>
                        <th className="py-2.5 px-3 border-r border-slate-200 dark:border-slate-700">Date &amp; Time</th>
                        <th className="py-2.5 px-3 border-r border-slate-200 dark:border-slate-700">Item Name</th>
                        <th className="py-2.5 px-2 border-r border-slate-200 dark:border-slate-700">SKU</th>
                        <th className="py-2.5 px-2 border-r border-slate-200 dark:border-slate-700">Activity Type</th>
                        <th className="py-2.5 px-2 border-r border-slate-200 dark:border-slate-700">Ref / Bill #</th>
                        <th className="py-2.5 px-3 border-r border-slate-200 dark:border-slate-700">Party / Branch</th>
                        <th className="py-2.5 px-2 text-right border-r border-slate-200 dark:border-slate-700">Rate</th>
                        <th className="py-2.5 px-2 text-right border-r border-slate-200 dark:border-slate-700">Qty IN (+)</th>
                        <th className="py-2.5 px-2 text-right border-r border-slate-200 dark:border-slate-700">Qty OUT (&minus;)</th>
                        <th className="py-2.5 px-3 text-right">Amount (PKR)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-slate-800 text-slate-800 dark:text-slate-200">
                      {reports.stockMovement.allMovements
                        .filter(m => {
                          if (stockMovementTypeFilter === 'purchase' && m.type !== 'PURCHASE_IN') return false;
                          if (stockMovementTypeFilter === 'sale' && m.type !== 'SALE_OUT') return false;
                          if (stockMovementTypeFilter === 'transfer_in' && m.type !== 'TRANSFER_IN') return false;
                          if (stockMovementTypeFilter === 'transfer_out' && m.type !== 'TRANSFER_OUT') return false;
                          if (stockMovementTypeFilter === 'return' && m.type !== 'RETURN_IN') return false;
                          if (stockCategoryFilter !== 'ALL' && m.category !== stockCategoryFilter) return false;
                          if (stockSearchTerm.trim()) {
                            const term = stockSearchTerm.toLowerCase();
                            if (!m.itemName.toLowerCase().includes(term) && !m.sku.toLowerCase().includes(term) && !m.refNo.toLowerCase().includes(term) && !m.party.toLowerCase().includes(term)) return false;
                          }
                          return true;
                        })
                        .map(m => (
                          <tr key={m.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                            <td className="py-2 px-3 whitespace-nowrap text-slate-600 dark:text-slate-400 font-mono text-[11px] border-r border-slate-200 dark:border-slate-800">{m.displayDate}</td>
                            <td className="py-2 px-3 font-semibold text-slate-900 dark:text-slate-100 border-r border-slate-200 dark:border-slate-800">{m.itemName}</td>
                            <td className="py-2 px-2 font-mono text-[11px] text-slate-500 border-r border-slate-200 dark:border-slate-800">{m.sku}</td>
                            <td className="py-2 px-2 whitespace-nowrap font-medium text-slate-800 dark:text-slate-200 border-r border-slate-200 dark:border-slate-800">
                              {m.typeLabel}
                            </td>
                            <td className="py-2 px-2 font-mono text-slate-700 dark:text-slate-300 text-[11px] border-r border-slate-200 dark:border-slate-800">{m.refNo}</td>
                            <td className="py-2 px-3 text-slate-700 dark:text-slate-300 border-r border-slate-200 dark:border-slate-800">{m.party}</td>
                            <td className="py-2 px-2 text-right font-mono text-slate-700 dark:text-slate-300 border-r border-slate-200 dark:border-slate-800">{m.rate ? m.rate.toLocaleString() : '-'}</td>
                            <td className="py-2 px-2 text-right font-mono font-bold text-slate-900 dark:text-slate-100 border-r border-slate-200 dark:border-slate-800">
                              {m.qtyIn > 0 ? `+${m.qtyIn.toLocaleString()}` : '-'}
                            </td>
                            <td className="py-2 px-2 text-right font-mono font-bold text-slate-900 dark:text-slate-100 border-r border-slate-200 dark:border-slate-800">
                              {m.qtyOut > 0 ? `-${m.qtyOut.toLocaleString()}` : '-'}
                            </td>
                            <td className="py-2 px-3 text-right font-mono font-semibold text-slate-900 dark:text-slate-100">
                              PKR {m.totalValue.toLocaleString()}
                            </td>
                          </tr>
                        ))}

                      {reports.stockMovement.allMovements.filter(m => {
                        if (stockMovementTypeFilter === 'purchase' && m.type !== 'PURCHASE_IN') return false;
                        if (stockMovementTypeFilter === 'sale' && m.type !== 'SALE_OUT') return false;
                        if (stockMovementTypeFilter === 'transfer_in' && m.type !== 'TRANSFER_IN') return false;
                        if (stockMovementTypeFilter === 'transfer_out' && m.type !== 'TRANSFER_OUT') return false;
                        if (stockMovementTypeFilter === 'return' && m.type !== 'RETURN_IN') return false;
                        if (stockCategoryFilter !== 'ALL' && m.category !== stockCategoryFilter) return false;
                        if (stockSearchTerm.trim()) {
                          const term = stockSearchTerm.toLowerCase();
                          if (!m.itemName.toLowerCase().includes(term) && !m.sku.toLowerCase().includes(term) && !m.refNo.toLowerCase().includes(term) && !m.party.toLowerCase().includes(term)) return false;
                        }
                        return true;
                      }).length === 0 && (
                        <tr>
                          <td colSpan={10} className="py-8 text-center text-slate-500">
                            No stock movements found matching the selected filters.
                          </td>
                        </tr>
                      )}
                    </tbody>
                    <tfoot className="bg-slate-100 dark:bg-slate-800 font-bold border-t-2 border-slate-400 dark:border-slate-600 text-slate-900 dark:text-slate-100">
                      <tr>
                        <td colSpan={7} className="py-3 px-3 text-right uppercase text-[11px] tracking-wider border-r border-slate-300 dark:border-slate-700">
                          Period Movement Total
                        </td>
                        <td className="py-3 px-2 text-right font-mono text-xs border-r border-slate-200 dark:border-slate-700">
                          +{reports.stockMovement.allMovements
                            .filter(m => {
                              if (stockMovementTypeFilter === 'purchase' && m.type !== 'PURCHASE_IN') return false;
                              if (stockMovementTypeFilter === 'sale' && m.type !== 'SALE_OUT') return false;
                              if (stockMovementTypeFilter === 'transfer_in' && m.type !== 'TRANSFER_IN') return false;
                              if (stockMovementTypeFilter === 'transfer_out' && m.type !== 'TRANSFER_OUT') return false;
                              if (stockMovementTypeFilter === 'return' && m.type !== 'RETURN_IN') return false;
                              if (stockCategoryFilter !== 'ALL' && m.category !== stockCategoryFilter) return false;
                              if (stockSearchTerm.trim()) {
                                const term = stockSearchTerm.toLowerCase();
                                if (!m.itemName.toLowerCase().includes(term) && !m.sku.toLowerCase().includes(term) && !m.refNo.toLowerCase().includes(term) && !m.party.toLowerCase().includes(term)) return false;
                              }
                              return true;
                            })
                            .reduce((sum, m) => sum + m.qtyIn, 0).toLocaleString()}
                        </td>
                        <td className="py-3 px-2 text-right font-mono text-xs border-r border-slate-200 dark:border-slate-700">
                          &minus;{reports.stockMovement.allMovements
                            .filter(m => {
                              if (stockMovementTypeFilter === 'purchase' && m.type !== 'PURCHASE_IN') return false;
                              if (stockMovementTypeFilter === 'sale' && m.type !== 'SALE_OUT') return false;
                              if (stockMovementTypeFilter === 'transfer_in' && m.type !== 'TRANSFER_IN') return false;
                              if (stockMovementTypeFilter === 'transfer_out' && m.type !== 'TRANSFER_OUT') return false;
                              if (stockMovementTypeFilter === 'return' && m.type !== 'RETURN_IN') return false;
                              if (stockCategoryFilter !== 'ALL' && m.category !== stockCategoryFilter) return false;
                              if (stockSearchTerm.trim()) {
                                const term = stockSearchTerm.toLowerCase();
                                if (!m.itemName.toLowerCase().includes(term) && !m.sku.toLowerCase().includes(term) && !m.refNo.toLowerCase().includes(term) && !m.party.toLowerCase().includes(term)) return false;
                              }
                              return true;
                            })
                            .reduce((sum, m) => sum + m.qtyOut, 0).toLocaleString()}
                        </td>
                        <td className="py-3 px-3 text-right font-mono text-xs">
                          PKR {reports.stockMovement.allMovements
                            .filter(m => {
                              if (stockMovementTypeFilter === 'purchase' && m.type !== 'PURCHASE_IN') return false;
                              if (stockMovementTypeFilter === 'sale' && m.type !== 'SALE_OUT') return false;
                              if (stockMovementTypeFilter === 'transfer_in' && m.type !== 'TRANSFER_IN') return false;
                              if (stockMovementTypeFilter === 'transfer_out' && m.type !== 'TRANSFER_OUT') return false;
                              if (stockMovementTypeFilter === 'return' && m.type !== 'RETURN_IN') return false;
                              if (stockCategoryFilter !== 'ALL' && m.category !== stockCategoryFilter) return false;
                              if (stockSearchTerm.trim()) {
                                const term = stockSearchTerm.toLowerCase();
                                if (!m.itemName.toLowerCase().includes(term) && !m.sku.toLowerCase().includes(term) && !m.refNo.toLowerCase().includes(term) && !m.party.toLowerCase().includes(term)) return false;
                              }
                              return true;
                            })
                            .reduce((sum, m) => sum + m.totalValue, 0).toLocaleString()}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {reportType === 'sales' && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 md:gap-6 mb-4 md:mb-6">
              <div className="card p-3 md:p-5">
                 <div className="text-[10px] text-slate-400 uppercase tracking-widest mb-1">Period Revenue</div>
                 <div className="text-base md:text-3xl font-bold tracking-tight text-emerald-600">PKR {reports.totalRevenue.toLocaleString()}</div>
              </div>
              <div className="card p-3 md:p-5">
                 <div className="text-[10px] text-slate-400 uppercase tracking-widest mb-1">Transactions</div>
                 <div className="text-base md:text-3xl font-bold tracking-tight text-slate-800 dark:text-slate-100">{reports.filteredCount}</div>
              </div>
              <div className="card p-3 md:p-5 col-span-2 md:col-span-1">
                 <div className="text-[10px] text-slate-400 uppercase tracking-widest mb-1">Avg Transaction</div>
                 <div className="text-base md:text-3xl font-bold tracking-tight text-sky-600">PKR {reports.filteredCount ? Math.round(reports.totalRevenue / reports.filteredCount).toLocaleString() : 0}</div>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6 print:hidden">
              <div className="card p-5 flex flex-col min-h-[350px]">
                <div className="font-serif italic text-sm text-slate-600 dark:text-slate-300 mb-6 border-b border-slate-100 dark:border-slate-800/50 pb-2">Revenue Trend</div>
                <div className="flex-1 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={reports.trendChart} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                      <XAxis dataKey="period" stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} />
                      <YAxis stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(v) => `PKR ${v/1000}k`} />
                      <Tooltip 
                        contentStyle={{ backgroundColor: '#1e293b', border: 'none', borderRadius: '8px', color: '#f8fafc' }}
                        itemStyle={{ color: '#38bdf8' }}
                      />
                      <Line type="monotone" dataKey="sales" stroke="#0284c7" strokeWidth={3} dot={{ r: 4, fill: '#0ea5e9' }} activeDot={{ r: 6 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="card p-5 flex flex-col min-h-[350px]">
                <div className="font-serif italic text-sm text-slate-600 dark:text-slate-300 mb-6 border-b border-slate-100 dark:border-slate-800/50 pb-2">Top Selling Items (Revenue)</div>
                <div className="flex-1 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={reports.topItems} layout="vertical" margin={{ top: 5, right: 20, bottom: 5, left: 40 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" />
                      <XAxis type="number" stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(v) => `PKR ${v/1000}k`} />
                      <YAxis dataKey="name" type="category" stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} width={80} />
                      <Tooltip 
                        cursor={{ fill: '#f1f5f9' }}
                        contentStyle={{ backgroundColor: '#ffffff', borderColor: '#e2e8f0', borderRadius: '8px', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                      />
                      <Bar dataKey="revenue" fill="#10b981" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
              
              {!activeBranchId && reports.branchChart.length > 0 && (
                <div className="card p-5 flex flex-col min-h-[350px] col-span-1 lg:col-span-2">
                  <div className="font-serif italic text-sm text-slate-600 dark:text-slate-300 mb-6 border-b border-slate-100 dark:border-slate-800/50 pb-2">Branch Performance Snapshot</div>
                  <div className="flex-1 w-full">
                    <ResponsiveContainer width="100%" height={300}>
                      <BarChart data={reports.branchChart} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                        <XAxis dataKey="name" stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} />
                        <YAxis stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(v) => `PKR ${v/1000}k`} />
                        <Tooltip 
                          cursor={{ fill: '#f1f5f9' }}
                          contentStyle={{ backgroundColor: '#ffffff', borderColor: '#e2e8f0', borderRadius: '8px', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                        />
                        <Bar dataKey="revenue" fill="#6366f1" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}
            </div>
          </>
        )}

        {reportType === 'daily_sales' && (
          <div className="card">
            <div className="p-5 border-b border-slate-100 dark:border-slate-800/50 flex justify-between items-center">
              <h3 className="font-semibold text-slate-800 dark:text-slate-100">Daily Sales Breakdown</h3>
              <div className="text-xs text-slate-500 dark:text-slate-400">Includes In-Store and Online sales</div>
            </div>
            <div className="overflow-x-auto print:overflow-visible">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 dark:bg-slate-800/50 border-y border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300">
                  <tr>
                    <th className="py-3 px-4 font-semibold uppercase text-[11px] tracking-wider">Date</th>
                    <th className="py-3 px-4 font-semibold uppercase text-[11px] tracking-wider text-right">In-Store Sales</th>
                    <th className="py-3 px-4 font-semibold uppercase text-[11px] tracking-wider text-right">Online Sales</th>
                    <th className="py-3 px-4 font-semibold uppercase text-[11px] tracking-wider text-right">Total Revenue</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 print:divide-black/20">
                  {reports.dailySalesReport.map((row, i) => (
                    <tr key={i} className="hover:bg-slate-50/50">
                      <td className="py-3 px-4 font-medium text-slate-700 dark:text-slate-200">{row.display}</td>
                      <td className="py-3 px-4 text-right text-emerald-600">{(row.inStore || 0).toLocaleString()}</td>
                      <td className="py-3 px-4 text-right text-sky-600">{(row.online || 0).toLocaleString()}</td>
                      <td className="py-3 px-4 text-right font-bold text-slate-800 dark:text-slate-100">{(row.total || 0).toLocaleString()}</td>
                    </tr>
                  ))}
                  {reports.dailySalesReport.length === 0 && (
                    <tr>
                      <td colSpan={4} className="py-8 text-center text-slate-500 dark:text-slate-400 italic">No sales found for this period</td>
                    </tr>
                  )}
                  {reports.dailySalesReport.length > 0 && (
                    <tr className="bg-slate-50 dark:bg-slate-800/50 font-bold">
                      <td className="py-3 px-4 text-slate-800 dark:text-slate-100 uppercase text-xs tracking-wider">Totals</td>
                      <td className="py-3 px-4 text-right text-emerald-600">{reports.dailySalesReport.reduce((sum, r) => sum + r.inStore, 0).toLocaleString()}</td>
                      <td className="py-3 px-4 text-right text-sky-600">{reports.dailySalesReport.reduce((sum, r) => sum + r.online, 0).toLocaleString()}</td>
                      <td className="py-3 px-4 text-right text-slate-900 dark:text-slate-50">{reports.dailySalesReport.reduce((sum, r) => sum + r.total, 0).toLocaleString()}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
        {reportType === 'detailed_sales' && (
          <div className="card">
            <div className="p-5 border-b border-slate-100 dark:border-slate-800/50 flex justify-between items-center">
              <h3 className="font-semibold text-slate-800 dark:text-slate-100">Detailed Sales (Bills)</h3>
            </div>
            <div className="overflow-x-auto print:overflow-visible">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 dark:bg-slate-800/50 border-y border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300">
                  <tr>
                    <th className="py-3 px-4 font-semibold uppercase text-[11px] tracking-wider">Date & Time</th>
                    <th className="py-3 px-4 font-semibold uppercase text-[11px] tracking-wider">Inv #</th>
                    <th className="py-3 px-4 font-semibold uppercase text-[11px] tracking-wider">Type</th>
                    <th className="py-3 px-4 font-semibold uppercase text-[11px] tracking-wider">Customer</th>
                    <th className="py-3 px-4 font-semibold uppercase text-[11px] tracking-wider">Payment</th>
                    <th className="py-3 px-4 font-semibold uppercase text-[11px] tracking-wider text-right">Items Qty</th>
                    <th className="py-3 px-4 font-semibold uppercase text-[11px] tracking-wider text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 print:divide-black/20">
                  {reports.detailedSales.map((sale) => (
                    <tr key={sale.id} className="hover:bg-slate-50/50">
                      <td className="py-3 px-4 text-slate-600 dark:text-slate-300">
                        {safeFormat(sale.date || 0, 'dd MMM yyyy, hh:mm a')}
                      </td>
                      <td className="py-3 px-4 font-medium text-slate-700 dark:text-slate-200">{String(sale.invoiceNo || sale.id.slice(0, 8)).toUpperCase()}</td>
                      <td className="py-3 px-4">
                        {sale.saleType === 'Online' ? (
                          <span className="px-2 py-1 rounded bg-sky-100 text-sky-700 text-xs border border-sky-200 font-medium">Online</span>
                        ) : (
                          <span className="px-2 py-1 rounded bg-slate-100 dark:bg-slate-950 text-slate-700 dark:text-slate-200 text-xs border border-slate-200 dark:border-slate-700 font-medium">In-Store</span>
                        )}
                        {sale.transactionType === 'Return' && (
                          <span className="ml-2 px-2 py-1 rounded bg-rose-100 text-rose-700 text-xs border border-rose-200 font-medium">Return</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-slate-600 dark:text-slate-300">{sale.customerName || 'Walk-in Customer'}</td>
                      <td className="py-3 px-4 text-slate-600 dark:text-slate-300">
                        <span className="inline-block px-1.5 py-0.5 bg-slate-100 dark:bg-slate-950 text-[10px] uppercase font-bold tracking-wider rounded border border-slate-200 dark:border-slate-700">
                          {sale.paymentMethod || 'Cash'}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right text-slate-600 dark:text-slate-300 font-medium">
                        {(sale.items || []).reduce((sum, i) => sum + (i.qty || 0), 0)}
                      </td>
                      <td className="py-3 px-4 text-right font-bold text-slate-800 dark:text-slate-100">
                        PKR {((sale.transactionType === 'Return' ? -Math.abs(sale.total || 0) : sale.total || 0)).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                  {reports.detailedSales.length === 0 && (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-slate-500 dark:text-slate-400 italic">No sales found for this period</td>
                    </tr>
                  )}
                  {reports.detailedSales.length > 0 && (
                    <tr className="bg-slate-50 dark:bg-slate-800/50 font-bold">
                      <td colSpan={6} className="py-3 px-4 text-right text-slate-800 dark:text-slate-100 uppercase text-xs tracking-wider">Total Amount</td>
                      <td className="py-3 px-4 text-right text-emerald-600 text-base">
                        PKR {reports.detailedSales.reduce((sum, s) => sum + (s.transactionType === 'Return' ? -Math.abs(s.total || 0) : (s.total || 0)), 0).toLocaleString()}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
        {reportType === 'detailed_purchases' && (
          <div className="card">
            <div className="p-5 border-b border-slate-100 dark:border-slate-800/50 flex justify-between items-center">
              <h3 className="font-semibold text-slate-800 dark:text-slate-100">Detailed Purchases (Bills)</h3>
            </div>
            <div className="overflow-x-auto print:overflow-visible">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 dark:bg-slate-800/50 border-y border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300">
                  <tr>
                    <th className="py-3 px-4 font-semibold uppercase text-[11px] tracking-wider">Date & Time</th>
                    <th className="py-3 px-4 font-semibold uppercase text-[11px] tracking-wider">Inv #</th>
                    <th className="py-3 px-4 font-semibold uppercase text-[11px] tracking-wider">Vendor</th>
                    <th className="py-3 px-4 font-semibold uppercase text-[11px] tracking-wider">Payment</th>
                    <th className="py-3 px-4 font-semibold uppercase text-[11px] tracking-wider text-right">Items Qty</th>
                    <th className="py-3 px-4 font-semibold uppercase text-[11px] tracking-wider text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 print:divide-black/20">
                  {reports.detailedPurchases.map((purchase) => (
                    <tr key={purchase.id} className="hover:bg-slate-50/50">
                      <td className="py-3 px-4 text-slate-600 dark:text-slate-300">
                        {safeFormat(purchase.date || (purchase.createdAt?.seconds ? purchase.createdAt.seconds * 1000 : 0), 'dd MMM yyyy, hh:mm a')}
                      </td>
                      <td className="py-3 px-4 font-medium text-slate-700 dark:text-slate-200">{String(purchase.invoiceNo || purchase.id.slice(0, 8)).toUpperCase()}</td>
                      <td className="py-3 px-4 text-slate-600 dark:text-slate-300">{purchase.vendorName || 'Unknown Vendor'}</td>
                      <td className="py-3 px-4 text-slate-600 dark:text-slate-300">
                        <span className="inline-block px-1.5 py-0.5 bg-slate-100 dark:bg-slate-950 text-[10px] uppercase font-bold tracking-wider rounded border border-slate-200 dark:border-slate-700">
                          {purchase.paymentMethod || 'Cash'}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right text-slate-600 dark:text-slate-300 font-medium">
                        {(purchase.items || []).reduce((sum: number, i: any) => sum + (i.qty || 0), 0)}
                      </td>
                      <td className="py-3 px-4 text-right font-bold text-slate-800 dark:text-slate-100">
                        PKR {(purchase.total || 0).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                  {reports.detailedPurchases.length === 0 && (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-slate-500 dark:text-slate-400 italic">No purchases found for this period</td>
                    </tr>
                  )}
                  {reports.detailedPurchases.length > 0 && (
                    <tr className="bg-slate-50 dark:bg-slate-800/50 font-bold">
                      <td colSpan={5} className="py-3 px-4 text-right text-slate-800 dark:text-slate-100 uppercase text-xs tracking-wider">Total Purchase Amount</td>
                      <td className="py-3 px-4 text-right text-rose-600 text-base">
                        PKR {reports.detailedPurchases.reduce((sum, p) => sum + (p.total || 0), 0).toLocaleString()}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
        {reportType === 'items' && (
          <div className="card">
            <div className="p-5 border-b border-slate-100 dark:border-slate-800/50">
              <h3 className="font-semibold text-slate-800 dark:text-slate-100">Best Selling Items Detailed Report</h3>
            </div>
            <div className="overflow-x-auto print:overflow-visible">
              <table className="w-full text-left border-collapse print:border-b-2 print:border-black">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400 text-xs uppercase tracking-wider print:bg-transparent print:text-black print:border-b-2 print:border-black">
                    <th className="px-6 py-3 font-medium">Rank</th>
                    <th className="px-6 py-3 font-medium print:font-extrabold print:text-sm">Item Name</th>
                    <th className="px-6 py-3 font-medium text-right">Sale Price</th>
                    <th className="px-6 py-3 font-medium text-right">Gross Qty</th>
                    <th className="px-6 py-3 font-medium text-right text-rose-500">Return Qty</th>
                    <th className="px-6 py-3 font-medium text-right">Net Qty</th>
                    <th className="px-6 py-3 font-medium text-right">Gross Sales</th>
                    <th className="px-6 py-3 font-medium text-right text-rose-500">Returns</th>
                    <th className="px-6 py-3 font-medium text-right">Net Revenue</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 print:divide-black/20">
                  {reports.allItems.map((item, index) => (
                    <tr key={index} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                      <td className="px-6 py-4 text-sm text-slate-500 dark:text-slate-400 font-mono">#{index + 1}</td>
                      <td className="px-6 py-4 text-sm font-medium text-slate-900 dark:text-slate-50">{item.name}</td>
                      <td className="px-6 py-4 text-sm text-right text-slate-600 dark:text-slate-300 font-mono">{(item.price || 0).toLocaleString()}</td>
                      <td className="px-6 py-4 text-sm text-right text-slate-600 dark:text-slate-300 font-mono">{item.grossQty.toLocaleString()}</td>
                      <td className="px-6 py-4 text-sm text-right text-rose-500 font-mono">{item.returnQty.toLocaleString()}</td>
                      <td className="px-6 py-4 text-sm text-right text-slate-800 dark:text-slate-100 font-bold font-mono">{item.qty.toLocaleString()}</td>
                      <td className="px-6 py-4 text-sm text-right text-slate-600 dark:text-slate-300 font-mono">PKR {item.grossRevenue.toLocaleString()}</td>
                      <td className="px-6 py-4 text-sm text-right text-rose-500 font-mono">PKR {item.returnRevenue.toLocaleString()}</td>
                      <td className="px-6 py-4 text-sm text-right font-bold text-emerald-600 font-mono">PKR {item.revenue.toLocaleString()}</td>
                    </tr>
                  ))}
                  {reports.allItems.length === 0 && (
                    <tr>
                      <td colSpan={9} className="px-6 py-8 text-center text-slate-500 dark:text-slate-400 text-sm">No items sold in the selected period.</td>
                    </tr>
                  )}
                  {reports.allItems.length > 0 && (
                    <tr className="bg-slate-50 dark:bg-slate-800/50 font-bold">
                      <td colSpan={3} className="py-3 px-6 text-right text-slate-800 dark:text-slate-100 uppercase text-xs tracking-wider">Total</td>
                      <td className="py-3 px-6 text-right text-slate-700 dark:text-slate-200 text-sm font-mono">
                        {reports.allItems.reduce((sum, item) => sum + item.grossQty, 0).toLocaleString()}
                      </td>
                      <td className="py-3 px-6 text-right text-rose-500 text-sm font-mono">
                        {reports.allItems.reduce((sum, item) => sum + item.returnQty, 0).toLocaleString()}
                      </td>
                      <td className="py-3 px-6 text-right text-slate-800 dark:text-slate-100 text-base font-mono">
                        {reports.allItems.reduce((sum, item) => sum + item.qty, 0).toLocaleString()}
                      </td>
                      <td className="py-3 px-6 text-right text-slate-700 dark:text-slate-200 text-sm font-mono">
                        PKR {reports.allItems.reduce((sum, item) => sum + item.grossRevenue, 0).toLocaleString()}
                      </td>
                      <td className="py-3 px-6 text-right text-rose-500 text-sm font-mono">
                        PKR {reports.allItems.reduce((sum, item) => sum + item.returnRevenue, 0).toLocaleString()}
                      </td>
                      <td className="py-3 px-6 text-right text-emerald-600 text-base font-mono">
                        PKR {reports.allItems.reduce((sum, item) => sum + item.revenue, 0).toLocaleString()}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {reportType === 'categories' && (
          <div className="space-y-6">
            <div className="card p-5 flex flex-col min-h-[350px] print:hidden">
              <div className="font-serif italic text-sm text-slate-600 dark:text-slate-300 mb-6 border-b border-slate-100 dark:border-slate-800/50 pb-2">Revenue by Category</div>
              <div className="flex-1 w-full">
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={reports.categoriesReport} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                    <XAxis dataKey="name" stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} />
                    <YAxis stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(v) => `PKR ${v/1000}k`} />
                    <Tooltip cursor={{ fill: '#f1f5f9' }} contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                    <Bar dataKey="revenue" fill="#0ea5e9" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="card">
              <div className="p-5 border-b border-slate-100 dark:border-slate-800/50">
                <h3 className="font-semibold text-slate-800 dark:text-slate-100">Sales by Category Report</h3>
              </div>
              <div className="overflow-x-auto print:overflow-visible">
                <table className="w-full text-left border-collapse print:border-b-2 print:border-black">
                  <thead>
                    <tr className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400 text-xs uppercase tracking-wider print:bg-transparent print:text-black print:border-b-2 print:border-black">
                      <th className="px-6 py-3 font-medium">Category Name</th>
                      <th className="px-6 py-3 font-medium text-right">Items Sold</th>
                      <th className="px-6 py-3 font-medium text-right">Revenue Generated</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 print:divide-black/20">
                    {reports.categoriesReport.map((item, index) => (
                      <tr key={index} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                        <td className="px-6 py-4 text-sm font-medium text-slate-900 dark:text-slate-50">{item.name}</td>
                        <td className="px-6 py-4 text-sm text-right text-slate-600 dark:text-slate-300 font-mono">{item.qty.toLocaleString()}</td>
                        <td className="px-6 py-4 text-sm text-right font-medium text-emerald-600 font-mono">PKR {item.revenue.toLocaleString()}</td>
                      </tr>
                    ))}
                    {reports.categoriesReport.length === 0 && (
                      <tr>
                        <td colSpan={3} className="px-6 py-8 text-center text-slate-500 dark:text-slate-400 text-sm">No sales in selected period.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {reportType === 'payments' && (
          <div className="space-y-6">
             <div className="card p-5 flex flex-col min-h-[350px] print:hidden">
              <div className="font-serif italic text-sm text-slate-600 dark:text-slate-300 mb-6 border-b border-slate-100 dark:border-slate-800/50 pb-2">Revenue by Payment Method</div>
              <div className="flex-1 w-full">
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={reports.paymentsReport} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                    <XAxis dataKey="name" stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} />
                    <YAxis stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(v) => `PKR ${v/1000}k`} />
                    <Tooltip cursor={{ fill: '#f1f5f9' }} contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                    <Bar dataKey="revenue" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="card">
              <div className="p-5 border-b border-slate-100 dark:border-slate-800/50">
                <h3 className="font-semibold text-slate-800 dark:text-slate-100">Sales by Payment Method</h3>
              </div>
              <div className="overflow-x-auto print:overflow-visible">
                <table className="w-full text-left border-collapse print:border-b-2 print:border-black">
                  <thead>
                    <tr className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400 text-xs uppercase tracking-wider print:bg-transparent print:text-black print:border-b-2 print:border-black">
                      <th className="px-6 py-3 font-medium">Payment Method</th>
                      <th className="px-6 py-3 font-medium text-right">Transactions</th>
                      <th className="px-6 py-3 font-medium text-right">Total Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 print:divide-black/20">
                    {reports.paymentsReport.map((item, index) => (
                      <tr key={index} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                        <td className="px-6 py-4 text-sm font-medium text-slate-900 dark:text-slate-50">{item.name}</td>
                        <td className="px-6 py-4 text-sm text-right text-slate-600 dark:text-slate-300 font-mono">{item.count.toLocaleString()}</td>
                        <td className="px-6 py-4 text-sm text-right font-medium text-emerald-600 font-mono">PKR {item.revenue.toLocaleString()}</td>
                      </tr>
                    ))}
                    {reports.paymentsReport.length === 0 && (
                      <tr>
                        <td colSpan={3} className="px-6 py-8 text-center text-slate-500 dark:text-slate-400 text-sm">No sales in selected period.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {reportType === 'customers' && (
          <div className="card">
            <div className="p-5 border-b border-slate-100 dark:border-slate-800/50">
              <h3 className="font-semibold text-slate-800 dark:text-slate-100">Customer Sales Report</h3>
            </div>
            <div className="overflow-x-auto print:overflow-visible">
              <table className="w-full text-left border-collapse print:border-b-2 print:border-black">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400 text-xs uppercase tracking-wider print:bg-transparent print:text-black print:border-b-2 print:border-black">
                    <th className="px-6 py-3 font-medium">Customer Name</th>
                    <th className="px-6 py-3 font-medium text-right"># of Sales Orders</th>
                    <th className="px-6 py-3 font-medium text-right">Total Revenue</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 print:divide-black/20">
                  {reports.customerReport.map((customer, index) => (
                    <tr key={index} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                      <td className="px-6 py-4 text-sm font-medium text-slate-900 dark:text-slate-50">{customer.name}</td>
                      <td className="px-6 py-4 text-sm text-right text-slate-600 dark:text-slate-300 font-mono">{customer.count.toLocaleString()}</td>
                      <td className="px-6 py-4 text-sm text-right font-medium text-emerald-600 font-mono">PKR {customer.total.toLocaleString()}</td>
                    </tr>
                  ))}
                  {reports.customerReport.length === 0 && (
                    <tr>
                      <td colSpan={3} className="px-6 py-8 text-center text-slate-500 dark:text-slate-400 text-sm">No sales recorded for any customers.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {reportType === 'vendor_payables' && (() => {
          const filteredVendors = reports.vendorPayablesList.filter(v => {
            const matchesSearch = !vendorPayableSearch ||
              v.name.toLowerCase().includes(vendorPayableSearch.toLowerCase()) ||
              (v.phone && v.phone.includes(vendorPayableSearch));
            if (!matchesSearch) return false;
            if (vendorPayableFilter === 'payable') return v.balance < 0;
            if (vendorPayableFilter === 'advance') return v.balance > 0;
            return true;
          });

          return (
            <div className="space-y-6">
              {/* Summary Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="card p-5 bg-rose-50/50 dark:bg-rose-950/20 border-rose-200 dark:border-rose-900">
                  <div className="text-xs font-bold text-rose-600 dark:text-rose-400 uppercase tracking-wider mb-1">
                    Total Vendor Payables (وینڈرز کو دینا ہے)
                  </div>
                  <div className="text-2xl font-black text-rose-700 dark:text-rose-300 font-mono">
                    PKR {reports.totalVendorPayablesOnly.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                  <div className="text-[11px] text-rose-600/80 mt-1">
                    {reports.vendorPayablesList.filter(v => v.balance < 0).length} vendors with outstanding due (Dashboard &amp; Statement Match)
                  </div>
                </div>

                <div className="card p-5 bg-emerald-50/50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-900">
                  <div className="text-xs font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider mb-1">
                    Vendor Advance / Prepaid (ہمارا ایڈوانس)
                  </div>
                  <div className="text-2xl font-black text-emerald-700 dark:text-emerald-300 font-mono">
                    PKR {reports.totalVendorAdvanceOnly.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                  <div className="text-[11px] text-emerald-600/80 mt-1">
                    {reports.vendorPayablesList.filter(v => v.balance > 0).length} vendors with advance credit
                  </div>
                </div>

                <div className="card p-5 bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800">
                  <div className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">
                    Net Vendor Position (خالص پوزیشن)
                  </div>
                  <div className={clsx("text-2xl font-black font-mono", (reports.totalVendorAdvanceOnly - reports.totalVendorPayablesOnly) >= 0 ? "text-emerald-600" : "text-rose-600")}>
                    PKR {Math.abs(reports.totalVendorAdvanceOnly - reports.totalVendorPayablesOnly).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    <span className="text-xs font-medium ml-1.5 text-slate-500">
                      {(reports.totalVendorAdvanceOnly - reports.totalVendorPayablesOnly) >= 0 ? '(Net Advance)' : '(Net Payable)'}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-500 mt-1">
                    Total Active Vendors: {reports.vendorPayablesList.length}
                  </div>
                </div>
              </div>

              {/* Table */}
              <div className="card">
                <div className="p-5 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center">
                  <div>
                    <h3 className="font-semibold text-slate-800 dark:text-slate-100">
                      Vendor Payables &amp; Balances Statement (وینڈرز واجبات کھاتہ)
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      Showing {filteredVendors.length} of {reports.vendorPayablesList.length} vendors
                    </p>
                  </div>
                </div>

                <div className="overflow-x-auto print:overflow-visible">
                  <table className="w-full text-left border-collapse print:border-b-2 print:border-black text-sm">
                    <thead>
                      <tr className="bg-slate-50 dark:bg-slate-800/50 text-slate-600 dark:text-slate-300 text-xs font-semibold uppercase tracking-wider print:bg-transparent print:text-black print:border-b-2 print:border-black">
                        <th className="py-3 px-4 w-12 text-center">#</th>
                        <th className="py-3 px-4">Vendor Name</th>
                        <th className="py-3 px-4">Contact</th>
                        <th className="py-3 px-4 text-center">Status</th>
                        <th className="py-3 px-4 text-right">Balance (PKR)</th>
                        <th className="py-3 px-4 text-center print:hidden">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800 print:divide-black/20">
                      {filteredVendors.map((v, idx) => (
                        <tr key={v.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40">
                          <td className="py-3 px-4 text-center font-mono text-slate-400 print:text-black">{idx + 1}</td>
                          <td className="py-3 px-4 font-semibold text-slate-900 dark:text-slate-100 print:text-black">
                            {v.name}
                          </td>
                          <td className="py-3 px-4 font-mono text-xs text-slate-600 dark:text-slate-400 print:text-black">
                            {v.phone || '-'}
                          </td>
                          <td className="py-3 px-4 text-center">
                            {v.balance < 0 ? (
                              <span className="inline-block px-2 py-0.5 rounded text-xs font-bold bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-400 border border-rose-200 dark:border-rose-900 print:border-black print:text-black">
                                Payable (دینا ہے)
                              </span>
                            ) : v.balance > 0 ? (
                              <span className="inline-block px-2 py-0.5 rounded text-xs font-bold bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-900 print:border-black print:text-black">
                                Advance (ایڈوانس)
                              </span>
                            ) : (
                              <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                                Settled (برابر)
                              </span>
                            )}
                          </td>
                          <td className={clsx("py-3 px-4 text-right font-mono font-bold text-sm", v.balance < 0 ? "text-rose-600 dark:text-rose-400" : v.balance > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-slate-500", "print:text-black")}>
                            PKR {Math.abs(v.balance).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            {v.balance < 0 && <span className="text-[10px] font-normal ml-1 text-rose-600 print:text-black">(Payable)</span>}
                            {v.balance > 0 && <span className="text-[10px] font-normal ml-1 text-emerald-600 print:text-black">(Advance)</span>}
                          </td>
                          <td className="py-3 px-4 text-center print:hidden">
                            <button
                              type="button"
                              onClick={() => navigate('/ledger', { state: { viewMode: 'vendor', vendorId: v.id } })}
                              className="text-xs text-sky-600 dark:text-sky-400 hover:underline font-medium"
                            >
                              View Ledger
                            </button>
                          </td>
                        </tr>
                      ))}
                      {filteredVendors.length === 0 && (
                        <tr>
                          <td colSpan={6} className="py-8 text-center text-slate-500 italic">
                            No vendors found matching filter.
                          </td>
                        </tr>
                      )}
                      {filteredVendors.length > 0 && (
                        <tr className="bg-slate-50 dark:bg-slate-800/60 font-bold border-t-2 border-slate-300 dark:border-slate-700 print:border-black">
                          <td colSpan={3} className="py-3 px-4 text-right uppercase text-xs tracking-wider text-slate-800 dark:text-slate-200 print:text-black">
                            Total Payable to Vendors (وینڈرز کو دینا ہے):
                          </td>
                          <td colSpan={2} className="py-3 px-4 text-right font-mono text-base text-rose-600 dark:text-rose-400 print:text-black">
                            PKR {reports.totalVendorPayablesOnly.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </td>
                          <td className="print:hidden"></td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          );
        })()}

        {reportType === 'customer_receivables' && (() => {
          const filteredCustomers = reports.customerReceivablesList.filter(c => {
            const matchesSearch = !customerReceivableSearch ||
              c.name.toLowerCase().includes(customerReceivableSearch.toLowerCase()) ||
              (c.phone && c.phone.includes(customerReceivableSearch)) ||
              (c.city && c.city.toLowerCase().includes(customerReceivableSearch.toLowerCase()));
            if (!matchesSearch) return false;
            if (customerReceivableFilter === 'receivable') return c.balance < 0;
            if (customerReceivableFilter === 'advance') return c.balance > 0;
            return true;
          });

          return (
            <div className="space-y-6">
              {/* Summary Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="card p-5 bg-rose-50/50 dark:bg-rose-950/20 border-rose-200 dark:border-rose-900">
                  <div className="text-xs font-bold text-rose-600 dark:text-rose-400 uppercase tracking-wider mb-1">
                    Total Customer Receivables (کسٹمرز سے لینا ہے)
                  </div>
                  <div className="text-2xl font-black text-rose-700 dark:text-rose-300 font-mono">
                    PKR {reports.totalCustomerReceivablesOnly.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                  <div className="text-[11px] text-rose-600/80 mt-1">
                    {reports.customerReceivablesList.filter(c => c.balance < 0).length} customers with outstanding due (Dashboard &amp; Statement Match)
                  </div>
                </div>

                <div className="card p-5 bg-emerald-50/50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-900">
                  <div className="text-xs font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider mb-1">
                    Customer Advances / Prepaid (کسٹمر کا ایڈوانس)
                  </div>
                  <div className="text-2xl font-black text-emerald-700 dark:text-emerald-300 font-mono">
                    PKR {reports.totalCustomerAdvanceOnly.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                  <div className="text-[11px] text-emerald-600/80 mt-1">
                    {reports.customerReceivablesList.filter(c => c.balance > 0).length} customers with advance credit
                  </div>
                </div>

                <div className="card p-5 bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800">
                  <div className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">
                    Net Customer Position (خالص وصولی)
                  </div>
                  <div className={clsx("text-2xl font-black font-mono", (reports.totalCustomerReceivablesOnly - reports.totalCustomerAdvanceOnly) >= 0 ? "text-rose-600" : "text-emerald-600")}>
                    PKR {Math.abs(reports.totalCustomerReceivablesOnly - reports.totalCustomerAdvanceOnly).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    <span className="text-xs font-medium ml-1.5 text-slate-500">
                      {(reports.totalCustomerReceivablesOnly - reports.totalCustomerAdvanceOnly) >= 0 ? '(Net Receivable)' : '(Net Customer Advance)'}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-500 mt-1">
                    Total Active Customers: {reports.customerReceivablesList.length}
                  </div>
                </div>
              </div>

              {/* Table */}
              <div className="card">
                <div className="p-5 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center">
                  <div>
                    <h3 className="font-semibold text-slate-800 dark:text-slate-100">
                      Customer Receivables &amp; Balances Statement (کسٹمر وصولیاں کھاتہ)
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      Showing {filteredCustomers.length} of {reports.customerReceivablesList.length} customers
                    </p>
                  </div>
                </div>

                <div className="overflow-x-auto print:overflow-visible">
                  <table className="w-full text-left border-collapse print:border-b-2 print:border-black text-sm">
                    <thead>
                      <tr className="bg-slate-50 dark:bg-slate-800/50 text-slate-600 dark:text-slate-300 text-xs font-semibold uppercase tracking-wider print:bg-transparent print:text-black print:border-b-2 print:border-black">
                        <th className="py-3 px-4 w-12 text-center">#</th>
                        <th className="py-3 px-4">Customer Name</th>
                        <th className="py-3 px-4">Contact &amp; City</th>
                        <th className="py-3 px-4 text-center">Status</th>
                        <th className="py-3 px-4 text-right">Balance (PKR)</th>
                        <th className="py-3 px-4 text-center print:hidden">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800 print:divide-black/20">
                      {filteredCustomers.map((c, idx) => (
                        <tr key={c.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40">
                          <td className="py-3 px-4 text-center font-mono text-slate-400 print:text-black">{idx + 1}</td>
                          <td className="py-3 px-4 font-semibold text-slate-900 dark:text-slate-100 print:text-black">
                            {c.name}
                          </td>
                          <td className="py-3 px-4 font-mono text-xs text-slate-600 dark:text-slate-400 print:text-black">
                            {[c.phone, c.city].filter(Boolean).join(' • ') || '-'}
                          </td>
                          <td className="py-3 px-4 text-center">
                            {c.balance < 0 ? (
                              <span className="inline-block px-2 py-0.5 rounded text-xs font-bold bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-400 border border-rose-200 dark:border-rose-900 print:border-black print:text-black">
                                Receivable (لینا ہے)
                              </span>
                            ) : c.balance > 0 ? (
                              <span className="inline-block px-2 py-0.5 rounded text-xs font-bold bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-900 print:border-black print:text-black">
                                Advance (ایڈوانس)
                              </span>
                            ) : (
                              <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                                Settled (برابر)
                              </span>
                            )}
                          </td>
                          <td className={clsx("py-3 px-4 text-right font-mono font-bold text-sm", c.balance < 0 ? "text-rose-600 dark:text-rose-400" : c.balance > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-slate-500", "print:text-black")}>
                            PKR {Math.abs(c.balance).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            {c.balance < 0 && <span className="text-[10px] font-normal ml-1 text-rose-600 print:text-black">(Due)</span>}
                            {c.balance > 0 && <span className="text-[10px] font-normal ml-1 text-emerald-600 print:text-black">(Advance)</span>}
                          </td>
                          <td className="py-3 px-4 text-center print:hidden">
                            <button
                              type="button"
                              onClick={() => navigate('/ledger', { state: { viewMode: 'customer', customerId: c.id } })}
                              className="text-xs text-sky-600 dark:text-sky-400 hover:underline font-medium"
                            >
                              View Ledger
                            </button>
                          </td>
                        </tr>
                      ))}
                      {filteredCustomers.length === 0 && (
                        <tr>
                          <td colSpan={6} className="py-8 text-center text-slate-500 italic">
                            No customers found matching filter.
                          </td>
                        </tr>
                      )}
                      {filteredCustomers.length > 0 && (
                        <tr className="bg-slate-50 dark:bg-slate-800/60 font-bold border-t-2 border-slate-300 dark:border-slate-700 print:border-black">
                          <td colSpan={3} className="py-3 px-4 text-right uppercase text-xs tracking-wider text-slate-800 dark:text-slate-200 print:text-black">
                            Total Receivables from Customers (کسٹمرز سے لینا ہے):
                          </td>
                          <td colSpan={2} className="py-3 px-4 text-right font-mono text-base text-rose-600 dark:text-rose-400 print:text-black">
                            PKR {reports.totalCustomerReceivablesOnly.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </td>
                          <td className="print:hidden"></td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          );
        })()}

        {reportType === 'vendors' && (
          <div className="card">
            <div className="p-5 border-b border-slate-100 dark:border-slate-800/50">
              <h3 className="font-semibold text-slate-800 dark:text-slate-100">Vendor Purchases Report</h3>
            </div>
            <div className="overflow-x-auto print:overflow-visible">
              <table className="w-full text-left border-collapse print:border-b-2 print:border-black">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400 text-xs uppercase tracking-wider print:bg-transparent print:text-black print:border-b-2 print:border-black">
                    <th className="px-6 py-3 font-medium">Vendor Name</th>
                    <th className="px-6 py-3 font-medium text-right"># of Purchase Orders</th>
                    <th className="px-6 py-3 font-medium text-right">Total Purchase Value</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 print:divide-black/20">
                  {reports.vendorReport.map((vendor, index) => (
                    <tr key={index} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                      <td className="px-6 py-4 text-sm font-medium text-slate-900 dark:text-slate-50">{vendor.name}</td>
                      <td className="px-6 py-4 text-sm text-right text-slate-600 dark:text-slate-300 font-mono">{vendor.count.toLocaleString()}</td>
                      <td className="px-6 py-4 text-sm text-right font-medium text-rose-600 font-mono">PKR {vendor.total.toLocaleString()}</td>
                    </tr>
                  ))}
                  {reports.vendorReport.length === 0 && (
                    <tr>
                      <td colSpan={3} className="px-6 py-8 text-center text-slate-500 dark:text-slate-400 text-sm">No purchases recorded.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
        
        {reportType === 'vendor_payments' && (() => {
          const filteredVendorSummaries = reports.vendorPaymentSummaryList.filter(v => {
            if (vendorPaymentFilterVendor !== 'ALL' && v.vendorId !== vendorPaymentFilterVendor && v.vendorName !== vendorPaymentFilterVendor) {
              return false;
            }
            if (vendorPaymentSearch.trim()) {
              const q = vendorPaymentSearch.toLowerCase().trim();
              const inName = v.vendorName.toLowerCase().includes(q);
              const inPhone = v.vendorPhone.includes(q);
              const inTx = v.transactions.some(t => (t.reference && t.reference.toLowerCase().includes(q)) || (t.description && t.description.toLowerCase().includes(q)));
              if (!inName && !inPhone && !inTx) return false;
            }
            return true;
          });

          const filteredTransactionsList = reports.periodVendorPaymentEntries.filter(t => {
            if (vendorPaymentFilterVendor !== 'ALL' && t.vendorId !== vendorPaymentFilterVendor && t.vendorName !== vendorPaymentFilterVendor) {
              return false;
            }
            if (vendorPaymentSearch.trim()) {
              const q = vendorPaymentSearch.toLowerCase().trim();
              const inName = t.vendorName.toLowerCase().includes(q);
              const inPhone = t.vendorPhone.includes(q);
              const inRef = t.reference.toLowerCase().includes(q);
              const inDesc = t.description.toLowerCase().includes(q);
              if (!inName && !inPhone && !inRef && !inDesc) return false;
            }
            return true;
          });

          const totalFilteredPaid = filteredVendorSummaries.reduce((sum, v) => sum + v.totalPaid, 0);

          return (
            <div className="space-y-6">
              {/* Summary Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="card p-5 bg-emerald-50/50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-900">
                  <div className="text-xs font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider mb-1">
                    Total Vendor Payments (کل ادا شدہ رقم)
                  </div>
                  <div className="text-2xl font-black text-emerald-700 dark:text-emerald-300 font-mono">
                    PKR {reports.totalVendorPaidInPeriod.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                  <div className="text-[11px] text-emerald-600/80 mt-1">
                    {reports.vendorPaymentSummaryList.length} vendors paid in this period
                  </div>
                </div>

                <div className="card p-5 bg-sky-50/50 dark:bg-sky-950/20 border-sky-200 dark:border-sky-900">
                  <div className="text-xs font-bold text-sky-600 dark:text-sky-400 uppercase tracking-wider mb-1">
                    Payment Vouchers (ادائیگی واؤچرز)
                  </div>
                  <div className="text-2xl font-black text-sky-700 dark:text-sky-300 font-mono">
                    {reports.totalVendorPaymentTransactions} Entries
                  </div>
                  <div className="text-[11px] text-sky-600/80 mt-1">
                    Total payment transactions recorded
                  </div>
                </div>

                <div className="card p-5 bg-indigo-50/50 dark:bg-indigo-950/20 border-indigo-200 dark:border-indigo-900">
                  <div className="text-xs font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider mb-1">
                    Top Paid Vendor (سب سے زیادہ ادائیگی)
                  </div>
                  <div className="text-xl font-black text-indigo-700 dark:text-indigo-300 truncate font-mono">
                    {reports.topPaidVendor ? reports.topPaidVendor.vendorName : 'None'}
                  </div>
                  <div className="text-[11px] text-indigo-600/80 mt-1 font-mono font-bold">
                    {reports.topPaidVendor ? `PKR ${reports.topPaidVendor.totalPaid.toLocaleString()}` : '-'}
                  </div>
                </div>

                <div className="card p-5 bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800">
                  <div className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">
                    Selected Month / Period (منتخب مدت)
                  </div>
                  <div className="text-base font-bold text-slate-800 dark:text-slate-100 font-mono">
                    {safeFormat(new Date(startDate), 'dd MMM yyyy')}
                  </div>
                  <div className="text-xs text-slate-500 font-mono">
                    to {safeFormat(new Date(endDate), 'dd MMM yyyy')}
                  </div>
                </div>
              </div>

              {/* Main Content Area */}
              {vendorPaymentViewMode === 'summary' ? (
                <div className="card">
                  <div className="p-5 border-b border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
                    <div>
                      <h3 className="font-semibold text-slate-800 dark:text-slate-100 text-base">
                        Monthly Vendor Payments Summary (ماہانہ وینڈرز ادائیگیاں خلاصہ)
                      </h3>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                        Showing payments made to {filteredVendorSummaries.length} vendors in the selected period
                      </p>
                    </div>
                    <div className="text-xs font-semibold px-3 py-1.5 rounded-full bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 font-mono print:hidden">
                      Period Total: PKR {totalFilteredPaid.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                  </div>

                  <div className="overflow-x-auto print:overflow-visible">
                    <table className="w-full text-left border-collapse print:border-b-2 print:border-black text-sm">
                      <thead>
                        <tr className="bg-slate-50 dark:bg-slate-800/50 text-slate-600 dark:text-slate-300 text-xs font-semibold uppercase tracking-wider print:bg-transparent print:text-black print:border-b-2 print:border-black">
                          <th className="py-3 px-4 w-12 text-center">#</th>
                          <th className="py-3 px-4">Vendor Name (وینڈر کا نام)</th>
                          <th className="py-3 px-4">Contact Phone</th>
                          <th className="py-3 px-4 text-center"># Payments</th>
                          <th className="py-3 px-4 text-right">Total Paid (اس ماہ ادا رقم)</th>
                          <th className="py-3 px-4 text-right">Current Balance (موجودہ بقایا)</th>
                          <th className="py-3 px-4 text-center print:hidden">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800 print:divide-black/20">
                        {filteredVendorSummaries.map((v, idx) => {
                          const isExpanded = expandedVendorPaymentId === v.vendorId;
                          return (
                            <React.Fragment key={v.vendorId || idx}>
                              <tr 
                                onClick={() => setExpandedVendorPaymentId(isExpanded ? null : v.vendorId)}
                                className="hover:bg-slate-50/60 dark:hover:bg-slate-800/50 transition-colors cursor-pointer"
                              >
                                <td className="py-3.5 px-4 text-center font-mono text-slate-400 print:text-black">
                                  {idx + 1}
                                </td>
                                <td className="py-3.5 px-4 font-semibold text-slate-900 dark:text-slate-100 print:text-black">
                                  <div className="flex items-center gap-1.5">
                                    <span>{v.vendorName}</span>
                                    {isExpanded ? (
                                      <ChevronUp className="w-3.5 h-3.5 text-slate-400 print:hidden" />
                                    ) : (
                                      <ChevronDown className="w-3.5 h-3.5 text-slate-400 print:hidden" />
                                    )}
                                  </div>
                                </td>
                                <td className="py-3.5 px-4 font-mono text-xs text-slate-600 dark:text-slate-400 print:text-black">
                                  {v.vendorPhone || '-'}
                                </td>
                                <td className="py-3.5 px-4 text-center font-mono text-xs">
                                  <span className="inline-block px-2.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold border border-slate-200 dark:border-slate-700 print:border-none">
                                    {v.paymentsCount}
                                  </span>
                                </td>
                                <td className="py-3.5 px-4 text-right font-mono font-bold text-emerald-600 dark:text-emerald-400 print:text-black text-sm">
                                  PKR {v.totalPaid.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </td>
                                <td className="py-3.5 px-4 text-right font-mono text-xs">
                                  {v.currentBalance < 0 ? (
                                    <span className="text-rose-600 dark:text-rose-400 font-bold print:text-black">
                                      Payable: PKR {Math.abs(v.currentBalance).toLocaleString()}
                                    </span>
                                  ) : v.currentBalance > 0 ? (
                                    <span className="text-emerald-600 dark:text-emerald-400 font-bold print:text-black">
                                      Advance: PKR {v.currentBalance.toLocaleString()}
                                    </span>
                                  ) : (
                                    <span className="text-slate-400">Settled (0)</span>
                                  )}
                                </td>
                                <td className="py-3.5 px-4 text-center print:hidden" onClick={(e) => e.stopPropagation()}>
                                  <div className="flex items-center justify-center gap-2">
                                    <button
                                      type="button"
                                      onClick={() => setExpandedVendorPaymentId(isExpanded ? null : v.vendorId)}
                                      className="text-xs px-2.5 py-1 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded font-medium transition cursor-pointer"
                                    >
                                      {isExpanded ? 'Hide' : 'Details'}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => navigate('/ledger', { state: { viewMode: 'vendor', vendorId: v.vendorId } })}
                                      className="text-xs text-sky-600 dark:text-sky-400 hover:underline font-medium inline-flex items-center"
                                      title="Open full ledger for this vendor"
                                    >
                                      Ledger
                                    </button>
                                  </div>
                                </td>
                              </tr>

                              {/* Expanded Row showing transactions */}
                              {isExpanded && (
                                <tr className="bg-slate-50/80 dark:bg-slate-850/60 print:table-row">
                                  <td colSpan={7} className="p-3 sm:p-4 border-y border-slate-200 dark:border-slate-700 print:border-black">
                                    <div className="bg-white dark:bg-slate-900 rounded border border-slate-200 dark:border-slate-700 p-3 shadow-xs print:shadow-none print:border-black">
                                      <div className="flex justify-between items-center mb-2 pb-1 border-b border-slate-100 dark:border-slate-800 print:border-black">
                                        <span className="text-xs font-bold text-slate-700 dark:text-slate-200 uppercase tracking-wider">
                                          Payment Transactions for {v.vendorName} ({v.transactions.length})
                                        </span>
                                        <span className="text-xs font-mono font-bold text-emerald-600 dark:text-emerald-400">
                                          Total: PKR {v.totalPaid.toLocaleString()}
                                        </span>
                                      </div>
                                      <table className="w-full text-left text-xs border-collapse">
                                        <thead>
                                          <tr className="text-slate-500 uppercase border-b border-slate-200 dark:border-slate-700 print:border-black">
                                            <th className="py-1.5 px-2">Date &amp; Time</th>
                                            <th className="py-1.5 px-2">Reference / Voucher</th>
                                            <th className="py-1.5 px-2">Category</th>
                                            <th className="py-1.5 px-2">Description / Remarks</th>
                                            <th className="py-1.5 px-2 text-right">Amount (PKR)</th>
                                          </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800 print:divide-black/20">
                                          {v.transactions.map((tx, tIdx) => (
                                            <tr key={tx.id || tIdx} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                                              <td className="py-1.5 px-2 font-mono text-slate-600 dark:text-slate-300">
                                                {tx.displayDate}
                                              </td>
                                              <td className="py-1.5 px-2 font-mono font-medium text-slate-800 dark:text-slate-200">
                                                {tx.reference || '-'}
                                              </td>
                                              <td className="py-1.5 px-2 text-slate-500">
                                                <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-[10px] font-semibold">
                                                  {tx.category}
                                                </span>
                                              </td>
                                              <td className="py-1.5 px-2 text-slate-600 dark:text-slate-400">
                                                {tx.description || '-'}
                                              </td>
                                              <td className="py-1.5 px-2 text-right font-mono font-bold text-emerald-600 dark:text-emerald-400 print:text-black">
                                                PKR {tx.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                              </td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </React.Fragment>
                          );
                        })}

                        {filteredVendorSummaries.length === 0 && (
                          <tr>
                            <td colSpan={7} className="py-10 text-center text-slate-500 dark:text-slate-400 italic">
                              No payments recorded for vendors in the selected month/period.
                            </td>
                          </tr>
                        )}

                        {filteredVendorSummaries.length > 0 && (
                          <tr className="bg-slate-100/80 dark:bg-slate-800 font-bold border-t-2 border-slate-300 dark:border-slate-700 print:border-black">
                            <td colSpan={4} className="py-3 px-4 text-right uppercase text-xs tracking-wider text-slate-900 dark:text-slate-100 print:text-black">
                              Total Payments to Vendors (وینڈرز کو کل ادا شدہ رقم):
                            </td>
                            <td className="py-3 px-4 text-right font-mono text-base text-emerald-600 dark:text-emerald-400 print:text-black">
                              PKR {totalFilteredPaid.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </td>
                            <td colSpan={2} className="print:hidden"></td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                /* Detailed Transactions Log */
                <div className="card">
                  <div className="p-5 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center">
                    <div>
                      <h3 className="font-semibold text-slate-800 dark:text-slate-100 text-base">
                        Vendor Payment Transactions Log (تمام ادائیگیاں - تفصیلی لاگ)
                      </h3>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                        {filteredTransactionsList.length} total payment transactions in this period
                      </p>
                    </div>
                    <div className="text-xs font-semibold px-3 py-1.5 rounded-full bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 font-mono">
                      Total Paid: PKR {totalFilteredPaid.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                  </div>

                  <div className="overflow-x-auto print:overflow-visible">
                    <table className="w-full text-left border-collapse print:border-b-2 print:border-black text-sm">
                      <thead>
                        <tr className="bg-slate-50 dark:bg-slate-800/50 text-slate-600 dark:text-slate-300 text-xs font-semibold uppercase tracking-wider print:bg-transparent print:text-black print:border-b-2 print:border-black">
                          <th className="py-3 px-4 w-12 text-center">#</th>
                          <th className="py-3 px-4">Date &amp; Time</th>
                          <th className="py-3 px-4">Vendor Name</th>
                          <th className="py-3 px-4">Reference / Voucher</th>
                          <th className="py-3 px-4">Category</th>
                          <th className="py-3 px-4">Description / Remarks</th>
                          <th className="py-3 px-4 text-right">Amount (PKR)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800 print:divide-black/20">
                        {filteredTransactionsList.map((tx, idx) => (
                          <tr key={tx.id || idx} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40">
                            <td className="py-3 px-4 text-center font-mono text-slate-400 print:text-black">
                              {idx + 1}
                            </td>
                            <td className="py-3 px-4 font-mono text-xs text-slate-600 dark:text-slate-400 print:text-black whitespace-nowrap">
                              {tx.displayDate}
                            </td>
                            <td className="py-3 px-4 font-semibold text-slate-900 dark:text-slate-100 print:text-black">
                              {tx.vendorName}
                            </td>
                            <td className="py-3 px-4 font-mono text-xs font-medium text-slate-700 dark:text-slate-300 print:text-black">
                              {tx.reference || '-'}
                            </td>
                            <td className="py-3 px-4 text-xs text-slate-500">
                              <span className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-[11px] font-medium border border-slate-200 dark:border-slate-700 print:border-none">
                                {tx.category}
                              </span>
                            </td>
                            <td className="py-3 px-4 text-xs text-slate-600 dark:text-slate-400">
                              {tx.description || '-'}
                            </td>
                            <td className="py-3 px-4 text-right font-mono font-bold text-emerald-600 dark:text-emerald-400 print:text-black text-sm whitespace-nowrap">
                              PKR {tx.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </td>
                          </tr>
                        ))}

                        {filteredTransactionsList.length === 0 && (
                          <tr>
                            <td colSpan={7} className="py-10 text-center text-slate-500 italic">
                              No payment transactions recorded for vendors in this period.
                            </td>
                          </tr>
                        )}

                        {filteredTransactionsList.length > 0 && (
                          <tr className="bg-slate-100/80 dark:bg-slate-800 font-bold border-t-2 border-slate-300 dark:border-slate-700 print:border-black">
                            <td colSpan={6} className="py-3 px-4 text-right uppercase text-xs tracking-wider text-slate-900 dark:text-slate-100 print:text-black">
                              Total Payments to Vendors (وینڈرز کو کل ادا شدہ رقم):
                            </td>
                            <td className="py-3 px-4 text-right font-mono text-base text-emerald-600 dark:text-emerald-400 print:text-black">
                              PKR {totalFilteredPaid.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          );
        })()}
        
        {reportType === 'vendor_items' && (
          <div className="space-y-6">
            {reports.vendorDetailedReport.filter(v => selectedReportVendorName === 'ALL' || v.vendorName === selectedReportVendorName).length === 0 ? (
              <div className="card p-8 text-center text-slate-500 dark:text-slate-400">
                No purchases recorded for this period.
              </div>
            ) : (
              reports.vendorDetailedReport.filter(v => selectedReportVendorName === 'ALL' || v.vendorName === selectedReportVendorName).map((vendor, vIndex) => (
                <div key={vIndex} className="card print:shadow-none print:border print:border-black print:mb-8 print:break-inside-avoid">
                  <div className="p-4 border-b border-slate-100 dark:border-slate-800/50 print:border-black print:border-b-2 flex justify-between items-center bg-slate-50 dark:bg-slate-800/20 print:bg-transparent">
                    <h3 className="font-semibold text-lg text-slate-800 dark:text-slate-100 print:text-black print:font-bold print:text-xl uppercase tracking-widest">{vendor.vendorName}</h3>
                    <div className="flex space-x-6 print:text-black">
                       <div><span className="text-xs text-slate-400 uppercase tracking-widest block print:text-black print:font-bold">Total Items</span><span className="font-mono font-bold text-slate-700 dark:text-slate-200 print:text-black print:text-lg">{vendor.totalQty.toLocaleString()}</span></div>
                       <div><span className="text-xs text-slate-400 uppercase tracking-widest block print:text-black print:font-bold">Total Value</span><span className="font-mono font-bold text-rose-600 print:text-black print:text-lg">PKR {vendor.totalValue.toLocaleString()}</span></div>
                    </div>
                  </div>
                  <div className="overflow-x-auto print:overflow-visible">
                    <table className="w-full text-left border-collapse print:border-b-2 print:border-black">
                      <thead>
                        <tr className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400 text-xs uppercase tracking-wider print:bg-transparent print:text-black print:border-b-2 print:border-black">
                          <th className="px-6 py-3 font-medium print:font-extrabold print:text-sm">Item Name</th>
                          <th className="px-6 py-3 font-medium text-right print:font-extrabold print:text-sm">Quantity Purchased</th>
                          <th className="px-6 py-3 font-medium text-right print:font-extrabold print:text-sm">Avg Rate</th>
                          <th className="px-6 py-3 font-medium text-right print:font-extrabold print:text-sm">Total Cost</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 print:divide-black/20">
                        {vendor.items.map((item, iIndex) => (
                          <tr key={iIndex} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 print:hover:bg-transparent">
                            <td className="px-6 py-3 text-sm font-medium text-slate-900 dark:text-slate-50 print:text-black print:font-bold">{item.itemName}</td>
                            <td className="px-6 py-3 text-sm text-right text-slate-600 dark:text-slate-300 font-mono print:text-black">{item.qty.toLocaleString()}</td>
                            <td className="px-6 py-3 text-sm text-right text-slate-600 dark:text-slate-300 font-mono print:text-black">PKR {Math.round(item.total / (item.qty || 1)).toLocaleString()}</td>
                            <td className="px-6 py-3 text-sm text-right text-rose-600 font-mono print:text-black print:font-bold">PKR {item.total.toLocaleString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {reportType === 'profitability' && (
          <div className="card">
            <div className="p-5 border-b border-slate-100 dark:border-slate-800/50 flex justify-between items-center">
              <h3 className="font-semibold text-slate-800 dark:text-slate-100">Profitability by Item</h3>
              <div className="text-sm font-medium text-emerald-600 bg-emerald-50 px-3 py-1.5 rounded-full border border-emerald-100">
                Total Profit: PKR {reports.profitabilityReport.reduce((acc, curr) => acc + curr.profit, 0).toLocaleString()}
              </div>
            </div>
            <div className="overflow-x-auto print:overflow-visible">
              <table className="w-full text-left border-collapse print:border-b-2 print:border-black">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400 text-xs uppercase tracking-wider print:bg-transparent print:text-black print:border-b-2 print:border-black">
                    <th className="px-6 py-3 font-medium print:font-extrabold print:text-sm">Item Name</th>
                    <th className="px-6 py-3 font-medium text-right">Qty Sold</th>
                    <th className="px-6 py-3 font-medium text-right">Revenue (PKR)</th>
                    <th className="px-6 py-3 font-medium text-right">Cost (PKR)</th>
                    <th className="px-6 py-3 font-medium text-right text-emerald-600">Profit (PKR)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 print:divide-black/20">
                  {reports.profitabilityReport.map((item, index) => (
                    <tr key={index} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                      <td className="px-6 py-4 text-sm font-medium text-slate-900 dark:text-slate-50">{item.name}</td>
                      <td className="px-6 py-4 text-sm text-right text-slate-600 dark:text-slate-300 font-mono">{item.qty.toLocaleString()}</td>
                      <td className="px-6 py-4 text-sm text-right font-medium text-sky-600 font-mono">{item.revenue.toLocaleString()}</td>
                      <td className="px-6 py-4 text-sm text-right font-medium text-rose-600 font-mono">{item.cost.toLocaleString()}</td>
                      <td className="px-6 py-4 text-sm text-right font-bold text-emerald-600 font-mono">{item.profit.toLocaleString()}</td>
                    </tr>
                  ))}
                  {reports.profitabilityReport.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-6 py-8 text-center text-slate-500 dark:text-slate-400 text-sm">No items sold.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
        {reportType === 'advances' && (
          <div className="card">
            <div className="p-5 border-b border-slate-100 dark:border-slate-800/50 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
              <h3 className="font-semibold text-slate-800 dark:text-slate-100 uppercase tracking-widest text-xs">Employee Advance Balances & Activity</h3>
              <div className="text-sm font-medium text-amber-600 bg-amber-50 px-3 py-1.5 rounded-full border border-amber-100 font-mono">
                Total Outstanding: PKR {reports.advanceReport.reduce((acc, curr) => acc + curr.currentBalance, 0).toLocaleString()}
              </div>
            </div>
            <div className="overflow-x-auto print:overflow-visible">
              <table className="w-full text-left border-collapse print:border-b-2 print:border-black">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400 text-[10px] uppercase tracking-widest print:bg-transparent print:text-black print:border-b-2 print:border-black">
                    <th className="px-6 py-3 font-bold">Employee Name</th>
                    <th className="px-6 py-3 font-bold text-right">Given (In Period)</th>
                    <th className="px-6 py-3 font-bold text-right">Deducted (In Period)</th>
                    <th className="px-6 py-3 font-bold text-right text-amber-600">Current Balance</th>
                    <th className="px-6 py-3 font-bold text-center print:hidden w-10">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800 print:divide-black/20">
                  {reports.advanceReport
                    .filter(row => !advanceSearchTerm || row.name.toLowerCase().includes(advanceSearchTerm.toLowerCase()))
                    .map((row, index) => (
                    <React.Fragment key={index}>
                      <tr className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors group">
                        <td className="px-6 py-4">
                          <div className="flex flex-col">
                            <span className="text-sm font-bold text-slate-900 dark:text-slate-50">{row.name}</span>
                            <span className="text-[10px] text-slate-400 uppercase tracking-widest">{row.role}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-sm text-right font-mono text-emerald-600">PKR {row.totalGiven.toLocaleString()}</td>
                        <td className="px-6 py-4 text-sm text-right font-mono text-rose-600">PKR {row.totalDeducted.toLocaleString()}</td>
                        <td className="px-6 py-4 text-sm text-right font-bold text-amber-600 font-mono">PKR {row.currentBalance.toLocaleString()}</td>
                        <td className="px-6 py-4 text-center print:hidden">
                          <button 
                            onClick={() => setExpandedAdvanceId(expandedAdvanceId === row.id ? null : row.id)}
                            className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded transition-colors"
                          >
                            <span className={`inline-block transform transition-transform duration-200 ${expandedAdvanceId === row.id ? 'rotate-90' : ''}`}>➔</span>
                          </button>
                        </td>
                      </tr>
                      {expandedAdvanceId === row.id && (
                        <tr className="bg-slate-50/50 dark:bg-slate-800/20 print:hidden">
                          <td colSpan={5} className="px-6 py-4 border-l-2 border-amber-500">
                            <div className="space-y-3">
                              <h4 className="text-[10px] uppercase tracking-widest font-bold text-slate-500 mb-2">Transaction History</h4>
                              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                                {row.details.length === 0 ? (
                                  <div className="text-xs text-slate-400 italic">No activity recorded for this period.</div>
                                ) : (
                                  row.details.map((detail: any, dIndex: number) => (
                                    <div key={dIndex} className="bg-white dark:bg-slate-900 p-2.5 rounded border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col justify-between">
                                      <div className="flex justify-between items-start mb-1">
                                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-tighter ${
                                          detail.type === 'Issue' ? 'bg-emerald-100 text-emerald-700' : 
                                          detail.type === 'Salary' ? 'bg-blue-100 text-blue-700' :
                                          'bg-rose-100 text-rose-700'
                                        }`}>
                                          {detail.type}
                                        </span>
                                        <span className="text-[10px] text-slate-400 font-mono">
                                          {new Date(detail.date).toLocaleDateString()}
                                        </span>
                                      </div>
                                      <div className="text-xs font-bold text-slate-700 dark:text-slate-300 mt-1">
                                        PKR {detail.amount.toLocaleString()}
                                      </div>
                                      <div className="text-[10px] text-slate-500 mt-0.5 line-clamp-1 italic">
                                        {detail.desc}
                                      </div>
                                    </div>
                                  ))
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                      {/* Print details always */}
                      <tr className="hidden print:table-row">
                        <td colSpan={5} className="px-6 py-2 border-l-2 border-black/20">
                           <div className="text-[10px] font-bold uppercase tracking-widest mb-1 text-black/60">Detail:</div>
                           <div className="flex flex-wrap gap-x-6 gap-y-1">
                             {row.details.map((d: any, di: number) => (
                               <div key={di} className="text-[10px] text-black">
                                 <span className="font-bold">[{new Date(d.date).toLocaleDateString()}]</span> {d.type}: PKR {d.amount.toLocaleString()} ({d.desc})
                               </div>
                             ))}
                           </div>
                        </td>
                      </tr>
                    </React.Fragment>
                  ))}
                  {reports.advanceReport.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-6 py-8 text-center text-slate-500 dark:text-slate-400 text-sm">No employee data found.</td>
                    </tr>
                  )}
                  {reports.advanceReport.length > 0 && (
                    <tr className="bg-slate-50 dark:bg-slate-800/50 font-bold border-t-2 border-slate-200 dark:border-slate-700">
                      <td className="py-4 px-6 text-right text-slate-800 dark:text-slate-100 uppercase text-[10px] tracking-widest">Total Period Summary</td>
                      <td className="py-4 px-6 text-right text-emerald-600 text-sm font-mono">
                        PKR {reports.advanceReport.reduce((sum, row) => sum + row.totalGiven, 0).toLocaleString()}
                      </td>
                      <td className="py-4 px-6 text-right text-rose-600 text-sm font-mono">
                        PKR {reports.advanceReport.reduce((sum, row) => sum + row.totalDeducted, 0).toLocaleString()}
                      </td>
                      <td className="py-4 px-6 text-right text-amber-600 text-sm font-mono">
                        PKR {reports.advanceReport.reduce((sum, row) => sum + row.currentBalance, 0).toLocaleString()}
                      </td>
                      <td className="print:hidden"></td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
