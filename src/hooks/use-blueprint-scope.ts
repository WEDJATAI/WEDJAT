"use client";

// Shared platform → blueprint → version scoping used by Chat, Analysis and
// Search views. Selecting a platform filters the blueprint list; selecting a
// blueprint lazily loads its full detail (version timeline).

import { useMemo, useState } from "react";
import { useApiData } from "@/hooks/use-api-data";
import type { BlueprintDetail, BlueprintSummary, PlatformSummary } from "@/lib/wedjat/types";

export interface BlueprintScope {
  platforms: ReturnType<typeof useApiData<PlatformSummary[]>>;
  platformSlug: string | null;
  setPlatform: (slug: string | null) => void;
  blueprints: ReturnType<typeof useApiData<BlueprintSummary[]>>;
  blueprintSlug: string | null;
  setBlueprint: (slug: string | null) => void;
  selectedBlueprint: BlueprintSummary | null;
  detail: ReturnType<typeof useApiData<BlueprintDetail>>;
}

export function useBlueprintScope(): BlueprintScope {
  const platforms = useApiData<PlatformSummary[]>("/api/platforms");
  const [platformSlug, setPlatformSlug] = useState<string | null>(null);
  const blueprints = useApiData<BlueprintSummary[]>(
    platformSlug ? `/api/blueprints?platform=${encodeURIComponent(platformSlug)}` : "/api/blueprints",
  );
  const [blueprintSlug, setBlueprintSlug] = useState<string | null>(null);

  const selectedBlueprint = useMemo(
    () => blueprints.data?.find((b) => b.slug === blueprintSlug) ?? null,
    [blueprints.data, blueprintSlug],
  );

  const detail = useApiData<BlueprintDetail>(
    selectedBlueprint ? `/api/blueprints?id=${encodeURIComponent(selectedBlueprint.id)}&full=1` : null,
  );

  const setPlatform = (slug: string | null) => {
    setPlatformSlug(slug);
    setBlueprintSlug(null);
  };

  return {
    platforms,
    platformSlug,
    setPlatform,
    blueprints,
    blueprintSlug,
    setBlueprint: setBlueprintSlug,
    selectedBlueprint,
    detail,
  };
}
