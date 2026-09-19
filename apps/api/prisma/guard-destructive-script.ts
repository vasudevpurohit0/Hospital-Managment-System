/**
 * V-11: these DB-maintenance scripts (cleanup.ts, delete-emp-1001.ts,
 * delete-fake-emps.ts) used to instantiate `new PrismaClient()` directly
 * against whatever `DATABASE_URL` was in the invoking shell's environment,
 * with no check on `NODE_ENV`, no host allowlist, and no confirmation --
 * meaning any of them run by mistake (a misfired CI job, a copy-pasted
 * terminal command) with a production-pointing `DATABASE_URL` exported would
 * silently and irreversibly delete real clinical/procurement data.
 *
 * Call this first thing in `main()` in any script that runs an unconditional
 * `deleteMany()`/`delete()` against real tables. It refuses to proceed
 * unless the target host looks like a local/dev database AND the caller
 * passed `--yes` on the command line.
 */
export function assertSafeToRunDestructiveScript(scriptName: string): void {
  if (process.env.NODE_ENV === 'production') {
    console.error(`[${scriptName}] Refusing to run: NODE_ENV=production.`);
    process.exit(1);
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error(`[${scriptName}] Refusing to run: DATABASE_URL is not set.`);
    process.exit(1);
  }

  let host: string;
  try {
    host = new URL(databaseUrl).hostname;
  } catch {
    console.error(`[${scriptName}] Refusing to run: DATABASE_URL is not a valid URL.`);
    process.exit(1);
  }

  // Loopback (local dev) and the docker-compose service name this project's
  // own docker-compose.yml uses for its Postgres container -- nothing else.
  const LOCAL_HOST_ALLOWLIST = new Set(['localhost', '127.0.0.1', '::1', 'postgres', 'db']);
  if (!LOCAL_HOST_ALLOWLIST.has(host)) {
    console.error(
      `[${scriptName}] Refusing to run: DATABASE_URL host "${host}" is not in the local/dev allowlist (${[...LOCAL_HOST_ALLOWLIST].join(', ')}).`,
    );
    process.exit(1);
  }

  if (!process.argv.includes('--yes')) {
    console.error(
      `[${scriptName}] This script deletes real rows from "${host}". Re-run with --yes to confirm you mean to do this.`,
    );
    process.exit(1);
  }

  console.log(`[${scriptName}] Confirmed: local/dev host "${host}", --yes present. Proceeding.`);
}
