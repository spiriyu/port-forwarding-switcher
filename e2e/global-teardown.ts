export default async function globalTeardown() {
  const pid = process.env['E2E_DAEMON_PID'];
  if (pid) {
    try { process.kill(Number(pid), 'SIGTERM'); } catch { /* already dead */ }
  }
}
