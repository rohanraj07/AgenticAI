/**
 * Structured console logger with colour-coded prefixes.
 * Used by every backend module for consistent, readable logs.
 */

const COLORS = {
  reset:  '\x1b[0m',
  bright: '\x1b[1m',
  cyan:   '\x1b[36m',
  green:  '\x1b[32m',
  yellow: '\x1b[33m',
  red:    '\x1b[31m',
  magenta:'\x1b[35m',
  blue:   '\x1b[34m',
  grey:   '\x1b[90m',
};

function ts() {
  return new Date().toISOString().slice(11, 23); // HH:MM:SS.mmm
}

function tag(label, color) {
  return `${color}${COLORS.bright}[${label}]${COLORS.reset}`;
}

export const log = {
  redis:   (...a) => console.log(tag('Redis',    COLORS.cyan),    ts(), ...a),
  vector:  (...a) => console.log(tag('VectorDB', COLORS.blue),    ts(), ...a),
  agent:   (...a) => console.log(tag('Agent',    COLORS.magenta), ts(), ...a),
  chain:   (...a) => console.log(tag('LangChain',COLORS.green),   ts(), ...a),
  graph:   (...a) => console.log(tag('LangGraph',COLORS.yellow),  ts(), ...a),
  route:   (...a) => console.log(tag('Route',    COLORS.cyan),    ts(), ...a),
  info:    (...a) => console.log(tag('Info',     COLORS.green),   ts(), ...a),
  warn:    (...a) => console.warn(tag('Warn',    COLORS.yellow),  ts(), ...a),
  error:   (...a) => console.error(tag('Error',  COLORS.red),     ts(), ...a),
};
