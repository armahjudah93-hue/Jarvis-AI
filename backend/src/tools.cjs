const crypto = require('crypto');

const MAX_TIMER_SECONDS = 86_400;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ALLOWED_FILE_EXTENSIONS = new Set(['txt', 'md', 'csv', 'json', 'pdf', 'png', 'jpg', 'jpeg', 'webp']);

function userError(message, code = 'invalid_arguments', status = 400) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  error.expose = true;
  return error;
}

function assertPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw userError('Tool arguments must be an object.');
}

function createTimer(args) {
  assertPlainObject(args);
  const durationSeconds = Number(args.durationSeconds);
  if (!Number.isInteger(durationSeconds) || durationSeconds < 1 || durationSeconds > MAX_TIMER_SECONDS) {
    throw userError(`Timer duration must be a whole number between 1 and ${MAX_TIMER_SECONDS} seconds.`);
  }
  const label = typeof args.label === 'string' && args.label.trim() ? args.label.trim().slice(0, 80) : 'Jarvis timer';
  return { durationSeconds, label, startsOnClient: true };
}

function getTime(args = {}) {
  assertPlainObject(args);
  const requestedTimeZone = typeof args.timeZone === 'string' && args.timeZone.trim() ? args.timeZone.trim() : undefined;
  let timeZone = requestedTimeZone;
  try {
    if (timeZone) Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());
  } catch {
    throw userError('That time zone is not recognized. Use an IANA time zone such as Europe/Paris.');
  }

  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'long',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short'
  });
  return { iso: now.toISOString(), formatted: formatter.format(now), timeZone: timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone };
}

class SafeExpressionParser {
  constructor(expression) {
    if (typeof expression !== 'string' || expression.length > 160) throw userError('Use a mathematical expression of up to 160 characters.');
    this.tokens = this.tokenize(expression);
    this.index = 0;
  }

