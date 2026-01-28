#!/usr/bin/env node
/**
 * Aura Agent CLI
 * Expert AI agent for full automation of Aura.build
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import { config } from 'dotenv';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

import { AuraOrchestrator } from './orchestrator.js';
import type { AgentConfig, AuraTask, TaskType, Backend } from './types/index.js';

// Load environment variables
config();

const VERSION = '1.0.0';

// CLI instance
const program = new Command();

// Default configuration
const DEFAULT_CONFIG: AgentConfig = {
  preferredBackend: (process.env.PREFERRED_BACKEND as Backend | 'auto') || 'auto',
  maxRetries: parseInt(process.env.MAX_RETRIES || '3'),
  timeoutMs: parseInt(process.env.TIMEOUT_MS || '60000'),
  headless: process.env.HEADLESS !== 'false',
  debug: process.env.DEBUG === 'true',
};

// ASCII Art Banner
const BANNER = chalk.cyan(`
   ___                        ___                    __
  /   | __  ___________ _    /   | ____ ____  ____  / /_
 / /| |/ / / / ___/ __ \`/   / /| |/ __ \`/ _ \\/ __ \\/ __/
/ ___ / /_/ / /  / /_/ /   / ___ / /_/ /  __/ / / / /_
/_/  |_\\__,_/_/   \\__,_/   /_/  |_\\__, /\\___/_/ /_/\\__/
                                 /____/

  ${chalk.gray('Expert AI Agent for Aura.build Automation')}
  ${chalk.gray(`v${VERSION}`)}
`);

/**
 * Create orchestrator with config
 */
function createOrchestrator(options: Partial<AgentConfig> = {}): AuraOrchestrator {
  const config: AgentConfig = {
    ...DEFAULT_CONFIG,
    ...options,
    credentials: process.env.AURA_EMAIL && process.env.AURA_PASSWORD ? {
      email: process.env.AURA_EMAIL,
      password: process.env.AURA_PASSWORD,
    } : undefined,
  };

  return new AuraOrchestrator(config);
}

/**
 * Generate unique task ID
 */
