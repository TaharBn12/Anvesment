const LEVELS = { info: 'ℹ️', warn: '⚠️', error: '❌', ok: '✅' };

function ts() {
  return new Date().toISOString();
}

export const logger = {
  info: (...args) => console.log(LEVELS.info, ts(), ...args),
  ok: (...args) => console.log(LEVELS.ok, ts(), ...args),
  warn: (...args) => console.warn(LEVELS.warn, ts(), ...args),
  error: (...args) => console.error(LEVELS.error, ts(), ...args),
};

export default logger;
