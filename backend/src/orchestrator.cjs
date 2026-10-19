const OpenAI = require('openai');
const { calculate, createTimer, getTime, searchWeb, userError } = require('./tools.cjs');

const TOOL_DEFINITIONS = [
  {
    type: 'function',
    name: 'get_time',
    description: 'Get the current time. Use for requests asking what time it is in a location or timezone.',
    strict: true,
    parameters: {
      type: 'object',
      properties: { timeZone: { type: ['string', 'null'], description: 'Optional IANA timezone, for example Europe/Paris.' } },
      required: ['timeZone'],
      additionalProperties: false
    }
  },
  {
    type: 'function',
    name: 'create_timer',
    description: 'Start a visible timer inside JARVIS. Use only when the user clearly asks to set, start, or create a timer.',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        durationSeconds: { type: 'integer', minimum: 1, maximum: 86400, description: 'Timer duration in seconds.' },
        label: { type: ['string', 'null'], description: 'A short optional timer label.' }
      },
      required: ['durationSeconds', 'label'],
      additionalProperties: false
    }
  },
  {
    type: 'function',
    name: 'calculate',
    description: 'Safely calculate a mathematical expression. Use only for arithmetic with numbers and basic operators.',
    strict: true,
    parameters: {
      type: 'object',
      properties: { expression: { type: 'string', description: 'Expression using numbers, parentheses and + - * / ^ only.' } },
      required: ['expression'],
      additionalProperties: false
    }
  },
  {
    type: 'function',
    name: 'search_web',
    description: 'Search the public web for current or factual information. Returns sourced instant-answer results.',
    strict: true,
    parameters: {
      type: 'object',
      properties: { query: { type: 'string', minLength: 2, maxLength: 160 } },
      required: ['query'],
      additionalProperties: false
    }
  }
];

const SYSTEM_INSTRUCTIONS = `You are JARVIS, a concise, permission-aware assistant. You have only four tools: get_time, create_timer, calculate, and search_web. Use a tool whenever it can provide an actual result. Do not invent tool results. You cannot open apps, send messages, delete files, change settings, access the filesystem, or control macOS in this build. For unsupported or risky desktop requests, explain plainly that no action was executed and suggest a supported alternative. Never output shell commands as an action plan.`;

function humanizeDuration(seconds) {
  if (seconds % 3600 === 0) return `${seconds / 3600} hour${seconds === 3600 ? '' : 's'}`;
  if (seconds % 60 === 0) return `${seconds / 60} minute${seconds === 60 ? '' : 's'}`;
  return `${seconds} second${seconds === 1 ? '' : 's'}`;
}

function safeMessage(value) {
  return typeof value === 'string' ? value.trim().slice(0, 2000) : '';
}

function normalizeHistory(history) {
  if (!Array.isArray(history)) return [];
  return history.slice(-12).flatMap(item => {
    if (!item || !['user', 'assistant'].includes(item.role)) return [];
    const content = safeMessage(item.content);
    return content ? [{ role: item.role, content }] : [];
  });
}

