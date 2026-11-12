import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router';
import { useBranch } from '../context/BranchContext';
import { useAuth } from '../context/AuthContext';
import { useSettings } from '../context/SettingsContext';
import { collection, query, where, Timestamp, doc, updateDoc, addDoc, deleteDoc } from '../lib/customFirestore';
import { db, safeCollectionSnapshot } from '../lib/firebase';
import { Building2, Plus, Trash2, Mail, Phone, MapPin, Printer, Pencil, Search, ExternalLink, ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import { printInvoice } from '../lib/print';

interface Vendor {
  id: string;
  branchId: string;
  name: string;
  phone: string;
  email: string;
  address?: string;
  createdAt: any;
  tenantId?: string;
  isCourier?: boolean;
  isGlobal?: boolean;
}

interface VendorBalanceInfo {
  totalIn: number;       // Payments made to vendor (Cash In)
  totalOut: number;      // Bills / Purchases from vendor (Cash Out)
  rawBalance: number;    // totalIn - totalOut (negative = we owe vendor)
  dueAmount: number;     // Absolute outstanding balance
  status: 'PAYABLE' | 'ADVANCE' | 'CLEAR';
  statusLabel: string;   // Bilingual label
}

export function Vendors() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { activeBranchId, branches } = useBranch();
  const { enableDeletion } = useSettings();
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [editingVendor, setEditingVendor] = useState<Vendor | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [selectedBranchId, setSelectedBranchId] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Search & Filter state
  const [searchTerm, setSearchTerm] = useState('');
  const [balanceFilter, setBalanceFilter] = useState<'ALL' | 'PAYABLE' | 'ADVANCE' | 'CLEAR'>('ALL');

  const [ledgerEntries, setLedgerEntries] = useState<any[]>([]);
  const [purchases, setPurchases] = useState<any[]>([]);
  const [sales, setSales] = useState<any[]>([]);

  // Calculate dynamic months list for the last 12 months
  const generateMonthsList = () => {
    const list = [];
    const currDate = new Date();
    for (let i = 0; i < 12; i++) {
      const d = new Date(currDate.getFullYear(), currDate.getMonth() - i, 1);
      const label = d.toLocaleString('default', { month: 'long', year: 'numeric' });
      const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      list.push({ label, value, year: d.getFullYear(), month: d.getMonth() });
    }
    return list;
  };

  const monthsList = generateMonthsList();
  const [selectedMonth, setSelectedMonth] = useState(monthsList[0]?.value || '');

  // Load ledger, purchases, and sales
  useEffect(() => {
    if (!activeBranchId) return;

    let qLedger: any = collection(db, 'ledger');
    let qPurchases: any = collection(db, 'purchases');
    let qSales: any = collection(db, 'sales');

    if (activeBranchId) {
      qLedger = query(qLedger, where('branchId', '==', activeBranchId));
      qPurchases = query(qPurchases, where('branchId', '==', activeBranchId));
      qSales = query(qSales, where('branchId', '==', activeBranchId));
    }

    const unsubLedger = safeCollectionSnapshot(qLedger, (snap) => {
      setLedgerEntries(snap.docs.map(d => {
        const dt = d.data() as any;
        let dDate = dt.date;
        if (!dDate) {
          dDate = dt.createdAt?.toMillis ? dt.createdAt.toMillis() : (dt.createdAt?.seconds ? dt.createdAt.seconds * 1000 : 0);
        } else if (typeof dDate === 'string') {
          const num = Number(dDate);
          if (!isNaN(num) && num > 1000000000) dDate = num;
          else dDate = new Date(dDate).getTime();
        }
        return { id: d.id, ...dt, date: dDate };
      }));
    });

    const unsubPurchases = safeCollectionSnapshot(qPurchases, (snap) => {
      setPurchases(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
    });

    const unsubSales = safeCollectionSnapshot(qSales, (snap) => {
      setSales(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
    });

    return () => {
      unsubLedger();
      unsubPurchases();
      unsubSales();
    };
  }, [activeBranchId, user]);

  useEffect(() => {
    if (showAdd && !selectedBranchId) {
      if (activeBranchId) setSelectedBranchId(activeBranchId);
      else if (branches.length > 0) setSelectedBranchId(branches[0].id);
    }
  }, [showAdd, activeBranchId, branches]);

  // Load vendors
  useEffect(() => {
    if (!activeBranchId) return;

    const tenantId = user?.tenantId || user?.uid;
    let q: any = collection(db, 'vendors');

    const unsubscribe = safeCollectionSnapshot(q, (snap) => {
      let list = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) } as Vendor));
      if (tenantId) {
        list = list.filter(v => !v.tenantId || v.tenantId === tenantId);
      }
      if (activeBranchId) {
        list = list.filter(v => !v.branchId || v.branchId === activeBranchId || (activeBranchId === 'main' && !v.branchId) || v.isCourier || v.isGlobal);
      }
      setVendors(list);
    });
    
    return () => unsubscribe();
  }, [activeBranchId, user]);

  const handleAddVendor = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    const branchToUse = selectedBranchId || activeBranchId;
    if (!branchToUse) {
      alert("Please select a specific branch to add a vendor.");
      return;
    }
    
    setIsSubmitting(true);
    try {
      if (editingVendor) {
        await updateDoc(doc(db, 'vendors', editingVendor.id), {
          branchId: branchToUse,
          name,
          phone,
          email,
          address,
          updatedAt: Timestamp.now()
        });
        setEditingVendor(null);
      } else {
        await addDoc(collection(db, 'vendors'), {
          branchId: branchToUse,
          name,
          phone,
          email,
          address,
          createdAt: Timestamp.now(),
          tenantId: user?.tenantId || user?.uid
        });
      }
      setShowAdd(false);
      setName('');
      setPhone('');
      setEmail('');
      setAddress('');
      setSelectedBranchId(activeBranchId || '');
    } catch (e: any) {
      alert(e.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEditClick = (vendor: Vendor) => {
    setEditingVendor(vendor);
    setName(vendor.name);
    setPhone(vendor.phone);
    setEmail(vendor.email || '');
    setAddress(vendor.address || '');
    setSelectedBranchId(vendor.branchId);
    setShowAdd(true);
  };

  const handleDelete = async (id: string) => {
    if (confirm('Are you sure you want to delete this vendor?')) {
      try {
        await deleteDoc(doc(db, 'vendors', id));
      } catch (e: any) {
        alert(e.message);
      }
    }
  };

  // Authoritative Vendor Balance Calculator
  // In vendor bookkeeping:
  // - totalOut = purchases / bills received from vendor (our liability to pay)
  // - totalIn  = payments given to vendor (Cash In reducing our liability)
  // - rawBalance = totalIn - totalOut
  //   If rawBalance < 0: totalOut > totalIn => We owe the vendor (Payable / دینا ہے)
  //   If rawBalance > 0: totalIn > totalOut => We paid advance / credit (Advance / لینا ہے)
  const getVendorBalanceInfo = (vendorId: string): VendorBalanceInfo => {
    const vEntries = ledgerEntries.filter(e => e.vendorId === vendorId);
    const totalIn = vEntries.filter(e => e.type === 'IN').reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0);
    const totalOut = vEntries.filter(e => e.type === 'OUT').reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0);
    const rawBalance = totalIn - totalOut;
    const dueAmount = Math.abs(rawBalance);

    if (rawBalance < -0.01) {
      return {
        totalIn,
        totalOut,
        rawBalance,
        dueAmount,
        status: 'PAYABLE',
        statusLabel: 'دینا ہے (Payable)'
      };
    } else if (rawBalance > 0.01) {
      return {
        totalIn,
        totalOut,
        rawBalance,
        dueAmount,
        status: 'ADVANCE',
        statusLabel: 'ایڈوانس (Advance)'
      };
    } else {
      return {
        totalIn,
        totalOut,
        rawBalance: 0,
        dueAmount: 0,
        status: 'CLEAR',
        statusLabel: 'Clear (بے باق)'
      };
    }
  };

  const getVendorBalance = (vendorId: string) => {
    return getVendorBalanceInfo(vendorId).rawBalance;
  };

  // Build map of item names/ids to vendors for monthly sales
  const itemToVendorMap = useMemo(() => {
    const map = new Map<string, { id: string; name: string }>();
    purchases.forEach(p => {
      if (p.vendorId) {
        (p.items || []).forEach((item: any) => {
          const cleanName = String(item.name || '').trim().toLowerCase();
          const cleanId = String(item.id || '').trim();
          if (cleanName) {
            map.set(cleanName, { id: p.vendorId, name: p.vendorName });
          }
          if (cleanId) {
            map.set(cleanId, { id: p.vendorId, name: p.vendorName });
          }
        });
      }
    });
    return map;
  }, [purchases]);

  const selectedMonthObj = monthsList.find(m => m.value === selectedMonth);
  let startTimestamp = 0;
  let endTimestamp = Number.MAX_SAFE_INTEGER;
  let selectedMonthLabel = '';

  if (selectedMonthObj) {
    const start = new Date(selectedMonthObj.year, selectedMonthObj.month, 1);
    const end = new Date(selectedMonthObj.year, selectedMonthObj.month + 1, 0, 23, 59, 59, 999);
    startTimestamp = start.getTime();
    endTimestamp = end.getTime();
    selectedMonthLabel = start.toLocaleString('default', { month: 'short' });
  }

  const getMonthlyVendorSales = (vendorId: string, startTs: number, endTs: number) => {
    let totalSales = 0;
    sales.forEach(sale => {
      const saleDate = sale.date;
      if (!saleDate || saleDate < startTs || saleDate > endTs) return;

      const isReturn = sale.transactionType === 'Return';
      (sale.items || []).forEach((item: any) => {
        const cleanName = String(item.name || '').trim().toLowerCase();
        const cleanId = String(item.id || '').trim();
        const mappedVendor = itemToVendorMap.get(cleanName) || itemToVendorMap.get(cleanId);
        
        if (mappedVendor && mappedVendor?.id === vendorId) {
          const itemTotal = (Number(item.qty) || 0) * (Number(item.price) || 0);
          if (isReturn) {
            totalSales -= itemTotal;
          } else {
            totalSales += itemTotal;
          }
        }
      });
    });
    return totalSales;
  };

  // Fixed: Pick Cash IN (type === 'IN') for vendor payments (e.g. Cash Pay, Cheque Pay, Receipts)
  const getMonthlyVendorPayments = (vendorId: string, startTs: number, endTs: number) => {
    return ledgerEntries
      .filter(e => e.vendorId === vendorId && e.type === 'IN')
      .filter(e => {
        const dt = Number(e.date) || 0;
        return dt >= startTs && dt <= endTs;
      })
      .filter(e => !e.customerId && e.category !== 'Sale Invoice' && e.category !== 'Stock Transfer' && e.category !== 'Vendor Bill')
      .reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0);
  };

  // Overall totals across all displayed vendors
  const totalPayable = useMemo(() => {
    return vendors
      .map(v => getVendorBalance(v.id))
      .filter(b => b < 0)
      .reduce((sum, b) => sum + Math.abs(b), 0);
  }, [vendors, ledgerEntries]);

  const totalReceivable = useMemo(() => {
    return vendors
      .map(v => getVendorBalance(v.id))
      .filter(b => b > 0)
      .reduce((sum, b) => sum + b, 0);
  }, [vendors, ledgerEntries]);

  const payableVendorsCount = useMemo(() => {
    return vendors.filter(v => getVendorBalance(v.id) < -0.01).length;
  }, [vendors, ledgerEntries]);

  const advanceVendorsCount = useMemo(() => {
    return vendors.filter(v => getVendorBalance(v.id) > 0.01).length;
  }, [vendors, ledgerEntries]);

  const clearVendorsCount = useMemo(() => {
    return vendors.filter(v => Math.abs(getVendorBalance(v.id)) <= 0.01).length;
  }, [vendors, ledgerEntries]);

  // Filtered and sorted vendors for display
  const displayedVendors = useMemo(() => {
    return vendors
      .filter(v => {
        // Search filter
        if (searchTerm) {
          const q = searchTerm.toLowerCase().trim();
          const matchName = v.name?.toLowerCase().includes(q);
          const matchPhone = v.phone?.includes(q);
          const matchEmail = v.email?.toLowerCase().includes(q);
          if (!matchName && !matchPhone && !matchEmail) return false;
        }

        // Status tab filter
        if (balanceFilter === 'PAYABLE') {
          return getVendorBalance(v.id) < -0.01;
        }
        if (balanceFilter === 'ADVANCE') {
          return getVendorBalance(v.id) > 0.01;
        }
        if (balanceFilter === 'CLEAR') {
          return Math.abs(getVendorBalance(v.id)) <= 0.01;
        }

        return true;
      })
      .sort((a, b) => {
        const balA = getVendorBalanceInfo(a.id);
        const balB = getVendorBalanceInfo(b.id);
        // Put highest payable at the top
        if (balA.status === 'PAYABLE' && balB.status === 'PAYABLE') {
          return balB.dueAmount - balA.dueAmount;
        }
        if (balA.status === 'PAYABLE') return -1;
        if (balB.status === 'PAYABLE') return 1;
        return balB.dueAmount - balA.dueAmount;
      });
  }, [vendors, ledgerEntries, searchTerm, balanceFilter]);

  const currentBranchName = activeBranchId === 'main' 
    ? 'Main Branch (HQ)' 
    : (branches.find(b => b.id === activeBranchId)?.name || 'Branch');

  return (
    <>
      <div className="space-y-6 print:hidden">
        {/* Header Bar */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div className="card p-4 flex-1 w-full md:w-auto">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100 flex items-center">
                  <Building2 className="w-5 h-5 mr-3 text-sky-600 dark:text-sky-400" />
                  Vendors Directory & Balances (وینڈرز ڈائریکٹری اور بقایا کھاتہ)
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  Active Branch: <span className="font-semibold text-slate-700 dark:text-slate-200">{currentBranchName}</span> • Real-time synchronized with Ledger
                </p>
              </div>
            </div>
          </div>
          <button 
            onClick={() => {
              setEditingVendor(null);
              setName('');
              setPhone('');
              setEmail('');
              setAddress('');
              setShowAdd(!showAdd);
            }} 
            className="flex items-center px-4 py-2.5 bg-sky-600 text-white rounded-lg hover:bg-sky-700 transition shadow-sm font-semibold w-full md:w-auto justify-center"
          >
            <Plus className="w-5 h-5 mr-1.5" /> Add New Vendor
          </button>
        </div>

        {/* Summary Metric Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
          <div className="card p-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm rounded-xl">
            <div className="flex justify-between items-center mb-1">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">Total Vendors</span>
              <Building2 className="w-4 h-4 text-slate-400" />
            </div>
            <div className="text-2xl font-black text-slate-800 dark:text-slate-100">{vendors.length}</div>
            <div className="text-[11px] text-slate-500 mt-1 flex items-center gap-2">
              <span>{payableVendorsCount} Payable</span> • <span>{advanceVendorsCount} Advance</span>
            </div>
          </div>

          <div className="card p-5 bg-rose-50/40 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-900/50 shadow-sm rounded-xl">
            <div className="flex justify-between items-center mb-1">
              <span className="text-xs font-bold text-rose-600 dark:text-rose-400 uppercase tracking-widest">Total Payable (دینا ہے)</span>
              <ArrowDownLeft className="w-4 h-4 text-rose-600" />
            </div>
            <div className="text-2xl font-black text-rose-600 dark:text-rose-400">
              PKR {totalPayable.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
            </div>
            <div className="text-[11px] text-rose-700/80 dark:text-rose-300/80 mt-1 font-medium">
              We owe across {payableVendorsCount} vendors
            </div>
          </div>

          <div className="card p-5 bg-emerald-50/40 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900/50 shadow-sm rounded-xl">
            <div className="flex justify-between items-center mb-1">
              <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-widest">Total Advance (لینا ہے)</span>
              <ArrowUpRight className="w-4 h-4 text-emerald-600" />
            </div>
            <div className="text-2xl font-black text-emerald-600 dark:text-emerald-400">
              PKR {totalReceivable.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
            </div>
            <div className="text-[11px] text-emerald-700/80 dark:text-emerald-300/80 mt-1 font-medium">
              Prepaid / advance with {advanceVendorsCount} vendors
            </div>
          </div>

          <div className="card p-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm rounded-xl">
            <div className="flex justify-between items-center mb-1">
              <span className="text-xs font-bold text-sky-600 dark:text-sky-400 uppercase tracking-widest">Net Position (خالص پوزیشن)</span>
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                (totalReceivable - totalPayable) >= 0 
                  ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-200' 
                  : 'bg-rose-100 text-rose-700 dark:bg-rose-900 dark:text-rose-200'
              }`}>
                {(totalReceivable - totalPayable) >= 0 ? 'Prepaid Net' : 'Net Payable'}
              </span>
            </div>
            <div className={`text-2xl font-black ${(totalReceivable - totalPayable) >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
              PKR {Math.abs(totalReceivable - totalPayable).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
            </div>
            <div className="text-[11px] text-slate-500 mt-1">
              {(totalReceivable - totalPayable) >= 0 ? 'Surplus Advance' : 'Total Net Outstanding Debt'}
            </div>
          </div>
        </div>

        {/* Add / Edit Form */}
        {showAdd && (
          <div className="card p-6 bg-slate-50 dark:bg-slate-800/50 border border-slate-300 dark:border-slate-700 rounded-xl shadow-sm">
            <h3 className="font-bold text-base mb-4 text-slate-800 dark:text-slate-100 border-b border-slate-200 dark:border-slate-700 pb-2">
              {editingVendor ? 'Edit Vendor Profile' : 'New Vendor Profile (نیا وینڈر شامل کریں)'}
            </h3>
            <form onSubmit={handleAddVendor} className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {user?.role === 'super_admin' && !activeBranchId && (
                <div className="md:col-span-2">
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Assign to Branch *</label>
                  <select 
                    required 
                    value={selectedBranchId} 
                    onChange={e => setSelectedBranchId(e.target.value)} 
                    className="w-full rounded-md border border-slate-300 dark:border-slate-600 px-3 py-2 bg-white dark:bg-slate-900 text-sm font-medium"
                  >
                    <option value="" disabled>Select a branch</option>
                    <option value="main">Main Branch (HQ)</option>
                    {branches.map(b => (
                      <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                  </select>
                </div>
              )}
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Company / Vendor Name (وینڈر کا نام) *</label>
                <input required type="text" value={name} onChange={e => setName(e.target.value)} className="w-full rounded-md border border-slate-300 dark:border-slate-600 px-3 py-2 bg-white dark:bg-slate-900 text-sm font-medium" placeholder="e.g. ABEER KHAN, DAWOOD TEXTILES" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Phone Number (فون نمبر) *</label>
                <input required type="text" value={phone} onChange={e => setPhone(e.target.value)} className="w-full rounded-md border border-slate-300 dark:border-slate-600 px-3 py-2 bg-white dark:bg-slate-900 text-sm font-medium" placeholder="0300-1234567" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Email Address (ای میل)</label>
                <input type="email" value={email} onChange={e => setEmail(e.target.value)} className="w-full rounded-md border border-slate-300 dark:border-slate-600 px-3 py-2 bg-white dark:bg-slate-900 text-sm font-medium" placeholder="vendor@example.com" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Business Address / City (پتہ یا شہر)</label>
                <input type="text" value={address} onChange={e => setAddress(e.target.value)} className="w-full rounded-md border border-slate-300 dark:border-slate-600 px-3 py-2 bg-white dark:bg-slate-900 text-sm font-medium" placeholder="Tata Market, Factory Area, Faisalabad" />
              </div>
              <div className="md:col-span-2 flex justify-end gap-2 mt-2">
                <button 
                  type="button" 
                  onClick={() => {
                    setShowAdd(false);
                    setEditingVendor(null);
                    setName('');
                    setPhone('');
                    setEmail('');
                    setAddress('');
                  }} 
                  disabled={isSubmitting} 
                  className="px-4 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-md font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition disabled:opacity-50 text-sm"
                >
                  Cancel
                </button>
                <button type="submit" disabled={isSubmitting} className="px-6 py-2 bg-sky-600 text-white rounded-md font-semibold hover:bg-sky-700 transition disabled:opacity-50 text-sm">
                  {isSubmitting ? 'Saving...' : editingVendor ? 'Update Vendor' : 'Save Vendor'}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Vendors Balances & Analytics Section */}
        <div className="card p-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm rounded-xl">
          <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center border-b border-slate-100 dark:border-slate-800 pb-4 mb-5 gap-4">
            <div>
              <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                Vendors Outstanding Balances Statement
                <span className="text-xs font-normal text-slate-500 dark:text-slate-400">
                  (وینڈرز کا درست بقایا کھاتہ اور ادائیگیاں)
                </span>
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Accurate running balance calculated from all purchases, bills, and payments in the ledger.
              </p>
            </div>
            
            <div className="flex flex-wrap items-center gap-3 w-full lg:w-auto">
              {/* Search Vendor Input */}
              <div className="relative flex-1 sm:w-64">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search vendor name, phone..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 font-medium text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-sky-500 shadow-sm"
                />
              </div>

              {/* Month Selection */}
              <select
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                className="rounded-lg border border-slate-300 dark:border-slate-600 px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 font-semibold text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-sky-500 shadow-sm"
              >
                {monthsList.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label} Payments
                  </option>
                ))}
              </select>

              {/* Print All Balances Button */}
              <button
                onClick={() => printInvoice('vendor-balances-print', `All_Vendors_Balances_${selectedMonth || 'Current'}`, 'a4')}
                className="flex items-center px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-semibold text-xs transition shadow-sm"
              >
                <Printer className="w-4 h-4 mr-1.5" /> Print Balance Sheet (پرنٹ کھاتہ)
              </button>
            </div>
          </div>

          {/* Quick Filter Tabs */}
          <div className="flex items-center gap-2 mb-4 overflow-x-auto pb-1 text-xs font-semibold">
            <button
              onClick={() => setBalanceFilter('ALL')}
              className={`px-3 py-1.5 rounded-lg border transition ${
                balanceFilter === 'ALL'
                  ? 'bg-slate-800 text-white border-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:border-slate-100'
                  : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-50'
              }`}
            >
              All Vendors ({vendors.length})
            </button>
            <button
              onClick={() => setBalanceFilter('PAYABLE')}
              className={`px-3 py-1.5 rounded-lg border transition flex items-center gap-1.5 ${
                balanceFilter === 'PAYABLE'
                  ? 'bg-rose-600 text-white border-rose-600'
                  : 'bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-400 border-rose-200 dark:border-rose-900/60 hover:bg-rose-100'
              }`}
            >
              <span>Payable (جن کو دینا ہے)</span>
              <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-white/20">{payableVendorsCount}</span>
            </button>
            <button
              onClick={() => setBalanceFilter('ADVANCE')}
              className={`px-3 py-1.5 rounded-lg border transition flex items-center gap-1.5 ${
                balanceFilter === 'ADVANCE'
                  ? 'bg-emerald-600 text-white border-emerald-600'
                  : 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-900/60 hover:bg-emerald-100'
              }`}
            >
              <span>Advance (جن کا ایڈوانس ہے)</span>
              <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-white/20">{advanceVendorsCount}</span>
            </button>
            <button
              onClick={() => setBalanceFilter('CLEAR')}
              className={`px-3 py-1.5 rounded-lg border transition flex items-center gap-1.5 ${
                balanceFilter === 'CLEAR'
                  ? 'bg-slate-600 text-white border-slate-600'
                  : 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-100'
              }`}
            >
              <span>Clear / Nil ({clearVendorsCount})</span>
            </button>
          </div>

          {/* Accurate Balances Table */}
          <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="bg-slate-100 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-700 text-xs font-bold uppercase text-slate-600 dark:text-slate-300 tracking-wider">
                  <th className="px-4 py-3 text-center w-12">#</th>
                  <th className="px-4 py-3">Vendor Profile</th>
                  <th className="px-4 py-3 text-right">Outstanding Balance (بقایا رقم)</th>
                  <th className="px-4 py-3 text-center">Status (کیفیت)</th>
                  <th className="px-4 py-3 text-right">Total Purchases (کل مال)</th>
                  <th className="px-4 py-3 text-right">Total Paid (کل ادائیگیاں)</th>
                  <th className="px-4 py-3 text-right">{selectedMonthLabel} Payments</th>
                  <th className="px-4 py-3 text-center">Ledger Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {displayedVendors.map((v, index) => {
                  const balInfo = getVendorBalanceInfo(v.id);
                  const monthlyPayments = getMonthlyVendorPayments(v.id, startTimestamp, endTimestamp);
                  const bName = branches.find(b => b.id === v.branchId)?.name || currentBranchName;

                  return (
                    <tr key={v.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition">
                      <td className="px-4 py-3.5 text-center font-mono text-xs text-slate-400">
                        {index + 1}
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="font-bold text-slate-900 dark:text-slate-100 text-base">
                          {v.name}
                        </div>
                        <div className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-2 mt-0.5">
                          {v.phone && <span>📞 {v.phone}</span>}
                          {v.address && <span className="opacity-75">• {v.address}</span>}
                          <span className="text-[10px] px-1.5 py-0.2 bg-slate-100 dark:bg-slate-800 text-slate-500 rounded">
                            {bName}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3.5 text-right font-mono font-extrabold text-base">
                        <span className={
                          balInfo.status === 'PAYABLE' ? 'text-rose-600 dark:text-rose-400' :
                          balInfo.status === 'ADVANCE' ? 'text-emerald-600 dark:text-emerald-400' :
                          'text-slate-600 dark:text-slate-300'
                        }>
                          PKR {balInfo.dueAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </span>
                      </td>
                      <td className="px-4 py-3.5 text-center">
                        <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold border ${
                          balInfo.status === 'PAYABLE' 
                            ? 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/50 dark:text-rose-300 dark:border-rose-900' 
                            : balInfo.status === 'ADVANCE'
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-900'
                              : 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700'
                        }`}>
                          {balInfo.statusLabel}
                        </span>
                      </td>
                      <td className="px-4 py-3.5 text-right font-mono text-slate-700 dark:text-slate-300 font-semibold text-xs">
                        PKR {balInfo.totalOut.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </td>
                      <td className="px-4 py-3.5 text-right font-mono text-emerald-600 dark:text-emerald-400 font-semibold text-xs">
                        PKR {balInfo.totalIn.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </td>
                      <td className="px-4 py-3.5 text-right font-mono text-sky-600 dark:text-sky-400 font-bold text-xs">
                        PKR {monthlyPayments.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </td>
                      <td className="px-4 py-3.5 text-center">
                        <button
                          onClick={() => navigate('/ledger', { state: { viewMode: 'vendor', vendorId: v.id } })}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300 hover:bg-sky-100 dark:hover:bg-sky-900/60 font-semibold text-xs transition border border-sky-200 dark:border-sky-800 shadow-sm"
                          title="Open full ledger history"
                        >
                          <span>کھاتہ دیکھیں</span>
                          <ExternalLink className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {displayedVendors.length === 0 && (
                  <tr>
                    <td colSpan={8} className="text-center py-10 text-slate-400">
                      No vendors found matching your criteria.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Vendors Profiles Directory Cards */}
        <div className="border-t border-slate-200 dark:border-slate-700 pt-6">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest">
              Vendors Profiles Directory ({displayedVendors.length} Profiles)
            </h3>
            <span className="text-xs text-slate-400">Click "View Ledger History" on any profile to see all transactions</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
            {displayedVendors.map(v => {
              const balInfo = getVendorBalanceInfo(v.id);
              const bName = branches.find(b => b.id === v.branchId)?.name || currentBranchName;

              return (
                <div key={v.id} className="card p-5 group flex flex-col bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl hover:shadow-md transition">
                  <div className="flex justify-between items-start mb-2">
                    <div className="flex items-center">
                      <div className="w-10 h-10 rounded-lg bg-sky-50 dark:bg-sky-950/60 border border-sky-100 dark:border-sky-800 flex items-center justify-center text-sky-600 dark:text-sky-400 font-bold text-lg mr-3 shadow-sm">
                        <Building2 className="w-5 h-5 text-sky-600 dark:text-sky-400" />
                      </div>
                      <div>
                        <h3 className="font-bold text-slate-900 dark:text-slate-100 text-base">{v.name}</h3>
                        <div className="text-[10px] text-slate-400 uppercase tracking-widest font-semibold">{bName}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <button onClick={() => handleEditClick(v)} className="text-slate-400 hover:text-sky-500 transition p-1" title="Edit Vendor">
                        <Pencil className="w-4 h-4" />
                      </button>
                      {user?.role === 'super_admin' && enableDeletion && (
                        <button onClick={() => handleDelete(v.id)} className="text-slate-300 hover:text-rose-500 transition p-1" title="Delete Vendor">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                  
                  {/* Live Accurate Balance Card */}
                  <div className={`mt-3 p-3 rounded-lg border flex items-center justify-between ${
                    balInfo.status === 'PAYABLE' 
                      ? 'bg-rose-50/70 dark:bg-rose-950/30 border-rose-200 dark:border-rose-900/60' 
                      : balInfo.status === 'ADVANCE' 
                        ? 'bg-emerald-50/70 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900/60' 
                        : 'bg-slate-50 dark:bg-slate-800/40 border-slate-200 dark:border-slate-700'
                  }`}>
                    <div>
                      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                        Current Balance (موجودہ بقایا کھاتہ)
                      </div>
                      <div className={`text-lg font-black font-mono mt-0.5 ${
                        balInfo.status === 'PAYABLE' ? 'text-rose-600 dark:text-rose-400' :
                        balInfo.status === 'ADVANCE' ? 'text-emerald-600 dark:text-emerald-400' :
                        'text-slate-700 dark:text-slate-200'
                      }`}>
                        PKR {balInfo.dueAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </div>
                    </div>
                    <span className={`px-2.5 py-1 rounded text-xs font-bold ${
                      balInfo.status === 'PAYABLE' ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/60 dark:text-rose-200' :
                      balInfo.status === 'ADVANCE' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/60 dark:text-emerald-200' :
                      'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-300'
                    }`}>
                      {balInfo.statusLabel}
                    </span>
                  </div>

                  {/* Summary Stats Row */}
                  <div className="grid grid-cols-2 gap-2 mt-3 pt-2 text-[11px] font-medium border-t border-slate-100 dark:border-slate-800">
                    <div>
                      <span className="text-slate-400">Total Purchases:</span>
                      <div className="font-mono font-bold text-slate-700 dark:text-slate-300">
                        PKR {balInfo.totalOut.toLocaleString()}
                      </div>
                    </div>
                    <div>
                      <span className="text-slate-400">Total Paid:</span>
                      <div className="font-mono font-bold text-emerald-600 dark:text-emerald-400">
                        PKR {balInfo.totalIn.toLocaleString()}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-1.5 flex-1 mt-3 pt-2 border-t border-slate-100 dark:border-slate-800">
                    <div className="flex items-center text-xs text-slate-600 dark:text-slate-300">
                      <Phone className="w-3.5 h-3.5 mr-2 text-slate-400 shrink-0" />
                      {v.phone || 'No phone'}
                    </div>
                    {v.email && (
                      <div className="flex items-center text-xs text-slate-600 dark:text-slate-300">
                        <Mail className="w-3.5 h-3.5 mr-2 text-slate-400 shrink-0" />
                        {v.email}
                      </div>
                    )}
                    {v.address && (
                      <div className="flex items-center text-xs text-slate-600 dark:text-slate-300">
                        <MapPin className="w-3.5 h-3.5 mr-2 text-slate-400 shrink-0" />
                        {v.address}
                      </div>
                    )}
                  </div>
                  
                  <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800/80 flex justify-between items-center text-xs">
                     <span className="text-slate-400 font-mono text-[10px]">ID: {v.id.substring(0, 8)}</span>
                     <button 
                       onClick={() => navigate('/ledger', { state: { viewMode: 'vendor', vendorId: v.id } })} 
                       className="text-sky-600 dark:text-sky-400 font-semibold hover:underline inline-flex items-center gap-1"
                     >
                       <span>View Ledger History</span>
                       <ExternalLink className="w-3 h-3" />
                     </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Hidden Printable document for All Print */}
      <div id="vendor-balances-print" className="hidden print:block print:bg-white print:w-full print:static print:z-auto print:h-auto print:p-0 font-sans text-black">
        <div className="flex justify-between items-start border-b-[3px] border-black pb-3 mb-6">
          <div>
            <h1 className="text-2xl font-black uppercase tracking-wider text-black">
              {currentBranchName.toUpperCase()}
            </h1>
            <p className="text-sm font-bold uppercase tracking-widest text-slate-800 mt-0.5">
              Vendors Outstanding Balances Statement (وینڈرز بقایا کھاتہ رپورٹ)
            </p>
          </div>
          <div className="text-right">
            <p className="text-sm font-bold text-black">Print Date: {new Date().toLocaleDateString('en-PK', { day: '2-digit', month: 'short', year: 'numeric' })}</p>
            <p className="text-xs text-slate-600">{new Date().toLocaleTimeString()}</p>
          </div>
        </div>

        <table className="w-full text-left border-collapse mt-4 text-xs text-black">
          <thead>
            <tr className="border-b-2 border-black text-xs font-bold uppercase tracking-wider text-black bg-slate-100">
              <th className="py-2.5 px-2 text-center w-8">#</th>
              <th className="py-2.5 px-2">Vendor Name</th>
              <th className="py-2.5 px-2">Phone</th>
              <th className="py-2.5 px-2 text-right">Total Purchases (Cr)</th>
              <th className="py-2.5 px-2 text-right">Total Paid (Dr)</th>
              <th className="py-2.5 px-2 text-right">Outstanding Balance</th>
              <th className="py-2.5 px-2 text-center">Status (کیفیت)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-300">
            {vendors.map((v, index) => {
              const balInfo = getVendorBalanceInfo(v.id);
              return (
                <tr key={v.id} className="text-black">
                  <td className="py-2 px-2 text-center font-medium font-mono text-black">{index + 1}</td>
                  <td className="py-2 px-2 font-bold text-black text-sm">{v.name}</td>
                  <td className="py-2 px-2 text-black font-mono">{v.phone || '-'}</td>
                  <td className="py-2 px-2 text-right font-mono text-black">
                    {balInfo.totalOut.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </td>
                  <td className="py-2 px-2 text-right font-mono text-black">
                    {balInfo.totalIn.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </td>
                  <td className="py-2 px-2 text-right font-mono font-bold text-black text-sm">
                    PKR {balInfo.dueAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </td>
                  <td className="py-2 px-2 text-center font-bold text-xs">
                    {balInfo.statusLabel}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* Printable Summary Footer */}
        <div className="mt-8 border-t-2 border-black pt-4 space-y-2.5 text-black">
          <div className="flex justify-between items-center">
            <div className="font-bold uppercase text-xs text-rose-800">
              Total Payable (واجب الادا - ہم نے وینڈرز کو دینا ہے):
            </div>
            <div className="font-mono font-bold text-base text-rose-800">
              PKR {totalPayable.toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </div>
          </div>
          <div className="flex justify-between items-center">
            <div className="font-bold uppercase text-xs text-emerald-800">
              Total Advance (ایڈوانس - ہم نے وینڈرز سے لینا ہے):
            </div>
            <div className="font-mono font-bold text-base text-emerald-800">
              PKR {totalReceivable.toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </div>
          </div>
          <div className="flex justify-between items-center pt-2 border-t border-black">
            <div className="font-extrabold uppercase text-sm">
              Net Outstanding Balance (خالص بقایا کھاتہ):
            </div>
            <div className="font-mono font-black text-lg">
              PKR {Math.abs(totalReceivable - totalPayable).toLocaleString(undefined, { minimumFractionDigits: 2 })}
              <span className="text-xs ml-1 font-bold">
                {(totalReceivable - totalPayable) >= 0 ? '(Prepaid / Advance)' : '(Payable / دینا ہے)'}
              </span>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
