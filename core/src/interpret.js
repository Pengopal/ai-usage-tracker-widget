// Turns a reader's result into what the apps store for a provider:
//   { connected: false }
//   { connected: true, error }
//   { connected: true, windows, plan?, detail? }
const { parseClaude, parseOpenAI, parseGrok } = require('./parsers');

const PARSERS = { claude: parseClaude, openai: parseOpenAI, grok: parseGrok };

function interpret(id, res, now = Date.now()) {
  if (!res || typeof res !== 'object' || !res.auth) return { connected: false };
  if (res.error) return { connected: true, error: String(res.error) };
  const parse = PARSERS[id];
  if (!parse) return { connected: true, error: `Unknown provider ${id}` };
  const parsed = parse(res, now);
  if (parsed.error) return { connected: true, error: parsed.error };
  const windows = Object.fromEntries(Object.entries(parsed.windows || {}).filter(([, w]) => w && w.pct != null));
  const out = { connected: true, windows };
  if (parsed.plan != null) out.plan = parsed.plan;
  if (parsed.detail != null) out.detail = parsed.detail;
  return out;
}

module.exports = { interpret };
