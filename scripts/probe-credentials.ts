// ═══════════════════════════════════════════════════════════════════════════════
// WEDJAT — credential probe (validation ONLY; never prints secret values).
//
// Reads .env.local, probes each platform's GitHub repo (auth'd GET), Turso
// DB (SELECT 1), Vercel token (GET /v2/user or project), and AI provider keys
// (lightweight auth-checked call). Prints ONLY platform + OK/FAIL + hints
// (rate limits, repo visibility) — no token material, ever.
// ═══════════════════════════════════════════════════════════════════════════════

import { readFileSync } from 'node:fs';

const env = readFileSync('.env.local', 'utf8');
const envMap = new Map(
  env.split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

async function probeGitHub(name: string, token: string, repo: string): Promise<void> {
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'wedjat-probe' },
    });
    if (res.status === 200) {
      const j = (await res.json()) as { private?: boolean; default_branch?: string; size?: number; pushed_at?: string };
      console.log(`  ${name} GitHub: OK (branch ${j.default_branch}, ${j.size}KB, pushed ${j.pushed_at?.slice(0, 10)})`);
    } else if (res.status === 404) {
      console.log(`  ${name} GitHub: FAIL 404 (repo not visible with this token)`);
    } else {
      console.log(`  ${name} GitHub: FAIL ${res.status}`);
    }
  } catch (e) {
    console.log(`  ${name} GitHub: NETWORK ${e instanceof Error ? e.message.slice(0, 40) : 'err'}`);
  }
}

async function probeTurso(name: string, url: string, token: string): Promise<void> {
  try {
    const { createClient } = await import('@libsql/client');
    const c = createClient({ url, authToken: token });
    await c.execute('SELECT 1');
    const tables = await c.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name");
    console.log(`  ${name} Turso: OK (${tables.rows.length} tables)`);
    c.close();
  } catch (e) {
    console.log(`  ${name} Turso: FAIL ${e instanceof Error ? e.message.slice(0, 60) : 'err'}`);
  }
}

async function probeVercel(name: string, token: string): Promise<void> {
  try {
    const res = await fetch('https://api.vercel.com/v2/user', { headers: { Authorization: `Bearer ${token}` } });
    console.log(`  ${name} Vercel token: ${res.status === 200 ? 'OK' : `FAIL ${res.status}`}`);
  } catch {
    console.log(`  ${name} Vercel token: NETWORK`);
  }
}

async function probeGroq(name: string, key: string): Promise<void> {
  try {
    const res = await fetch('https://api.groq.com/openai/v1/models', { headers: { Authorization: `Bearer ${key}` } });
    console.log(`  ${name} Groq key: ${res.status === 200 ? 'OK (valid)' : `FAIL ${res.status}`}`);
  } catch {
    console.log(`  ${name} Groq key: NETWORK`);
  }
}

async function main(): Promise<void> {
  const platforms: { name: string; prefix: string; hasTurso: boolean; hasVercel: boolean; hasGroq: boolean }[] = [
    { name: 'CIRKLE', prefix: 'CIRKLE', hasTurso: true, hasVercel: true, hasGroq: true },
    { name: 'AURIENTA', prefix: 'AURIENTA', hasTurso: true, hasVercel: true, hasGroq: true },
    { name: 'SGTX', prefix: 'SGTX', hasTurso: true, hasVercel: true, hasGroq: true },
    { name: 'MTQ', prefix: 'MTQ', hasTurso: true, hasVercel: true, hasGroq: true },
    { name: 'JUDGE SMART', prefix: 'JUDGE', hasTurso: true, hasVercel: true, hasGroq: false },
    { name: 'EGYCOURT', prefix: 'EGYCOURT', hasTurso: false, hasVercel: false, hasGroq: false },
    { name: 'SGTX FABLE', prefix: 'SGTXFABLE', hasTurso: false, hasVercel: false, hasGroq: false },
    { name: 'PPE', prefix: 'PPE', hasTurso: true, hasVercel: true, hasGroq: false },
    { name: 'MTQ SIGMA', prefix: 'MTQS', hasTurso: true, hasVercel: true, hasGroq: true },
    { name: 'OLYMP-EX', prefix: 'OLYMPEX', hasTurso: false, hasVercel: false, hasGroq: false },
  ];
  for (const p of platforms) {
    console.log(`== ${p.name} ==`);
    const ghToken = envMap.get(`${p.prefix}_GITHUB_TOKEN`);
    const ghRepo = envMap.get(`${p.prefix}_GITHUB_REPO`);
    if (ghToken && ghRepo) await probeGitHub(p.name, ghToken, ghRepo);
    if (p.hasTurso) {
      const url = envMap.get(`${p.prefix}_TURSO_DATABASE_URL`);
      const tok = envMap.get(`${p.prefix}_TURSO_AUTH_TOKEN`);
      if (url && tok) await probeTurso(p.name, url, tok);
    }
    if (p.hasVercel) {
      const tok = envMap.get(`${p.prefix}_VERCEL_TOKEN`);
      if (tok) await probeVercel(p.name, tok);
    }
    if (p.hasGroq) {
      const key = envMap.get(`${p.prefix}_GROQ_API_KEY`);
      if (key) await probeGroq(p.name, key);
    }
  }
  // Org-level keys
  console.log('== WEDJAT org keys ==');
  const wg = envMap.get('WEDJAT_GROQ_API_KEY');
  if (wg) await probeGroq('WEDJAT', wg);
}

main().catch((e) => console.error('failed:', e));
