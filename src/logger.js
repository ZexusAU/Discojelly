const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

/** Tiny timestamped logger. Never log secrets or raw webhook bodies above debug level. */
export function createLogger(level = 'info') {
  const min = LEVELS[level] ?? LEVELS.info;
  const emit = (name, stream) => (...args) => {
    if (LEVELS[name] >= min) stream(`${new Date().toISOString()} [${name.toUpperCase()}]`, ...args);
  };
  return {
    debug: emit('debug', console.debug),
    info: emit('info', console.log),
    warn: emit('warn', console.warn),
    error: emit('error', console.error),
  };
}
