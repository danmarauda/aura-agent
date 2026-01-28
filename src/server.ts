/**
 * Aura Agent - HTTP Server
 * Provides health checks and API endpoints for Railway deployment
 */

import { createServer, IncomingMessage, ServerResponse } from 'http';
import { AuraOrchestrator } from './orchestrator.js';
import type { AgentConfig, AuraTask, TaskType } from './types/index.js';

const PORT = parseInt(process.env.PORT || '3000');

// Default configuration
const config: AgentConfig = {
  preferredBackend: (process.env.PREFERRED_BACKEND as 'auto') || 'auto',
  maxRetries: parseInt(process.env.MAX_RETRIES || '3'),
  timeoutMs: parseInt(process.env.TIMEOUT_MS || '60000'),
  headless: process.env.HEADLESS !== 'false',
  debug: process.env.DEBUG === 'true',
  credentials: process.env.AURA_EMAIL && process.env.AURA_PASSWORD ? {
    email: process.env.AURA_EMAIL,
    password: process.env.AURA_PASSWORD,
  } : undefined,
};

let orchestrator: AuraOrchestrator;

/**
 * Parse JSON body from request
 */
async function parseBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

/**
 * Send JSON response
 */
function sendJson(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data, null, 2));
}

/**
 * Generate task ID
 */
function generateTaskId(): string {
  return `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Handle HTTP requests
 */
async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url || '/', `http://localhost:${PORT}`);
  const path = url.pathname;
  const method = req.method || 'GET';

  console.log(`[${new Date().toISOString()}] ${method} ${path}`);

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    // Health check
    if (path === '/health' || path === '/') {
      const health = orchestrator.getBackendHealth();
      sendJson(res, 200, {
        status: 'healthy',
        version: '1.0.0',
        service: 'aura-agent',
        backends: health,
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // Backend health details
    if (path === '/health/backends') {
      const health = await orchestrator.refreshHealth();
      sendJson(res, 200, {
        backends: health,
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // Execute task
    if (path === '/task' && method === 'POST') {
      const body = await parseBody(req) as {
        type: TaskType;
        params: Record<string, unknown>;
      };

      if (!body.type) {
        sendJson(res, 400, { error: 'Missing task type' });
        return;
      }

      const task: AuraTask = {
        id: generateTaskId(),
        type: body.type,
        params: body.params || {},
        status: 'pending',
      };

      console.log(`[Task] Executing ${task.type} with ID ${task.id}`);
      const result = await orchestrator.executeTask(task);

      sendJson(res, result.success ? 200 : 500, {
        taskId: task.id,
        ...result,
      });
      return;
    }

    // Plan task (dry run)
    if (path === '/task/plan' && method === 'POST') {
      const body = await parseBody(req) as {
        type: TaskType;
        params: Record<string, unknown>;
      };

      if (!body.type) {
        sendJson(res, 400, { error: 'Missing task type' });
        return;
      }

      const task: AuraTask = {
        id: generateTaskId(),
        type: body.type,
        params: body.params || {},
        status: 'pending',
      };

      const plan = await orchestrator.planTask(task);
      sendJson(res, 200, plan);
      return;
    }

    // Generate design shortcut
    if (path === '/generate' && method === 'POST') {
      const body = await parseBody(req) as {
        prompt: string;
        template?: string;
        style?: string;
      };

      if (!body.prompt) {
        sendJson(res, 400, { error: 'Missing prompt' });
        return;
      }

      const task: AuraTask = {
        id: generateTaskId(),
        type: 'generate_design',
        params: body,
        status: 'pending',
      };

      console.log(`[Generate] Creating design: "${body.prompt.slice(0, 50)}..."`);
      const result = await orchestrator.executeTask(task);

      sendJson(res, result.success ? 200 : 500, {
        taskId: task.id,
        ...result,
      });
      return;
    }

    // Export project shortcut
    if (path.startsWith('/export/') && method === 'POST') {
      const projectId = path.split('/')[2];
      const body = await parseBody(req) as {
        format?: 'html' | 'figma';
      };

      const task: AuraTask = {
        id: generateTaskId(),
        type: body.format === 'figma' ? 'export_figma' : 'export_html',
        params: { projectId, ...body },
        status: 'pending',
      };

      console.log(`[Export] Exporting project ${projectId}`);
      const result = await orchestrator.executeTask(task);

      sendJson(res, result.success ? 200 : 500, {
        taskId: task.id,
        ...result,
      });
      return;
    }

    // API documentation
    if (path === '/docs') {
      sendJson(res, 200, {
        name: 'Aura Agent API',
        version: '1.0.0',
        endpoints: {
          'GET /health': 'Health check and backend status',
          'GET /health/backends': 'Detailed backend health with refresh',
          'POST /task': 'Execute any task type',
          'POST /task/plan': 'Plan task execution (dry run)',
          'POST /generate': 'Generate design shortcut',
          'POST /export/:projectId': 'Export project shortcut',
        },
        taskTypes: [
          'generate_design',
          'export_html',
          'export_figma',
          'create_project',
          'edit_component',
          'apply_template',
          'ai_prompt',
          'publish',
          'custom_action',
        ],
      });
      return;
    }

    // 404 for unknown routes
    sendJson(res, 404, { error: 'Not found', path });

  } catch (error) {
    console.error(`[Error] ${(error as Error).message}`);
    sendJson(res, 500, {
      error: 'Internal server error',
      message: (error as Error).message,
    });
  }
}

/**
 * Start the server
 */
async function main(): Promise<void> {
  console.log('🚀 Aura Agent Server starting...');

  // Initialize orchestrator
  orchestrator = new AuraOrchestrator(config);

  // Create server
  const server = createServer(handleRequest);

  // Start listening
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`
╔══════════════════════════════════════════════════════════════╗
║                     AURA AGENT SERVER                         ║
╠══════════════════════════════════════════════════════════════╣
║  Status: Running                                              ║
║  Port: ${String(PORT).padEnd(52)}║
║  Mode: ${(process.env.MODE || 'server').padEnd(52)}║
╠══════════════════════════════════════════════════════════════╣
║  Endpoints:                                                   ║
║    GET  /health          - Health check                       ║
║    GET  /docs            - API documentation                  ║
║    POST /task            - Execute task                       ║
║    POST /generate        - Generate design                    ║
║    POST /export/:id      - Export project                     ║
╚══════════════════════════════════════════════════════════════╝
    `);
  });

  // Graceful shutdown
  process.on('SIGTERM', () => {
    console.log('Shutting down...');
    server.close(() => {
      console.log('Server closed');
      process.exit(0);
    });
  });
}

main().catch(console.error);
// Trigger rebuild Thu 29 Jan 2026 07:34:48 AEDT
