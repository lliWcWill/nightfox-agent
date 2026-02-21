/**
 * Terminal-style rendering for Telegram messages.
 * Provides emoji icons, spinners, and progress indicators for a terminal-like experience.
 */

// Tool icons (emoji-based for mobile friendliness)
export const TOOL_ICONS: Record<string, string> = {
  // File operations (Claude SDK names)
  Read: '📖',
  Write: '✏️',
  Edit: '🔧',

  // Search and navigation (Claude SDK)
  Grep: '🔍',
  Glob: '📁',

  // Execution (Claude SDK)
  Bash: '💻',
  Task: '📋',

  // Web (Claude SDK)
  WebFetch: '🌐',
  WebSearch: '🔎',

  // Notebook (Claude SDK)
  NotebookEdit: '📓',

  // OpenAI provider — fsuite tools
  ftree: '🌲',
  fsearch: '🔍',
  fcontent: '📝',
  fmap: '🗺️',
  fmetrics: '📊',
  read_file: '📖',

  // OpenAI provider — dangerous mode tools
  shell: '💻',
  apply_patch: '🔧',

  // MCP — ShieldCortex memory tools
  remember: '🧠',
  recall: '🧠',
  forget: '🗑️',
  get_context: '🧠',
  start_session: '▶️',
  end_session: '⏹️',
  consolidate: '🔄',
  memory_stats: '📊',
  get_memory: '🧠',
  get_related: '🔗',
  link_memories: '🔗',
  detect_contradictions: '⚡',
  graph_query: '🕸️',
  graph_entities: '🕸️',
  graph_explain: '🕸️',
  set_project: '📂',
  get_project: '📂',

  // MCP — Playwright browser tools
  browser_navigate: '🌐',
  browser_snapshot: '📸',
  browser_click: '🖱️',
  browser_type: '⌨️',
  browser_take_screenshot: '📸',

  // Status indicators
  thinking: '💭',
  complete: '✅',
  error: '❌',
  warning: '⚠️',
  info: 'ℹ️',
};

// Spinner frames for animation (Braille pattern spinner)
export const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

// Alternative spinner (dots)
export const DOTS_SPINNER = ['⠁', '⠂', '⠄', '⡀', '⢀', '⠠', '⠐', '⠈'];

// Progress bar characters
export const PROGRESS = {
  empty: '░',
  filled: '█',
  partial: '▓',
};

/**
 * Get icon for a tool name
 */
export function getToolIcon(toolName: string): string {
  return TOOL_ICONS[toolName] || '🔹';
}

/**
 * Get current spinner frame based on index
 */
export function getSpinnerFrame(index: number): string {
  return SPINNER_FRAMES[index % SPINNER_FRAMES.length];
}

/**
 * Render a status line showing current operation
 * Example: "⠹ 📖 Reading src/config.ts..."
 */
export function renderStatusLine(
  spinnerIndex: number,
  icon: string,
  operation: string,
  detail?: string
): string {
  const spinner = getSpinnerFrame(spinnerIndex);
  const detailStr = detail ? ` ${detail}` : '';
  return `${spinner} ${icon} ${operation}${detailStr}`;
}

/**
 * Render a progress bar
 * Example: "[████████░░░░] 67%"
 */
export function renderProgressBar(percent: number, width: number = 12): string {
  const clampedPercent = Math.max(0, Math.min(100, percent));
  const filledCount = Math.round((clampedPercent / 100) * width);
  const emptyCount = width - filledCount;

  const filled = PROGRESS.filled.repeat(filledCount);
  const empty = PROGRESS.empty.repeat(emptyCount);

  return `[${filled}${empty}] ${Math.round(clampedPercent)}%`;
}

/**
 * Render a tool operation status
 * Example: "📖 Read → src/config.ts"
 */
export function renderToolOperation(toolName: string, detail?: string): string {
  const icon = getToolIcon(toolName);
  const action = getToolAction(toolName);
  const detailStr = detail ? ` → ${detail}` : '';
  return `${icon} ${action}${detailStr}`;
}

/**
 * Get human-readable action name for a tool
 */
function getToolAction(toolName: string): string {
  const actions: Record<string, string> = {
    // Claude SDK tools
    Read: 'Reading',
    Write: 'Writing',
    Edit: 'Editing',
    Bash: 'Running',
    Grep: 'Searching',
    Glob: 'Finding',
    Task: 'Task',
    WebFetch: 'Fetching',
    WebSearch: 'Searching',
    NotebookEdit: 'Editing notebook',
    // OpenAI fsuite tools
    ftree: 'Scanning tree',
    fsearch: 'Searching files',
    fcontent: 'Searching content',
    fmap: 'Mapping code',
    fmetrics: 'Checking metrics',
    read_file: 'Reading',
    // OpenAI dangerous tools
    shell: 'Running',
    apply_patch: 'Patching',
    // MCP memory tools
    remember: 'Remembering',
    recall: 'Recalling',
    forget: 'Forgetting',
    get_context: 'Loading context',
    start_session: 'Starting session',
    end_session: 'Ending session',
    consolidate: 'Consolidating',
    memory_stats: 'Checking stats',
    get_memory: 'Reading memory',
    get_related: 'Finding related',
    link_memories: 'Linking',
    detect_contradictions: 'Detecting conflicts',
    graph_query: 'Querying graph',
    graph_entities: 'Listing entities',
    graph_explain: 'Explaining',
    // MCP Playwright tools
    browser_navigate: 'Navigating',
    browser_snapshot: 'Taking snapshot',
    browser_click: 'Clicking',
    browser_type: 'Typing',
    browser_take_screenshot: 'Screenshotting',
  };
  return actions[toolName] || toolName;
}

