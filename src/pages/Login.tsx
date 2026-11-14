import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { Navigate, useNavigate } from 'react-router';
import { signInWithEmailAndPassword, setPersistence, browserSessionPersistence } from 'firebase/auth';
import { auth } from '../lib/firebase';
import { Lock, Mail, ArrowRight } from 'lucide-react';
import { motion } from 'motion/react';
import { InstallPWA } from '../components/InstallPWA';
import { MCLogo } from '../components/MCLogo';

const bgImage = "https://images.unsplash.com/photo-1441984904996-e0b6ba687e04?auto=format&fit=crop&w=2000&q=80";

export function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { user, loginAsDemo } = useAuth();
  const navigate = useNavigate();

  if (user) {
    return (
      <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center p-4">
        <motion.div 
          initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
          className="bg-zinc-900 p-8 rounded-2xl shadow-2xl border border-white/10 max-w-sm w-full text-center relative overflow-hidden"
        >
          <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-transparent pointer-events-none" />
          <div className="mx-auto mb-6 flex justify-center relative z-10">
            <MCLogo className="w-20 h-20 shadow-[0_0_30px_rgba(59,130,246,0.15)]" />
          </div>
          <h2 className="text-xl font-medium text-white mb-2 relative z-10 font-serif">Already Logged In</h2>
          <p className="text-zinc-400 mb-8 text-sm relative z-10 font-light tracking-wide">
            You are currently logged in as <br/><strong className="text-zinc-300 font-medium">{user.email}</strong>
          </p>
          <div className="space-y-3 relative z-10">
            <button
              onClick={() => navigate('/')}
              className="w-full py-3 bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-xl font-medium hover:from-blue-500 hover:to-blue-600 transition shadow-lg shadow-blue-900/20"
            >
              Continue to Dashboard
            </button>
            <button
              onClick={() => auth.signOut()}
              className="w-full py-3 bg-white/5 text-zinc-300 rounded-xl font-medium hover:bg-white/10 transition border border-white/5"
            >
              Sign out and switch accounts
            </button>
          </div>
        </motion.div>
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    
    try {
      const trimmedEmail = email.trim().toLowerCase();
      
      // Step 1: Detect branch configuration for this email
      let branchConfigToUse = null;
      
      // If it's the known super admin email, skip lookup to save quota and go directly to main
      if (trimmedEmail !== 'admin@manzoor.com' && trimmedEmail !== 'mainbranch@manzoor.com') {
        try {
          const { collection, query, where, doc } = await import('../lib/customFirestore');
          const { mainDb, safeGetDocs, safeGetDoc } = await import('../lib/firebase');
          
          // Try loading fallback branch configs first
          const branchConfigsFallback = await import('../lib/branch-configs.json').then(m => m.default || m);
          
          const usersRef = collection(mainDb, 'users');
          const q = query(usersRef, where('email', '==', trimmedEmail));
          const querySnap = await safeGetDocs(q);
          
          if (!querySnap.empty) {
            const userDoc = querySnap.docs[0].data() as any;
            const branchId = userDoc.branchId;
            if (branchId && branchId !== 'main') {
              // Check fallback first, then Firestore
              if (branchConfigsFallback && branchConfigsFallback[branchId]) {
                branchConfigToUse = branchConfigsFallback[branchId];
              } else {
                const branchDocRef = doc(mainDb, 'branches', branchId);
                const branchDocSnap = await safeGetDoc(branchDocRef);
                if (branchDocSnap.exists()) {
                  const branchData = branchDocSnap.data() as any;
                  if (branchData.firebaseConfig) {
                    branchConfigToUse = branchData.firebaseConfig;
                  }
                }
              }
            }
          } else {
            // Check if there's any fallback mapping matching this email or if we can find any branch
            // matching a fallback config
            const fallbackBranchId = Object.keys(branchConfigsFallback || {}).find(bId => {
              const cfg = branchConfigsFallback[bId];
              return cfg && cfg.adminEmail === trimmedEmail;
            });
            if (fallbackBranchId) {
              branchConfigToUse = branchConfigsFallback[fallbackBranchId];
            }
          }
        } catch (dbErr) {
          console.error("Failed to query mainDb during login. Falling back to local configs.", dbErr);
          try {
            const branchConfigsFallback = await import('../lib/branch-configs.json').then(m => m.default || m);
            const fallbackBranchId = Object.keys(branchConfigsFallback || {}).find(bId => {
              const cfg = branchConfigsFallback[bId];
              return cfg && cfg.adminEmail === trimmedEmail;
            });
            if (fallbackBranchId) {
              branchConfigToUse = branchConfigsFallback[fallbackBranchId];
            }
          } catch (jsonErr) {
            console.error("Fallback json parse failed", jsonErr);
          }
        }
      }

      // Step 2: Switch active firebase project
      const firebase = await import('../lib/firebase');
      firebase.switchFirebaseProject(branchConfigToUse);

      // Step 3: Authenticate against the active project
      // Set persistence to session so different tabs can have different users
      await setPersistence(firebase.auth, browserSessionPersistence);
      const userCred = await signInWithEmailAndPassword(firebase.auth, email, password);

      try {
        const { recordActivityLog } = await import('../lib/activityLogger');
        await recordActivityLog({
          action: 'User Login',
          category: 'Auth',
          details: `User signed in successfully with email ${trimmedEmail}`,
          user: {
            uid: userCred.user.uid,
            email: userCred.user.email,
            name: userCred.user.displayName || trimmedEmail.split('@')[0],
          }
        });
      } catch (e) {}

      window.location.href = '/';
    } catch (err: any) {
      console.error("Login failed:", err);
      let msg = "Authentication failed. Please check your email and password.";
      if (err.code === 'auth/invalid-credential' || err.message?.includes('invalid-credential')) {
        msg = "Invalid email or password. Please verify your credentials or use the Quick Demo Login below.";
      } else if (err.code === 'auth/user-not-found') {
        msg = "No account found with this email address.";
      } else if (err.code === 'auth/wrong-password') {
        msg = "Incorrect password. Please try again.";
      } else if (err.code === 'auth/too-many-requests') {
        msg = "Too many failed attempts. Please wait a moment or use Demo Login.";
      } else if (err.message) {
        msg = err.message;
      }
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden bg-[#090D16] font-sans px-4 py-12">
      {/* Subtle architectural grid & ambient cobalt glow */}
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.04]"
        style={{
          backgroundImage:
            'linear-gradient(to right, #94a3b8 1px, transparent 1px), linear-gradient(to bottom, #94a3b8 1px, transparent 1px)',
          backgroundSize: '48px 48px',
        }}
      />
      <div className="absolute -top-40 left-1/2 -translate-x-1/2 w-[640px] h-[320px] bg-blue-600/15 blur-[120px] rounded-full pointer-events-none" />

      {/* Login Card */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
        className="relative z-10 w-full max-w-md"
      >
        <div className="bg-[#111827]/95 border border-slate-800 rounded-2xl shadow-2xl p-8 sm:p-10">
          <div className="flex flex-col items-center text-center mb-8">
            <MCLogo className="w-16 h-16 mb-5" />
            <h1 className="font-display text-2xl font-bold tracking-tight text-white">
              Manzoor Collection
            </h1>
            <p className="text-xs text-slate-400 mt-1">
              Multi-Branch Retail &amp; Financial Ledger
            </p>
          </div>

          <form className="space-y-5" onSubmit={handleSubmit}>
            {error && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="bg-rose-950/50 border border-rose-800/60 rounded-xl p-4 text-center">
                <p className="text-xs text-rose-200 mb-3">{error}</p>
                <button
                  type="button"
                  onClick={() => {
                    loginAsDemo(email || 'admin@manzoor.com');
                    navigate('/');
                  }}
                  className="w-full text-xs bg-rose-600 hover:bg-rose-500 text-white font-semibold py-2 px-3 rounded-lg transition-colors cursor-pointer"
                >
                  Bypass &amp; Sign In as Demo Admin
                </button>
              </motion.div>
            )}

            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-slate-300">Email Address</label>
              <div className="relative group">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                  <Mail className="h-4 w-4 text-slate-500 group-focus-within:text-blue-400 transition-colors" />
                </div>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="block w-full pl-10 pr-3.5 bg-[#090D16] border border-slate-700/80 rounded-lg py-3 text-sm text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-colors placeholder-slate-500"
                  placeholder="admin@manzoor.com"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-slate-300">Password</label>
              <div className="relative group">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                  <Lock className="h-4 w-4 text-slate-500 group-focus-within:text-blue-400 transition-colors" />
                </div>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="block w-full pl-10 pr-3.5 bg-[#090D16] border border-slate-700/80 rounded-lg py-3 text-sm text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-colors placeholder-slate-500"
                  placeholder="••••••••"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full mt-2 flex justify-center items-center py-3 px-4 rounded-lg text-sm font-semibold text-white bg-blue-600 hover:bg-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-50 transition-colors cursor-pointer"
            >
              {loading ? "Authenticating..." : "Sign In"}
              {!loading && <ArrowRight className="w-4 h-4 ml-2" />}
            </button>

            <div className="text-center pt-1">
              <span className="text-xs text-slate-500">Trouble signing in? </span>
              <button
                type="button"
                onClick={() => {
                  loginAsDemo('admin@manzoor.com');
                  navigate('/');
                }}
                className="text-xs text-blue-400 hover:text-blue-300 font-medium underline transition-colors cursor-pointer"
              >
                Quick Demo Login
              </button>
            </div>
          </form>

          <div className="mt-8 flex flex-col items-center justify-center gap-3 border-t border-slate-800 pt-6">
            <InstallPWA className="!py-2.5 !px-5 !bg-slate-800 hover:!bg-slate-700 !text-slate-200 !shadow-none border border-slate-700 !text-xs !font-semibold rounded-lg transition-colors" />
            <p className="text-[11px] text-slate-500 text-center">
              Install desktop or mobile app for offline POS access
            </p>
          </div>
        </div>

        <div className="mt-6 text-center text-xs text-slate-500">
          <p>&copy; 2026 Manzoor Collection &middot; Retail ERP</p>
        </div>
      </motion.div>
    </div>
  );
}
