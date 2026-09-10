// ═══════════════════════════════════════════════════════════════════════════════
// WEDJAT v4 §5/§54/§96 — Multi-platform PULL ingestion from LOCAL GIT CLONES.
//
// Generalizes scripts/ingest-cirkle.ts into a per-platform profile driver:
//   • Sources are LOCAL shallow clones (default /tmp/repos) — no GitHub API
//     rate limits, works for public repos with NO token.
//   • Each platform profile declares §5 coordinates (repo/deployment/db URLs),
//     blueprint partitioning (§4 explicit boundaries) and curation rules.
//   • Registers the platform in the fabric registry (§88 connect) BEFORE
//     ingesting, then submits documents through the REAL intake pipeline
//     (POST /api/ingestion) — serial submit+wait, split oversized sources.
//   • Additive & idempotent: the API de-duplicates by content hash (§30/§58)
//     — re-running never duplicates knowledge.
//
// Provenance: every non-markdown file is wrapped as fenced code with the
// repo + branch + HEAD commit; content is ingested as DATA only (§59) —
// never executed.
//
// Usage:
//   bun scripts/ingest-platform.ts --platform cirkle
//   bun scripts/ingest-platform.ts --platform judge,sgtx-fable,mtq-sigma,mtq
//   bun scripts/ingest-platform.ts --platform mtq --app https://wedjat-ai.vercel.app
//   bun scripts/ingest-platform.ts --platform all            (all 5 profiles)
// Flags: --app <url>  --repos <dir>  --no-connect  --dry-run
// ═══════════════════════════════════════════════════════════════════════════════

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';

// ── CLI ──────────────────────────────────────────────────────────────────────

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const has = (name: string): boolean => process.argv.includes(`--${name}`);

const APP = arg('app') ?? 'http://localhost:3000';
const REPOS_DIR = arg('repos') ?? '/tmp/repos';
const DRY_RUN = has('dry-run');
const CONNECT = !has('no-connect');
const PLATFORMS_ARG = arg('platform') ?? '';
// Bounded submit concurrency. Default 1 = the original serial submit+wait
// (required against a LOCAL dev server: embeddings are CPU-bound in one
// process — Task 22 OOM lesson). Against SERVERLESS (--app …vercel.app) each
// job runs in its own lambda instance, so a small window (4–6) is safe and
// ~5× faster; duplicates are idempotency-key-skipped on re-runs.
const PARALLEL = Math.max(1, Math.min(8, parseInt(arg('parallel') ?? '1', 10) || 1));

// ── Platform profiles (§5 INITIAL REGISTERED PLATFORM SOURCES) ───────────────

interface BlueprintDef {
  slug: string;
  title: string;
}
interface Selection {
  path: string;
  blueprint: BlueprintDef;
  docType: string;
  title: string;
}
interface PlatformProfile {
  slug: string;
  name: string;
  clone: string;
  repositoryUrl: string;
  deploymentUrl?: string;
  databaseUrl?: string;
  titlePrefix: string;
  select: (files: string[]) => Selection[];
  // Task 26 — platforms whose knowledge spans MULTIPLE repositories (e.g.
  // MITHQAL flagship + its web app; OLYMP-EX site + micro-app). Extra clones
  // are mounted under a virtual path prefix so `select` sees one unified
  // tree; provenance + SHA are resolved per-source.
  extraClones?: { clone: string; repositoryUrl: string; mount: string }[];
}

const ARCH = (p: string, t: string): BlueprintDef => ({ slug: `${p}-architecture`, title: t });

function docTypeFor(path: string): string {
  const n = path.toUpperCase();
  const base = n.split('/').pop() ?? n;
  if (base.includes('BLUEPRINT')) return 'BLUEPRINT';
  if (base.startsWith('ADR-')) return 'ADR';
  if (n.includes('SPECIFICATION') || n.includes('PLAYBOOK') || n.includes('ARCHITECTURE') || n.includes('GAP_ANALYSIS') || n.includes('MAPPING')) return 'SPEC';
  if (n.includes('AUDIT') || n.includes('COMPLIANCE')) return 'AUDIT';
  if (n.includes('DEPLOYMENT') || n.includes('ROLLBACK')) return 'RUNBOOK';
  return 'REFERENCE';
}

function titleFromPath(path: string): string {
  const base = path.split('/').pop() ?? path;
  return base
    .replace(/\.(md|prisma|json|ts|tsx|py|sql|sol)$/i, '')
    .replace(/[-_.]+/g, ' ')
    .trim();
}

