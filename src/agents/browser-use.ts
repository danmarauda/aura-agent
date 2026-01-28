/**
 * Browser-Use Agent Integration
 * MCP-based browser automation with cloud profiles and authentication persistence
 */

import axios, { AxiosInstance } from 'axios';
import type { AgentConfig, AuraTask, TaskResult } from '../types/index.js';

const BROWSER_USE_API = 'https://api.browser-use.com';
const BROWSER_USE_MCP = 'https://api.browser-use.com/mcp';

interface BrowserProfile {
  id: string;
  name: string;
  domain: string;
  lastUsed: string;
}

interface TaskMonitorResponse {
  taskId: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  progress: number;
  result?: unknown;
  error?: string;
  screenshots?: string[];
}

/**
 * Task templates for Aura.build operations
 */
const AURA_TASK_TEMPLATES: Record<string, (params: Record<string, unknown>) => string> = {
  generate_design: (params) => `
    Go to aura.build and sign in if needed.
    Create a new project with the AI prompt: "${params.prompt}".
    Wait for the design to be generated completely.
    Take a screenshot of the final design.
    Return the project URL.
  `,

  export_html: (params) => `
    Go to aura.build project at ${params.projectId}.
    Find and click the Export button.
    Select HTML format.
    Download the exported files.
    Confirm download completed.
  `,

  export_figma: (params) => `
    Navigate to aura.build project ${params.projectId}.
    Click Export and select Figma format.
    Wait for Figma export to complete.
    Return the Figma file URL.
  `,

  edit_component: (params) => `
    Open aura.build project ${params.projectId}.
    Find and select component: ${params.componentId}.
    Apply these changes: "${params.prompt}".
    Save the changes.
  `,

  create_project: (params) => `
    Go to aura.build.
    Sign in if not already logged in.
    Create a new project named "${params.name}".
    Return the new project URL.
  `,

  apply_template: (params) => `
    Open aura.build project ${params.projectId}.
    Find Templates section.
    Apply template: "${params.template}".
    Confirm the template was applied.
  `,

  ai_prompt: (params) => `
    Navigate to aura.build project ${params.projectId}.
    Find the AI assistant input.
    Enter this prompt: "${params.prompt}".
    Submit and wait for AI to complete.
    Take a screenshot of the result.
  `,

  publish: (params) => `
    Open aura.build project ${params.projectId}.
    Find the Publish button.
    Click Publish.
    Complete any publish steps required.
    Return the published URL.
  `,

  upload_asset: (params) => `
    Go to aura.build project ${params.projectId}.
    Find the Assets or Upload section.
    Upload file: ${params.file}.
    Wait for upload to complete.
    Confirm the asset is available.
  `,
};

export class BrowserUseAgent {
  private client: AxiosInstance;
  private config: AgentConfig;
  private profiles: BrowserProfile[] = [];

