"use client";

// ═══════════════════════════════════════════════════════════════════════════
// Intelligence — main view (v4 §1–§127). One nav view with internal tabs
// exactly per contract §3:
//   Overview · Event Fabric · Service Identities · Recommendations ·
//   Patterns · Memory · Platform Registry · API Console.
//
// Conventions mirror the intake view: controlled Tabs (h-11 touch targets on
// mobile, scrollable TabsList), framer-motion transition, per-tab data
// fetching via useApiData (tabs unmount when inactive, so the ~8s event-fabric
// poll only runs while its tab is visible), role gating via the
// FABRIC_ADMIN_ROLES / FABRIC_CURATOR_ROLES sets, and graceful 404 handling —
// the backend lands in parallel and every tab degrades to a friendly
// error/empty state instead of crashing.
// ═══════════════════════════════════════════════════════════════════════════

import { useState } from "react";
import { motion } from "framer-motion";
import {
  Brain,
  Gauge,
  KeyRound,
  Lightbulb,
  Server,
  Shapes,
  SquareTerminal,
  Webhook,
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SectionHeading } from "@/components/wedjat/shared/section-heading";
import { IntelligenceOverviewTab } from "@/components/wedjat/intelligence/intelligence-overview-tab";
import { IntelligenceFabricTab } from "@/components/wedjat/intelligence/intelligence-fabric-tab";
import { IntelligenceIdentitiesTab } from "@/components/wedjat/intelligence/intelligence-identities-tab";
import { IntelligenceRecommendationsTab } from "@/components/wedjat/intelligence/intelligence-recommendations-tab";
import { IntelligencePatternsTab } from "@/components/wedjat/intelligence/intelligence-patterns-tab";
import { IntelligenceMemoryTab } from "@/components/wedjat/intelligence/intelligence-memory-tab";
import { IntelligenceRegistryTab } from "@/components/wedjat/intelligence/intelligence-registry-tab";
import { IntelligenceConsoleTab } from "@/components/wedjat/intelligence/intelligence-console-tab";

export function IntelligenceView({ role }: { role: string }) {
  const [tab, setTab] = useState("overview");

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="space-y-4"
    >
      <SectionHeading
        eyebrow="v4 · §1–§127"
        title="Intelligence"
        description="The knowledge-first intelligence fabric: a service-identity platform API, an append-only event fabric with a dead-letter queue, evidence-based recommendations with a closed outcome loop, cross-platform patterns, memory provenance and the 10-platform registry."
      />

      <Tabs value={tab} onValueChange={setTab}>
        <div className="wedjat-scroll max-w-full overflow-x-auto pb-1">
          <TabsList className="wedjat-scroll h-11 w-max max-w-full overflow-x-auto sm:h-9">
            <TabsTrigger value="overview" className="gap-1.5 px-3">
              <Gauge aria-hidden="true" className="size-3.5" />
              Overview
            </TabsTrigger>
            <TabsTrigger value="fabric" className="gap-1.5 px-3">
              <Webhook aria-hidden="true" className="size-3.5" />
              Event Fabric
            </TabsTrigger>
            <TabsTrigger value="identities" className="gap-1.5 px-3">
              <KeyRound aria-hidden="true" className="size-3.5" />
              Service Identities
            </TabsTrigger>
            <TabsTrigger value="recommendations" className="gap-1.5 px-3">
              <Lightbulb aria-hidden="true" className="size-3.5" />
              Recommendations
            </TabsTrigger>
            <TabsTrigger value="patterns" className="gap-1.5 px-3">
              <Shapes aria-hidden="true" className="size-3.5" />
              Patterns
            </TabsTrigger>
            <TabsTrigger value="memory" className="gap-1.5 px-3">
              <Brain aria-hidden="true" className="size-3.5" />
              Memory
            </TabsTrigger>
            <TabsTrigger value="registry" className="gap-1.5 px-3">
              <Server aria-hidden="true" className="size-3.5" />
              Platform Registry
            </TabsTrigger>
            <TabsTrigger value="console" className="gap-1.5 px-3">
              <SquareTerminal aria-hidden="true" className="size-3.5" />
              API Console
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="overview" className="mt-4">
          <IntelligenceOverviewTab role={role} />
        </TabsContent>

        <TabsContent value="fabric" className="mt-4">
          <IntelligenceFabricTab role={role} />
        </TabsContent>

        <TabsContent value="identities" className="mt-4">
          <IntelligenceIdentitiesTab role={role} />
        </TabsContent>

        <TabsContent value="recommendations" className="mt-4">
          <IntelligenceRecommendationsTab role={role} />
        </TabsContent>

        <TabsContent value="patterns" className="mt-4">
          <IntelligencePatternsTab />
        </TabsContent>

        <TabsContent value="memory" className="mt-4">
          <IntelligenceMemoryTab />
        </TabsContent>

        <TabsContent value="registry" className="mt-4">
          <IntelligenceRegistryTab role={role} />
        </TabsContent>

        <TabsContent value="console" className="mt-4">
          <IntelligenceConsoleTab />
        </TabsContent>
      </Tabs>
    </motion.div>
  );
}
