// ═══════════════════════════════════════════════════════════════════════════════
// WEDJAT DOMAIN AI — Seed: demo source databases for the intake engine (§106–§160).
//
// Creates three realistic external-platform artifacts and runs them through the
// REAL intake pipeline (same code the API/job worker uses):
//   1. scarab-crm v1 (SQLite binary — legacy CRM, 12 tables, FKs, indexes)
//   2. scarab-crm v2 (SQLite — schema drift: +loyalty_programs, +column, −table)
//   3. atlas-commerce products export (CSV)
//   4. pulse-events notifications export (JSONL)
// Idempotent: skips when SourceDatabase rows already exist.
// ═══════════════════════════════════════════════════════════════════════════════

import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { db } from '@/lib/db';
import { runIntake, INTAKE_ENGINE_VERSION } from '@/lib/wedjat/intake/engine';
import { logger } from '@/lib/wedjat/logger';

const SOURCES_DIR = join(process.cwd(), 'db', 'sources');

// Deterministic pseudo-random (seeded LCG) → reproducible artifacts.
let seedState = 42;
function rnd(): number {
  seedState = (seedState * 1103515245 + 12345) % 2147483648;
  return seedState / 2147483648;
}
function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(rnd() * arr.length)];
}
function int(min: number, max: number): number {
  return Math.floor(min + rnd() * (max - min + 1));
}
function isoDaysAgo(days: number, hourOffset = 0): string {
  const d = new Date(Date.now() - days * 86_400_000 + hourOffset * 3_600_000);
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

// ── scarab-crm builder (v1 / v2 with drift) ───────────────────────────────────

const FIRST = ['Amara', 'Yusuf', 'Layla', 'Omar', 'Nadia', 'Karim', 'Salma', 'Tariq', 'Dina', 'Hassan', 'Aisha', 'Faisal'];
const LAST = ['Djedi', 'Kahlout', 'Hassan', 'Farouk', 'Mansour', 'Said', 'Aziz', 'Bakr', 'Nour', 'Rahman'];
const CITIES = ['Cairo', 'Alexandria', 'Giza', 'Luxor', 'Aswan', 'Mansoura', 'Tanta', 'Suez'];
const STATUSES = ['ACTIVE', 'PROSPECT', 'CHURNED'] as const;
const TIERS = ['BRONZE', 'SILVER', 'GOLD', 'PLATINUM'] as const;
const ORDER_STATUSES = ['NEW', 'PAID', 'SHIPPED', 'CANCELLED'] as const;
const PAY_METHODS = ['CARD', 'WALLET', 'BANK'] as const;
const PAY_STATUSES = ['CAPTURED', 'REFUNDED', 'PENDING'] as const;
const DEPARTMENTS = ['ENGINEERING', 'SALES', 'SUPPORT', 'FINANCE', 'OPERATIONS'] as const;
const ROLES = ['AGENT', 'MANAGER', 'DIRECTOR'] as const;
const CATEGORIES = ['ELECTRONICS', 'APPAREL', 'HOME', 'BEAUTY', 'SPORTS'] as const;
const DOC_TYPES = ['SPEC', 'POLICY', 'RUNBOOK', 'REPORT'] as const;
const DOC_STATUSES = ['DRAFT', 'PUBLISHED', 'ARCHIVED'] as const;

function esc(s: string): string {
  return s.replace(/'/g, "''");
}

function buildScarabCrm(path: string, v2: boolean): void {
  const sqlite = new DatabaseSync(path);
  sqlite.exec('PRAGMA journal_mode=WAL;');
  sqlite.exec('PRAGMA foreign_keys=ON;');

  sqlite.exec(`
    CREATE TABLE customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT,
      status TEXT NOT NULL CHECK (status IN ('ACTIVE','PROSPECT','CHURNED')),
      tier TEXT,
      address TEXT,
      city TEXT,
      country TEXT DEFAULT 'EG',
      created_at DATETIME NOT NULL,
      updated_at DATETIME,
      notes TEXT
    );
    CREATE INDEX idx_customers_email ON customers(email);
    CREATE INDEX idx_customers_status ON customers(status);
    CREATE UNIQUE INDEX uq_customers_email ON customers(email);
  `);

  sqlite.exec(`
    CREATE TABLE client_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_uuid TEXT NOT NULL,
      account_name TEXT NOT NULL,
      primary_email TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at DATETIME NOT NULL
    );
    CREATE UNIQUE INDEX uq_client_accounts_uuid ON client_accounts(account_uuid);
  `);

  sqlite.exec(`
    CREATE TABLE orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('NEW','PAID','SHIPPED','CANCELLED')),
      total_amount NUMERIC(12,2) NOT NULL,
      currency TEXT NOT NULL DEFAULT 'EGP',
      ordered_at DATETIME NOT NULL,
      created_at DATETIME NOT NULL,
      updated_at DATETIME,
      FOREIGN KEY (customer_id) REFERENCES customers(id)
    );
    CREATE INDEX idx_orders_customer ON orders(customer_id);
    CREATE INDEX idx_orders_status ON orders(status);
  `);

  sqlite.exec(`
    CREATE TABLE products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sku TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      category TEXT NOT NULL,
      price NUMERIC(10,2) NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT 1,
      created_at DATETIME NOT NULL
    );
    CREATE UNIQUE INDEX uq_products_sku ON products(sku);
  `);

  sqlite.exec(`
    CREATE TABLE order_items (
      order_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      quantity INTEGER NOT NULL,
      unit_price NUMERIC(10,2) NOT NULL,
      PRIMARY KEY (order_id, product_id),
      FOREIGN KEY (order_id) REFERENCES orders(id),
      FOREIGN KEY (product_id) REFERENCES products(id)
    );
  `);

  sqlite.exec(`
    CREATE TABLE payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      amount NUMERIC(12,2) NOT NULL,
      currency TEXT NOT NULL DEFAULT 'EGP',
      method TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('CAPTURED','REFUNDED','PENDING')),
      paid_at DATETIME,
      FOREIGN KEY (order_id) REFERENCES orders(id)
    );
    CREATE INDEX idx_payments_order ON payments(order_id);
  `);

  sqlite.exec(`
    CREATE TABLE inventory (
      product_id INTEGER NOT NULL,
      warehouse TEXT NOT NULL,
      quantity_on_hand INTEGER NOT NULL DEFAULT 0,
      reorder_threshold INTEGER NOT NULL DEFAULT 10,
      PRIMARY KEY (product_id, warehouse),
      FOREIGN KEY (product_id) REFERENCES products(id)
    );
  `);

  sqlite.exec(`
    CREATE TABLE employees (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      email TEXT NOT NULL,
      department TEXT NOT NULL,
      role TEXT NOT NULL,
      hired_at DATE NOT NULL,
      salary NUMERIC(10,2)
    );
    CREATE UNIQUE INDEX uq_employees_email ON employees(email);
  `);

  sqlite.exec(`
    CREATE TABLE documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      content TEXT,
      author_id INTEGER,
      doc_type TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at DATETIME NOT NULL,
      FOREIGN KEY (author_id) REFERENCES employees(id)
    );
    CREATE INDEX idx_documents_type ON documents(doc_type);
  `);

  sqlite.exec(`
    CREATE TABLE settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      environment TEXT NOT NULL DEFAULT 'production',
      description TEXT
    );
  `);

  sqlite.exec(`
    CREATE TABLE audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_id INTEGER,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT,
      occurred_at DATETIME NOT NULL,
      detail TEXT
    );
    CREATE INDEX idx_audit_logs_occurred ON audit_logs(occurred_at);
    CREATE INDEX idx_audit_logs_entity ON audit_logs(entity_type, entity_id);
  `);

  // v2 drift: categories exists only in v1; loyalty_programs only in v2.
  if (!v2) {
    sqlite.exec(`
      CREATE TABLE categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        code TEXT NOT NULL
      );
    `);
    const catRows = CATEGORIES.map((c, i) => `(${i + 1}, '${c}', '${c.slice(0, 3)}')`).join(',');
    sqlite.exec(`INSERT INTO categories (id, name, code) VALUES ${catRows};`);
  } else {
    sqlite.exec(`
      CREATE TABLE loyalty_programs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        program_name TEXT NOT NULL,
        tier TEXT NOT NULL,
        points_required INTEGER NOT NULL,
        valid_from DATE NOT NULL,
        valid_to DATE,
        description TEXT
      );
    `);
    const lp = ['Nile Rewards', 'Delta Club', 'Oasis Circle']
      .map((n, i) => `(${i + 1}, '${n}', '${pick(TIERS)}', ${int(500, 20000)}, '${isoDaysAgo(30)}', '${isoDaysAgo(-400)}', '${esc('Program tier with annual benefits and point redemption rules.')}')`)
      .join(',');
    const lpSql = `INSERT INTO loyalty_programs (id, program_name, tier, points_required, valid_from, valid_to, description) VALUES ${lp};`;
    sqlite.exec(lpSql);
    sqlite.exec(`ALTER TABLE customers ADD COLUMN loyalty_tier TEXT;`);
    sqlite.exec(`UPDATE customers SET loyalty_tier = 'NONE';`);
  }

  // ── data ─────────────────────────────────────────────────────────────────────
  const insert = (table: string, cols: string, rows: string[]): void => {
    if (rows.length === 0) return;
    sqlite.exec(`INSERT INTO ${table} (${cols}) VALUES ${rows.join(',')};`);
  };

  const customers: string[] = [];
  for (let i = 1; i <= 220; i++) {
    const fn = pick(FIRST);
    const ln = pick(LAST);
    const stale = rnd() < 0.25;
    customers.push(
      `(${i}, '${esc(`${fn} ${ln}`)}', '${esc(`${fn.toLowerCase()}.${ln.toLowerCase()}${i}@example.com`)}', '+20 10 ${int(10000000, 99999999)}', '${pick(STATUSES)}', '${pick(TIERS)}', '${int(1, 80)} ${pick(['Tahrir', 'Nile', 'Pyramids', 'Corniche'])} St', '${pick(CITIES)}', 'EG', '${isoDaysAgo(stale ? int(380, 700) : int(2, 300))}', '${isoDaysAgo(int(1, 30))}', ${rnd() < 0.5 ? `'${esc('Key account contact — prefers email before calls.')}'` : 'NULL'})`
    );
  }
  insert('customers', 'id, name, email, phone, status, tier, address, city, country, created_at, updated_at, notes', customers);

  const accounts: string[] = [];
  for (let i = 1; i <= 80; i++) {
    accounts.push(
      `(${i}, '${createHash('md5').update(`acct-${i}`).digest('hex')}', '${esc(`Account ${i} Holdings`)}', '${esc(`ops${i}@example.org`)}', '${pick(STATUSES)}', '${isoDaysAgo(int(10, 500))}')`
    );
  }
  insert('client_accounts', 'id, account_uuid, account_name, primary_email, status, created_at', accounts);

  const products: string[] = [];
  const productCount = 120;
  for (let i = 1; i <= productCount; i++) {
    const cat = pick(CATEGORIES);
    products.push(
      `(${i}, 'SKU-${1000 + i}', '${esc(`${cat.slice(0, 1)}${i} ${pick(['Pro', 'Lite', 'Max', 'Classic', 'Edge'])}`)}', '${esc(`The ${cat.toLowerCase()} line item ${i} — durable build, 12-month warranty, regional service coverage. Includes mounting kit and quick-start guide with full specifications for procurement teams.`)}', '${cat}', ${int(50, 9000)}, ${rnd() < 0.85 ? 1 : 0}, '${isoDaysAgo(int(30, 800))}')`
    );
  }
  insert('products', 'id, sku, name, description, category, price, is_active, created_at', products);

  const inventory: string[] = [];
  for (let i = 1; i <= productCount; i++) {
    inventory.push(`(${i}, '${pick(['CAI-WH-1', 'ALX-WH-2', 'GIZ-WH-1'])}', ${int(0, 500)}, ${int(5, 40)})`);
  }
  insert('inventory', 'product_id, warehouse, quantity_on_hand, reorder_threshold', inventory);

  const employees: string[] = [];
  for (let i = 1; i <= 40; i++) {
    const fn = pick(FIRST);
    const ln = pick(LAST);
    employees.push(
      `(${i}, '${fn}', '${ln}', '${esc(`${fn.toLowerCase()}.${ln.toLowerCase()}${i}@scarab-crm.example`)}', '${pick(DEPARTMENTS)}', '${pick(ROLES)}', '${isoDaysAgo(int(90, 2500))}', ${int(8000, 42000)})`
    );
  }
  insert('employees', 'id, first_name, last_name, email, department, role, hired_at, salary', employees);

  const orders: string[] = [];
  for (let i = 1; i <= 900; i++) {
    const daysAgo = int(1, 340);
    orders.push(
      `(${i}, ${int(1, 220)}, '${pick(ORDER_STATUSES)}', ${int(120, 18000)}, 'EGP', '${isoDaysAgo(daysAgo)}', '${isoDaysAgo(daysAgo, 1)}', '${isoDaysAgo(Math.max(0, daysAgo - 1))}')`
    );
  }
  insert('orders', 'id, customer_id, status, total_amount, currency, ordered_at, created_at, updated_at', orders);

  const orderItems: string[] = [];
  for (let i = 1; i <= 900; i++) {
    const n = int(1, 4);
    const usedProducts = new Set<number>();
    for (let j = 0; j < n; j++) {
      let pid = int(1, productCount);
      while (usedProducts.has(pid)) pid = int(1, productCount);
      usedProducts.add(pid);
      orderItems.push(`(${i}, ${pid}, ${int(1, 5)}, ${int(50, 3000)})`);
    }
  }
  insert('order_items', 'order_id, product_id, quantity, unit_price', orderItems);

  const payments: string[] = [];
  for (let i = 1; i <= 850; i++) {
    // one deliberate outlier for DQ findings (WARN, non-blocking)
    const amount = i === 77 ? 1_250_000 : int(120, 18000);
    payments.push(
      `(${i}, ${i}, ${amount}, 'EGP', '${pick(PAY_METHODS)}', '${pick(PAY_STATUSES)}', '${isoDaysAgo(int(1, 330))}')`
    );
  }
  insert('payments', 'id, order_id, amount, currency, method, status, paid_at', payments);

  const documents: string[] = [];
  const docTitles = [
    'Refund handling policy',
    'Data retention schedule',
    'Warehouse failover runbook',
    'Customer onboarding spec',
    'Payment gateway integration report',
    'Churn review procedure',
  ];
  for (let i = 1; i <= 30; i++) {
    const title = `${docTitles[(i - 1) % docTitles.length]} ${Math.ceil(i / docTitles.length)}`;
    documents.push(
      `(${i}, '${esc(title)}', '${esc(`Policy document covering scope, responsibilities and escalation paths for ${title.toLowerCase()}. Approved by operations. Applies to all regional teams handling ${pick(['refunds', 'retention', 'failover', 'onboarding'])}. Review cycle: every 180 days. Owner: ${pick(DEPARTMENTS)} department.`)}', ${int(1, 40)}, '${pick(DOC_TYPES)}', '${pick(DOC_STATUSES)}', '${isoDaysAgo(int(5, 400))}')`
    );
  }
  insert('documents', 'id, title, content, author_id, doc_type, status, created_at', documents);

  const settingsRows: string[] = [
    `('billing.currency', 'EGP', 'production', 'Default settlement currency')`,
    `('checkout.timeout_sec', '900', 'production', 'Session timeout during checkout')`,
    `('support.sla_hours', '24', 'production', 'First-response SLA for open tickets')`,
    `('inventory.low_stock_alert', 'true', 'production', 'Enable low-stock notifications')`,
    `('auth.max_failed_logins', '5', 'production', 'Lockout threshold')`,
  ];
  insert('settings', 'key, value, environment, description', settingsRows);

  const audit: string[] = [];
  const actions = ['CREATE', 'UPDATE', 'DELETE', 'LOGIN', 'EXPORT', 'PERMISSION_CHANGE'];
  for (let i = 1; i <= 1500; i++) {
    audit.push(
      `(${i}, ${int(1, 40)}, '${pick(actions)}', '${pick(['ORDER', 'CUSTOMER', 'PRODUCT', 'DOCUMENT', 'SETTING'])}', '${int(1, 900)}', '${isoDaysAgo(int(0, 180), int(0, 20))}', '${esc(`audit trail entry ${i}`)}')`
    );
  }
  insert('audit_logs', 'id, actor_id, action, entity_type, entity_id, occurred_at, detail', audit);

  sqlite.exec('PRAGMA wal_checkpoint(TRUNCATE);');
  sqlite.close();
}

// ── CSV + JSONL builders ──────────────────────────────────────────────────────

function buildAtlasCsv(): string {
  const header = 'id,sku,product_name,description,category,list_price,currency,stock_qty,is_active,created_at';
  const rows: string[] = [];
  for (let i = 1; i <= 150; i++) {
    const cat = pick(CATEGORIES);
    rows.push(
      `${i},ATL-${2000 + i},"${cat} Item ${i} ${pick(['Standard', 'Premium', 'Value'])}","${esc(`Atlas commerce catalog item ${i} in the ${cat.toLowerCase()} category. Ships from Alexandria fulfilment center with 48-hour dispatch and cross-border returns support.`)}",${cat},${int(40, 6000)},USD,${int(0, 400)},${rnd() < 0.9 ? 'true' : 'false'},${isoDaysAgo(int(10, 400))}`
    );
  }
  return [header, ...rows].join('\n');
}

function buildPulseJsonl(): string {
  const rows: string[] = [];
  const types = ['ORDER_DELAYED', 'PAYMENT_FAILED', 'STOCK_LOW', 'AUTH_LOCKOUT', 'JOB_TIMEOUT', 'DELIVERY_EXCEPTION'];
  const severities = ['INFO', 'WARN', 'CRITICAL'];
  for (let i = 1; i <= 200; i++) {
    rows.push(
      JSON.stringify({
        id: `evt-${100000 + i}`,
        event_type: pick(types),
        severity: pick(severities),
        title: `Event ${i}: ${pick(['processing', 'dispatch', 'settlement', 'authentication'])} anomaly`,
        detail: `Automated notification from the pulse platform. Correlation key pulse-${int(1000, 9999)}. Requires triage when severity is CRITICAL.`,
        source_system: pick(['checkout-svc', 'payments-svc', 'inventory-svc', 'auth-svc']),
        occurred_at: isoDaysAgo(int(0, 60), int(0, 20)).replace(' ', 'T') + 'Z',
      })
    );
  }
  return rows.join('\n');
}

// ── orchestration ──────────────────────────────────────────────────────────────

async function ingestArtifact(
  orgId: string,
  userId: string,
  opts: { platform: string; name: string; versionLabel: string; originalName: string; build?: (path: string) => void; bytes?: Uint8Array }
): Promise<void> {
  const exists = await db.sourceDatabase.findFirst({
    where: { orgId, platform: opts.platform, name: opts.name, versionLabel: opts.versionLabel },
  });
  if (exists) {
    logger.info('intake_seed_skipped', { platform: opts.platform, version: opts.versionLabel });
    return;
  }
  const source = await db.sourceDatabase.create({
    data: {
      orgId,
      name: opts.name,
      platform: opts.platform,
      engine: 'UNKNOWN',
      versionLabel: opts.versionLabel,
      checksum: 'pending',
      byteSize: 0,
      artifactPath: 'pending',
      originalName: opts.originalName,
      status: 'PROCESSING',
      uploadedById: userId,
    },
  });
  const artifactPath = join(SOURCES_DIR, source.id, 'artifact');
  await fs.mkdir(join(SOURCES_DIR, source.id), { recursive: true });
  if (opts.bytes) {
    await fs.writeFile(artifactPath, opts.bytes);
  } else {
    opts.build(artifactPath);
  }
  const buf = new Uint8Array(await fs.readFile(artifactPath));
  const checksum = createHash('sha256').update(buf).digest('hex');
  await db.sourceDatabase.update({
    where: { id: source.id },
    data: { checksum, byteSize: buf.length, artifactPath, engine: 'SQLITE' },
  });
  const run = await db.intakeRun.create({
    data: {
      sourceDatabaseId: source.id,
      orgId,
      status: 'RAW',
      trigger: 'UPLOAD',
      engineVersion: INTAKE_ENGINE_VERSION,
    },
  });
  await db.sourceDatabase.update({ where: { id: source.id }, data: { latestRunId: run.id } });
  const outcome = await runIntake(run.id, userId);
  logger.info('intake_seed_done', {
    platform: opts.platform,
    version: opts.versionLabel,
    status: outcome.status,
    tables: outcome.tables,
    rows: outcome.rows,
    knowledge: outcome.knowledgeRecords,
    candidates: outcome.trainingCandidates,
    dq: outcome.dqReport?.score,
  });
  console.log(
    `[seed-intake] ${opts.platform} ${opts.versionLabel}: ${outcome.status} — ${outcome.tables} tables, ${outcome.rows.toLocaleString()} rows, DQ ${outcome.dqReport?.score ?? '—'}/100, mappings H/M/L/U ${outcome.mappings.high}/${outcome.mappings.medium}/${outcome.mappings.low}/${outcome.mappings.unresolved}, ${outcome.knowledgeRecords} knowledge records, ${outcome.trainingCandidates} training candidates`
  );
  for (const line of outcome.narrative) console.log(`    ${line}`);
}

async function main(): Promise<void> {
  const owner = await db.user.findFirst({ where: { role: 'OWNER' }, include: { org: true } });
  if (!owner) throw new Error('no OWNER user — run scripts/seed.ts first');
  const orgId = owner.orgId;
  await fs.mkdir(SOURCES_DIR, { recursive: true });

  const already = await db.sourceDatabase.count({ where: { orgId } });
  if (already > 0) {
    console.log(`[seed-intake] ${already} source database(s) already present — skipping.`);
    return;
  }

  console.log('[seed-intake] 1/4 — scarab-crm v1 (SQLite binary)…');
  await ingestArtifact(orgId, owner.id, {
    platform: 'scarab-crm',
    name: 'crm_prod',
    versionLabel: 'v1',
    originalName: 'crm_prod_v1.db',
    build: (p) => buildScarabCrm(p, false),
  });

  console.log('[seed-intake] 2/4 — scarab-crm v2 (schema drift demo)…');
  await ingestArtifact(orgId, owner.id, {
    platform: 'scarab-crm',
    name: 'crm_prod',
    versionLabel: 'v2',
    originalName: 'crm_prod_v2.db',
    build: (p) => buildScarabCrm(p, true),
  });

  console.log('[seed-intake] 3/4 — atlas-commerce products export (CSV)…');
  await ingestArtifact(orgId, owner.id, {
    platform: 'atlas-commerce',
    name: 'products_export',
    versionLabel: 'v1',
    originalName: 'atlas_products.csv',
    bytes: new TextEncoder().encode(buildAtlasCsv()),
  });

  console.log('[seed-intake] 4/4 — pulse-events notifications export (JSONL)…');
  await ingestArtifact(orgId, owner.id, {
    platform: 'pulse-events',
    name: 'notifications_export',
    versionLabel: 'v1',
    originalName: 'pulse_notifications.jsonl',
    bytes: new TextEncoder().encode(buildPulseJsonl()),
  });

  const sources = await db.sourceDatabase.findMany({ where: { orgId }, orderBy: { createdAt: 'asc' } });
  console.log('\n[seed-intake] SUMMARY');
  for (const s of sources) {
    console.log(
      `  ${s.platform}/${s.name} ${s.versionLabel} — ${s.status}, ${s.tablesTotal} tables, ${s.rowsTotal.toLocaleString()} rows, DQ ${s.dqScore ?? '—'}, mapped H/M/L/U ${s.mappedHigh}/${s.mappedMedium}/${s.mappedLow}/${s.mappedUnresolved}, ${s.knowledgeRecordsCount} KR, ${s.chunksCount} chunks, ${s.trainingCandidatesCount} candidates`
    );
  }
  process.exit(0);
}

main().catch((err) => {
  console.error('[seed-intake] FAILED:', err);
  process.exit(1);
});
