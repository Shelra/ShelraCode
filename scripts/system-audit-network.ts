const start = Date.now();
try {
  const response = await fetch("https://openrouter.ai/api/v1/models", { signal: AbortSignal.timeout(5_000) });
  console.log(JSON.stringify({ status: response.status, durationMs: Date.now() - start }));
} catch (error) {
  console.log(
    JSON.stringify({ error: error instanceof Error ? error.message : String(error), durationMs: Date.now() - start }),
  );
  process.exitCode = 1;
}