function generateTaskId(): string {
  return `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// Main CLI Program
program
  .name('aura')
  .description('Expert AI agent for Aura.build automation')
  .version(VERSION)
  .option('-d, --debug', 'Enable debug mode')
  .option('-b, --backend <backend>', 'Preferred backend (auto|api|lux|browser-use|steel|agent-browser)')
  .option('--headless', 'Run in headless mode (default)')
  .option('--headed', 'Run with visible browser')
  .hook('preAction', () => {
    if (program.opts().debug) {
      DEFAULT_CONFIG.debug = true;
    }
  });

// ============================================
// Generate Command
// ============================================
program
  .command('generate <prompt>')
  .description('Generate a new design from an AI prompt')
  .option('-t, --template <name>', 'Use a template as base')
  .option('-s, --style <style>', 'Design style (modern|minimal|bold|corporate|creative)')
  .option('-e, --export <format>', 'Auto-export after generation (html|figma)')
  .option('-o, --output <path>', 'Output path for export')
  .action(async (prompt: string, options) => {
    console.log(BANNER);
    const spinner = ora('Initializing agent...').start();

    try {
      const orchestrator = createOrchestrator({
        debug: program.opts().debug,
        preferredBackend: program.opts().backend || 'auto',
        headless: !program.opts().headed,
      });

      const task: AuraTask = {
        id: generateTaskId(),
        type: 'generate_design',
        params: {
          prompt,
          template: options.template,
          style: options.style,
        },
        status: 'pending',
      };

      spinner.text = 'Planning task execution...';
      const plan = await orchestrator.planTask(task);

      spinner.text = `Executing with ${plan.routing.backend} (${plan.routing.reason})`;

      const result = await orchestrator.executeTask(task);

      if (result.success) {
        spinner.succeed(chalk.green('Design generated successfully!'));

        if (result.data) {
          console.log(chalk.cyan('\nResult:'));
          console.log(JSON.stringify(result.data, null, 2));
        }

        if (result.screenshots?.length) {
          console.log(chalk.cyan('\nScreenshots:'));
          result.screenshots.forEach(s => console.log(`  - ${s}`));
        }

        // Auto-export if requested
        if (options.export && result.data && typeof result.data === 'object' && 'projectId' in (result.data as object)) {
          spinner.start(`Exporting to ${options.export}...`);
          const exportTask: AuraTask = {
            id: generateTaskId(),
            type: options.export === 'figma' ? 'export_figma' : 'export_html',
            params: { projectId: (result.data as { projectId: string }).projectId },
            status: 'pending',
          };
          const exportResult = await orchestrator.executeTask(exportTask);
          if (exportResult.success) {
            spinner.succeed(chalk.green(`Exported to ${options.export}!`));
          } else {
            spinner.warn(chalk.yellow('Export completed with warnings'));
          }
        }
      } else {
        spinner.fail(chalk.red('Design generation failed'));
        console.log(chalk.red('\nErrors:'));
        result.logs?.forEach(log => console.log(`  ${log}`));
      }
    } catch (error) {
      spinner.fail(chalk.red('Error: ' + (error as Error).message));
      process.exit(1);
    }
  });

// ============================================
// Export Command
// ============================================
program
  .command('export <project-id> <format>')
  .description('Export a project (html|figma|react|vue)')
  .option('-o, --output <path>', 'Output directory')
  .option('--minify', 'Minify output')
  .option('--no-assets', 'Skip assets')
  .action(async (projectId: string, format: string, options) => {
    console.log(BANNER);
    const spinner = ora(`Exporting project ${projectId} to ${format}...`).start();

    try {
      const orchestrator = createOrchestrator({
        debug: program.opts().debug,
        preferredBackend: program.opts().backend || 'auto',
      });

      const validFormats = ['html', 'figma', 'react', 'vue'] as const;
      const exportFormat = validFormats.includes(format as typeof validFormats[number])
        ? (format as 'html' | 'figma' | 'react' | 'vue')
        : 'html';

      const taskType: TaskType = exportFormat === 'figma' ? 'export_figma' : 'export_html';

      const task: AuraTask = {
        id: generateTaskId(),
        type: taskType,
        params: {
          projectId,
          exportFormat,
          outputPath: options.output,
          minify: options.minify,
          includeAssets: options.assets !== false,
        },
        status: 'pending',
      };

      const result = await orchestrator.executeTask(task);

      if (result.success) {
        spinner.succeed(chalk.green(`Export completed!`));

        if (result.artifacts?.length) {
          console.log(chalk.cyan('\nExported files:'));
          result.artifacts.forEach(a => console.log(`  - ${a.filename} (${a.type})`));
        }

        if (result.data) {
          console.log(chalk.cyan('\nDetails:'));
          console.log(JSON.stringify(result.data, null, 2));
        }
      } else {
        spinner.fail(chalk.red('Export failed'));
        result.logs?.forEach(log => console.log(chalk.red(`  ${log}`)));
      }
    } catch (error) {
      spinner.fail(chalk.red('Error: ' + (error as Error).message));
      process.exit(1);
    }
  });

// ============================================
// Create Command
// ============================================
program
  .command('create <name>')
  .description('Create a new empty project')
  .option('-d, --description <text>', 'Project description')
  .action(async (name: string, options) => {
    console.log(BANNER);
    const spinner = ora(`Creating project "${name}"...`).start();

    try {
      const orchestrator = createOrchestrator({
        debug: program.opts().debug,
      });

      const task: AuraTask = {
        id: generateTaskId(),
        type: 'create_project',
        params: { name, description: options.description },
        status: 'pending',
      };

      const result = await orchestrator.executeTask(task);

      if (result.success) {
        spinner.succeed(chalk.green(`Project "${name}" created!`));
        if (result.data) {
          console.log(chalk.cyan('\nProject URL:'), (result.data as { projectUrl?: string }).projectUrl || 'N/A');
        }
      } else {
        spinner.fail(chalk.red('Failed to create project'));
        result.logs?.forEach(log => console.log(chalk.red(`  ${log}`)));
      }
    } catch (error) {
      spinner.fail(chalk.red('Error: ' + (error as Error).message));
      process.exit(1);
    }
  });

// ============================================
// Prompt Command (AI iteration)
// ============================================
program
  .command('prompt <project-id> <prompt>')
  .description('Send an AI prompt to modify a project')
  .action(async (projectId: string, prompt: string) => {
    console.log(BANNER);
    const spinner = ora('Sending AI prompt...').start();

    try {
      const orchestrator = createOrchestrator({
        debug: program.opts().debug,
      });

      const task: AuraTask = {
        id: generateTaskId(),
        type: 'ai_prompt',
        params: { projectId, prompt },
        status: 'pending',
      };

      const result = await orchestrator.executeTask(task);

      if (result.success) {
        spinner.succeed(chalk.green('AI prompt processed!'));
        if (result.screenshots?.length) {
          console.log(chalk.cyan('\nScreenshot:'), result.screenshots[0]);
        }
      } else {
        spinner.fail(chalk.red('AI prompt failed'));
        result.logs?.forEach(log => console.log(chalk.red(`  ${log}`)));
      }
    } catch (error) {
      spinner.fail(chalk.red('Error: ' + (error as Error).message));
      process.exit(1);
    }
  });

// ============================================
// Template Command
// ============================================
program
  .command('template <project-id> <template-name>')
  .description('Apply a template to a project')
  .action(async (projectId: string, templateName: string) => {
    console.log(BANNER);
    const spinner = ora(`Applying template "${templateName}"...`).start();

    try {
      const orchestrator = createOrchestrator({
        debug: program.opts().debug,
      });

      const task: AuraTask = {
        id: generateTaskId(),
        type: 'apply_template',
        params: { projectId, template: templateName },
        status: 'pending',
      };

      const result = await orchestrator.executeTask(task);

      if (result.success) {
        spinner.succeed(chalk.green('Template applied!'));
      } else {
        spinner.fail(chalk.red('Failed to apply template'));
        result.logs?.forEach(log => console.log(chalk.red(`  ${log}`)));
      }
    } catch (error) {
      spinner.fail(chalk.red('Error: ' + (error as Error).message));
      process.exit(1);
    }
  });

// ============================================
// Execute Command (custom steps)
// ============================================
program
  .command('execute')
  .description('Execute custom automation steps')
  .option('-f, --file <path>', 'Load steps from file')
  .option('-s, --steps <steps...>', 'Steps to execute')
  .action(async (options) => {
    console.log(BANNER);

    let steps: string[] = options.steps || [];

    if (options.file && existsSync(options.file)) {
      const content = readFileSync(options.file, 'utf-8');
      steps = content.split('\n').filter(line => line.trim() && !line.startsWith('#'));
    }

    if (steps.length === 0) {
      // Interactive mode
      const answers = await inquirer.prompt([
        {
          type: 'editor',
          name: 'steps',
          message: 'Enter automation steps (one per line):',
        },
      ]);
      steps = (answers.steps as string).split('\n').filter(line => line.trim());
    }

    const spinner = ora('Executing custom steps...').start();

    try {
      const orchestrator = createOrchestrator({
        debug: program.opts().debug,
      });

      const task: AuraTask = {
        id: generateTaskId(),
        type: 'custom_action',
        params: { customSteps: steps },
        status: 'pending',
      };

      const result = await orchestrator.executeTask(task);

      if (result.success) {
        spinner.succeed(chalk.green('Custom execution completed!'));
        if (result.screenshots?.length) {
          console.log(chalk.cyan('\nScreenshots:'));
          result.screenshots.forEach(s => console.log(`  - ${s}`));
        }
      } else {
        spinner.fail(chalk.red('Execution failed'));
        result.logs?.forEach(log => console.log(chalk.red(`  ${log}`)));
      }
    } catch (error) {
      spinner.fail(chalk.red('Error: ' + (error as Error).message));
      process.exit(1);
    }
  });

// ============================================
// Health Command
// ============================================
program
  .command('health')
  .description('Check health of all backends')
  .action(async () => {
    console.log(BANNER);
    const spinner = ora('Checking backend health...').start();

    try {
      const orchestrator = createOrchestrator({
        debug: program.opts().debug,
      });

      const health = await orchestrator.refreshHealth();

      spinner.stop();
      console.log(chalk.cyan('\nBackend Health Status:\n'));

      const backends: Backend[] = ['api', 'lux', 'browser-use', 'steel', 'agent-browser'];

      backends.forEach(backend => {
        const status = health[backend];
        const icon = status ? chalk.green('✓') : chalk.red('✗');
        const statusText = status ? chalk.green('Available') : chalk.red('Unavailable');
        console.log(`  ${icon} ${backend.padEnd(15)} ${statusText}`);
      });

      console.log();
    } catch (error) {
      spinner.fail(chalk.red('Error: ' + (error as Error).message));
      process.exit(1);
    }
  });

// ============================================
// Intercept Command
// ============================================
program
  .command('intercept')
  .description('Start API interception to discover endpoints')
  .option('-p, --port <port>', 'Proxy port', '8080')
  .action(async (options) => {
    console.log(BANNER);
    console.log(chalk.cyan('Starting API Interceptor...\n'));

    console.log(chalk.yellow('Instructions:'));
    console.log('1. Configure your browser to use proxy: 127.0.0.1:' + options.port);
    console.log('2. Navigate to https://www.aura.build and perform actions');
    console.log('3. API calls will be captured and saved to ./api_endpoints.json');
    console.log('4. Press Ctrl+C to stop\n');

    const { spawn } = await import('child_process');
    const interceptor = spawn('python3', [
      join(process.cwd(), 'scripts', 'api_interceptor.py'),
      '--port', options.port,
    ], {
      stdio: 'inherit',
    });

    interceptor.on('error', (err) => {
      console.error(chalk.red('Failed to start interceptor:'), err.message);
      console.log(chalk.yellow('\nMake sure mitmproxy is installed: pip install mitmproxy'));
    });
  });

// ============================================
// Interactive Mode
// ============================================
program
  .command('interactive')
  .alias('i')
  .description('Start interactive mode')
  .action(async () => {
    console.log(BANNER);

    while (true) {
      const { action } = await inquirer.prompt([
        {
          type: 'list',
          name: 'action',
          message: 'What would you like to do?',
          choices: [
            { name: 'Generate a new design', value: 'generate' },
            { name: 'Export a project', value: 'export' },
            { name: 'Create a new project', value: 'create' },
            { name: 'Send AI prompt to project', value: 'prompt' },
            { name: 'Apply template', value: 'template' },
            { name: 'Execute custom steps', value: 'execute' },
            { name: 'Check backend health', value: 'health' },
            new inquirer.Separator(),
            { name: 'Exit', value: 'exit' },
          ],
        },
      ]);

      if (action === 'exit') {
        console.log(chalk.cyan('\nGoodbye! 👋\n'));
        break;
      }

      switch (action) {
        case 'generate': {
          const { prompt, template, style } = await inquirer.prompt([
            { type: 'input', name: 'prompt', message: 'Design prompt:' },
            { type: 'input', name: 'template', message: 'Template (optional):' },
            {
              type: 'list',
              name: 'style',
              message: 'Style:',
              choices: ['modern', 'minimal', 'bold', 'corporate', 'creative'],
            },
          ]);
          // Execute generate command
          await program.parseAsync(['node', 'aura', 'generate', prompt, '-s', style, ...(template ? ['-t', template] : [])]);
          break;
        }

        case 'export': {
          const { projectId, format } = await inquirer.prompt([
            { type: 'input', name: 'projectId', message: 'Project ID:' },
            { type: 'list', name: 'format', message: 'Format:', choices: ['html', 'figma', 'react', 'vue'] },
          ]);
          await program.parseAsync(['node', 'aura', 'export', projectId, format]);
          break;
        }

        case 'create': {
          const { name, description } = await inquirer.prompt([
            { type: 'input', name: 'name', message: 'Project name:' },
            { type: 'input', name: 'description', message: 'Description (optional):' },
          ]);
          await program.parseAsync(['node', 'aura', 'create', name, ...(description ? ['-d', description] : [])]);
          break;
        }

        case 'prompt': {
          const { projectId, prompt } = await inquirer.prompt([
            { type: 'input', name: 'projectId', message: 'Project ID:' },
            { type: 'input', name: 'prompt', message: 'AI prompt:' },
          ]);
          await program.parseAsync(['node', 'aura', 'prompt', projectId, prompt]);
          break;
        }

        case 'template': {
          const { projectId, templateName } = await inquirer.prompt([
            { type: 'input', name: 'projectId', message: 'Project ID:' },
            { type: 'input', name: 'templateName', message: 'Template name:' },
          ]);
          await program.parseAsync(['node', 'aura', 'template', projectId, templateName]);
          break;
        }

        case 'execute': {
          await program.parseAsync(['node', 'aura', 'execute']);
          break;
        }

        case 'health': {
          await program.parseAsync(['node', 'aura', 'health']);
          break;
        }
      }

      console.log(); // Empty line between actions
    }
  });

// Parse CLI arguments
program.parse();