  constructor(config: AgentConfig) {
    this.config = config;

    if (!process.env.BROWSER_USE_API_KEY) {
      throw new Error('BROWSER_USE_API_KEY environment variable not set');
    }

    this.client = axios.create({
      baseURL: BROWSER_USE_API,
      timeout: config.timeoutMs,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.BROWSER_USE_API_KEY}`,
      },
    });
  }

  /**
   * Health check for browser-use availability
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await this.client.get('/health');
      return response.status === 200;
    } catch {
      return false;
    }
  }

  /**
   * List available browser profiles
   */
  async listProfiles(): Promise<BrowserProfile[]> {
    try {
      const response = await this.client.get<{ profiles: BrowserProfile[] }>('/v1/profiles');
      this.profiles = response.data.profiles;
      return this.profiles;
    } catch (error) {
      if (this.config.debug) {
        console.error('[browser-use] Failed to list profiles:', error);
      }
      return [];
    }
  }

  /**
   * Find or create an Aura.build profile
   */
  private async getAuraProfile(): Promise<string | undefined> {
    if (this.profiles.length === 0) {
      await this.listProfiles();
    }

    const auraProfile = this.profiles.find(p =>
      p.domain.includes('aura.build') || p.name.toLowerCase().includes('aura')
    );

    return auraProfile?.id;
  }

  /**
   * Execute a browser task via API
   */
  private async executeBrowserTask(taskDescription: string, maxSteps: number = 8): Promise<{
    taskId: string;
    status: string;
  }> {
    const profileId = await this.getAuraProfile();

    const response = await this.client.post<{
      taskId: string;
      status: string;
    }>('/v1/tasks', {
      task: taskDescription,
      maxSteps,
      profileId,
      useCloud: true,  // Use stealth browser
    });

    return response.data;
  }

  /**
   * Monitor task progress
   */
  private async monitorTask(taskId: string): Promise<TaskMonitorResponse> {
    const response = await this.client.get<TaskMonitorResponse>(`/v1/tasks/${taskId}`);
    return response.data;
  }

  /**
   * Wait for task completion with polling
   */
  private async waitForCompletion(taskId: string): Promise<TaskMonitorResponse> {
    const maxWait = this.config.timeoutMs;
    const pollInterval = 2000;
    let elapsed = 0;

    while (elapsed < maxWait) {
      const status = await this.monitorTask(taskId);

      if (status.status === 'completed' || status.status === 'failed') {
        return status;
      }

      if (this.config.debug) {
        console.log(`[browser-use] Task ${taskId} progress: ${status.progress}%`);
      }

      await new Promise(resolve => setTimeout(resolve, pollInterval));
      elapsed += pollInterval;
    }

    throw new Error('Task timed out');
  }

  /**
   * Execute an Aura task
   */
  async executeAuraTask(task: AuraTask): Promise<TaskResult> {
    const template = AURA_TASK_TEMPLATES[task.type];

    if (!template) {
      return {
        success: false,
        logs: [`Task type ${task.type} not supported by browser-use agent`],
      };
    }

    const taskDescription = template(task.params);
    const maxSteps = this.getMaxSteps(task.type);

    if (this.config.debug) {
      console.log(`[browser-use] Executing task: ${taskDescription}`);
    }

    try {
      // Start the task
      const { taskId } = await this.executeBrowserTask(taskDescription, maxSteps);

      if (this.config.debug) {
        console.log(`[browser-use] Task started with ID: ${taskId}`);
      }

      // Wait for completion
      const result = await this.waitForCompletion(taskId);

      if (result.status === 'completed') {
        return {
          success: true,
          data: result.result,
          screenshots: result.screenshots,
          logs: [`Task completed successfully`],
        };
      } else {
        return {
          success: false,
          logs: [result.error || 'Task failed'],
          screenshots: result.screenshots,
        };
      }
    } catch (error) {
      return {
        success: false,
        logs: [(error as Error).message],
      };
    }
  }

  /**
   * Alias for executeAuraTask for orchestrator compatibility
   */
  async executeTask(task: AuraTask): Promise<TaskResult> {
    return this.executeAuraTask(task);
  }

  /**
   * Get max steps for task type
   */
  private getMaxSteps(taskType: string): number {
    const stepMap: Record<string, number> = {
      generate_design: 10,
      export_html: 6,
      export_figma: 6,
      edit_component: 8,
      create_project: 6,
      apply_template: 6,
      ai_prompt: 8,
      publish: 8,
      upload_asset: 5,
    };
    return stepMap[taskType] || 8;
  }

  /**
   * Execute custom browser task with natural language
   */
  async executeCustomTask(instructions: string): Promise<TaskResult> {
    try {
      const { taskId } = await this.executeBrowserTask(instructions, 10);
      const result = await this.waitForCompletion(taskId);

      return {
        success: result.status === 'completed',
        data: result.result,
        screenshots: result.screenshots,
        logs: result.error ? [result.error] : ['Custom task completed'],
      };
    } catch (error) {
      return {
        success: false,
        logs: [(error as Error).message],
      };
    }
  }

  /**
   * Get MCP configuration for Claude Code
   */
  getMcpConfig(): {
    command: string;
    url: string;
    headers: Record<string, string>;
  } {
    return {
      command: `claude mcp add --transport http browser-use ${BROWSER_USE_MCP}`,
      url: BROWSER_USE_MCP,
      headers: {
        'x-api-key': process.env.BROWSER_USE_API_KEY || '',
      },
    };
  }
}
