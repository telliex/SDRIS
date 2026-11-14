// Sprint 0 process placeholder. No jobs are claimed or executed yet.
console.log('SDRIS worker scaffold: no durable jobs configured');

// Keep the process alive so it behaves like a long-running worker, and exit cleanly on signals.
const keepAlive = setInterval(() => undefined, 60_000);

function shutdown(signal: string): void {
  console.log(`SDRIS worker received ${signal}, shutting down`);
  clearInterval(keepAlive);
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
