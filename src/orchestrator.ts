/**
 * Aura Agent - Intelligent Orchestrator
 * Routes tasks to the optimal backend based on complexity, availability, and performance
 */

import type {
  AgentConfig,
  AuraTask,
  Backend,
  ExecutionPlan,
  RoutingDecision,
  TaskComplexity,
  TaskResult,
  TaskType,
  EventHandler,
  AgentEvent,
} from './types/index.js';

import { AuraAPIClient } from './api/client.js';
import { LuxAgent } from './agents/lux.js';
import { BrowserUseAgent } from './agents/browser-use.js';
import { SteelAgent } from './agents/steel.js';
import { AgentBrowserWrapper } from './agents/agent-browser.js';

/**
 * Task complexity mapping for routing decisions
 */
const TASK_COMPLEXITY: Record<TaskType, TaskComplexity> = {
  // Simple tasks - prefer API if available
  create_project: 'simple',
  duplicate_project: 'simple',
  delete_component: 'simple',
  upload_asset: 'simple',

  // Moderate tasks - API preferred, browser fallback
  export_html: 'moderate',
  export_figma: 'moderate',
  add_component: 'moderate',
  apply_template: 'moderate',

  // Complex tasks - may need browser for visual confirmation
  generate_design: 'complex',
  edit_component: 'complex',
  ai_prompt: 'complex',
  publish: 'complex',

  // Visual tasks - require browser automation
  custom_action: 'visual',
};

/**
 * Backend capabilities and preferences
 */
const BACKEND_CAPABILITIES: Record<Backend, {
  supports: TaskComplexity[];
  speed: number; // 1-10
  reliability: number; // 1-10
  cost: number; // 1-10 (lower is better)
}> = {
  api: {
    supports: ['simple', 'moderate'],
    speed: 10,
    reliability: 9,
    cost: 1,
  },
  lux: {
    supports: ['simple', 'moderate', 'complex', 'visual'],
    speed: 9, // 1 second per step
    reliability: 8,
    cost: 3,
  },
  'browser-use': {
    supports: ['simple', 'moderate', 'complex', 'visual'],
    speed: 7,
    reliability: 8,
    cost: 5,
  },
  steel: {
    supports: ['simple', 'moderate', 'complex', 'visual'],
    speed: 7,
    reliability: 9,
    cost: 4,
  },
  'agent-browser': {
    supports: ['simple', 'moderate', 'complex', 'visual'],
    speed: 6,
    reliability: 7,
    cost: 1, // Local, free
  },
};

export class AuraOrchestrator {
  private config: AgentConfig;
  private apiClient: AuraAPIClient | null = null;
  private luxAgent: LuxAgent | null = null;
  private browserUseAgent: BrowserUseAgent | null = null;
  private steelAgent: SteelAgent | null = null;
  private agentBrowser: AgentBrowserWrapper | null = null;
  private eventHandlers: EventHandler[] = [];
  private backendHealth: Map<Backend, boolean> = new Map();

  constructor(config: AgentConfig) {
    this.config = config;
    this.initializeBackends();
  }

  /**
   * Initialize available backends
   */
  private async initializeBackends(): Promise<void> {
    // Try to initialize API client
    try {
      this.apiClient = new AuraAPIClient(this.config);
      this.backendHealth.set('api', true);
    } catch {
      this.backendHealth.set('api', false);
    }

    // Initialize Lux agent if API key available
    if (process.env.OAGI_API_KEY) {
      try {
        this.luxAgent = new LuxAgent(this.config);
        this.backendHealth.set('lux', true);
      } catch {
        this.backendHealth.set('lux', false);
      }
    }

    // Initialize browser-use if API key available
    if (process.env.BROWSER_USE_API_KEY) {
      try {
        this.browserUseAgent = new BrowserUseAgent(this.config);
        this.backendHealth.set('browser-use', true);
      } catch {
        this.backendHealth.set('browser-use', false);
      }
    }

    // Initialize Steel if URL available
    if (process.env.STEEL_BASE_URL) {
      try {
        this.steelAgent = new SteelAgent(this.config);
        this.backendHealth.set('steel', true);
      } catch {
        this.backendHealth.set('steel', false);
      }
    }

    // Agent-browser is always available locally
    try {
      this.agentBrowser = new AgentBrowserWrapper(this.config);
      this.backendHealth.set('agent-browser', true);
    } catch {
      this.backendHealth.set('agent-browser', false);
    }
  }

  /**
   * Subscribe to agent events
   */
  public onEvent(handler: EventHandler): void {
    this.eventHandlers.push(handler);
  }

  /**
   * Emit an event to all handlers
   */
  private async emitEvent(event: AgentEvent): Promise<void> {
    for (const handler of this.eventHandlers) {
      await handler(event);
    }
  }

