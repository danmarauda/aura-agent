/**
 * Agent-Browser Wrapper
 * Local CLI-based browser automation fallback
 */

import { spawn } from 'child_process';
import type { AgentConfig, AuraTask, TaskResult, BrowserState, InteractiveElement } from '../types/index.js';

const AGENT_BROWSER_PATH = '/usr/local/bin/agent-browser';

export class AgentBrowserWrapper {
  private config: AgentConfig;
  private sessionName: string = 'aura-agent';

  constructor(config: AgentConfig) {
    this.config = config;
  }

  /**
   * Execute agent-browser command
   */
  private async exec(args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
    return new Promise((resolve) => {
      const proc = spawn(AGENT_BROWSER_PATH, ['--session', this.sessionName, ...args]);

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        resolve({ stdout, stderr, code: code || 0 });
      });

      proc.on('error', (error) => {
        resolve({ stdout, stderr: error.message, code: 1 });
      });

      // Timeout
      setTimeout(() => {
        proc.kill();
        resolve({ stdout, stderr: 'Command timed out', code: 1 });
      }, this.config.timeoutMs);
    });
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<boolean> {
    const result = await this.exec(['--help']);
    return result.code === 0;
  }

  /**
   * Navigate to URL
   */
  async navigate(url: string): Promise<void> {
    const result = await this.exec(['open', url]);
    if (result.code !== 0) {
      throw new Error(`Navigation failed: ${result.stderr}`);
    }
  }

  /**
   * Get snapshot of interactive elements
   */
  async snapshot(): Promise<InteractiveElement[]> {
    const result = await this.exec(['snapshot', '-i', '--json']);
    if (result.code !== 0) {
      throw new Error(`Snapshot failed: ${result.stderr}`);
    }

    try {
      const data = JSON.parse(result.stdout);
      return data.elements || [];
    } catch {
      // Parse text format
      const elements: InteractiveElement[] = [];
      const lines = result.stdout.split('\n');

      for (const line of lines) {
        const match = line.match(/\[ref=(\w+)\]\s+(\w+)\s+"([^"]+)"/);
        if (match) {
          elements.push({
            ref: match[1],
            type: match[2],
            text: match[3],
            bounds: { x: 0, y: 0, width: 0, height: 0 },
            attributes: {},
          });
        }
      }

      return elements;
    }
  }

  /**
   * Click element by ref
   */
  async click(ref: string): Promise<void> {
    const result = await this.exec(['click', ref]);
    if (result.code !== 0) {
      throw new Error(`Click failed: ${result.stderr}`);
    }
  }

  /**
   * Fill input field
   */
  async fill(ref: string, value: string): Promise<void> {
    const result = await this.exec(['fill', ref, value]);
    if (result.code !== 0) {
      throw new Error(`Fill failed: ${result.stderr}`);
    }
  }

  /**
   * Type text
   */
  async type(ref: string, value: string): Promise<void> {
    const result = await this.exec(['type', ref, value]);
    if (result.code !== 0) {
      throw new Error(`Type failed: ${result.stderr}`);
    }
  }

  /**
   * Press key
   */
  async press(key: string): Promise<void> {
    const result = await this.exec(['press', key]);
    if (result.code !== 0) {
      throw new Error(`Press failed: ${result.stderr}`);
    }
  }

  /**
   * Wait for condition
   */
  async wait(condition: string | number): Promise<void> {
    if (typeof condition === 'number') {
      await new Promise(resolve => setTimeout(resolve, condition));
    } else {
      const result = await this.exec(['wait', condition]);
      if (result.code !== 0) {
        throw new Error(`Wait failed: ${result.stderr}`);
      }
    }
  }

  /**
   * Take screenshot
   */
  async screenshot(path?: string): Promise<string> {
    const outputPath = path || `/tmp/aura_agent_${Date.now()}.png`;
    const result = await this.exec(['screenshot', outputPath]);

    if (result.code !== 0) {
      throw new Error(`Screenshot failed: ${result.stderr}`);
    }

    return outputPath;
  }

  /**
   * Get browser state
   */
  async getBrowserState(): Promise<BrowserState> {
    const [titleResult, urlResult, elements] = await Promise.all([
      this.exec(['get', 'title']),
      this.exec(['get', 'url']),
      this.snapshot(),
    ]);

    const screenshotPath = await this.screenshot();

    return {
      title: titleResult.stdout.trim(),
      url: urlResult.stdout.trim(),
      elements,
      screenshot: screenshotPath,
    };
  }

  /**
   * Find element by text and perform action
   */
  private async findAndInteract(text: string, action: 'click' | 'fill', value?: string): Promise<boolean> {
    const elements = await this.snapshot();
    const element = elements.find(e =>
      e.text?.toLowerCase().includes(text.toLowerCase()) ||
      e.attributes?.placeholder?.toLowerCase().includes(text.toLowerCase())
    );

    if (!element) {
      if (this.config.debug) {
        console.log(`[agent-browser] Element not found: ${text}`);
      }
      return false;
    }

    if (action === 'click') {
      await this.click(element.ref);
    } else if (action === 'fill' && value) {
      await this.fill(element.ref, value);
    }

    return true;
  }

  /**
   * Execute Aura task
   */
  async executeTask(task: AuraTask): Promise<TaskResult> {
    const screenshots: string[] = [];
    const logs: string[] = [];

    try {
      // Navigate to Aura.build
      await this.navigate('https://www.aura.build');
      logs.push('Navigated to aura.build');

      // Wait for page load
      await this.wait(3000);
      screenshots.push(await this.screenshot());

      // Handle authentication
      await this.handleAuth(logs);

      // Execute task-specific actions
      switch (task.type) {
        case 'generate_design':
          return await this.generateDesign(task.params, screenshots, logs);

        case 'export_html':
          return await this.exportHtml(task.params, screenshots, logs);

        case 'create_project':
          return await this.createProject(task.params, screenshots, logs);

        case 'edit_component':
          return await this.editComponent(task.params, screenshots, logs);

        default:
          return await this.genericTask(task, screenshots, logs);
      }
    } catch (error) {
      return {
        success: false,
        screenshots,
        logs: [...logs, (error as Error).message],
      };
    }
  }

  /**
   * Handle authentication
   */
  private async handleAuth(logs: string[]): Promise<void> {
    const state = await this.getBrowserState();

    if (state.url.includes('login') || state.url.includes('signin')) {
      const email = process.env.AURA_EMAIL;
      const password = process.env.AURA_PASSWORD;

      if (!email || !password) {
        throw new Error('AURA_EMAIL and AURA_PASSWORD required for authentication');
      }

      // Find and fill email
      const emailElement = state.elements.find(e =>
        e.type === 'input' && (
          e.attributes?.type === 'email' ||
          e.attributes?.name?.includes('email') ||
          e.attributes?.placeholder?.toLowerCase().includes('email')
        )
      );

      if (emailElement) {
        await this.fill(emailElement.ref, email);
        logs.push('Filled email field');
      }

      // Find and fill password
      const passwordElement = state.elements.find(e =>
        e.type === 'input' && (
          e.attributes?.type === 'password' ||
          e.attributes?.name?.includes('password')
        )
      );

      if (passwordElement) {
        await this.fill(passwordElement.ref, password);
        logs.push('Filled password field');
      }

      // Click submit
      const submitElement = state.elements.find(e =>
        (e.type === 'button' && e.text?.toLowerCase().includes('sign')) ||
        (e.type === 'button' && e.text?.toLowerCase().includes('log'))
      );

      if (submitElement) {
        await this.click(submitElement.ref);
        logs.push('Clicked sign in button');
        await this.wait(5000);
      }
    }
  }

  /**
   * Generate design task
   */
  private async generateDesign(params: Record<string, unknown>, screenshots: string[], logs: string[]): Promise<TaskResult> {
    // Click New Project
    const clicked = await this.findAndInteract('New Project', 'click');
    if (!clicked) {
      await this.findAndInteract('Create', 'click');
    }
    logs.push('Clicked New Project');
    await this.wait(2000);

    // Find prompt input
    const state = await this.getBrowserState();
    const promptInput = state.elements.find(e =>
      e.type === 'textarea' ||
      (e.type === 'input' && e.attributes?.placeholder?.toLowerCase().includes('prompt'))
    );

    if (promptInput) {
      await this.fill(promptInput.ref, params.prompt as string);
      logs.push('Filled AI prompt');
    }

    // Click Generate
    await this.findAndInteract('Generate', 'click');
    logs.push('Clicked Generate');

    // Wait for generation
    await this.wait(60000);
    screenshots.push(await this.screenshot());

    const finalState = await this.getBrowserState();

    return {
      success: true,
      data: { url: finalState.url },
      screenshots,
      logs,
    };
  }

  /**
   * Export HTML task
   */
  private async exportHtml(params: Record<string, unknown>, screenshots: string[], logs: string[]): Promise<TaskResult> {
    await this.navigate(`https://www.aura.build/project/${params.projectId}`);
    await this.wait(3000);
    await this.handleAuth(logs);

    await this.findAndInteract('Export', 'click');
    logs.push('Clicked Export');
    await this.wait(1000);

    await this.findAndInteract('HTML', 'click');
    logs.push('Selected HTML');
    await this.wait(5000);

    screenshots.push(await this.screenshot());

    return {
      success: true,
      screenshots,
      logs,
    };
  }

  /**
   * Create project task
   */
  private async createProject(params: Record<string, unknown>, screenshots: string[], logs: string[]): Promise<TaskResult> {
    await this.findAndInteract('New Project', 'click');
    await this.wait(2000);

    if (params.name) {
      const state = await this.getBrowserState();
      const nameInput = state.elements.find(e =>
        e.type === 'input' && (
          e.attributes?.name?.includes('name') ||
          e.attributes?.placeholder?.toLowerCase().includes('name')
        )
      );

      if (nameInput) {
        await this.fill(nameInput.ref, params.name as string);
      }
    }

    await this.findAndInteract('Create', 'click');
    await this.wait(3000);

    screenshots.push(await this.screenshot());
    const finalState = await this.getBrowserState();

    return {
      success: true,
      data: { projectUrl: finalState.url },
      screenshots,
      logs,
    };
  }

  /**
   * Edit component task
   */
  private async editComponent(params: Record<string, unknown>, screenshots: string[], logs: string[]): Promise<TaskResult> {
    await this.navigate(`https://www.aura.build/project/${params.projectId}`);
    await this.wait(3000);
    await this.handleAuth(logs);

    // This is a simplified version - would need more sophisticated element selection
    if (params.prompt) {
      const state = await this.getBrowserState();
      const promptInput = state.elements.find(e => e.type === 'textarea');
      if (promptInput) {
        await this.fill(promptInput.ref, params.prompt as string);
        await this.findAndInteract('Apply', 'click');
        await this.wait(5000);
      }
    }

    screenshots.push(await this.screenshot());

    return {
      success: true,
      screenshots,
      logs,
    };
  }

  /**
   * Generic task execution
   */
  private async genericTask(task: AuraTask, screenshots: string[], logs: string[]): Promise<TaskResult> {
    if (task.params.customSteps && Array.isArray(task.params.customSteps)) {
      for (const step of task.params.customSteps) {
        logs.push(`Executing: ${step}`);

        if (step.toLowerCase().includes('navigate')) {
          const urlMatch = step.match(/https?:\/\/[^\s]+/);
          if (urlMatch) await this.navigate(urlMatch[0]);
        } else if (step.toLowerCase().includes('click')) {
          const targetMatch = step.match(/click\s+(?:on\s+)?["']?([^"']+)["']?/i);
          if (targetMatch) await this.findAndInteract(targetMatch[1], 'click');
        } else if (step.toLowerCase().includes('fill') || step.toLowerCase().includes('type')) {
          const fillMatch = step.match(/(?:fill|type)\s+["']?([^"']+)["']?\s+(?:with|:)\s+["']?([^"']+)["']?/i);
          if (fillMatch) await this.findAndInteract(fillMatch[1], 'fill', fillMatch[2]);
        } else if (step.toLowerCase().includes('wait')) {
          const waitMatch = step.match(/wait\s+(\d+)/i);
          if (waitMatch) await this.wait(parseInt(waitMatch[1]));
        } else if (step.toLowerCase().includes('screenshot')) {
          screenshots.push(await this.screenshot());
        }
      }
    }

    screenshots.push(await this.screenshot());

    return {
      success: true,
      screenshots,
      logs,
    };
  }

  /**
   * Close browser
   */
  async close(): Promise<void> {
    await this.exec(['close']);
  }
}
