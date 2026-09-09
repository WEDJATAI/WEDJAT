"use client";

// WEDJAT DOMAIN AI — single-route application.
// View switching is client-side state (persisted in localStorage);
// the login gate wraps everything until a Principal is established.

import { useCallback, useSyncExternalStore } from "react";
import { motion } from "framer-motion";
import Image from "next/image";
import { AppShell, type ViewId } from "@/components/wedjat/app-shell";
import { LoginView } from "@/components/wedjat/views/login-view";
import { DashboardView } from "@/components/wedjat/views/dashboard-view";
import { ChatView } from "@/components/wedjat/views/chat-view";
import { KnowledgeView } from "@/components/wedjat/views/knowledge-view";
import { IntakeView } from "@/components/wedjat/intake/intake-view";
import { AnalysisView } from "@/components/wedjat/views/analysis-view";
import { SearchView } from "@/components/wedjat/views/search-view";
import { TrainingView } from "@/components/wedjat/views/training-view";
import { EvaluationView } from "@/components/wedjat/views/evaluation-view";
import { ModelsView } from "@/components/wedjat/views/models-view";
import { ObservabilityView } from "@/components/wedjat/views/observability-view";
import { SettingsView } from "@/components/wedjat/views/settings-view";
import { useSession } from "@/hooks/use-session";

const VIEW_STORAGE_KEY = "wedjat.view";
const VIEW_CHANGE_EVENT = "wedjat:view-change";
const VALID_VIEWS: ViewId[] = [
  "dashboard",
  "chat",
  "knowledge",
  "intake",
  "analysis",
  "search",
  "training",
  "evaluation",
  "models",
  "observability",
  "settings",
];

function subscribeToViewStore(cb: () => void) {
  window.addEventListener("storage", cb);
  window.addEventListener(VIEW_CHANGE_EVENT, cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener(VIEW_CHANGE_EVENT, cb);
  };
}

function readStoredView(): ViewId {
  try {
    const stored = window.localStorage.getItem(VIEW_STORAGE_KEY);
    if (stored && (VALID_VIEWS as string[]).includes(stored)) {
      return stored as ViewId;
    }
  } catch {
    /* localStorage unavailable */
  }
  return "dashboard";
}

/** View persisted to localStorage, read through useSyncExternalStore. */
function usePersistedView(): [ViewId, (v: ViewId) => void] {
  const view = useSyncExternalStore(
    subscribeToViewStore,
    readStoredView,
    () => "dashboard" as ViewId,
  );
  const setView = useCallback((v: ViewId) => {
    try {
      window.localStorage.setItem(VIEW_STORAGE_KEY, v);
    } catch {
      /* ignore */
    }
    window.dispatchEvent(new Event(VIEW_CHANGE_EVENT));
  }, []);
  return [view, setView];
}

function LoadingSplash() {
  return (
    <div
      className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background text-foreground"
      role="status"
      aria-label="Loading WEDJAT"
    >
      <div
        aria-hidden="true"
        className="flex size-14 items-center justify-center overflow-hidden rounded-2xl border border-border bg-[#0f161e] shadow-md"
      >
        <Image
          src="/wedjat-mark-sm.jpg"
          alt=""
          width={44}
          height={33}
          className="h-auto w-10"
        />
      </div>
      <div className="text-center">
        <p className="text-sm font-semibold tracking-wide">WEDJAT</p>
        <p className="mt-1 text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
          Domain AI
        </p>
      </div>
      <p className="text-xs text-muted-foreground">
        Restoring your session…
      </p>
    </div>
  );
}

export default function Page() {
  const { principal, status, login, logout, updatePrincipal } = useSession();
  const [view, changeView] = usePersistedView();

  if (status === "loading") {
    return <LoadingSplash />;
  }

  if (!principal) {
    return <LoginView onLogin={login} />;
  }

  return (
    <AppShell
      principal={principal}
      view={view}
      onViewChange={changeView}
      onLogout={() => {
        void logout();
      }}
    >
      <motion.div
        key={view}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -6 }}
        transition={{ duration: 0.25, ease: "easeOut" }}
      >
        {view === "dashboard" ? <DashboardView onNavigate={changeView} /> : null}
        {view === "chat" ? <ChatView /> : null}
        {view === "knowledge" ? <KnowledgeView /> : null}
        {view === "intake" ? <IntakeView role={principal.role} /> : null}
        {view === "analysis" ? <AnalysisView /> : null}
        {view === "search" ? <SearchView /> : null}
        {view === "training" ? <TrainingView role={principal.role} /> : null}
        {view === "evaluation" ? <EvaluationView /> : null}
        {view === "models" ? <ModelsView role={principal.role} /> : null}
        {view === "observability" ? <ObservabilityView /> : null}
        {view === "settings" ? (
          <SettingsView principal={principal} onPrincipalUpdate={updatePrincipal} />
        ) : null}
      </motion.div>
    </AppShell>
  );
}