  /**
   * Determine optimal routing for a task
   */
  public routeTask(task: AuraTask): RoutingDecision {
    const complexity = TASK_COMPLEXITY[task.type] || 'complex';

    // If specific backend is configured, use it
    if (this.config.preferredBackend !== 'auto') {
      const backend = this.config.preferredBackend as Backend;
      if (this.backendHealth.get(backend)) {
        return {
          backend,
          reason: 'User-configured preference',
          confidence: 1.0,
          fallbacks: this.getFallbacks(backend, complexity),
        };
      }
    }

    // Auto-select based on task complexity and backend capabilities
    const availableBackends = Array.from(this.backendHealth.entries())
      .filter(([_, healthy]) => healthy)
      .map(([backend]) => backend);

    // Score each backend
    const scores = availableBackends.map(backend => {
      const caps = BACKEND_CAPABILITIES[backend];
      if (!caps.supports.includes(complexity)) {
        return { backend, score: 0 };
      }

      // Weighted scoring: speed (40%), reliability (35%), cost (25%)
      const score = (caps.speed * 0.4) + (caps.reliability * 0.35) + ((10 - caps.cost) * 0.25);
      return { backend, score };
    }).filter(s => s.score > 0);

    // Sort by score
    scores.sort((a, b) => b.score - a.score);

    if (scores.length === 0) {
      throw new Error(`No available backend supports task complexity: ${complexity}`);
    }

    const best = scores[0];
    const fallbacks = scores.slice(1).map(s => s.backend);

    return {
      backend: best.backend,
      reason: this.getRoutingReason(best.backend, complexity),
      confidence: best.score / 10,
      fallbacks,
    };
  }

  /**
   * Get fallback backends for a given primary backend
   */
  private getFallbacks(primary: Backend, complexity: TaskComplexity): Backend[] {
    return (Object.keys(BACKEND_CAPABILITIES) as Backend[])
      .filter(b => b !== primary)
      .filter(b => this.backendHealth.get(b))
      .filter(b => BACKEND_CAPABILITIES[b].supports.includes(complexity));
  }

  /**
   * Generate human-readable routing reason
   */
  private getRoutingReason(backend: Backend, _complexity: TaskComplexity): string {
    const reasons: Record<Backend, string> = {
      api: 'Direct API call - fastest and most reliable for this operation',
      lux: 'Lux vision model - best performance for complex visual tasks (1s/step)',
      'browser-use': 'browser-use MCP - excellent for authenticated sessions with state persistence',
      steel: 'Steel browser API - reliable self-hosted option with full Playwright support',
      'agent-browser': 'Local agent-browser - free fallback with good element detection',
    };
    return reasons[backend];
  }

  /**
   * Create an execution plan for a task
   */
  public async planTask(task: AuraTask): Promise<ExecutionPlan> {
    const routing = this.routeTask(task);
    const complexity = TASK_COMPLEXITY[task.type] || 'complex';

    const steps = await this.generateSteps(task, routing.backend);
    const estimatedDuration = this.estimateDuration(steps, routing.backend);

    return {
      taskId: task.id,
      steps,
      estimatedDuration,
      complexity,
      routing,
    };
  }

  /**
   * Generate execution steps based on task and backend
   */
  private async generateSteps(task: AuraTask, _backend: Backend): Promise<ExecutionPlan['steps']> {
    // This would be expanded based on the specific task type
    const baseSteps = {
      generate_design: [
        { id: 'nav', action: 'navigate', params: { url: 'https://www.aura.build' }, dependsOn: [], timeout: 10000, retryable: true },
        { id: 'auth', action: 'authenticate', params: {}, dependsOn: ['nav'], timeout: 15000, retryable: true },
        { id: 'new', action: 'click', params: { target: 'New Project' }, dependsOn: ['auth'], timeout: 5000, retryable: true },
        { id: 'prompt', action: 'fill', params: { target: 'AI Prompt', value: task.params.prompt }, dependsOn: ['new'], timeout: 5000, retryable: true },
        { id: 'generate', action: 'click', params: { target: 'Generate' }, dependsOn: ['prompt'], timeout: 5000, retryable: true },
        { id: 'wait', action: 'wait', params: { condition: 'generation_complete' }, dependsOn: ['generate'], timeout: 120000, retryable: false },
        { id: 'screenshot', action: 'screenshot', params: {}, dependsOn: ['wait'], timeout: 5000, retryable: true },
      ],
      export_html: [
        { id: 'nav', action: 'navigate', params: { url: `https://www.aura.build/project/${task.params.projectId}` }, dependsOn: [], timeout: 10000, retryable: true },
        { id: 'auth', action: 'authenticate', params: {}, dependsOn: ['nav'], timeout: 15000, retryable: true },
        { id: 'export_menu', action: 'click', params: { target: 'Export' }, dependsOn: ['auth'], timeout: 5000, retryable: true },
        { id: 'select_html', action: 'click', params: { target: 'HTML' }, dependsOn: ['export_menu'], timeout: 5000, retryable: true },
        { id: 'download', action: 'wait', params: { condition: 'download_complete' }, dependsOn: ['select_html'], timeout: 30000, retryable: false },
      ],
    };

    return baseSteps[task.type as keyof typeof baseSteps] || [
      { id: 'custom', action: 'execute_custom', params: task.params, dependsOn: [], timeout: 60000, retryable: true },
    ];
  }

