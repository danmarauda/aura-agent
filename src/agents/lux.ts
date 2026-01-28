/**
 * Lux Agent - OpenAGI's Computer Use Model Integration
 * Fastest visual automation backend (1 second per step, 83.6% benchmark)
 */

import { spawn, ChildProcess } from 'child_process';
import type { AgentConfig, AuraTask, TaskResult, BrowserState } from '../types/index.js';

/**
 * Lux execution modes
 */
type LuxMode = 'tasker' | 'actor' | 'thinker';

/**
 * Map task types to optimal Lux modes
 */
const TASK_MODE_MAP: Record<string, LuxMode> = {
  generate_design: 'thinker',  // Complex, may need extended execution
  edit_component: 'actor',     // Immediate task
  add_component: 'actor',
  delete_component: 'tasker',  // Strict step-by-step
  export_html: 'tasker',
  export_figma: 'tasker',
  create_project: 'actor',
  duplicate_project: 'tasker',
  publish: 'tasker',
  upload_asset: 'actor',
  apply_template: 'actor',
  ai_prompt: 'thinker',
  custom_action: 'thinker',
};

/**
 * Task-specific instruction templates for Aura.build
 */
const TASK_INSTRUCTIONS: Record<string, (params: Record<string, unknown>) => string> = {
  generate_design: (params) => `
    Navigate to https://www.aura.build
    Sign in with the saved credentials if not already logged in
    Click on "New Project" or "Create" button
    In the AI prompt input field, enter the following design request:
    "${params.prompt}"
    Click the "Generate" button
    Wait for the design to be fully generated (watch for loading indicators to disappear)
    Take a screenshot of the final result
    Return the project URL from the browser address bar
  `,

  export_html: (params) => `
    Navigate to https://www.aura.build/project/${params.projectId}
    Sign in if not already authenticated
    Look for an "Export" button or menu
    Click on Export
    Select "HTML" as the export format
    If there are export options, keep defaults
    Click Download or Export
    Wait for the download to complete
    Confirm the file was downloaded successfully
  `,

  export_figma: (params) => `
    Navigate to https://www.aura.build/project/${params.projectId}
    Sign in if not already authenticated
    Find and click the "Export" button or menu
    Select "Figma" as the export format
    Wait for the Figma export to complete
    Copy and return the Figma file URL
  `,

  edit_component: (params) => `
    Navigate to https://www.aura.build/project/${params.projectId}
    Sign in if not already authenticated
    Find and click on the component with ID or name: ${params.componentId}
    ${params.prompt ? `Apply the following changes: "${params.prompt}"` : 'Open the component editor'}
    Save the changes
    Take a screenshot showing the updated component
  `,

  create_project: (params) => `
    Navigate to https://www.aura.build
    Sign in if not already authenticated
    Click on "New Project" or "Create" button
    Enter the project name: "${params.name}"
    ${params.description ? `Add description: "${params.description}"` : ''}
    Create the project
    Wait for the project editor to load
    Return the new project URL
  `,

  apply_template: (params) => `
    Navigate to https://www.aura.build/project/${params.projectId}
    Sign in if not already authenticated
    Look for "Templates" or "Apply Template" option
    Search or browse for template: "${params.template}"
    Click to apply the selected template
    Confirm the application if prompted
    Wait for the template to be fully applied
  `,

  ai_prompt: (params) => `
    Navigate to https://www.aura.build/project/${params.projectId}
    Sign in if not already authenticated
    Find the AI assistant or prompt input area
    Enter the following prompt:
    "${params.prompt}"
    Submit the prompt and wait for AI to process
    Review the changes made by AI
    Take a screenshot of the result
  `,

  custom_action: (params) => {
    if (params.customSteps && Array.isArray(params.customSteps)) {
      return params.customSteps.join('\n');
    }
    return params.prompt as string || 'No instructions provided';
  },
};

export class LuxAgent {
  private config: AgentConfig;
  private pythonProcess: ChildProcess | null = null;
  private isInitialized: boolean = false;

  constructor(config: AgentConfig) {
    this.config = config;
  }

  /**
   * Health check for Lux availability
   */
  async healthCheck(): Promise<boolean> {
    return new Promise((resolve) => {
      const check = spawn('python3', ['-c', 'import oagi; print("OK")']);

      check.on('close', (code) => {
        resolve(code === 0);
      });

      check.on('error', () => {
        resolve(false);
      });

      setTimeout(() => {
        check.kill();
        resolve(false);
      }, 5000);
    });
  }

  /**
   * Initialize Lux agent
   */
  private async initialize(): Promise<void> {
    if (this.isInitialized) return;

    // Verify OAGI SDK is installed
    const hasOagi = await this.healthCheck();
    if (!hasOagi) {
      throw new Error('OAGI SDK not installed. Run: pip install oagi');
    }

    // Verify API key
    if (!process.env.OAGI_API_KEY) {
      throw new Error('OAGI_API_KEY environment variable not set');
    }

    this.isInitialized = true;
  }

  /**
   * Get optimal mode for task
   */
  private getMode(taskType: string): LuxMode {
    return TASK_MODE_MAP[taskType] || 'actor';
  }

  /**
   * Generate instructions for task
   */
  private generateInstructions(task: AuraTask): string {
    const generator = TASK_INSTRUCTIONS[task.type];
    if (generator) {
      return generator(task.params);
    }

    // Default instructions
    return `
      Navigate to https://www.aura.build
      Sign in if not already authenticated
      ${task.params.prompt || 'Complete the requested action'}
    `;
  }