/**
 * Extract a meaningful detail from tool input for display
 */
export function extractToolDetail(toolName: string, input: Record<string, unknown>): string | undefined {
  const str = (key: string): string | undefined => {
    const val = input[key];
    return typeof val === 'string' ? val : undefined;
  };

  switch (toolName) {
    // Claude SDK tools
    case 'Read':
    case 'Write':
    case 'Edit':
    case 'NotebookEdit':
      return truncatePath(str('file_path'));
    case 'Bash':
      return truncateCommand(str('command'));
    case 'Grep':
    case 'Glob':
      return str('pattern');
    case 'WebFetch':
    case 'WebSearch':
      return truncateUrl(str('url') || str('query'));
    case 'Task':
      return str('description');

    // OpenAI fsuite tools
    case 'ftree':
      return str('args') || 'project root';
    case 'fsearch':
      return str('query');
    case 'fcontent':
      return str('query');
    case 'fmap':
      return str('args');
    case 'fmetrics':
      return str('args');
    case 'read_file':
      return truncatePath(str('path'));

    // OpenAI dangerous tools
    case 'shell':
      return truncateCommand(str('command') || str('commands'));
    case 'apply_patch':
      return truncatePath(str('path'));

    // MCP memory tools
    case 'remember':
      return str('title');
    case 'recall':
      return str('query') || str('mode');
    case 'forget':
      return str('query') || str('id')?.toString();
    case 'get_context':
      return str('query') || 'loading';
    case 'get_memory':
      return str('id')?.toString();
    case 'graph_query':
      return str('entity');
    case 'graph_explain':
      return `${str('from') || '?'} → ${str('to') || '?'}`;

    // MCP Playwright tools
    case 'browser_navigate':
      return truncateUrl(str('url'));
    case 'browser_click':
      return str('element') || str('ref');
    case 'browser_type':
      return str('text');

    default:
      // For any unknown tool, try common param names
      return str('query') || str('path') || str('url') || str('title') || str('name') || undefined;
  }
}

/**
 * Truncate a file path for display
 */
function truncatePath(filePath: string | undefined, maxLen: number = 40): string | undefined {
  if (!filePath) return undefined;
  if (filePath.length <= maxLen) return filePath;

  // Keep the last part of the path
  const parts = filePath.split('/');
  let result = parts[parts.length - 1];

  // Truncate filename itself if it exceeds maxLen
  if (result.length > maxLen) {
    return result.substring(0, maxLen - 3) + '...';
  }

  // Add parent dirs if space allows
  for (let i = parts.length - 2; i >= 0; i--) {
    const candidate = `.../${parts.slice(i).join('/')}`;
    if (candidate.length <= maxLen) {
      result = candidate;
    } else {
      break;
    }
  }

  return result;
}

/**
 * Truncate a command for display
 */
function truncateCommand(command: string | undefined, maxLen: number = 50): string | undefined {
  if (!command) return undefined;
  const firstLine = command.split('\n')[0].trim();
  if (firstLine.length <= maxLen) return firstLine;
  return firstLine.substring(0, maxLen - 3) + '...';
}

/**
 * Truncate a URL for display
 */
function truncateUrl(url: string | undefined, maxLen: number = 40): string | undefined {
  if (!url) return undefined;
  if (url.length <= maxLen) return url;
  return url.substring(0, maxLen - 3) + '...';
}

/**
 * Render a background task status line
 * Example: "📋 Background: Installing dependencies ✅"
 */
export function renderBackgroundTask(
  name: string,
  status: 'running' | 'complete' | 'error',
  spinnerIndex: number = 0
): string {
  const statusIcon = status === 'complete'
    ? TOOL_ICONS.complete
    : status === 'error'
      ? TOOL_ICONS.error
      : getSpinnerFrame(spinnerIndex);
  return `📋 Background: ${name} ${statusIcon}`;
}

/**
 * Format a terminal-style message with optional status and background tasks
 */
export function formatTerminalMessage(
  content: string,
  options: {
    spinnerIndex?: number;
    currentOperation?: { icon: string; name: string; detail?: string };
    backgroundTasks?: Array<{ name: string; status: 'running' | 'complete' | 'error' }>;
    isComplete?: boolean;
  } = {}
): string {
  const { spinnerIndex = 0, currentOperation, backgroundTasks = [], isComplete = false } = options;

  const parts: string[] = [];

  // Add status line if there's a current operation and not complete
  if (currentOperation && !isComplete) {
    parts.push(renderStatusLine(
      spinnerIndex,
      currentOperation.icon,
      currentOperation.name,
      currentOperation.detail
    ));
    parts.push('');
  }

  // Add main content
  if (content) {
    parts.push(content);
  }

  // Add background tasks if any
  if (backgroundTasks.length > 0) {
    if (content) parts.push('');
    for (const task of backgroundTasks) {
      parts.push(renderBackgroundTask(task.name, task.status, spinnerIndex));
    }
  }

  return parts.join('\n');
}