  /**
   * Estimate task duration based on steps and backend
   */
  private estimateDuration(steps: ExecutionPlan['steps'], backend: Backend): number {
    const backendMultiplier: Record<Backend, number> = {
      api: 0.5,
      lux: 1.0,
      'browser-use': 1.5,
      steel: 1.5,
      'agent-browser': 2.0,
    };

    const baseTime = steps.reduce((sum, step) => sum + (step.timeout || 5000), 0);
    return Math.ceil(baseTime * backendMultiplier[backend] / 1000);
  }

  /**
   * Execute a task with automatic routing and failover
   */
  public async executeTask(task: AuraTask): Promise<TaskResult> {
    const plan = await this.planTask(task);

    await this.emitEvent({
      type: 'task_start',
      timestamp: new Date(),
      taskId: task.id,
      data: { plan },
    });

    let lastError: Error | null = null;
    const backendsToTry = [plan.routing.backend, ...plan.routing.fallbacks];

    for (const backend of backendsToTry) {
      try {
        if (this.config.debug) {
          console.log(`[Orchestrator] Attempting execution with backend: ${backend}`);
        }

        const result = await this.executeWithBackend(task, backend, plan.steps);

        await this.emitEvent({
          type: 'task_complete',
          timestamp: new Date(),
          taskId: task.id,
          data: { result, backend },
        });

        return result;
      } catch (error) {
        lastError = error as Error;
        console.warn(`[Orchestrator] Backend ${backend} failed:`, lastError.message);

        await this.emitEvent({
          type: 'error',
          timestamp: new Date(),
          taskId: task.id,
          data: { backend, error: lastError.message },
        });
      }
    }

    throw new Error(`All backends failed. Last error: ${lastError?.message}`);
  }

  /**
   * Execute task with specific backend
   */
  private async executeWithBackend(
    task: AuraTask,
    backend: Backend,
    _steps: ExecutionPlan['steps']
  ): Promise<TaskResult> {
    switch (backend) {
      case 'api':
        if (!this.apiClient) throw new Error('API client not available');
        return this.apiClient.executeTask(task);

      case 'lux':
        if (!this.luxAgent) throw new Error('Lux agent not available');
        return this.luxAgent.executeTask(task);

      case 'browser-use':
        if (!this.browserUseAgent) throw new Error('browser-use agent not available');
        return this.browserUseAgent.executeTask(task);

      case 'steel':
        if (!this.steelAgent) throw new Error('Steel agent not available');
        return this.steelAgent.executeTask(task);

      case 'agent-browser':
        if (!this.agentBrowser) throw new Error('agent-browser not available');
        return this.agentBrowser.executeTask(task);

      default:
        throw new Error(`Unknown backend: ${backend}`);
    }
  }

  /**
   * Get health status of all backends
   */
  public getBackendHealth(): Record<Backend, boolean> {
    return Object.fromEntries(this.backendHealth) as Record<Backend, boolean>;
  }

  /**
   * Manually set backend health (useful for runtime discovery)
   */
  public setBackendHealth(backend: Backend, healthy: boolean): void {
    this.backendHealth.set(backend, healthy);
  }

  /**
   * Refresh backend health checks
   */
  public async refreshHealth(): Promise<Record<Backend, boolean>> {
    const checks = await Promise.allSettled([
      this.apiClient?.healthCheck().then(() => this.backendHealth.set('api', true)).catch(() => this.backendHealth.set('api', false)),
      this.luxAgent?.healthCheck().then(() => this.backendHealth.set('lux', true)).catch(() => this.backendHealth.set('lux', false)),
      this.browserUseAgent?.healthCheck().then(() => this.backendHealth.set('browser-use', true)).catch(() => this.backendHealth.set('browser-use', false)),
      this.steelAgent?.healthCheck().then(() => this.backendHealth.set('steel', true)).catch(() => this.backendHealth.set('steel', false)),
      this.agentBrowser?.healthCheck().then(() => this.backendHealth.set('agent-browser', true)).catch(() => this.backendHealth.set('agent-browser', false)),
    ]);

    if (this.config.debug) {
      console.log('[Orchestrator] Health check results:', checks);
    }

    return this.getBackendHealth();
  }
}
