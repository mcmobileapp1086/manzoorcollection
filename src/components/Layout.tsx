import { Outlet, Link, useLocation, useNavigate } from 'react-router';
import { useAuth } from '../context/AuthContext';
import { useBranch } from '../context/BranchContext';
import { useSettings } from '../context/SettingsContext';
import { InstallPWA } from './InstallPWA';
import { MCLogo } from './MCLogo';
import { 
  BuildingIcon, 
  LayoutDashboard, 
  Package, 
  ShoppingCart, 
  Truck, 
  Users, 
  Building2, 
  UsersRound, 
  LogOut,
  ChevronDown,
  BookText,
  BarChart3,
  KeyRound,
  Banknote,
  Menu,
  ShieldAlert,
  ArrowRightLeft,
  X,
  Wallet,
  History,
  TrendingUp,
  Lock,
  Eye,
  EyeOff,
  Landmark,
  Boxes,
  CalendarCheck
} from 'lucide-react';
import { ThemeToggle } from './ThemeToggle';
import clsx from 'clsx';
import React, { useState, useEffect } from 'react';
import { collection, query, where } from '../lib/customFirestore';
import { updatePassword, EmailAuthProvider, reauthenticateWithCredential } from 'firebase/auth';
import { db, safeCollectionSnapshot } from '../lib/firebase';
import toast from 'react-hot-toast';