  tokenize(expression) {
    const tokens = [];
    const compact = expression.replace(/\s+/g, '');
    if (!compact) throw userError('Enter a mathematical expression to calculate.');
    let index = 0;
    while (index < compact.length) {
      const fragment = compact.slice(index);
      const number = fragment.match(/^(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/i);
      if (number) {
        tokens.push({ type: 'number', value: Number(number[0]) });
        index += number[0].length;
        continue;
      }
      const character = compact[index];
      if ('+-*/^()'.includes(character)) {
        tokens.push({ type: character, value: character });
        index += 1;
        continue;
      }
      throw userError('Calculations support numbers, parentheses, and +, -, ×, ÷, or ^ only.');
    }
    if (tokens.length > 80) throw userError('That expression is too complex.');
    return tokens;
  }

  peek(type) { return this.tokens[this.index]?.type === type; }
  take(type) {
    if (!this.peek(type)) return false;
    this.index += 1;
    return true;
  }

  parse() {
    const value = this.expression();
    if (this.index !== this.tokens.length) throw userError('I could not parse that calculation.');
    if (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER) throw userError('That result is outside the supported range.');
    return value;
  }

  expression() {
    let value = this.term();
    while (this.peek('+') || this.peek('-')) {
      const operator = this.tokens[this.index++].type;
      const right = this.term();
      value = operator === '+' ? value + right : value - right;
    }
    return value;
  }

  term() {
    let value = this.power();
    while (this.peek('*') || this.peek('/')) {
      const operator = this.tokens[this.index++].type;
      const right = this.power();
      if (operator === '/' && right === 0) throw userError('Division by zero is not allowed.');
      value = operator === '*' ? value * right : value / right;
    }
    return value;
  }

  power() {
    let value = this.unary();
    if (this.take('^')) {
      const exponent = this.power();
      if (Math.abs(exponent) > 100) throw userError('Exponents must be between -100 and 100.');
      value **= exponent;
    }
    return value;
  }

  unary() {
    if (this.take('+')) return this.unary();
    if (this.take('-')) return -this.unary();
    if (this.take('(')) {
      const value = this.expression();
      if (!this.take(')')) throw userError('A closing parenthesis is missing.');
      return value;
    }
    if (this.peek('number')) return this.tokens[this.index++].value;
    throw userError('I expected a number or parenthesized expression.');
  }
}

function calculate(args) {
  assertPlainObject(args);
  const expression = typeof args.expression === 'string' ? args.expression : '';
  const value = new SafeExpressionParser(expression).parse();
  return { expression, value, formatted: new Intl.NumberFormat('en-US', { maximumFractionDigits: 12 }).format(value) };
}

function flattenRelatedTopics(topics, results = []) {
  for (const topic of topics || []) {
    if (topic.Topics) flattenRelatedTopics(topic.Topics, results);
    else if (topic.Text && topic.FirstURL) results.push({ title: topic.Text.split(' - ')[0], snippet: topic.Text, url: topic.FirstURL });
    if (results.length >= 5) break;
  }
  return results;
}

async function searchWeb(args) {
  assertPlainObject(args);
  const query = typeof args.query === 'string' ? args.query.trim().replace(/\s+/g, ' ') : '';
  if (query.length < 2 || query.length > 160) throw userError('Web searches must be between 2 and 160 characters.');

  const endpoint = new URL('https://api.duckduckgo.com/');
  endpoint.searchParams.set('q', query);
  endpoint.searchParams.set('format', 'json');
  endpoint.searchParams.set('no_html', '1');
  endpoint.searchParams.set('skip_disambig', '1');

  let response;
  try {
    response = await fetch(endpoint, { signal: AbortSignal.timeout(8_000), headers: { 'User-Agent': 'JarvisAI/0.2 (safe web search)' } });
  } catch {
    throw userError('The search provider could not be reached. Check your connection and try again.', 'search_unavailable', 503);
  }
  if (!response.ok) throw userError(`The search provider returned ${response.status}.`, 'search_unavailable', 503);

  const data = await response.json();
  const results = [];
  if (data.AbstractText && data.AbstractURL) {
    results.push({ title: data.Heading || query, snippet: data.AbstractText, url: data.AbstractURL });
  }
  flattenRelatedTopics(data.RelatedTopics, results);
  return { query, results: results.slice(0, 5), provider: 'DuckDuckGo Instant Answers' };
}

function extensionOf(fileName) {
  return String(fileName || '').split('.').pop().toLowerCase();
}

function analyzeFile(file) {
  if (!file || !Buffer.isBuffer(file.buffer)) throw userError('Choose a file before asking JARVIS to analyze it.', 'missing_file');
  if (file.size > MAX_FILE_BYTES) throw userError('Files must be 10 MB or smaller for this local analysis.', 'file_too_large');
  const extension = extensionOf(file.originalname);
  if (!ALLOWED_FILE_EXTENSIONS.has(extension)) throw userError('Supported files are TXT, MD, CSV, JSON, PDF, PNG, JPG, JPEG, and WEBP.', 'unsupported_file');

  const digest = crypto.createHash('sha256').update(file.buffer).digest('hex');
  const base = {
    fileName: file.originalname,
    bytes: file.size,
    mimeType: file.mimetype || 'application/octet-stream',
    extension,
    sha256: digest,
    analyzedLocally: true
  };

  if (['txt', 'md', 'csv', 'json'].includes(extension)) {
    const text = file.buffer.toString('utf8').replace(/\u0000/g, '');
    const lines = text ? text.split(/\r?\n/) : [];
    const analysis = { ...base, kind: extension === 'csv' ? 'csv' : extension === 'json' ? 'json' : 'text', characters: text.length, lines: lines.length, preview: text.slice(0, 1800) };
    if (extension === 'csv') {
      const nonBlank = lines.filter(line => line.trim());
      analysis.columns = nonBlank[0] ? nonBlank[0].split(',').map(value => value.trim()).slice(0, 30) : [];
      analysis.rows = Math.max(0, nonBlank.length - 1);
    }
    if (extension === 'json') {
      try {
        const parsed = JSON.parse(text);
        analysis.jsonType = Array.isArray(parsed) ? 'array' : typeof parsed;
        analysis.topLevelKeys = parsed && !Array.isArray(parsed) && typeof parsed === 'object' ? Object.keys(parsed).slice(0, 30) : [];
      } catch {
        analysis.jsonValid = false;
      }
    }
    return analysis;
  }

  if (extension === 'pdf') return { ...base, kind: 'pdf', preview: 'PDF received. Text extraction is not enabled in this build; JARVIS retained file metadata only.' };
  return { ...base, kind: 'image', preview: 'Image received. Visual model analysis requires an OpenAI API key and is not enabled for this local-only request.' };
}

module.exports = { ALLOWED_FILE_EXTENSIONS, SafeExpressionParser, analyzeFile, calculate, createTimer, getTime, searchWeb, userError };
