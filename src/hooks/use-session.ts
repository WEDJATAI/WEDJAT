"use client";

// Session hook for the WEDJAT DOMAIN AI frontend.
// Fetches /api/auth/me on mount, provides login/logout, and bounces the app
// back to the login view whenever any API call returns 401 UNAUTHORIZED.

import { useCallback, useEffect, useState } from "react";
import { api, apiPost, setUnauthorizedHandler } from "@/lib/wedjat/client";
import type { Principal } from "@/lib/wedjat/types";

export type SessionStatus = "loading" | "authenticated" | "anonymous";

export function useSession() {
  const [principal, setPrincipal] = useState<Principal | null>(null);
  const [status, setStatus] = useState<SessionStatus>("loading");

  // Restore session from the HttpOnly cookie.
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
    const p = await apiPost<Principal>("/api/auth/login", { email, password });
    setPrincipal(p);
    setStatus("authenticated");
    return p;
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiPost<true>("/api/auth/logout");
    } finally {
      setPrincipal(null);
      setStatus("anonymous");
    }
  }, []);

  return { principal, status, login, logout };
}