const profiles: PlatformProfile[] = [
  {
    slug: 'cirkle',
    name: 'CIRKLE',
    clone: 'fortleem_CIRKLE',
    repositoryUrl: 'https://github.com/fortleem/CIRKLE',
    deploymentUrl: 'https://cirkleapp.vercel.app/',
    databaseUrl: 'libsql://cirkle-fortleem.aws-us-east-1.turso.io',
    titlePrefix: 'CIRKLE',
    select: (files) => {
      const out: Selection[] = [];
      const arch = ARCH('cirkle', 'CIRKLE Architecture & Governance');
      const eng: BlueprintDef = { slug: 'cirkle-engineering', title: 'CIRKLE Engineering & Database' };
      const brain: BlueprintDef = { slug: 'cirkle-brain-ai', title: 'CIRKLE Brain AI Service' };
      for (const p of files) {
        if (p.startsWith('docs/') && p.toLowerCase().endsWith('.md')) {
          out.push({ path: p, blueprint: arch, docType: docTypeFor(p), title: `CIRKLE ${titleFromPath(p)}` });
        } else if (!p.includes('/') && p.toLowerCase().endsWith('.md') && !/^worklog/i.test(p)) {
          out.push({ path: p, blueprint: arch, docType: docTypeFor(p), title: `CIRKLE ${titleFromPath(p)}` });
        } else if (p === 'prisma/schema.prisma' || p === 'package.json') {
          out.push({ path: p, blueprint: eng, docType: 'REFERENCE', title: `CIRKLE ${titleFromPath(p)} (${p.includes('prisma') ? 'database schema' : 'package manifest'})` });
        } else if (p.startsWith('download/cirkle-brain-ai/')) {
          const rel = p.slice('download/cirkle-brain-ai/'.length);
          const wanted =
            rel === 'package.json' ||
            rel === 'prisma/schema.prisma' ||
            /^mini-services\/[^/]+\/(index\.ts|package\.json)$/.test(rel) ||
            /^src\/lib\/[^/]+\/index\.ts$/.test(rel);
          if (wanted) out.push({ path: p, blueprint: brain, docType: 'REFERENCE', title: `CIRKLE Brain ${titleFromPath(p)}` });
        }
      }
      return out;
    },
  },
  {
    // Task 26 — the REAL MITHQAL flagship repository was discovered at
    // MITHQALMTQ/mithqal (2340 tracked files: v25 final blueprint, 221
    // verification reports, 127 institutional src/lib modules, Solidity
    // contracts). The old MITHQALMTQ/MTQ stub (5KB README) is superseded
    // as the platform's source of record. fortleem/MTQ (the MTQ web-app
    // builder workspace carrying src/lib/mithqal app modules) is mounted
    // as a second source under mtq-app/.
    slug: 'mtq',
    name: 'MITHQAL MTQ',
    clone: 'MITHQALMTQ_mithqal',
    repositoryUrl: 'https://github.com/MITHQALMTQ/mithqal',
    deploymentUrl: 'https://mithqal.vercel.app/',
    databaseUrl: 'libsql://mtq-fortleem.aws-us-east-1.turso.io',
    titlePrefix: 'MITHQAL',
    extraClones: [
      { clone: 'fortleem_MTQ', repositoryUrl: 'https://github.com/fortleem/MTQ', mount: 'mtq-app/' },
    ],
    select: (files) => {
      const out: Selection[] = [];
      const arch = ARCH('mtq', 'MITHQAL Settlement Architecture');
      const verify: BlueprintDef = { slug: 'mtq-verification', title: 'MITHQAL Verification & Due Diligence' };
      const eng: BlueprintDef = { slug: 'mtq-engineering', title: 'MITHQAL Engineering (Contracts, Modules, Schema)' };
      const ROOT_BOILERPLATE = /^(LICENSE|CODE_OF_CONDUCT|CODEOWNERS|CONTRIBUTING|SECURITY|NOTICE)/i;
      for (const p of files) {
        if (p.startsWith('mtq-app/')) {
          // MTQ web-app workspace (fortleem/MTQ) — only the MITHQAL domain
          // modules + manifests (skip .grok skills, .vercel, multiplayer,
          // og, screenshots — non-org boilerplate).
          const rel = p.slice('mtq-app/'.length);
          if (rel === 'AGENTS.md' || rel === 'package.json' || /^src\/lib\/mithqal\/[^/]+\.ts$/.test(rel)) {
            out.push({ path: p, blueprint: eng, docType: rel.endsWith('.md') ? 'REFERENCE' : 'REFERENCE', title: `MTQ app ${titleFromPath(rel)}` });
          }
          continue;
        }
        // ── MITHQALMTQ/mithqal curation ──
        if (p.startsWith('skills/') || p.startsWith('.legacy-backup/') || p.startsWith('backups/') ||
            p.startsWith('upload/') || p.startsWith('screenshots/') || p.startsWith('foundry/') ||
            p.startsWith('.zscripts/') || p.startsWith('public/') || p.startsWith('scripts/') ||
            p.startsWith('src/app/') || p.startsWith('src/components/') || p.startsWith('src/hooks/')) continue;
        if (/\.(docx|png|jpg|jpeg|gif|svg|pdf|zip|db|bak|wav|mp3|mp4|mov|webm|srt|html|csv|woff2?|ttf|otf|exe|wasm|bin)$/i.test(p)) continue; // text-only pipeline
        // Blueprint-chain curation: v24/v25 versions are ALL included as
        // honest versioned history (CIRKLE v15/v16 precedent) — note the
        // v24 files are named mithqal-canonical-v24.x.md. Excluded only:
        // mithqal-canonical-blueprint.md (duplicate render of v24.2.1),
        // v18-blueprint-complete.md (superseded base) and blueprint.txt
        // (rendered artifact). Non-md media is cut by the global filter.
        const SUPERSEDED_BLUEPRINT = /^(docs\/blueprint\/(mithqal-canonical-blueprint\.md|v18-blueprint-complete\.md|blueprint\.txt))$/;
        if (SUPERSEDED_BLUEPRINT.test(p)) continue;
        if (!p.includes('/') && p.toLowerCase().endsWith('.md') && !ROOT_BOILERPLATE.test(p)) {
          out.push({ path: p, blueprint: arch, docType: docTypeFor(p), title: `MITHQAL ${titleFromPath(p)}` });
        } else if ((/^docs\/(architecture|blueprint|contracts|legal|roadmap|video)\//.test(p) || p === 'docs/whitepaper.md') && p.toLowerCase().endsWith('.md')) {
          out.push({ path: p, blueprint: p.startsWith('docs/blueprint/publication/') ? verify : arch, docType: docTypeFor(p), title: `MITHQAL ${titleFromPath(p)}` });
        } else if (/^docs\/(verification|due-diligence|evidence|institutional-validation)\//.test(p) && p.endsWith('.md')) {
          out.push({ path: p, blueprint: verify, docType: 'AUDIT', title: `MITHQAL ${titleFromPath(p)}` });
        } else if (/^src\/[A-Z][A-Za-z]+\.sol$/.test(p)) {
          out.push({ path: p, blueprint: eng, docType: 'SPEC', title: `MITHQAL Solidity contract — ${titleFromPath(p)}` });
        } else if (/^src\/lib\/[A-Za-z0-9_/-]+\.ts$/.test(p)) {
          out.push({ path: p, blueprint: eng, docType: 'REFERENCE', title: `MITHQAL module — ${titleFromPath(p)}` });
        } else if (p === 'prisma/schema.prisma' || p === 'package.json') {
          out.push({ path: p, blueprint: eng, docType: 'REFERENCE', title: `MITHQAL ${titleFromPath(p)} (${p.includes('prisma') ? 'database schema' : 'package manifest'})` });
        }
      }
      return out;
    },
  },
  {
    // Task 26 — OLYMP-EX (Egyptian agritrade export company: fresh/frozen
    // produce brand + corporate site). Two public repos: the full brand site
    // (fortleem/olympex_export, Lovable-built) + a vite/Cloudflare micro-app
    // (fortleem/olympex) mounted under micro-app/.
    slug: 'olymp-ex',
    name: 'OLYMP EX',
    clone: 'fortleem_olympex_export',
    repositoryUrl: 'https://github.com/fortleem/olympex_export',
    titlePrefix: 'OLYMP EX',
    extraClones: [
      { clone: 'fortleem_olympex', repositoryUrl: 'https://github.com/fortleem/olympex', mount: 'micro-app/' },
    ],
    select: (files) => {
      const out: Selection[] = [];
      const brand: BlueprintDef = { slug: 'olymp-ex-brand', title: 'OLYMP-EX Brand Identity & Site' };
      const eng: BlueprintDef = { slug: 'olymp-ex-engineering', title: 'OLYMP-EX Engineering' };
      for (const p of files) {
        if (p.startsWith('micro-app/')) {
          const rel = p.slice('micro-app/'.length);
          const wanted = rel === 'README.md' || rel === 'package.json' || rel === 'wrangler.jsonc' ||
            rel === 'ecosystem.config.cjs' || rel === 'vite.config.ts' || rel === 'tsconfig.json' ||
            /^src\/[^/]+\.(ts|tsx)$/.test(rel) || /^public\/static\/[^/]+\.(js|css)$/.test(rel);
          if (wanted) out.push({ path: p, blueprint: eng, docType: 'REFERENCE', title: `Olymp Ex micro-app ${titleFromPath(rel)}` });
          continue;
        }
        if (/\.(png|jpg|jpeg|webp|gif|svg|ico|pdf|zip)$/i.test(p)) continue; // text-only pipeline
        if (p === 'README.md' || p === 'AGENTS.md') {
          out.push({ path: p, blueprint: brand, docType: 'SPEC', title: `OLYMP-EX ${p === 'README.md' ? 'brand launch specification' : 'agents guide'}` });
        } else if (/^src\/data\/[^/]+\.ts$/.test(p)) {
          out.push({ path: p, blueprint: brand, docType: 'REFERENCE', title: `OLYMP-EX ${titleFromPath(p)} data` });
        } else if (/^src\/(components\/(brand|site)|hooks|lib|routes)\/[A-Za-z0-9_/-]+\.(ts|tsx)$/.test(p)) {
          out.push({ path: p, blueprint: brand, docType: 'REFERENCE', title: `OLYMP-EX ${titleFromPath(p)}` });
        } else if (p === 'package.json' || p === 'components.json' || p === 'vite.config.ts' || p === 'tsconfig.json') {
          out.push({ path: p, blueprint: eng, docType: 'REFERENCE', title: `OLYMP-EX ${titleFromPath(p)} manifest` });
        }
      }
      return out;
    },
  },
  {
    slug: 'judge',
    name: 'JUDGE SMART',
    clone: 'fortleem_judge_synapse',
    repositoryUrl: 'https://github.com/fortleem/judge_synapse',
    deploymentUrl: 'https://judge-smart.vercel.app',
    databaseUrl: 'libsql://judge-fortleem.aws-us-east-1.turso.io',
    titlePrefix: 'JUDGE',
    select: (files) => {
      const out: Selection[] = [];
      const arch = ARCH('judge', 'JUDGE SMART Architecture & Governance');
      const corpus: BlueprintDef = { slug: 'judge-legal-corpus', title: 'JUDGE SMART Legal Corpus (Egypt)' };
      const eng: BlueprintDef = { slug: 'judge-engineering', title: 'JUDGE SMART Engineering & Database' };
      const judicial: BlueprintDef = { slug: 'judge-judicial-engine', title: 'JUDGE SMART Judicial Engine' };
      for (const p of files) {
        if (p === 'README.md' || p === 'audit-report.md') {
          out.push({ path: p, blueprint: arch, docType: p.toLowerCase().includes('audit') ? 'AUDIT' : 'REFERENCE', title: `JUDGE SMART ${titleFromPath(p)}` });
        } else if (p.startsWith('legal-corpus/snapshots/') && p.endsWith('.md')) {
          out.push({ path: p, blueprint: corpus, docType: 'SPEC', title: `JUDGE Legal Corpus — ${titleFromPath(p)}` });
        } else if (p === 'prisma/schema.prisma' || p === 'package.json') {
          out.push({ path: p, blueprint: eng, docType: 'REFERENCE', title: `JUDGE SMART ${titleFromPath(p)} (${p.includes('prisma') ? 'database schema' : 'package manifest'})` });
        } else if (/^src\/lib\/judicial\/[^/]+\.ts$/.test(p)) {
          out.push({ path: p, blueprint: judicial, docType: 'REFERENCE', title: `JUDGE Judicial Engine — ${titleFromPath(p)}` });
        }
      }
      return out;
    },
  },
  {
    slug: 'sgtx-fable',
    name: 'SGTX FABLE',
    clone: 'fortleem_SGTX_FABLE',
    repositoryUrl: 'https://github.com/fortleem/SGTX_FABLE',
    titlePrefix: 'SGTX FABLE',
    select: (files) => {
      const out: Selection[] = [];
      const arch = ARCH('sgtx-fable', 'SGTX FABLE Trade Platform Architecture');
      const db: BlueprintDef = { slug: 'sgtx-fable-database', title: 'SGTX FABLE Database & Schema' };
      const eng: BlueprintDef = { slug: 'sgtx-fable-engineering', title: 'SGTX FABLE Engineering' };
      for (const p of files) {
        if (p === 'README.md' || p === 'GAP_ANALYSIS.md' || p === 'docs/COCKPIT_MAPPING.md') {
          out.push({ path: p, blueprint: arch, docType: docTypeFor(p), title: `SGTX FABLE ${titleFromPath(p)}` });
        } else if (
          p === 'migrations/0001_consolidated.sql' ||
          p === 'migrations/0005_canonical_schema_snapshot.sql' ||
          p === 'seed.sql'
        ) {
          out.push({ path: p, blueprint: db, docType: 'REFERENCE', title: `SGTX FABLE database — ${titleFromPath(p)}` });
        } else if (p === 'package.json') {
          out.push({ path: p, blueprint: eng, docType: 'REFERENCE', title: 'SGTX FABLE package manifest' });
        } else if (/^src\/lib\/[^/]+\.ts$/.test(p)) {
          out.push({ path: p, blueprint: eng, docType: 'REFERENCE', title: `SGTX FABLE engine — ${titleFromPath(p)}` });
        }
      }
      return out;
    },
  },
  {
    // OWNER re-supplied the private-repo GitHub token (Task 24) — this profile
    // was blocked in Task 23 (GitHub 403 unauthenticated).
    slug: 'aurienta',
    name: 'AURIENTA',
    clone: 'Aurienta_Aurienta',
    repositoryUrl: 'https://github.com/Aurienta/Aurienta',
    deploymentUrl: 'https://aurienta.vercel.app',
    databaseUrl: 'libsql://aurienta-fortleem.aws-us-east-1.turso.io',
    titlePrefix: 'AURIENTA',
    select: (files) => {
      const out: Selection[] = [];
      const arch = ARCH('aurienta', 'AURIENTA Architecture & Governance');
      const blueprint: BlueprintDef = { slug: 'aurienta-blueprint', title: 'AURIENTA Master Blueprint & Amendments' };
      const eng: BlueprintDef = { slug: 'aurienta-engineering', title: 'AURIENTA Engineering & Modules' };
      for (const p of files) {
        // Blueprint registry first (docs/blueprint/*.md would otherwise be
        // captured by the generic docs/ rule).
        if (p.startsWith('docs/blueprint/') && (p.endsWith('.md') || p.endsWith('.json'))) {
          out.push({ path: p, blueprint, docType: p.includes('REGISTRY') ? 'SPEC' : 'REFERENCE', title: `AURIENTA Blueprint ${titleFromPath(p)}` });
        } else if (p.startsWith('docs/') && p.toLowerCase().endsWith('.md')) {
          out.push({ path: p, blueprint: arch, docType: docTypeFor(p), title: `AURIENTA ${titleFromPath(p)}` });
        } else if (p === 'PRODUCTION_READINESS_AUDIT.md' || p === 'REPOSITORY_INTEGRITY.md' || p === 'UI_AUDIT.md') {
          out.push({ path: p, blueprint: arch, docType: docTypeFor(p), title: `AURIENTA ${titleFromPath(p)}` });
        } else if (p === 'prisma/schema.prisma' || p === 'package.json') {
          out.push({ path: p, blueprint: eng, docType: 'REFERENCE', title: `AURIENTA ${titleFromPath(p)} (${p.includes('prisma') ? 'database schema' : 'package manifest'})` });
        } else if (/^src\/lib\/aurienta\/[^/]+\.ts$/.test(p)) {
          // All 42 institutional modules — each is a self-contained engine
          // (matching engine, constitutional audit, market execution…).
          // .docx blueprint binaries are honestly NOT ingested (text-only
          // pipeline); the markdown changelog carries the canonical version.
          out.push({ path: p, blueprint: eng, docType: 'REFERENCE', title: `AURIENTA module — ${titleFromPath(p)}` });
        }
      }
      return out;
    },
  },
  {
    // OWNER re-supplied the private-repo GitHub token (Task 24) — blocked in
    // Task 23. 151 domain-engine entry modules + certification docs + the
    // constitutional OPA governor policies.
    slug: 'sgtx',
    name: 'SGTX',
    clone: 'SGTX-PILOT_SGTX',
    repositoryUrl: 'https://github.com/SGTX-PILOT/SGTX',
    deploymentUrl: 'https://sgtx.vercel.app',
    databaseUrl: 'libsql://sgtx-fortleem.aws-us-east-1.turso.io',
    titlePrefix: 'SGTX',
    select: (files) => {
      const out: Selection[] = [];
      const arch = ARCH('sgtx', 'SGTX Trade Platform Architecture & Certification');
      const gov: BlueprintDef = { slug: 'sgtx-governor', title: 'SGTX Constitutional Governor & Policies' };
      const eng: BlueprintDef = { slug: 'sgtx-engineering', title: 'SGTX Engineering & Domain Engines' };
      const auth: BlueprintDef = { slug: 'sgtx-security-auth', title: 'SGTX Security & Authentication' };
      for (const p of files) {
        if (/^SGTX_[A-Z0-9_.]+\.md$/.test(p) || p === 'README.md' || p === 'COCKPIT_PHASE_0_PR.md') {
          out.push({ path: p, blueprint: arch, docType: docTypeFor(p), title: `SGTX ${titleFromPath(p)}` });
        } else if (p === 'docs/blueprint/CHANGE-CONTROL-LEDGER.md') {
          out.push({ path: p, blueprint: arch, docType: 'SPEC', title: 'SGTX Blueprint Change-Control Ledger' });
        } else if (/^core\/governor\/policies\/[^/]+\.rego$/.test(p)) {
          out.push({ path: p, blueprint: gov, docType: 'SPEC', title: `SGTX Governor policy — ${titleFromPath(p)}` });
        } else if (p === 'prisma/schema.prisma' || p === 'package.json' || p === 'src/lib/openapi-spec.ts') {
          out.push({ path: p, blueprint: eng, docType: 'REFERENCE', title: `SGTX ${titleFromPath(p)} (${p.includes('prisma') ? 'database schema' : p.includes('openapi') ? 'API surface' : 'package manifest'})` });
        } else if (/^src\/lib\/v1\/(auth|auth-edge|passkey|zitadel)\.ts$/.test(p)) {
          out.push({ path: p, blueprint: auth, docType: 'REFERENCE', title: `SGTX auth — ${titleFromPath(p)}` });
        } else if (/^src\/lib\/sgtx\/[^/]+\/index\.ts$/.test(p) || /^src\/lib\/sgtx\/[^/]+\.ts$/.test(p)) {
          // Domain-engine module entry (index.ts) or single-file module.
          const moduleName = p.slice('src/lib/sgtx/'.length).replace(/\/index\.ts$/, '').replace(/\.ts$/, '');
          out.push({ path: p, blueprint: eng, docType: 'REFERENCE', title: `SGTX engine — ${moduleName}` });
        }
      }
      return out;
    },
  },
  {
    // OWNER re-supplied the private-repo GitHub token (Task 24) — blocked in
    // Task 23. Compact bilingual (AR/EN) VLM compliance platform.
    slug: 'ppe',
    name: 'PPE SMART',
    clone: 'fortleem_PPE',
    repositoryUrl: 'https://github.com/fortleem/PPE',
    deploymentUrl: 'https://ppe-smart.vercel.app',
    databaseUrl: 'libsql://ppe-smart-fortleem.aws-us-east-1.turso.io',
    titlePrefix: 'PPE',
    select: (files) => {
      const out: Selection[] = [];
      const arch = ARCH('ppe', 'PPE Detector Architecture & Experiments');
      const eng: BlueprintDef = { slug: 'ppe-engineering', title: 'PPE Detector Engineering' };
      for (const p of files) {
        if (p === 'README.md') {
          out.push({ path: p, blueprint: arch, docType: 'SPEC', title: 'PPE Detector — نظام كشف معدات السلامة (overview & experiments)' });
        } else if (p === 'prisma/schema.prisma' || p === 'package.json') {
          out.push({ path: p, blueprint: eng, docType: 'REFERENCE', title: `PPE ${titleFromPath(p)} (${p.includes('prisma') ? 'database schema' : 'package manifest'})` });
        } else if (/^src\/lib\/[^/]+\.ts$/.test(p)) {
          out.push({ path: p, blueprint: eng, docType: 'REFERENCE', title: `PPE module — ${titleFromPath(p)}` });
        }
      }
      return out;
    },
  },
  {
    slug: 'mtq-sigma',
    name: 'MTQ SIGMA',
    clone: 'MITHQALMTQ_MTQ_SIGMA',
    repositoryUrl: 'https://github.com/MITHQALMTQ/MTQ_SIGMA',
    deploymentUrl: 'https://mtq-sigma.vercel.app',
    databaseUrl: 'libsql://mtqs-fortleem.aws-us-east-1.turso.io',
    titlePrefix: 'MTQ SIGMA',
    select: (files) => {
      const out: Selection[] = [];
      const proto: BlueprintDef = { slug: 'mtq-sigma-protocol', title: 'MTQ Σ Protocol & Collateralization' };
      const eng: BlueprintDef = { slug: 'mtq-sigma-engineering', title: 'MTQ Σ Engineering' };
      for (const p of files) {
        if (p.startsWith('contracts/') && p.endsWith('.sol') && !p.includes('deployments')) {
          out.push({ path: p, blueprint: proto, docType: 'SPEC', title: `MTQ Σ Solidity contract — ${titleFromPath(p)}` });
        } else if (p === 'package.json' || p === 'prisma/schema.prisma') {
          out.push({ path: p, blueprint: eng, docType: 'REFERENCE', title: `MTQ Σ ${titleFromPath(p)} (${p.includes('prisma') ? 'database schema' : 'package manifest'})` });
        } else if (/^mini-services\/[^/]+\/index\.ts$/.test(p)) {
          out.push({ path: p, blueprint: eng, docType: 'REFERENCE', title: `MTQ Σ service — ${titleFromPath(p)}` });
        } else if (/^src\/lib\/mtq\/[^/]+\.ts$/.test(p)) {
          out.push({ path: p, blueprint: eng, docType: 'REFERENCE', title: `MTQ Σ engine — ${titleFromPath(p)}` });
        }
      }
      return out;
    },
  },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${APP}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const json = (await res.json()) as { ok: boolean; data?: T; error?: { code?: string; message?: string } };
  if (!json.ok) throw new Error(`API ${json.error?.code}: ${json.error?.message ?? res.status}`);
  return json.data as T;
}

async function listJobs(): Promise<{ id: string; status: string; progress: number; lastError: string | null }[]> {
  const res = await fetch(`${APP}/api/jobs?limit=100`);
  const json = (await res.json()) as {
    ok: boolean;
    data?: { id: string; status: string; progress: number; lastError: string | null }[] | { jobs?: { id: string; status: string; progress: number; lastError: string | null }[] };
  };
  if (Array.isArray(json.data)) return json.data;
  return json.data?.jobs ?? [];
}

/** All file paths in a clone (git-tracked list is implicit: everything except .git). */
function walkFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (rel: string) => {
    for (const entry of readdirSync(join(dir, rel), { withFileTypes: true })) {
      if (entry.name === '.git') continue;
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(relPath);
      else out.push(relPath);
    }
  };
  walk('');
  return out;
}

