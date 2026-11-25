/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useState, useEffect, useCallback, useMemo } from "react";
import {
  loginApi,
  registerApi,
  logoutApi,
  logoutAllApi,
  refreshApi,
  updateProfileApi,
  changePasswordApi,
  setAuthTokens,
} from "../services/api";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [accessToken, setAccessToken] = useState(null);
  const [csrfToken, setCsrfToken] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  // Synchronize in-memory tokens with api.js module state
  const applyTokens = useCallback((tokens) => {
    if (tokens) {
      setAccessToken(tokens.access_token || null);
      setCsrfToken(tokens.csrf_token || null);
      setAuthTokens(tokens);
    } else {
      setAccessToken(null);
      setCsrfToken(null);
      setAuthTokens(null);
    }
  }, []);

  // Silent session restoration on initial application load
  const restoreSession = useCallback(async () => {
    try {
      const res = await refreshApi();
      applyTokens({
        access_token: res.access_token,
        csrf_token: res.csrf_token,
      });
      setUser(res.user);
    } catch {
      // Unauthenticated or expired session
      applyTokens(null);
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  }, [applyTokens]);

  useEffect(() => {
    const timer = setTimeout(() => {
      restoreSession();
    }, 0);
    return () => clearTimeout(timer);
  }, [restoreSession]);

  // User Login (Browser Cookie Mode)
  const login = useCallback(
    async (email, password) => {
      const res = await loginApi({
        email,
        password,
        token_transport: "cookie", // Enforce HttpOnly cookie flow
      });

      applyTokens({
        access_token: res.access_token,
        csrf_token: res.csrf_token,
      });
      setUser(res.user);
      return res.user;
    },
    [applyTokens]
  );

  // User Registration
  const register = useCallback(async (email, fullName, password) => {
    return await registerApi({
      email,
      full_name: fullName,
      password,
    });
  }, []);

  // Current-Session Logout
  const logout = useCallback(async () => {
    try {
      await logoutApi();
    } catch (err) {
      console.warn("Logout error:", err);
    } finally {
      applyTokens(null);
      setUser(null);
    }
  }, [applyTokens]);

  // Account-Wide Logout (All Devices)
  const logoutAll = useCallback(async () => {
    try {
      await logoutAllApi();
    } catch (err) {
      console.warn("Account-wide logout error:", err);
    } finally {
      applyTokens(null);
      setUser(null);
    }
  }, [applyTokens]);

  // Update Profile
  const updateProfile = useCallback(async (fullName) => {
    const updatedUser = await updateProfileApi({ full_name: fullName });
    setUser(updatedUser);
    return updatedUser;
  }, []);

  // Change Password (revokes existing sessions on backend)
  const changePassword = useCallback(
    async (currentPassword, newPassword) => {
      const res = await changePasswordApi({
        current_password: currentPassword,
        new_password: newPassword,
      });
      applyTokens(null);
      setUser(null);
      return res;
    },
    [applyTokens]
  );

  const value = useMemo(
    () => ({
      user,
      accessToken,
      csrfToken,
      isLoading,
      isAuthenticated: Boolean(user),
      login,
      register,
      logout,
      logoutAll,
      updateProfile,
      changePassword,
      refreshSession: restoreSession,
    }),
    [
      user,
      accessToken,
      csrfToken,
      isLoading,
      login,
      register,
      logout,
      logoutAll,
      updateProfile,
      changePassword,
      restoreSession,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
