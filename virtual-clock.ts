// Inserted before scene scripts, never after initialization. Timers remain native
// for readiness timeouts; scene validation prohibits using them for choreography.
export const VIRTUAL_CLOCK_SOURCE = `(function(){
  let virtualMs = 0, rafId = 0;
  const queue = new Map();
  const errors = [];
  Object.defineProperty(performance, 'now', { configurable: true, value: () => virtualMs });
  Date.now = () => virtualMs;
  window.requestAnimationFrame = function(cb){
    if (typeof cb !== 'function') throw new TypeError('RAF callback must be a function');
    queue.set(++rafId, cb);
    return rafId;
  };
  window.cancelAnimationFrame = id => queue.delete(id);
  window.addEventListener('error', e => errors.push(e.message || 'Scene runtime error'));
  window.addEventListener('unhandledrejection', e => errors.push(String(e.reason)));
  window.__TIMECUT__ = { errors, now: () => virtualMs };
  window.__TIMECUT_SET_TIME__ = function(seconds){
    if (!Number.isFinite(seconds) || seconds < 0) throw new Error('Invalid frame timestamp');
    if (errors.length) throw new Error(errors[errors.length - 1]);
    virtualMs = seconds * 1000;
    const ids = Array.from(queue.keys());
    for (const id of ids) {
      const cb = queue.get(id);
      queue.delete(id);
      if (!cb) continue;
      try { cb(virtualMs); }
      catch (e) { errors.push(String(e)); throw e; }
    }
    // Persisted event-driven scenes still use the same absolute timeline.
    document.getAnimations().forEach(a => { a.pause(); a.currentTime = virtualMs; });
    window.__MOTIONFORGE_TIME__ = seconds;
    window.dispatchEvent(new CustomEvent('motionforge:frame', { detail: seconds }));
    if (errors.length) throw new Error(errors[errors.length - 1]);
  };
})();`;

export function injectVirtualClock(html: string) {
  if (!/<head\b[^>]*>/i.test(html)) throw new Error('Cannot install virtual clock: missing head');
  return html.replace(/<head\b[^>]*>/i, head => `${head}<script>${VIRTUAL_CLOCK_SOURCE}</script>`);
}