function shortSha(cloneDir: string): string {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: cloneDir, encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

const LANG_MAP: Record<string, string> = { ts: 'ts', tsx: 'tsx', js: 'js', json: 'json', prisma: 'prisma', py: 'py', md: 'md', sh: 'sh', sql: 'sql', sol: 'sol', rego: 'rego' };

function wrapAsMarkdown(repositoryUrl: string, path: string, content: string, sha: string): string {
  const ext = (path.split('.').pop() ?? 'txt').toLowerCase();
  if (ext === 'md') return content; // already markdown — ingest as-is
  const lang = LANG_MAP[ext] ?? '';
  return `# Source: ${path}\n\nProvenance: \`${path}\` in the ${repositoryUrl.replace('https://github.com/', '')} repository (branch main @ ${sha}).\n\n\`\`\`${lang}\n${content}\n\`\`\`\n`;
}

/**
 * Split oversized sources so each ingestion job fits the serverless after()
 * window (~60s). Markdown splits at heading boundaries; code splits RAW
 * content at line boundaries BEFORE wrapping (so fenced blocks stay intact).
 */
const SPLIT_THRESHOLD = 70_000;
function splitMarkdown(title: string, markdown: string, repo: string): string[] {
  if (markdown.length <= SPLIT_THRESHOLD) return [markdown];
  const lines = markdown.split('\n');
  const parts: string[] = [];
  let current: string[] = [];
  let currentSize = 0;
  const flush = () => {
    if (current.length > 0 && currentSize > 800) parts.push(current.join('\n'));
    current = [];
    currentSize = 0;
  };
  for (const line of lines) {
    if (/^#{1,2} \S/.test(line) && currentSize >= SPLIT_THRESHOLD) flush();
    current.push(line);
    currentSize += line.length + 1;
  }
  flush();
  // Heading-boundary split fails for wrapped CODE files (one giant fenced
  // block, no interior headings) — post-pass: raw-slice any still-oversized
  // part at line boundaries (found via the orphaned 320KB SGTX schema job on
  // production: single part > after() window).
  const sliced: string[] = [];
  for (const part of parts) {
    if (part.length <= SPLIT_THRESHOLD * 1.2) {
      sliced.push(part);
      continue;
    }
    const partLines = part.split('\n');
    let buf: string[] = [];
    let bufSize = 0;
    for (const line of partLines) {
      buf.push(line);
      bufSize += line.length + 1;
      if (bufSize >= SPLIT_THRESHOLD) {
        sliced.push(buf.join('\n'));
        buf = [];
        bufSize = 0;
      }
    }
    if (buf.length > 0 && bufSize > 800) sliced.push(buf.join('\n'));
  }
  parts.length = 0;
  parts.push(...sliced);
  if (parts.length === 0) {
    for (let i = 0; i < markdown.length; i += SPLIT_THRESHOLD) parts.push(markdown.slice(i, i + SPLIT_THRESHOLD));
  }
  const total = parts.length;
  return parts.map((p, i) =>
    total === 1 ? p : `# ${title} — Part ${i + 1} of ${total}\n\nContinuation of \`${title}\` (${repo}@main).\n\n${p}`
  );
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function ingestPlatform(profile: PlatformProfile): Promise<void> {
  // Task 26 — unified multi-clone file tree: main-clone paths stay as-is;
  // extra clones mount under a virtual prefix so `select` sees ONE tree.
  // Provenance (repo URL + SHA) is resolved per-source at read time.
  const sources: { dir: string; repo: string; mount: string; sha: string }[] = [];
  const addSource = (clone: string, repo: string, mount: string) => {
    const dir = join(REPOS_DIR, clone);
    try {
      const sha = shortSha(dir); // throws when the dir is not a git clone
      sources.push({ dir, repo, mount, sha });
    } catch {
      console.error(`  ✗ clone not found: ${clone} (clone it first)`);
    }
  };
  addSource(profile.clone, profile.repositoryUrl, '');
  for (const e of profile.extraClones ?? []) addSource(e.clone, e.repositoryUrl, e.mount);
  if (sources.length === 0) return;
  const cloneDir = sources[0].dir; // single-clone profiles keep their ref
  console.log(`\n──────────────────────────────────────────────────────`);
  console.log(`${profile.name} (${profile.slug}) → ${APP}`);
  console.log(`  source: ${profile.repositoryUrl} @ local clone ${cloneDir}`);

  const files: string[] = [];
  for (const src of sources) {
    try {
      const walked = walkFiles(src.dir);
      files.push(...(src.mount ? walked.map((p) => `${src.mount}${p}`) : walked));
    } catch {
      console.error(`  ✗ cannot walk: ${src.dir}`);
    }
  }
  console.log(`  HEAD ${sources[0].sha} · ${files.length} repo entries (${sources.length} source repo(s))`);

  /** Resolve a (possibly mounted) selection path back to its source clone. */
  const resolve = (path: string): { dir: string; real: string; repo: string; sha: string } | null => {
    for (let i = sources.length - 1; i >= 0; i--) {
      const s = sources[i];
      if (!s.mount || path.startsWith(s.mount)) {
        return { dir: s.dir, real: s.mount ? path.slice(s.mount.length) : path, repo: s.repo, sha: s.sha };
      }
    }
    return null;
  };

  const selections = profile.select(files);
  const totalKB = Math.round(
    selections.reduce((s, x) => {
      try {
        const r = resolve(x.path);
        return s + (r ? statSync(join(r.dir, r.real)).size : 0);
      } catch {
        return s;
      }
    }, 0) / 1024
  );
  console.log(`  selected ${selections.length} documents (~${totalKB}KB)`);
  if (selections.length === 0) {
    console.log('  (nothing selected — profile matched no files)');
    return;
  }
  if (DRY_RUN) {
    for (const s of selections) console.log(`  DRY: [${s.docType}] ${s.title} → ${s.blueprint.slug}`);
    return;
  }

  // §88 registry connect first (creates/refreshes the Platform row; the
  // ingestion API requires the platform to exist).
  if (CONNECT) {
    try {
      const dto = await apiPost<unknown>(`/api/fabric/registry/${profile.slug}/connect`, {
        repositoryUrl: profile.repositoryUrl,
        deploymentUrl: profile.deploymentUrl,
        databaseUrl: profile.databaseUrl,
      });
      void dto;
      console.log(`  ✓ registry CONNECTED: ${profile.slug}`);
    } catch (err) {
      console.error(`  ✗ registry connect failed: ${err instanceof Error ? err.message : err}`);
      return;
    }
  }

  // Materialize ALL parts first (read + wrap + split), then submit through
  // a bounded-concurrency pool. PARALLEL=1 (default) preserves the original
  // serial submit+wait — required against a LOCAL dev server, where
  // embeddings are CPU-bound in one process (Task 22 OOM lesson). Against
  // serverless (--app …vercel.app) each job runs in its own lambda
  // instance, so a small window (4–6) is safe and ~N× faster.
  interface Part {
    partTitle: string;
    docType: string;
    content: string;
    version: string;
    blueprint: BlueprintDef;
    kb: number;
  }
  const allParts: Part[] = [];
  let failed = 0;
  for (const sel of selections) {
    try {
      const src = resolve(sel.path);
      if (!src) throw new Error('selection path not found in any clone');
      const raw = readFileSync(join(src.dir, src.real), 'utf8');
      if (raw.trim().length < 40) {
        console.log(`  SKIP (too short): ${sel.path}`);
        continue;
      }
      const markdown = wrapAsMarkdown(src.repo, sel.path, raw, src.sha);
      const parts = splitMarkdown(sel.title, markdown, src.repo.replace('https://github.com/', ''));
      for (let pi = 0; pi < parts.length; pi++) {
        allParts.push({
          partTitle: parts.length > 1 ? `${sel.title} — Part ${pi + 1}/${parts.length}` : sel.title,
          docType: sel.docType,
          content: parts[pi],
          version: `github-main-${src.sha}`,
          blueprint: sel.blueprint,
          kb: Math.round(parts[pi].length / 1024),
        });
      }
    } catch (err) {
      failed++;
      console.log(`  FAIL: ${sel.path} — ${err instanceof Error ? err.message.slice(0, 80) : 'err'}`);
    }
  }

  const results: { title: string; jobId: string; duplicate: boolean }[] = [];
  let submitIdx = 0;
  const submitNext = async (): Promise<void> => {
    for (;;) {
      const i = submitIdx++;
      if (i >= allParts.length) return;
      const part = allParts[i];
      try {
        const r = await apiPost<{ jobId: string; duplicate: boolean }>('/api/ingestion', {
          platformSlug: profile.slug,
          blueprintSlug: part.blueprint.slug,
          blueprintTitle: part.blueprint.title,
          title: part.partTitle,
          docType: part.docType,
          content: part.content,
          documentVersion: part.version,
        });
        results.push({ title: part.partTitle, jobId: r.jobId, duplicate: r.duplicate });
        console.log(`  ${r.duplicate ? 'DUPLICATE' : 'QUEUED'}: ${part.partTitle} [${part.docType}] (${part.kb}KB)`);
        if (!r.duplicate) {
          // 75s ≈ the serverless after()-window cap — bigger docs checkpoint
          // progress and are resumed by a later re-run (resume-safe §58) or
          // by the worker's stale-RUNNING self-heal (Task 26).
          const waitDeadline = Date.now() + 75_000;
          for (;;) {
            await sleep(3000);
            const jobs = await listJobs();
            const j = jobs.find((x) => x.id === r.jobId);
            if (!j) continue;
            if (j.status === 'COMPLETED') { console.log(`    ✓ completed`); break; }
            if (j.status === 'FAILED') {
              console.log(`    ✗ FAILED: ${(j.lastError ?? '').slice(0, 90)}`);
              break;
            }
            if (Date.now() > waitDeadline) { console.log('    ⏱ window elapsed (job checkpoints progress; self-heal requeues it)'); break; }
          }
        }
      } catch (err) {
        failed++;
        console.log(`  FAIL: ${part.partTitle} — ${err instanceof Error ? err.message.slice(0, 80) : 'err'}`);
        await sleep(8000); // server may be restarting after a burst — back off
      }
    }
  };
  if (PARALLEL > 1) console.log(`  submitting with concurrency ${PARALLEL}`);
  await Promise.all(Array.from({ length: PARALLEL }, () => submitNext()));

  // Poll job completion (bounded wait).
  const ids = new Set(results.filter((r) => !r.duplicate).map((r) => r.jobId));
  const deadline = Date.now() + 8 * 60 * 1000;
  let completed = 0;
  while (Date.now() < deadline && completed < ids.size) {
    await sleep(4000);
    const jobs = await listJobs();
    completed = 0;
    for (const j of jobs) {
      if (ids.has(j.id) && (j.status === 'COMPLETED' || j.status === 'FAILED')) completed++;
    }
  }
  const finalJobs = await listJobs();
  const byId = new Map(finalJobs.map((j) => [j.id, j]));
  let okCount = 0;
  let failCount = 0;
  for (const r of results) {
    const j = byId.get(r.jobId);
    if (!j) continue;
    if (j.status === 'COMPLETED') okCount++;
    else if (j.status === 'FAILED') {
      failCount++;
      console.log(`  JOB FAILED: ${r.title} — ${(j.lastError ?? '').slice(0, 100)}`);
    }
  }
  const dupCount = results.filter((r) => r.duplicate).length;
  console.log(
    `${profile.slug} SUMMARY: ${results.length} submitted (${dupCount} duplicates), ${okCount} completed, ${failCount} failed, ${failed} submit-errors`
  );
}

async function main(): Promise<void> {
  if (!PLATFORMS_ARG) {
    console.error('usage: bun scripts/ingest-platform.ts --platform <slug[,slug2…]|all> [--app url] [--repos dir] [--dry-run] [--no-connect] [--parallel N]');
    console.error(`profiles: ${profiles.map((p) => p.slug).join(', ')}`);
    process.exit(1);
  }
  const wanted = PLATFORMS_ARG === 'all'
    ? profiles.map((p) => p.slug)
    : PLATFORMS_ARG.split(',').map((s) => s.trim()).filter(Boolean);
  for (const slug of wanted) {
    const profile = profiles.find((p) => p.slug === slug);
    if (!profile) {
      console.error(`unknown platform '${slug}' (known: ${profiles.map((p) => p.slug).join(', ')})`);
      continue;
    }
    await ingestPlatform(profile);
  }
}

main().catch((e) => {
  console.error('ingest failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
