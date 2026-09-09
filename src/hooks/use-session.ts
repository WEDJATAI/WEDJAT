"use client";

// Session hook for the WEDJAT DOMAIN AI frontend.
// Fetches /api/auth/me on mount, provides login/logout, and bounces the app
// back to the login view whenever any API call returns 401 UNAUTHORIZED.

import { useCallback, useEffect, useState } from "react";
import { api, apiPost, setAuthToken, setUnauthorizedHandler } from "@/lib/wedjat/client";
import type { LoginResponse, Principal } from "@/lib/wedjat/types";

export type SessionStatus = "loading" | "authenticated" | "anonymous";

export function useSession() {
  const [principal, setPrincipal] = useState<Principal | null>(null);
  const [status, setStatus] = useState<SessionStatus>("loading");

  // Restore session: HttpOnly cookie first, falling back to the persisted
  // bearer token (embedded preview contexts where cookies are blocked).
  useEffect(() => {
    let cancelled = false;
    api<Principal>("/api/auth/me")
      .then((p) => {
        if (cancelled) return;
        setPrincipal(p);
        setStatus("authenticated");
      })
      .catch(() => {
        if (cancelled) return;
        setPrincipal(null);
        setStatus("anonymous");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Any 401 anywhere in the app returns to the login view.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      setPrincipal(null);
      setStatus("anonymous");
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const r = await apiPost<LoginResponse>("/api/auth/login", { email, password });
    // Persist the session token for the Bearer fallback path; the server keeps
    // the principal authoritative.
    setAuthToken(r.token);
    setPrincipal(r.principal);
    setStatus("authenticated");
    return r.principal;
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiPost<true>("/api/auth/logout");
    } finally {
      setAuthToken(null);
      setPrincipal(null);
      setStatus("anonymous");
    }
  }, []);

  /** Applies an updated principal after a self-service credential change. */
  const updatePrincipal = useCallback((p: Principal) => {
    setPrincipal(p);
  }, []);

  return { principal, status, login, logout, updatePrincipal };
}
