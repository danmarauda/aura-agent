/**
 * Aura Agent - Main Entry Point
 * Expert AI agent for full automation of Aura.build
 */

import { AuraOrchestrator as Orchestrator } from './orchestrator.js';

// Core exports
export { AuraOrchestrator } from './orchestrator.js';
export { AuraAPIClient } from './api/client.js';

// Agent exports
export { LuxAgent } from './agents/lux.js';
export { BrowserUseAgent } from './agents/browser-use.js';
export { SteelAgent } from './agents/steel.js';
export { AgentBrowserWrapper } from './agents/agent-browser.js';

// Type exports
export type {
  AgentConfig,
  AuraCredentials,
  AuraProject,
  AuraPage,
  AuraComponent,
  AuraTask,
  TaskType,
  TaskParams,
  TaskStatus,
  TaskResult,
  Backend,
  TaskComplexity,
  ExecutionPlan,
  RoutingDecision,
  BrowserState,
  InteractiveElement,
  BrowserAction,
  InterceptedRequest,
  InterceptedResponse,
  APIEndpoint,
  Artifact,
  AgentEvent,
  EventHandler,
} from './types/index.js';

// Schema exports
export {
  GenerateDesignSchema,
  ExportOptionsSchema,
  TaskParamsSchema,
} from './types/index.js';

// Utility functions
export function createAgent(config?: Partial<import('./types/index.js').AgentConfig>): Orchestrator {
  const defaultConfig: import('./types/index.js').AgentConfig = {
    preferredBackend: 'auto',
    maxRetries: 3,
    timeoutMs: 60000,
    headless: true,
    debug: false,
    ...config,
  };

  return new Orchestrator(defaultConfig);
}

// Quick task execution
export async function executeTask(
  type: import('./types/index.js').TaskType,
  params: import('./types/index.js').TaskParams,
  config?: Partial<import('./types/index.js').AgentConfig>
): Promise<import('./types/index.js').TaskResult> {
  const agent = createAgent(config);

  const task: import('./types/index.js').AuraTask = {
    id: `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    type,
    params,
    status: 'pending',
  };

  return agent.executeTask(task);
}

// Convenience functions
export async function generateDesign(
  prompt: string,
  options?: { template?: string; style?: string }
): Promise<import('./types/index.js').TaskResult> {
  return executeTask('generate_design', { prompt, ...options });
}

export async function exportProject(
  projectId: string,
  format: 'html' | 'figma' = 'html'
): Promise<import('./types/index.js').TaskResult> {
  return executeTask(format === 'figma' ? 'export_figma' : 'export_html', { projectId });
}

export async function createProject(
  name: string,
  description?: string
): Promise<import('./types/index.js').TaskResult> {
  return executeTask('create_project', { name, description });
}

export async function sendPrompt(
  projectId: string,
  prompt: string
): Promise<import('./types/index.js').TaskResult> {
  return executeTask('ai_prompt', { projectId, prompt });
}

// Version
export const VERSION = '1.0.0';
