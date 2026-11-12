import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, initializeAuth, setPersistence, browserSessionPersistence } from 'firebase/auth';
import { getFirestore, onSnapshot, getDocs, collection, query, where, getDoc, doc } from '@firebase/firestore';
import baseConfig from '../../firebase-applet-config.json';
import { registerFirebaseRefs } from './customFirestore';

// Support Cloudflare / Vite environment variable overrides for custom Firebase projects
export const defaultFirebaseConfig = {
  projectId: (import.meta as any).env?.VITE_FIREBASE_PROJECT_ID || baseConfig.projectId,
  appId: (import.meta as any).env?.VITE_FIREBASE_APP_ID || baseConfig.appId,
  apiKey: (import.meta as any).env?.VITE_FIREBASE_API_KEY || baseConfig.apiKey,
  authDomain: (import.meta as any).env?.VITE_FIREBASE_AUTH_DOMAIN || baseConfig.authDomain,
  firestoreDatabaseId: (import.meta as any).env?.VITE_FIREBASE_DATABASE_ID || baseConfig.firestoreDatabaseId,
  storageBucket: (import.meta as any).env?.VITE_FIREBASE_STORAGE_BUCKET || baseConfig.storageBucket,
  messagingSenderId: (import.meta as any).env?.VITE_FIREBASE_MESSAGING_SENDER_ID || baseConfig.messagingSenderId,
  measurementId: (import.meta as any).env?.VITE_FIREBASE_MEASUREMENT_ID || baseConfig.measurementId || ""
};


// Force clear old IndexedDB local persistence to fix cross-tab auto-login shifts
try {
  if (typeof window !== 'undefined' && window.indexedDB) {
    indexedDB.deleteDatabase('firebaseLocalStorageDb');
  }
} catch(e) {}

// Main App (Always points to the original Firebase project)
export const mainApp = getApps().length === 0 ? initializeApp(defaultFirebaseConfig) : getApp();
export const mainDb = {} as any;
let mAuth;
try {
  mAuth = initializeAuth(mainApp, { persistence: browserSessionPersistence });
} catch (e) {
  mAuth = getAuth(mainApp);
  setPersistence(mAuth, browserSessionPersistence).catch(() => {});
}
export const mainAuth = mAuth;

// Secondary App for creating branch admins without signing out the Super Admin
export const secondaryApp = getApps().length < 2 ? initializeApp(defaultFirebaseConfig, "Secondary") : getApp("Secondary");
let sAuth;
try {
  sAuth = initializeAuth(secondaryApp, { persistence: browserSessionPersistence });
} catch (e) {
  sAuth = getAuth(secondaryApp);
  setPersistence(sAuth, browserSessionPersistence).catch(() => {});
}
export const secondaryAuth = sAuth;

// Dynamic Active App (Defaults to Main App)
export let app = mainApp;
export let auth = mainAuth;
export let db = mainDb;
export let activeFirebaseConfig = defaultFirebaseConfig;

export function switchFirebaseProject(branchConfig: any) {
  if (!branchConfig) {
    app = mainApp;
    auth = mainAuth;
    db = mainDb;
    activeFirebaseConfig = defaultFirebaseConfig;
    registerFirebaseRefs(db, activeFirebaseConfig);
    sessionStorage.removeItem('activeBranchConfig');
    return;
  }

  // Create a unique app name for the branch to avoid conflicts
  const appName = `BranchApp_${branchConfig.projectId}`;
  try {
    app = getApp(appName);
  } catch (e) {
    app = initializeApp(branchConfig, appName);
  }

  activeFirebaseConfig = branchConfig;
  try {
    auth = initializeAuth(app, { persistence: browserSessionPersistence });
  } catch (e) {
    auth = getAuth(app);
    setPersistence(auth, browserSessionPersistence).catch(() => {});
  }

      db = {} as any;
  registerFirebaseRefs(db, activeFirebaseConfig);
  sessionStorage.setItem('activeBranchConfig', JSON.stringify(branchConfig));
}

// Initial registration
registerFirebaseRefs(mainDb, defaultFirebaseConfig);

// Check on load if we have a saved branch config
try {
  const savedConfig = sessionStorage.getItem('activeBranchConfig');
  if (savedConfig) {
    switchFirebaseProject(JSON.parse(savedConfig));
  }
} catch (e) {
  console.error("Failed to load active branch config", e);
}

