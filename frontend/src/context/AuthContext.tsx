import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import {
  clearStoredToken,
  getStoredToken,
  setStoredToken,
} from "@/services/apiClient";
import {
  completeTenantRegistration as apiCompleteTenantRegistration,
  fetchCurrentUser,
  getAuthConfig,
  loginWithPassword as apiPasswordLogin,
  logoutSession,
  requestOtp as apiRequestOtp,
  requestTenantRegistrationOtp as apiRequestTenantRegOtp,
  verifyOtp as apiVerifyOtp,
} from "@/services/authService";
import {
  AuthConfigResponse,
  AuthUser,
  RequestOTPResponse,
  TenantSelfRegisterPayload,
  TenantSelfRegisterResponse,
  UserRole,
} from "@/types/api";

interface AuthContextValue {
  user: AuthUser | null;
  initializing: boolean;
  authConfig: AuthConfigResponse | null;
  loginWithPassword: (
    mobile: string,
    password: string,
    portalRole?: UserRole
  ) => Promise<AuthUser>;
  requestOtp: (
    mobile: string,
    portalRole?: UserRole
  ) => Promise<RequestOTPResponse>;
  verifyOtp: (
    mobile: string,
    otp: string,
    portalRole?: UserRole
  ) => Promise<AuthUser>;
  requestRegistrationOtp: (mobile: string) => Promise<RequestOTPResponse>;
  completeTenantRegistration: (
    payload: TenantSelfRegisterPayload
  ) => Promise<TenantSelfRegisterResponse>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function roleHomePath(role: UserRole): string {
  switch (role) {
    case "owner":
      return "/owner";
    case "manager":
      return "/manager";
    case "tenant":
      return "/tenant";
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [initializing, setInitializing] = useState<boolean>(true);
  const [authConfig, setAuthConfig] = useState<AuthConfigResponse | null>(null);

  const refreshUser = useCallback(async () => {
    const token = getStoredToken();
    if (!token) {
      setUser(null);
      return;
    }
    try {
      const me = await fetchCurrentUser();
      setUser(me);
    } catch {
      clearStoredToken();
      setUser(null);
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    async function bootstrap() {
      try {
        const cfg = await getAuthConfig();
        if (mounted) setAuthConfig(cfg);
      } catch {
        // Non-fatal if health check/config fails momentarily
      }
      await refreshUser();
      if (mounted) setInitializing(false);
    }
    void bootstrap();

    const handleUnauthorized = () => {
      setUser(null);
    };
    window.addEventListener("aapka_pg:unauthorized", handleUnauthorized);
    return () => {
      mounted = false;
      window.removeEventListener("aapka_pg:unauthorized", handleUnauthorized);
    };
  }, [refreshUser]);

  const loginWithPassword = useCallback(
    async (mobile: string, password: string, portalRole?: UserRole) => {
      const res = await apiPasswordLogin({
        mobile,
        password,
        portal_role: portalRole,
      });
      setStoredToken(res.access_token);
      setUser(res.user);
      return res.user;
    },
    []
  );

  const requestOtp = useCallback(
    async (mobile: string, portalRole?: UserRole) => {
      return apiRequestOtp({ mobile, portal_role: portalRole });
    },
    []
  );

  const verifyOtp = useCallback(
    async (mobile: string, otp: string, portalRole?: UserRole) => {
      const res = await apiVerifyOtp({
        mobile,
        otp,
        portal_role: portalRole,
      });
      setStoredToken(res.access_token);
      setUser(res.user);
      return res.user;
    },
    []
  );

  const requestRegistrationOtp = useCallback(async (mobile: string) => {
    return apiRequestTenantRegOtp({ mobile });
  }, []);

  const completeTenantRegistration = useCallback(
    async (payload: TenantSelfRegisterPayload) => {
      return apiCompleteTenantRegistration(payload);
    },
    []
  );

  const logout = useCallback(async () => {
    try {
      if (getStoredToken()) {
        await logoutSession();
      }
    } catch {
      // Clear local session even if server token already expired
    } finally {
      clearStoredToken();
      setUser(null);
    }
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        initializing,
        authConfig,
        loginWithPassword,
        requestOtp,
        verifyOtp,
        requestRegistrationOtp,
        completeTenantRegistration,
        logout,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return ctx;
}

