// Wait for completion so slow connections do not pile up requests or invalidate every response.
export function startPolling(refresh: () => Promise<unknown>, delay: number) {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout>;
  const run = async () => {
    try { if (!document.hidden) await refresh(); }
    catch { /* The data loader owns its visible error state. */ }
    finally { if (!stopped) timer = setTimeout(run, delay); }
  };
  void run();
  return () => { stopped = true; clearTimeout(timer); };
}