export function getSecondaryAuthForBranch(branchConfig: any) {
  if (!branchConfig) {
    return secondaryAuth;
  }
  const secondaryAppName = `Secondary_${branchConfig.projectId}`;
  let bApp;
  try {
    bApp = getApp(secondaryAppName);
  } catch (e) {
    bApp = initializeApp(branchConfig, secondaryAppName);
  }
  try {
    return initializeAuth(bApp, { persistence: browserSessionPersistence });
  } catch (e) {
    const sAuth = getAuth(bApp);
    setPersistence(sAuth, browserSessionPersistence).catch(() => {});
    return sAuth;
  }
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  }
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export function safeCollectionSnapshot(
  q: any, 
  onNext: (snapshot: any) => void,
  onError?: (error: any) => void
) {
  let unsubscribed = false;
  let realUnsubscribe: (() => void) | null = null;
  const path = q?.path || (q?._query?.path?.segments?.join('/')) || 'unknown';

  import('./customFirestore').then(({ onSnapshot: customOnSnapshot }) => {
    if (unsubscribed) return;
    realUnsubscribe = customOnSnapshot(q, onNext, (error: any) => {
      if (error?.message?.includes('insufficient permissions')) {
        handleFirestoreError(error, OperationType.GET, path);
      }
      const isExpectedAuthOrRateLimit =
        error?.name === 'AuthSessionError' ||
        error?.message?.includes('Authentication session') ||
        error?.message?.includes('__cookie_check') ||
        error?.message?.includes('429') ||
        error?.message === 'Failed to fetch';

      if (!isExpectedAuthOrRateLimit) {
        console.warn("Collection snapshot notice:", error);
        if (onError) onError(error);
      }
    });
  }).catch(err => {
    console.warn("Failed to load customFirestore for safeCollectionSnapshot:", err);
    if (onError) onError(err);
  });

  return () => {
    unsubscribed = true;
    if (realUnsubscribe) {
      realUnsubscribe();
    }
  };
}

export function safeDocSnapshot(
  docRef: any,
  onNext: (snapshot: any) => void,
  onError?: (error: any) => void
) {
  let unsubscribed = false;
  let realUnsubscribe: (() => void) | null = null;
  const path = docRef?.path || 'unknown';

  import('./customFirestore').then(({ onSnapshot: customOnSnapshot }) => {
    if (unsubscribed) return;
    realUnsubscribe = customOnSnapshot(docRef, onNext, (error: any) => {
      if (error?.message?.includes('insufficient permissions')) {
        handleFirestoreError(error, OperationType.GET, path);
      }
      const isExpectedAuthOrRateLimit =
        error?.name === 'AuthSessionError' ||
        error?.message?.includes('Authentication session') ||
        error?.message?.includes('__cookie_check') ||
        error?.message?.includes('429') ||
        error?.message === 'Failed to fetch';

      if (!isExpectedAuthOrRateLimit) {
        console.warn("Doc snapshot notice:", error);
        if (onError) onError(error);
      }
    });
  }).catch(err => {
    console.warn("Failed to load customFirestore for safeDocSnapshot:", err);
    if (onError) onError(err);
  });

  return () => {
    unsubscribed = true;
    if (realUnsubscribe) {
      realUnsubscribe();
    }
  };
}

export async function safeGetDocs(q: any, retries = 2) {
  const path = q?.path || (q?._query?.path?.segments?.join('/')) || 'unknown';
  try {
    const { getDocs: customGetDocs } = await import('./customFirestore');
    return await customGetDocs(q);
  } catch (error: any) {
    const isTransient = error?.name === 'TypeError' || error?.message?.includes('Failed to fetch') || error?.message?.includes('NetworkError');
    if (isTransient && retries > 0) {
      await new Promise(r => setTimeout(r, 400));
      return safeGetDocs(q, retries - 1);
    }
    if (error?.message?.includes('insufficient permissions')) {
      handleFirestoreError(error, OperationType.GET, path);
    }
    throw error;
  }
}

export async function safeGetDoc(docRef: any, retries = 2) {
  const path = docRef?.path || 'unknown';
  try {
    const { getDoc: customGetDoc } = await import('./customFirestore');
    return await customGetDoc(docRef);
  } catch (error: any) {
    const isTransient = error?.name === 'TypeError' || error?.message?.includes('Failed to fetch') || error?.message?.includes('NetworkError');
    if (isTransient && retries > 0) {
      await new Promise(r => setTimeout(r, 400));
      return safeGetDoc(docRef, retries - 1);
    }
    if (error?.message?.includes('insufficient permissions')) {
      handleFirestoreError(error, OperationType.GET, path);
    }
    throw error;
  }
}