export function Layout() {
  const { user, firebaseUser, logout } = useAuth();
  const { branches, activeBranchId, setActiveBranchId } = useBranch();
  useSettings();
  const location = useLocation();
  const navigate = useNavigate();
  const [showBranchMenu, setShowBranchMenu] = useState(false);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  // Profit & Loss Password Lock State
  const [showProfitLossModal, setShowProfitLossModal] = useState(false);
  const [profitLossPassword, setProfitLossPassword] = useState('');
  const [showProfitLossPassword, setShowProfitLossPassword] = useState(false);
  const [profitLossError, setProfitLossError] = useState('');
  const [hasAuthSessionIssue, setHasAuthSessionIssue] = useState(false);

  useEffect(() => {
    const handleAuthIssue = () => setHasAuthSessionIssue(true);
    window.addEventListener('ais-auth-session-required', handleAuthIssue);
    return () => {
      window.removeEventListener('ais-auth-session-required', handleAuthIssue);
    };
  }, []);

  const handleUnlockProfitLoss = (e: React.FormEvent) => {
    e.preventDefault();
    if (profitLossPassword === 'superadmin@@') {
      sessionStorage.setItem('profit_loss_unlocked', 'true');
      setShowProfitLossModal(false);
      setProfitLossPassword('');
      setProfitLossError('');
      toast.success('Profit & Loss Unlocked');
      navigate('/profit-loss');
    } else {
      setProfitLossError('Incorrect password! Please try again.');
    }
  };

  // Change Password State
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [isChangingPwd, setIsChangingPwd] = useState(false);
  const [pwdError, setPwdError] = useState('');
  const [pwdSuccess, setPwdSuccess] = useState('');

  useEffect(() => {
    if (user?.role !== 'super_admin' && !activeBranchId) {
      return;
    }

    let inventoryQuery = collection(db, 'inventory');
    if (activeBranchId) {
      inventoryQuery = query(inventoryQuery, where('branchId', '==', activeBranchId)) as any;
    }

    const unsubInventory = safeCollectionSnapshot(inventoryQuery, (snap) => {
      const items = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) } as any));
      const lowStock = items.filter(i => i.stock <= (i.minStockLevel || 0));
      if (lowStock.length > 0 && user?.role === 'branch_admin') {
        console.log(`[SYSTEM MOCK] Active low stock items: ${lowStock.length}`);
      }
    });

    return () => {
      unsubInventory();
    };
  }, [activeBranchId, user?.role, user?.email]);

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser) return;
    setIsChangingPwd(true);
    setPwdError('');
    setPwdSuccess('');

    try {
      const credential = EmailAuthProvider.credential(firebaseUser.email || '', currentPassword);
      await reauthenticateWithCredential(firebaseUser, credential);
      await updatePassword(firebaseUser, newPassword);
      setPwdSuccess("Password updated successfully!");
      setCurrentPassword('');
      setNewPassword('');
    } catch (err: any) {
      setPwdError(err?.message || 'Failed to update password.');
    } finally {
      setIsChangingPwd(false);
    }
  };

  const fullNavigation: any[] = [
    { name: 'Dashboard', href: '/', icon: LayoutDashboard, roles: ['super_admin', 'branch_admin', 'staff', 'limited_access', 'sales_stock_only', 'billing_only', 'new_limited_access', 'cashier'] },
    { name: 'Inventory', href: '/inventory', icon: Package, roles: ['super_admin', 'branch_admin', 'staff', 'limited_access', 'sales_stock_only', 'billing_only', 'new_limited_access', 'cashier'] },
    { name: 'Stock Transfer', href: '/stock-transfer', icon: ArrowRightLeft, roles: ['super_admin', 'branch_admin', 'limited_access', 'staff', 'sales_stock_only', 'billing_only', 'new_limited_access', 'cashier'] },
    { name: 'Sales / Billing', href: '/sales', icon: ShoppingCart, roles: ['super_admin', 'branch_admin', 'staff', 'billing_only', 'limited_access', 'sales_stock_only', 'new_limited_access', 'cashier', 'online_sale_login', 'online_team'] },
    { name: 'Customers', href: '/customers', icon: Users, roles: ['super_admin', 'branch_admin', 'staff', 'billing_only', 'sales_stock_only', 'new_limited_access', 'online_sale_login', 'online_team'] },
    { name: 'Purchases', href: '/purchases', icon: Truck, roles: ['super_admin', 'branch_admin', 'staff', 'limited_access', 'new_limited_access', 'cashier'] },
    { name: 'Vendors', href: '/vendors', icon: Building2, roles: ['super_admin', 'branch_admin', 'staff', 'limited_access', 'new_limited_access'] },
    { name: 'Reports', href: '/reports', icon: BarChart3, roles: ['super_admin', 'branch_admin', 'limited_access', 'new_limited_access'] },
    { name: 'Stock Movement Report', href: '/reports?tab=stock_movement', icon: Boxes, roles: ['super_admin', 'branch_admin', 'limited_access', 'new_limited_access', 'staff', 'sales_stock_only', 'cashier'] },
    { name: 'Profit & Loss', href: '/profit-loss', icon: TrendingUp, roles: ['super_admin', 'branch_admin', 'limited_access', 'new_limited_access'] },
    { name: 'Salesman Report', href: '/salesman-report', icon: BarChart3, roles: ['super_admin', 'branch_admin', 'limited_access', 'new_limited_access'] },
    { name: 'Customer Report', href: '/customer-report', icon: Users, roles: ['super_admin', 'branch_admin', 'staff', 'limited_access', 'new_limited_access'] },
    { name: 'Expenses', href: '/expenses', icon: Wallet, roles: ['super_admin', 'branch_admin', 'limited_access', 'new_limited_access', 'cashier'] },
    { name: 'Owner Account', href: '/owner-account', icon: Landmark, roles: ['super_admin', 'branch_admin', 'limited_access', 'new_limited_access', 'cashier', 'staff'] },
    { name: 'Ledger', href: '/ledger', icon: BookText, roles: ['super_admin', 'branch_admin', 'limited_access', 'new_limited_access'] },
    { name: 'Labour', href: '/employees', icon: UsersRound, roles: ['super_admin', 'branch_admin', 'limited_access', 'new_limited_access', 'cashier'] },
    { name: 'Daily Attendance', href: '/attendance', icon: CalendarCheck, roles: ['super_admin', 'branch_admin', 'limited_access', 'new_limited_access', 'cashier', 'staff'] },
    { name: 'Employee Purchases', href: '/employee-purchases', icon: ShoppingCart, roles: ['super_admin', 'branch_admin', 'limited_access', 'staff', 'billing_only', 'new_limited_access'] },
    { name: 'Salesmen', href: '/salesmen', icon: UsersRound, roles: ['super_admin', 'branch_admin', 'limited_access', 'new_limited_access'] },
    { name: 'Payroll', href: '/payroll', icon: Banknote, roles: ['super_admin', 'branch_admin', 'limited_access', 'new_limited_access'] },
    { name: 'Users & Logins', href: '/users', icon: KeyRound, roles: ['super_admin', 'branch_admin'] },
    { name: 'Online Employees', href: '/online-sales-employees', icon: Users, roles: ['super_admin', 'branch_admin', 'limited_access', 'new_limited_access', 'online_sale_login', 'online_team'] },
    { name: 'Online Sales Report', href: '/online-sales-report', icon: BarChart3, roles: ['super_admin', 'branch_admin', 'limited_access', 'new_limited_access', 'online_sale_login', 'online_team'] },
  ];

  const navigation = fullNavigation.filter(item => user && item.roles.includes(user.role));

  if (user?.role === 'super_admin' || user?.role === 'branch_admin') {
    navigation.push({ name: 'Logs Activity', href: '/activity-logs', icon: History, roles: ['super_admin', 'branch_admin'] });
  }

  if (user?.role === 'super_admin') {
    navigation.push({ name: 'Manage Branches', href: '/branches', icon: BuildingIcon, roles: ['super_admin'] });
    navigation.push({ name: 'Settings', href: '/settings', icon: ShieldAlert, roles: ['super_admin'] });
  }

  const activeBranch = branches.find(b => b.id === activeBranchId) || (branches.length > 0 ? branches[0] : null);
  const currentNavItem = navigation.find(item =>
    item.href.includes('?')
      ? location.pathname + location.search === item.href
      : location.pathname === item.href && !location.search
  );

  return (
    <div className="flex bg-[#F4F6F9] dark:bg-[#090D16] flex-1 overflow-hidden h-screen w-full print:h-auto print:overflow-visible print:block relative">
      {/* Mobile Overlay */}
      {isMobileMenuOpen && (
        <div
          className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs z-30 md:hidden"
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}

      {/* Executive Obsidian Sidebar */}
      <aside className={clsx(
        "bg-[#0B1120] border-r border-slate-800/90 h-full flex flex-col print:hidden z-40 shrink-0 absolute md:relative transition-transform duration-200 ease-out w-64",
        isMobileMenuOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
      )}>
        <div className="h-16 px-5 border-b border-slate-800/80 flex justify-between items-center shrink-0">
          <Link to="/" className="flex items-center gap-3 min-w-0">
            <MCLogo className="w-9 h-9 shrink-0" />
            <div className="min-w-0">
              <div className="text-white font-display font-bold text-sm tracking-tight truncate">
                Manzoor Collection
              </div>
              <div className="text-[11px] text-slate-400 truncate">
                Retail Management
              </div>
            </div>
          </Link>
          <button
            type="button"
            onClick={() => setIsMobileMenuOpen(false)}
            className="md:hidden p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <nav className="py-3 px-3 flex-1 overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
          <div className="space-y-0.5">
            {navigation.map((item) => {
              const isActive = item.href.includes('?')
                ? (location.pathname + location.search === item.href)
                : (location.pathname === item.href && !location.search);
              return (
                <Link
                  key={item.name}
                  to={item.href || '#'}
                  onClick={(e) => {
                    setIsMobileMenuOpen(false);
                    if (item.href === '/profit-loss') {
                      if (sessionStorage.getItem('profit_loss_unlocked') !== 'true') {
                        e.preventDefault();
                        setProfitLossPassword('');
                        setProfitLossError('');
                        setShowProfitLossModal(true);
                      }
                    }
                  }}
                  className={clsx(
                    isActive
                      ? 'bg-gradient-to-r from-blue-600 to-blue-500 text-white font-semibold shadow-sm shadow-blue-950/50'
                      : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/60 font-medium',
                    'flex items-center px-3 py-2.5 rounded-lg text-[13px] transition-all duration-150 justify-between group whitespace-nowrap'
                  )}
                >
                  <div className="flex items-center min-w-0">
                    {item.icon && (
                      <item.icon
                        className={clsx(
                          "mr-3 shrink-0 h-4 w-4 transition-colors",
                          isActive ? "text-white" : "text-slate-400 group-hover:text-slate-200"
                        )}
                      />
                    )}
                    <span className="truncate">{item.name}</span>
                  </div>
                  {item.href === '/profit-loss' && (
                    <Lock className={clsx("w-3.5 h-3.5 shrink-0 ml-2", isActive ? "text-blue-100" : "text-amber-400/80")} />
                  )}
                </Link>
              );
            })}
          </div>
        </nav>

        <div className="p-3.5 mt-auto border-t border-slate-800/80 bg-[#090D16]/60">
          <div className="mb-3 md:hidden">
            <InstallPWA className="w-full justify-center !py-2 !px-4 !bg-blue-600 hover:!bg-blue-700 text-xs rounded-lg shadow-xs" />
          </div>
          <div className="flex items-center justify-between gap-2 px-1">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-lg bg-slate-800 border border-slate-700 text-slate-200 flex items-center justify-center text-xs font-bold shrink-0">
                {user?.name?.substring(0, 2).toUpperCase() || 'MC'}
              </div>
              <div className="min-w-0">
                <div className="text-xs font-semibold text-slate-200 truncate">{user?.name}</div>
                <div className="text-[11px] text-slate-400 capitalize truncate">{user?.role.replace(/_/g, ' ')}</div>
              </div>
            </div>
            <button
              type="button"
              onClick={logout}
              className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors shrink-0 cursor-pointer"
              title="Sign Out"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content Workspace */}
      <main className="flex-1 flex flex-col overflow-hidden print:overflow-visible relative print:block print:h-auto min-w-0">
        {hasAuthSessionIssue && (
          <div className="bg-amber-600 text-white px-4 py-2.5 text-xs flex items-center justify-between z-50 shrink-0 shadow-sm">
            <div className="flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 shrink-0 text-amber-200" />
              <span>Authentication session authorization needed in preview iframe. Open in a new tab to continue.</span>
            </div>
            <div className="flex items-center gap-2">
              <a
                href={window.location.href}
                target="_blank"
                rel="noopener noreferrer"
                className="bg-white text-amber-900 font-bold px-2.5 py-1 rounded text-xs hover:bg-amber-50 shadow-xs cursor-pointer inline-flex items-center gap-1"
              >
                Open in New Tab ↗
              </a>
              <button
                type="button"
                onClick={() => { setHasAuthSessionIssue(false); window.location.reload(); }}
                className="bg-amber-700 hover:bg-amber-800 text-white font-medium px-2 py-1 rounded text-xs cursor-pointer"
              >
                Reload
              </button>
            </div>
          </div>
        )}

        {/* Executive Top Bar */}
        <header className="h-16 bg-white dark:bg-[#0F172A] border-b border-slate-200 dark:border-slate-800 px-4 sm:px-6 lg:px-8 flex items-center justify-between gap-4 z-10 shrink-0 print:hidden">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setIsMobileMenuOpen(true)}
              className="p-2 -ml-1.5 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 md:hidden shrink-0"
            >
              <Menu className="w-5 h-5" />
            </button>

            {/* Breadcrumb Context */}
            <div className="hidden lg:flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
              <span className="font-medium text-slate-400 dark:text-slate-500">Workspace</span>
              <span aria-hidden="true">/</span>
              <span className="font-semibold text-slate-800 dark:text-slate-100">
                {currentNavItem?.name || 'Dashboard'}
              </span>
            </div>

            <div className="hidden lg:block h-4 w-px bg-slate-200 dark:bg-slate-800" />

            {/* Branch Switcher / Active Branch Indicator */}
            {user?.role === 'super_admin' ? (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowBranchMenu(!showBranchMenu)}
                  className="bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600 text-xs text-slate-800 dark:text-slate-100 rounded-lg px-3 py-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 flex items-center justify-between gap-2 min-w-[150px] sm:min-w-[200px] transition-colors cursor-pointer"
                >
                  <span className="flex items-center gap-2 truncate font-semibold">
                    <Building2 className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 shrink-0" />
                    <span className="truncate">{activeBranch ? activeBranch.name : 'Select Branch'}</span>
                  </span>
                  <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                </button>

                {showBranchMenu && (
                  <div className="absolute left-0 mt-1.5 w-60 rounded-xl shadow-lg bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 z-20 text-xs text-slate-700 dark:text-slate-200 overflow-hidden">
                    <div className="py-1" role="menu">
                      {branches.map(branch => (
                        <button
                          key={branch.id}
                          type="button"
                          onClick={() => { setActiveBranchId(branch.id); setShowBranchMenu(false); }}
                          className={clsx(
                            "w-full text-left px-3.5 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-800/80 flex items-center justify-between font-medium transition-colors cursor-pointer",
                            activeBranchId === branch.id && "bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 font-semibold"
                          )}
                        >
                          <span className="truncate">{branch.name}</span>
                          {activeBranchId === branch.id && (
                            <span className="text-[11px] font-semibold text-blue-600 dark:text-blue-400">Active</span>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-200 px-2.5 py-1 rounded-lg bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700">
                <Building2 className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 shrink-0" />
                <span className="truncate">{activeBranch?.name || 'Main Branch'}</span>
              </div>
            )}
          </div>

          <div className="flex items-center gap-3 text-sm font-medium text-slate-700 dark:text-slate-200 shrink-0">
            <ThemeToggle />
            <InstallPWA className="!py-1.5 !px-3 !text-xs !bg-blue-600 hover:!bg-blue-700 hidden sm:flex rounded-lg" />

            <div className="relative">
              <button
                type="button"
                onClick={() => setShowProfileMenu(!showProfileMenu)}
                className="flex items-center gap-2.5 pl-1.5 pr-2.5 py-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <div className="w-8 h-8 rounded-lg bg-slate-900 dark:bg-blue-600 flex items-center justify-center text-white text-xs font-bold shrink-0">
                  {user?.name?.substring(0, 2).toUpperCase() || 'AD'}
                </div>
                <div className="hidden sm:block text-left">
                  <div className="text-xs font-semibold text-slate-800 dark:text-slate-100 leading-tight">
                    {user?.role === 'super_admin' ? 'Super Admin' : user?.name}
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 leading-tight capitalize">
                    {user?.role.replace(/_/g, ' ')}
                  </div>
                </div>
                <ChevronDown className="w-3.5 h-3.5 text-slate-400 hidden sm:block" />
              </button>

              {showProfileMenu && (
                <div className="absolute right-0 mt-1.5 w-52 bg-white dark:bg-[#111827] rounded-xl shadow-lg border border-slate-200 dark:border-slate-800 z-50 overflow-hidden">
                  <div className="py-1" role="menu">
                    <button
                      type="button"
                      onClick={() => { setShowProfileMenu(false); setShowChangePassword(true); }}
                      className="w-full text-left px-4 py-2.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800/80 flex items-center cursor-pointer"
                    >
                      <KeyRound className="w-4 h-4 mr-2.5 text-slate-400" />
                      Change Password
                    </button>
                    <div className="my-1 border-t border-slate-100 dark:border-slate-800" />
                    <button
                      type="button"
                      onClick={() => { setShowProfileMenu(false); logout(); }}
                      className="w-full text-left px-4 py-2.5 text-xs font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 flex items-center cursor-pointer"
                    >
                      <LogOut className="w-4 h-4 mr-2.5" />
                      Sign Out
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Scrollable Workspace Content */}
        <div className="flex-1 overflow-y-auto bg-[#F4F6F9] dark:bg-[#090D16] flex flex-col print:overflow-visible print:bg-white print:block print:h-auto print:min-h-0 relative">
          <div className={clsx("flex-1 print:p-0 print:block print:h-auto print:min-h-0", location.pathname === '/' ? "p-4 sm:p-5 lg:p-6" : "p-4 sm:p-6 lg:p-8 space-y-6")}>
            <Outlet />
          </div>

          <footer className="py-3.5 px-6 mt-auto text-center text-xs text-slate-500 dark:text-slate-400 bg-white dark:bg-[#0F172A] border-t border-slate-200 dark:border-slate-800 shrink-0 print:hidden">
            <span>&copy; 2026 Manzoor Collection &middot; {activeBranch?.name || 'Main Branch'}</span>
          </footer>
        </div>
      </main>

      {/* Change Password Modal */}
      {showChangePassword && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl shadow-xl max-w-md w-full p-6">
            <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100 mb-4">Change Password</h2>

            {pwdError && (
              <div className="mb-4 p-3 bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 text-xs rounded-lg border border-rose-200 dark:border-rose-900">
                {pwdError}
              </div>
            )}
            {pwdSuccess && (
              <div className="mb-4 p-3 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 text-xs rounded-lg border border-emerald-200 dark:border-emerald-900">
                {pwdSuccess}
              </div>
            )}

            <form onSubmit={handleChangePassword} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">Current Password</label>
                <input
                  type="password"
                  required
                  value={currentPassword}
                  onChange={e => setCurrentPassword(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 bg-white dark:bg-slate-900 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">New Password</label>
                <input
                  type="password"
                  required
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 bg-white dark:bg-slate-900 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowChangePassword(false)}
                  className="px-4 py-2 rounded-lg text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                >
                  Close
                </button>
                <button
                  type="submit"
                  disabled={isChangingPwd}
                  className="px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 text-sm font-semibold disabled:opacity-50 transition-colors cursor-pointer"
                >
                  {isChangingPwd ? 'Updating...' : 'Update Password'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Profit & Loss Password Lock Modal */}
      {showProfitLossModal && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center z-50 p-4 animate-fade-in">
          <div className="bg-white dark:bg-[#111827] rounded-xl shadow-xl max-w-md w-full p-6 border border-slate-200 dark:border-slate-800">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-amber-50 dark:bg-amber-950/50 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-800/60 flex items-center justify-center">
                  <Lock className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">Profit &amp; Loss Locked</h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400">Enter password to view Profit &amp; Loss</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowProfitLossModal(false);
                  setProfitLossPassword('');
                  setProfitLossError('');
                }}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {profitLossError && (
              <div className="mb-4 p-3 bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-400 text-xs rounded-lg border border-rose-200 dark:border-rose-900/50 font-medium">
                {profitLossError}
              </div>
            )}

            <form onSubmit={handleUnlockProfitLoss} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                  Password
                </label>
                <div className="relative">
                  <input
                    type={showProfitLossPassword ? 'text' : 'password'}
                    required
                    autoFocus
                    value={profitLossPassword}
                    onChange={(e) => {
                      setProfitLossPassword(e.target.value);
                      setProfitLossError('');
                    }}
                    placeholder="Enter password..."
                    className="w-full rounded-lg border border-slate-300 dark:border-slate-700 px-3.5 py-2.5 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100 text-sm focus:ring-2 focus:ring-blue-500 outline-none pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowProfitLossPassword(!showProfitLossPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                  >
                    {showProfitLossPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowProfitLossModal(false);
                    setProfitLossPassword('');
                    setProfitLossError('');
                  }}
                  className="px-4 py-2 rounded-lg text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 text-sm font-medium transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm transition-colors flex items-center gap-2 cursor-pointer"
                >
                  <Lock className="w-4 h-4" />
                  Unlock
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
