"use client";

// ═══════════════════════════════════════════════════════════════════════════
// Database Intake — main view (spec §106–§160). One nav view with internal
// tabs: Sources (§153 import dashboard) · Run Detail · Review Queue ·
// Autonomy (§151/§152) · Learning (§155).
//
// Polling mirrors the knowledge view pattern: GET /api/intake every 3s ONLY
// while any source's latest run is RAW/STAGED/ANALYZED/MAPPED/VALIDATED; the
// selected source's detail refetches on mutations and while its run is
// active. All endpoints 404-gracefully while the backend lands.
// ═══════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { DatabaseZap, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SectionHeading } from "@/components/wedjat/shared/section-heading";
import { IntakeSourcesTab } from "@/components/wedjat/intake/intake-sources-tab";
import { IntakeRunDetailTab } from "@/components/wedjat/intake/intake-run-detail-tab";
import { IntakeReviewTab } from "@/components/wedjat/intake/intake-review-tab";
import { IntakeAutonomyTab } from "@/components/wedjat/intake/intake-autonomy-tab";
import { IntakeLearningTab } from "@/components/wedjat/intake/intake-learning-tab";
import type { IntakeDetail } from "@/components/wedjat/intake/intake-run-detail-tab";
import {
  ACTIVE_INTAKE_RUN_STATUSES,
  formatCount,
} from "@/components/wedjat/intake/intake-helpers";
import { useApiData } from "@/hooks/use-api-data";
import type { IntakeListPayload } from "@/lib/wedjat/types";

const POLL_MS = 3000;

export function IntakeView({ role }: { role: string }) {
  const [tab, setTab] = useState("sources");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const list = useApiData<IntakeListPayload>("/api/intake");
  const detail = useApiData<IntakeDetail>(
    selectedId ? `/api/intake/${encodeURIComponent(selectedId)}` : null,
  );

  // ── 3s polling ONLY while runs are active (mirrors knowledge-view) ──
  // (null-safe: a partially-implemented backend may return stub payloads)
  const listActive = useMemo(
    () =>
      (list.data?.sources ?? []).some(
        (s) =>
          s.latestRun != null &&
          ACTIVE_INTAKE_RUN_STATUSES.has(s.latestRun.status),
      ),
    [list.data],
  );
  const detailActive = useMemo(
    () =>
      detail.data?.source?.latestRun != null &&
      ACTIVE_INTAKE_RUN_STATUSES.has(detail.data.source.latestRun.status),
    [detail.data],
  );

  useEffect(() => {
    if (!listActive) return;
    const interval = setInterval(() => list.refresh(), POLL_MS);
    return () => clearInterval(interval);
  }, [listActive, list.refresh]);

  useEffect(() => {
    if (!detailActive) return;
    const interval = setInterval(() => detail.refresh(), POLL_MS);
    return () => clearInterval(interval);
  }, [detailActive, detail.refresh]);

  // Re-arm on window focus (auto re-check after tab switches).
  useEffect(() => {
    const onFocus = () => list.refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [list.refresh]);

  const selectSource = (id: string) => {
    setSelectedId(id);
    setTab("detail");
  };

  const reviewCount =
    (list.data?.reviewQueue?.mappings ?? 0) +
    (list.data?.reviewQueue?.candidates ?? 0);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="space-y-4"
    >
      <SectionHeading
        eyebrow="§106–§160"
        title="Database Intake"
        description="Drop a database in — WEDJAT detects the engine, stages a versioned snapshot, maps tables to canonical entities, extracts knowledge, graph edges and training data. Humans only review what the engine is unsure about."
        actions={
          <span className="flex items-center gap-2">
            {listActive ? (
              <Badge
                variant="outline"
                className="wedjat-pulse border-amber-500/40 bg-amber-500/10 text-[10px] text-amber-700 dark:text-amber-400"
              >
                LIVE · 3s
              </Badge>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              className="h-9"
              onClick={list.refresh}
              aria-label="Refresh intake sources"
            >
              <RefreshCw
                aria-hidden="true"
                className={list.loading ? "size-3.5 animate-spin" : "size-3.5"}
              />
              Refresh
            </Button>
          </span>
        }
      />

      <Tabs value={tab} onValueChange={setTab}>
        <div className="wedjat-scroll max-w-full overflow-x-auto pb-1">
          <TabsList className="wedjat-scroll h-11 w-max max-w-full overflow-x-auto sm:h-9">
            <TabsTrigger value="sources" className="gap-1.5 px-3">
              <DatabaseZap aria-hidden="true" className="size-3.5" />
              Sources
            </TabsTrigger>
            <TabsTrigger value="detail" className="gap-1.5 px-3">
              Run Detail
            </TabsTrigger>
            <TabsTrigger value="review" className="gap-1.5 px-3">
              Review Queue
              {reviewCount > 0 ? (
                <Badge
                  variant="outline"
                  className="ml-1 border-amber-500/40 bg-amber-500/10 px-1.5 text-[9px] tabular-nums text-amber-700 dark:text-amber-400"
                >
                  {formatCount(reviewCount)}
                </Badge>
              ) : null}
            </TabsTrigger>
            <TabsTrigger value="autonomy" className="gap-1.5 px-3">
              Autonomy
            </TabsTrigger>
            <TabsTrigger value="learning" className="gap-1.5 px-3">
              Learning
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="sources" className="mt-4">
          <IntakeSourcesTab
            role={role}
            list={list}
            onSelectSource={selectSource}
            onUploaded={(res) => {
              setSelectedId(res.sourceDatabaseId);
              setTab("detail");
              list.refresh();
            }}
            onOpenReview={() => setTab("review")}
            onOpenAutonomy={() => setTab("autonomy")}
          />
        </TabsContent>

        <TabsContent value="detail" className="mt-4">
          <IntakeRunDetailTab
            role={role}
            selectedId={selectedId}
            detail={detail}
            onListRefresh={list.refresh}
          />
        </TabsContent>

        <TabsContent value="review" className="mt-4">
          <IntakeReviewTab role={role} list={list} />
        </TabsContent>

        <TabsContent value="autonomy" className="mt-4">
          <IntakeAutonomyTab role={role} />
        </TabsContent>

        <TabsContent value="learning" className="mt-4">
          <IntakeLearningTab role={role} />
        </TabsContent>
      </Tabs>
    </motion.div>
  );
}