  /**
   * Execute task using Lux
   */
  async executeTask(task: AuraTask): Promise<TaskResult> {
    await this.initialize();

    const mode = this.getMode(task.type);
    const instructions = this.generateInstructions(task);
    const maxSteps = this.getMaxSteps(task.type);

    if (this.config.debug) {
      console.log(`[Lux] Executing task ${task.id} with mode: ${mode}`);
      console.log(`[Lux] Instructions:`, instructions);
    }

    return new Promise((resolve) => {
      const pythonScript = this.buildPythonScript(instructions, mode, maxSteps);

      const proc = spawn('python3', ['-c', pythonScript], {
        env: {
          ...process.env,
          OAGI_API_KEY: process.env.OAGI_API_KEY,
        },
      });

      let stdout = '';
      let stderr = '';
      const screenshots: string[] = [];

      proc.stdout.on('data', (data) => {
        const output = data.toString();
        stdout += output;

        // Parse screenshot paths from output
        const screenshotMatch = output.match(/SCREENSHOT:(.+)/);
        if (screenshotMatch) {
          screenshots.push(screenshotMatch[1].trim());
        }

        if (this.config.debug) {
          console.log(`[Lux stdout]`, output);
        }
      });

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
        if (this.config.debug) {
          console.error(`[Lux stderr]`, data.toString());
        }
      });

      proc.on('close', (code) => {
        if (code === 0) {
          // Parse result from stdout
          const resultMatch = stdout.match(/RESULT:([\s\S]+?)(?:END_RESULT|$)/);
          let data = null;

          if (resultMatch) {
            try {
              data = JSON.parse(resultMatch[1].trim());
            } catch {
              data = resultMatch[1].trim();
            }
          }

          resolve({
            success: true,
            data,
            screenshots,
            logs: stdout.split('\n').filter(l => !l.startsWith('SCREENSHOT:') && !l.startsWith('RESULT:')),
          });
        } else {
          resolve({
            success: false,
            logs: [stderr || 'Unknown error occurred'],
          });
        }
      });

      // Set timeout
      setTimeout(() => {
        proc.kill();
        resolve({
          success: false,
          logs: ['Task timed out'],
        });
      }, this.config.timeoutMs);
    });
  }

  /**
   * Get max steps based on task type
   */
  private getMaxSteps(taskType: string): number {
    const stepMap: Record<string, number> = {
      generate_design: 50,
      edit_component: 20,
      add_component: 25,
      delete_component: 10,
      export_html: 15,
      export_figma: 15,
      create_project: 15,
      duplicate_project: 10,
      publish: 20,
      upload_asset: 10,
      apply_template: 20,
      ai_prompt: 30,
      custom_action: 100,
    };
    return stepMap[taskType] || 30;
  }

  /**
   * Build Python script for Lux execution
   */
  private buildPythonScript(instructions: string, mode: LuxMode, maxSteps: number): string {
    const escapedInstructions = instructions.replace(/"/g, '\\"').replace(/\n/g, '\\n');

    return `
import asyncio
import json
import os
import sys
from datetime import datetime

try:
    from oagi import AsyncDefaultAgent, AsyncPyautoguiActionHandler, AsyncScreenshotMaker
except ImportError:
    print("RESULT:{\\"error\\": \\"OAGI SDK not installed\\"}")
    print("END_RESULT")
    sys.exit(1)

async def run_task():
    try:
        agent = AsyncDefaultAgent(
            max_steps=${maxSteps},
            mode="${mode}"
        )

        action_handler = AsyncPyautoguiActionHandler()
        image_provider = AsyncScreenshotMaker()

        # Save credentials for auth
        credentials = {
            "email": os.environ.get("AURA_EMAIL", ""),
            "password": os.environ.get("AURA_PASSWORD", "")
        }

        task_instructions = """${escapedInstructions}

        IMPORTANT: If you need to sign in:
        - Email: """ + credentials["email"] + """
        - Password: """ + credentials["password"] + """

        After completing the task, output the result in this format:
        RESULT: <your result here>
        END_RESULT
        """

        completed = await agent.execute(
            task_instructions,
            action_handler=action_handler,
            image_provider=image_provider,
        )

        # Save final screenshot
        screenshot_path = f"/tmp/aura_agent_{datetime.now().strftime('%Y%m%d_%H%M%S')}.png"
        final_screenshot = await image_provider()
        if hasattr(final_screenshot, 'save'):
            final_screenshot.save(screenshot_path)
            print(f"SCREENSHOT:{screenshot_path}")

        result = {
            "completed": completed,
            "steps_executed": agent.steps_executed if hasattr(agent, 'steps_executed') else "unknown"
        }

        print(f"RESULT:{json.dumps(result)}")
        print("END_RESULT")

    except Exception as e:
        print(f"RESULT:{json.dumps({'error': str(e)})}")
        print("END_RESULT")
        sys.exit(1)

asyncio.run(run_task())
`;
  }

  /**
   * Get current browser state (for debugging)
   */
  async getBrowserState(): Promise<BrowserState | null> {
    // Lux doesn't expose browser state directly
    // This would need a screenshot + OCR approach
    return null;
  }

  /**
   * Stop any running execution
   */
  async stop(): Promise<void> {
    if (this.pythonProcess) {
      this.pythonProcess.kill();
      this.pythonProcess = null;
    }
  }
}
