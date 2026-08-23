export function createGuardedRunner(fn, { onSkip = () => undefined, onError = () => undefined } = {}) {
  let running = false;
  return async function runGuarded(...args) {
    if (running) {
      onSkip();
      return { skipped: true };
    }
    running = true;
    try {
      const value = await fn(...args);
      return { skipped: false, value };
    } catch (error) {
      onError(error);
      return { skipped: false, error };
    } finally {
      running = false;
    }
  };
}