function parseArguments(raw) {
  try {
    const value = JSON.parse(raw || '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('not object');
    return value;
  } catch {
    throw userError('The model returned invalid tool arguments.', 'invalid_model_tool_call');
  }
}

async function executeTool(name, args) {
  if (name === 'get_time') {
    const result = getTime(args);
    return { status: 'completed', action: { name, risk: 'low', result }, message: `It is ${result.formatted}.` };
  }
  if (name === 'calculate') {
    const result = calculate(args);
    return { status: 'completed', action: { name, risk: 'low', result }, message: `${result.expression} = ${result.formatted}` };
  }
  if (name === 'create_timer') {
    const result = createTimer(args);
    return {
      status: 'requires_client_action',
      action: { name, risk: 'low', result },
      message: `I prepared a ${humanizeDuration(result.durationSeconds)} timer. Starting it now.`
    };
  }
  if (name === 'search_web') {
    const result = await searchWeb(args);
    const count = result.results.length;
    return {
      status: 'completed',
      action: { name, risk: 'low', result },
      message: count ? `I found ${count} sourced web result${count === 1 ? '' : 's'} for “${result.query}”.` : `I searched for “${result.query}”, but the provider did not return a sourced instant answer.`
    };
  }
  throw userError('That tool is not available in this version of JARVIS.', 'unsupported_tool');
}

function extractFirstToolCall(response) {
  return (response.output || []).find(item => item.type === 'function_call');
}

async function routeWithOpenAI({ message, history, apiKey, model }) {
  const client = new OpenAI({ apiKey });
  const response = await client.responses.create({
    model,
    instructions: SYSTEM_INSTRUCTIONS,
    input: [...normalizeHistory(history), { role: 'user', content: message }],
    tools: TOOL_DEFINITIONS,
    tool_choice: 'auto',
    parallel_tool_calls: false,
    max_output_tokens: 450
  });

  const call = extractFirstToolCall(response);
  if (!call) {
    return {
      status: 'completed',
      message: safeMessage(response.output_text) || 'I could not produce a response for that request.',
      action: null,
      orchestrator: 'openai'
    };
  }
  const responseForTool = await executeTool(call.name, parseArguments(call.arguments));
  return { ...responseForTool, orchestrator: 'openai' };
}

function parseDuration(message) {
  const found = message.match(/(?:(?:for|in)\s*|timer(?:\s+of)?\s+)(\d+(?:\.\d+)?)\s*(seconds?|secs?|minutes?|mins?|hours?|hrs?)/i) || message.match(/(\d+(?:\.\d+)?)\s*(seconds?|secs?|minutes?|mins?|hours?|hrs?)\s*(?:timer|countdown)/i);
  if (!found) return null;
  const quantity = Number(found[1]);
  const unit = found[2].toLowerCase();
  const multiplier = unit.startsWith('h') ? 3600 : unit.startsWith('m') ? 60 : 1;
  const seconds = Math.round(quantity * multiplier);
  return Number.isInteger(seconds) && seconds > 0 ? seconds : null;
}

function extractExpression(message) {
  const stripped = message
    .replace(/^(?:please\s+)?(?:calculate|compute|solve|what is)\s+/i, '')
    .replace(/[?=]\s*$/, '')
    .replace(/×/g, '*')
    .replace(/÷/g, '/');
  return /^[\d\s+\-*/^().eE]+$/.test(stripped) ? stripped : null;
}

async function routeLocally(message) {
  const lower = message.toLowerCase();
  const durationSeconds = parseDuration(message);
  if (durationSeconds && /timer|countdown|remind me/i.test(message)) {
    return { ...(await executeTool('create_timer', { durationSeconds, label: 'Jarvis timer' })), orchestrator: 'local' };
  }
  if (/\b(?:time|clock)\b/.test(lower)) {
    const zone = message.match(/(?:in|for)\s+([A-Za-z_]+\/[A-Za-z_]+(?:\/[A-Za-z_]+)?)/)?.[1] || null;
    return { ...(await executeTool('get_time', { timeZone: zone })), orchestrator: 'local' };
  }
  const expression = extractExpression(message);
  if (expression) return { ...(await executeTool('calculate', { expression })), orchestrator: 'local' };
  if (/^(?:search|look up|who is|what is|when is|where is)\b/i.test(message)) {
    const query = message.replace(/^(?:search(?: for)?|look up|who is|what is|when is|where is)\s+/i, '').trim() || message;
    return { ...(await executeTool('search_web', { query })), orchestrator: 'local' };
  }

  return {
    status: 'unavailable',
    action: null,
    orchestrator: 'local',
    message: 'The AI model is not configured, and this request is not one of the approved local tools. Add OPENAI_API_KEY to the backend environment for conversational command routing.'
  };
}

async function routeCommand({ message, history, config }) {
  if (config.openaiApiKey) {
    try {
      return await routeWithOpenAI({ message, history, apiKey: config.openaiApiKey, model: config.openaiModel });
    } catch (error) {
      if (error.expose || error.code === 'invalid_arguments' || error.code === 'unsupported_tool') throw error;
      const failure = new Error('The AI service could not complete that request. No action was taken.');
      failure.code = 'ai_unavailable';
      failure.status = 502;
      throw failure;
    }
  }
  if (config.allowLocalFallback) return routeLocally(message);
  const error = new Error('The JARVIS AI backend needs an OPENAI_API_KEY before it can route commands.');
  error.code = 'ai_not_configured';
  error.status = 503;
  throw error;
}

module.exports = { TOOL_DEFINITIONS, executeTool, normalizeHistory, routeCommand };
