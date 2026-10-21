// Wait for completion so slow connections do not pile up requests or invalidate every response.
export function startPolling(refresh: () => Promise<unknown>, delay: number) {
  let stopped = false;
  let running = false;
  let timer: ReturnType<typeof setTimeout>;
  const run = async () => {
    if (stopped || running) return;
    clearTimeout(timer);
    running = true;
    try { if (!document.hidden && navigator.onLine !== false) await refresh(); }
    catch { /* The data loader owns its visible error state. */ }
    finally {
      running = false;
      if (!stopped) timer = setTimeout(run, delay);
    }
  };
  const resume = () => { if (!document.hidden && navigator.onLine !== false) void run(); };
  document.addEventListener('visibilitychange', resume);
  window.addEventListener('online', resume);
  void run();
  return () => {
    stopped = true;
    clearTimeout(timer);
    document.removeEventListener('visibilitychange', resume);
    window.removeEventListener('online', resume);
  };
}
