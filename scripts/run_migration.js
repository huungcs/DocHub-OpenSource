const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const projectRoot = path.join(__dirname, '..');

function loadLocalEnvironment() {
  const envPath = path.join(projectRoot, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]]) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[match[1]] = value;
  }
}

async function migrate() {
  loadLocalEnvironment();
  const migrationsDir = path.join(projectRoot, 'database', 'migrations');
  const migrations = fs.readdirSync(migrationsDir)
    .filter(file => /^\d+.*\.sql$/i.test(file))
    .sort();

  const password = process.env.SUPABASE_DB_PASSWORD || process.env.APP_PASSWORD;
  if (!password) throw new Error('Missing SUPABASE_DB_PASSWORD (or APP_PASSWORD) in the environment.');

  const client = new Client({
    host: process.env.SUPABASE_DB_HOST || 'db.your-project.supabase.co',
    port: Number(process.env.SUPABASE_DB_PORT || 5432),
    user: process.env.SUPABASE_DB_USER || 'postgres',
    password,
    database: process.env.SUPABASE_DB_NAME || 'postgres',
    ssl: { rejectUnauthorized: false }
  });

  console.log('Connecting to PostgreSQL...');
  await client.connect();
  console.log(`Connected. Applying ${migrations.length} migration(s)...`);

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.schema_migrations (
        filename TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      ALTER TABLE public.schema_migrations ENABLE ROW LEVEL SECURITY
    `);
    const applied = new Set((await client.query('SELECT filename FROM public.schema_migrations')).rows.map(row => row.filename));

    for (const filename of migrations) {
      if (applied.has(filename)) {
        console.log(`Already applied: ${filename}`);
        continue;
      }
      const sql = fs.readFileSync(path.join(migrationsDir, filename), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO public.schema_migrations(filename) VALUES ($1)', [filename]);
        await client.query('COMMIT');
        console.log(`Applied: ${filename}`);
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(`${filename}: ${error.message}`, { cause: error });
      }
    }

    // Verify tables
    const res = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name;
    `);
    console.log('Public tables created:', res.rows.map(r => r.table_name));

    // Reload PostgREST schema cache
    await client.query('NOTIFY pgrst, \'reload schema\';');
    console.log('Notified PostgREST to reload schema cache.');
  } catch (err) {
    console.error('Migration failed:', err);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

migrate().catch(console.error);
