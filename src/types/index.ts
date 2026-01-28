/**
 * Aura Agent - Type Definitions
 * Expert AI agent for Aura.build automation
 */

import { z } from 'zod';

// ============================================
// Core Types
// ============================================

export type Backend = 'api' | 'lux' | 'browser-use' | 'steel' | 'agent-browser';

export type TaskComplexity = 'simple' | 'moderate' | 'complex' | 'visual';

export interface AgentConfig {
  preferredBackend: Backend | 'auto';
  maxRetries: number;
  timeoutMs: number;
  headless: boolean;
  debug: boolean;
  credentials?: AuraCredentials;
}

export interface AuraCredentials {
  email: string;
  password: string;
  sessionToken?: string;
  refreshToken?: string;
  expiresAt?: Date;
}

// ============================================
// Aura.build API Types (Reverse Engineered)
// ============================================

export interface AuraProject {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  thumbnail?: string;
  pages: AuraPage[];
  settings: ProjectSettings;
}

export interface AuraPage {
  id: string;
  name: string;
  slug: string;
  components: AuraComponent[];
  styles: Record<string, unknown>;
  meta: PageMeta;
}

export interface AuraComponent {
  id: string;
  type: string;
  props: Record<string, unknown>;
  children?: AuraComponent[];
  styles: Record<string, unknown>;
  position: { x: number; y: number; width: number; height: number };
}

export interface ProjectSettings {
  theme: 'light' | 'dark' | 'system';
  fonts: string[];
  colors: Record<string, string>;
  breakpoints: Record<string, number>;
}

export interface PageMeta {
  title: string;
  description?: string;
  keywords?: string[];
  ogImage?: string;
}

// ============================================
// Task & Operation Types
// ============================================

export interface AuraTask {
  id: string;
  type: TaskType;
  params: TaskParams;
  status: TaskStatus;
  result?: TaskResult;
  error?: string;
  startedAt?: Date;
  completedAt?: Date;
  backend?: Backend;
}

export type TaskType =
  | 'generate_design'
  | 'edit_component'
  | 'add_component'
  | 'delete_component'
  | 'export_html'
  | 'export_figma'
  | 'create_project'
  | 'duplicate_project'
  | 'publish'
  | 'upload_asset'
  | 'apply_template'
  | 'ai_prompt'
  | 'custom_action';

export interface TaskParams {
  projectId?: string;
  pageId?: string;
  componentId?: string;
  prompt?: string;
  template?: string;
  exportFormat?: 'html' | 'figma' | 'react' | 'vue';
  file?: string;
  customSteps?: string[];
  [key: string]: unknown;
}

export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface TaskResult {
  success: boolean;
  data?: unknown;
  artifacts?: Artifact[];
  screenshots?: string[];
  logs?: string[];
}

export interface Artifact {
  type: 'html' | 'css' | 'js' | 'figma' | 'image' | 'json';
  filename: string;
  content?: string;
  url?: string;
  size?: number;
}

// ============================================
// API Interception Types
// ============================================

export interface InterceptedRequest {
  id: string;
  timestamp: Date;
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: unknown;
  response?: InterceptedResponse;
}

export interface InterceptedResponse {
  status: number;
  headers: Record<string, string>;
  body?: unknown;
  duration: number;
}

export interface APIEndpoint {
  path: string;
  method: string;
  description: string;
  params?: Record<string, ParamSchema>;
  response?: z.ZodType;
  authenticated: boolean;
}

export interface ParamSchema {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  required: boolean;
  description?: string;
  default?: unknown;
}

// ============================================
// Browser Automation Types
// ============================================

export interface BrowserState {
  url: string;
  title: string;
  elements: InteractiveElement[];
  screenshot?: string;
  cookies?: Record<string, string>;
}

export interface InteractiveElement {
  ref: string;
  type: string;
  text?: string;
  placeholder?: string;
  value?: string;
  bounds: { x: number; y: number; width: number; height: number };
  attributes: Record<string, string>;
}

export interface BrowserAction {
  type: 'click' | 'fill' | 'type' | 'select' | 'scroll' | 'wait' | 'screenshot' | 'navigate';
  target?: string; // Element ref or URL
  value?: string;
  options?: Record<string, unknown>;
}

// ============================================
// Orchestrator Types
// ============================================

export interface RoutingDecision {
  backend: Backend;
  reason: string;
  confidence: number;
  fallbacks: Backend[];
}

export interface ExecutionPlan {
  taskId: string;
  steps: ExecutionStep[];
  estimatedDuration: number;
  complexity: TaskComplexity;
  routing: RoutingDecision;
}

export interface ExecutionStep {
  id: string;
  action: string;
  params: Record<string, unknown>;
  dependsOn?: string[];
  timeout?: number;
  retryable: boolean;
}

// ============================================
// Event & Logging Types
// ============================================

export interface AgentEvent {
  type: 'task_start' | 'task_complete' | 'step_start' | 'step_complete' | 'error' | 'screenshot' | 'api_call';
  timestamp: Date;
  taskId?: string;
  stepId?: string;
  data?: unknown;
}

export type EventHandler = (event: AgentEvent) => void | Promise<void>;

// ============================================
// Zod Schemas for Validation
// ============================================

export const GenerateDesignSchema = z.object({
  prompt: z.string().min(1).max(2000),
  template: z.string().optional(),
  style: z.enum(['modern', 'minimal', 'bold', 'corporate', 'creative']).optional(),
  colorScheme: z.enum(['light', 'dark', 'auto']).optional(),
});

export const ExportOptionsSchema = z.object({
  format: z.enum(['html', 'figma', 'react', 'vue']),
  includeAssets: z.boolean().default(true),
  minify: z.boolean().default(false),
  outputPath: z.string().optional(),
});

export const TaskParamsSchema = z.object({
  projectId: z.string().optional(),
  pageId: z.string().optional(),
  componentId: z.string().optional(),
  prompt: z.string().optional(),
  template: z.string().optional(),
  exportFormat: z.enum(['html', 'figma', 'react', 'vue']).optional(),
  file: z.string().optional(),
  customSteps: z.array(z.string()).optional(),
}).passthrough();

export type GenerateDesignParams = z.infer<typeof GenerateDesignSchema>;
export type ExportOptions = z.infer<typeof ExportOptionsSchema>;
