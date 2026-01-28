/**
 * Steel.dev Agent Integration
 * Self-hosted browser API with Playwright/Puppeteer support
 */

import { chromium, Browser, Page, BrowserContext } from 'playwright';
import type { AgentConfig, AuraTask, TaskResult, BrowserState, InteractiveElement } from '../types/index.js';

const DEFAULT_STEEL_URL = 'http://localhost:3000';

export class SteelAgent {
  private config: AgentConfig;
  private steelUrl: string;
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private sessionId: string | null = null;

  constructor(config: AgentConfig) {
    this.config = config;
    this.steelUrl = process.env.STEEL_BASE_URL || DEFAULT_STEEL_URL;
  }

  /**
   * Health check for Steel availability
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.steelUrl}/health`);
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Create a new Steel session
   */
  private async createSession(): Promise<string> {
    const response = await fetch(`${this.steelUrl}/v1/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        blockAds: true,
        dimensions: { width: 1920, height: 1080 },
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to create Steel session: ${response.statusText}`);
    }

    const data = await response.json() as { id: string; wsUrl: string };
    this.sessionId = data.id;
    return data.wsUrl;
  }

  /**
   * Connect to Steel browser
   */
  private async connect(): Promise<void> {
    if (this.browser && this.page) return;

    const wsUrl = await this.createSession();

    this.browser = await chromium.connectOverCDP(wsUrl);
    this.context = this.browser.contexts()[0] || await this.browser.newContext();
    this.page = this.context.pages()[0] || await this.context.newPage();

    // Set default timeout
    this.page.setDefaultTimeout(this.config.timeoutMs);
  }

  /**
   * Get current browser state
   */
  async getBrowserState(): Promise<BrowserState> {
    if (!this.page) {
      await this.connect();
    }

    const url = this.page!.url();
    const title = await this.page!.title();

    // Get interactive elements
    const elements = await this.page!.evaluate(() => {
      const interactiveSelectors = 'a, button, input, select, textarea, [role="button"], [onclick], [tabindex]';
      const elementList: InteractiveElement[] = [];
      let refIndex = 0;

      document.querySelectorAll(interactiveSelectors).forEach((el) => {
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          const htmlEl = el as HTMLElement;
          elementList.push({
            ref: `e${refIndex++}`,
            type: el.tagName.toLowerCase(),
            text: htmlEl.innerText?.slice(0, 100),
            placeholder: (el as HTMLInputElement).placeholder,
            value: (el as HTMLInputElement).value,
            bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
            attributes: {
              id: el.id,
              class: el.className,
              name: (el as HTMLInputElement).name,
              href: (el as HTMLAnchorElement).href,
            },
          });
        }
      });

      return elementList;
    }) as InteractiveElement[];

    // Take screenshot
    const screenshotBuffer = await this.page!.screenshot();
    const screenshot = screenshotBuffer.toString('base64');

    return {
      url,
      title,
      elements,
      screenshot: `data:image/png;base64,${screenshot}`,
    };
  }

  /**
   * Navigate to URL
   */
  async navigate(url: string): Promise<void> {
    if (!this.page) await this.connect();
    await this.page!.goto(url, { waitUntil: 'networkidle' });
  }

  /**
   * Click element by selector or text
   */
  async click(target: string): Promise<void> {
    if (!this.page) await this.connect();

    try {
      // Try direct selector first
      await this.page!.click(target, { timeout: 5000 });
    } catch {
      // Try finding by text
      await this.page!.getByText(target, { exact: false }).first().click();
    }
  }

  /**
   * Fill input field
   */
  async fill(selector: string, value: string): Promise<void> {
    if (!this.page) await this.connect();

    try {
      await this.page!.fill(selector, value);
    } catch {
      // Try by placeholder
      await this.page!.getByPlaceholder(selector).fill(value);
    }
  }

  /**
   * Wait for element or condition
   */
  async waitFor(condition: string | number): Promise<void> {
    if (!this.page) await this.connect();

    if (typeof condition === 'number') {
      await this.page!.waitForTimeout(condition);
    } else {
      await this.page!.waitForSelector(condition);
    }
  }

  /**
   * Take screenshot
   */
  async screenshot(path?: string): Promise<string> {
    if (!this.page) await this.connect();

    if (path) {
      await this.page!.screenshot({ path, fullPage: true });
      return path;
    }

    const buffer = await this.page!.screenshot({ fullPage: true });
    return `data:image/png;base64,${buffer.toString('base64')}`;
  }

  /**
   * Execute Aura.build task
   */
  async executeTask(task: AuraTask): Promise<TaskResult> {
    try {
      await this.connect();
      const screenshots: string[] = [];

      // Navigate to Aura.build
      await this.navigate('https://www.aura.build');
      screenshots.push(await this.screenshot());

      // Handle authentication if needed
      await this.handleAuth();

      // Execute task-specific actions
      switch (task.type) {
        case 'generate_design':
          return await this.generateDesign(task.params, screenshots);

        case 'export_html':
          return await this.exportHtml(task.params, screenshots);

        case 'export_figma':
          return await this.exportFigma(task.params, screenshots);

        case 'create_project':
          return await this.createProject(task.params, screenshots);

        case 'edit_component':
          return await this.editComponent(task.params, screenshots);

        case 'apply_template':
          return await this.applyTemplate(task.params, screenshots);

        case 'ai_prompt':
          return await this.aiPrompt(task.params, screenshots);

        default:
          return await this.customAction(task.params, screenshots);
      }
    } catch (error) {
      return {
        success: false,
        logs: [(error as Error).message],
      };
    }
  }

  /**
   * Handle Aura.build authentication
   */
  private async handleAuth(): Promise<void> {
    const currentUrl = this.page!.url();

    // Check if we need to login
    if (currentUrl.includes('login') || currentUrl.includes('signin')) {
      const email = process.env.AURA_EMAIL;
      const password = process.env.AURA_PASSWORD;

      if (!email || !password) {
        throw new Error('AURA_EMAIL and AURA_PASSWORD environment variables required');
      }

      // Try to fill login form
      try {
        await this.page!.fill('input[type="email"], input[name="email"]', email);
        await this.page!.fill('input[type="password"], input[name="password"]', password);
        await this.page!.click('button[type="submit"], button:has-text("Sign in"), button:has-text("Login")');
        await this.page!.waitForNavigation({ waitUntil: 'networkidle' });
      } catch (e) {
        if (this.config.debug) {
          console.log('[Steel] Auth form not found or already logged in');
        }
      }
    }
  }

  /**
   * Generate design task
   */
  private async generateDesign(params: Record<string, unknown>, screenshots: string[]): Promise<TaskResult> {
    // Click New Project
    await this.click('New Project');
    await this.waitFor(2000);

    // Find and fill AI prompt
    await this.fill('textarea, input[placeholder*="prompt"], input[placeholder*="describe"]', params.prompt as string);

    // Click Generate
    await this.click('Generate');

    // Wait for generation (this may take a while)
    await this.waitFor(60000); // Wait up to 60 seconds

    screenshots.push(await this.screenshot());

    return {
      success: true,
      data: { url: this.page!.url() },
      screenshots,
      logs: ['Design generated successfully'],
    };
  }

  /**
   * Export HTML task
   */
  private async exportHtml(params: Record<string, unknown>, screenshots: string[]): Promise<TaskResult> {
    await this.navigate(`https://www.aura.build/project/${params.projectId}`);
    await this.handleAuth();

    await this.click('Export');
    await this.waitFor(1000);
    await this.click('HTML');

    // Wait for download
    const [download] = await Promise.all([
      this.page!.waitForEvent('download'),
      this.click('Download'),
    ]);

    const downloadPath = `/tmp/aura_export_${Date.now()}.zip`;
    await download.saveAs(downloadPath);

    screenshots.push(await this.screenshot());

    return {
      success: true,
      data: { downloadPath },
      screenshots,
      artifacts: [{ type: 'html', filename: downloadPath }],
      logs: ['HTML exported successfully'],
    };
  }

  /**
   * Export Figma task
   */
  private async exportFigma(params: Record<string, unknown>, screenshots: string[]): Promise<TaskResult> {
    await this.navigate(`https://www.aura.build/project/${params.projectId}`);
    await this.handleAuth();

    await this.click('Export');
    await this.waitFor(1000);
    await this.click('Figma');

    await this.waitFor(5000);

    // Look for Figma URL
    const figmaUrl = await this.page!.evaluate(() => {
      const link = document.querySelector('a[href*="figma.com"]');
      return link?.getAttribute('href');
    });

    screenshots.push(await this.screenshot());

    return {
      success: true,
      data: { figmaUrl },
      screenshots,
      logs: ['Figma export completed'],
    };
  }

  /**
   * Create project task
   */
  private async createProject(params: Record<string, unknown>, screenshots: string[]): Promise<TaskResult> {
    await this.click('New Project');
    await this.waitFor(1000);

    if (params.name) {
      await this.fill('input[name="name"], input[placeholder*="name"]', params.name as string);
    }

    await this.click('Create');
    await this.waitFor(3000);

    screenshots.push(await this.screenshot());

    return {
      success: true,
      data: { projectUrl: this.page!.url() },
      screenshots,
      logs: ['Project created successfully'],
    };
  }

  /**
   * Edit component task
   */
  private async editComponent(params: Record<string, unknown>, screenshots: string[]): Promise<TaskResult> {
    await this.navigate(`https://www.aura.build/project/${params.projectId}`);
    await this.handleAuth();

    // Click on component
    if (params.componentId) {
      await this.click(`[data-id="${params.componentId}"]`);
    }

    if (params.prompt) {
      await this.fill('textarea', params.prompt as string);
      await this.click('Apply');
      await this.waitFor(3000);
    }

    screenshots.push(await this.screenshot());

    return {
      success: true,
      screenshots,
      logs: ['Component edited'],
    };
  }

  /**
   * Apply template task
   */
  private async applyTemplate(params: Record<string, unknown>, screenshots: string[]): Promise<TaskResult> {
    await this.navigate(`https://www.aura.build/project/${params.projectId}`);
    await this.handleAuth();

    await this.click('Templates');
    await this.waitFor(1000);

    await this.fill('input[type="search"], input[placeholder*="search"]', params.template as string);
    await this.waitFor(1000);

    await this.click(`[data-template="${params.template}"]`);
    await this.click('Apply');
    await this.waitFor(5000);

    screenshots.push(await this.screenshot());

    return {
      success: true,
      screenshots,
      logs: ['Template applied'],
    };
  }

  /**
   * AI prompt task
   */
  private async aiPrompt(params: Record<string, unknown>, screenshots: string[]): Promise<TaskResult> {
    await this.navigate(`https://www.aura.build/project/${params.projectId}`);
    await this.handleAuth();

    // Find AI input
    await this.fill('textarea[placeholder*="AI"], textarea[placeholder*="prompt"]', params.prompt as string);
    await this.click('Submit');

    await this.waitFor(30000);

    screenshots.push(await this.screenshot());

    return {
      success: true,
      data: { result: 'AI prompt processed' },
      screenshots,
      logs: ['AI prompt completed'],
    };
  }

  /**
   * Custom action task
   */
  private async customAction(params: Record<string, unknown>, screenshots: string[]): Promise<TaskResult> {
    const steps = params.customSteps as string[] || [params.prompt as string];

    for (const step of steps) {
      // Parse and execute step
      if (step.includes('navigate') || step.includes('go to')) {
        const urlMatch = step.match(/(?:navigate|go to)\s+(.+)/i);
        if (urlMatch) await this.navigate(urlMatch[1].trim());
      } else if (step.includes('click')) {
        const targetMatch = step.match(/click\s+(?:on\s+)?(.+)/i);
        if (targetMatch) await this.click(targetMatch[1].trim());
      } else if (step.includes('fill') || step.includes('type')) {
        const fillMatch = step.match(/(?:fill|type)\s+(.+?)\s+(?:with|:)\s+(.+)/i);
        if (fillMatch) await this.fill(fillMatch[1].trim(), fillMatch[2].trim());
      } else if (step.includes('wait')) {
        const waitMatch = step.match(/wait\s+(\d+)/i);
        if (waitMatch) await this.waitFor(parseInt(waitMatch[1]));
      }
    }

    screenshots.push(await this.screenshot());

    return {
      success: true,
      screenshots,
      logs: ['Custom action completed'],
    };
  }

  /**
   * Close browser and session
   */
  async close(): Promise<void> {
    if (this.page) await this.page.close().catch(() => {});
    if (this.context) await this.context.close().catch(() => {});
    if (this.browser) await this.browser.close().catch(() => {});

    if (this.sessionId) {
      await fetch(`${this.steelUrl}/v1/sessions/${this.sessionId}`, {
        method: 'DELETE',
      }).catch(() => {});
    }

    this.page = null;
    this.context = null;
    this.browser = null;
    this.sessionId = null;
  }
}
