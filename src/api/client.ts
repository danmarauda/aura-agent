/**
 * Aura.build API Client
 * Direct API calls when available (reverse-engineered endpoints)
 */

import axios, { AxiosInstance, AxiosResponse } from 'axios';
import type { AgentConfig, AuraCredentials, AuraProject, AuraTask, TaskResult } from '../types/index.js';

const AURA_BASE_URL = 'https://www.aura.build/api';

/**
 * Discovered API Endpoints (populated via interception)
 * These are placeholders - run the interceptor to discover actual endpoints
 */
const DISCOVERED_ENDPOINTS = {
  auth: {
    login: '/auth/login',
    refresh: '/auth/refresh',
    logout: '/auth/logout',
  },
  projects: {
    list: '/projects',
    create: '/projects',
    get: '/projects/:id',
    update: '/projects/:id',
    delete: '/projects/:id',
    duplicate: '/projects/:id/duplicate',
  },
  generation: {
    design: '/generate/design',
    component: '/generate/component',
    fromImage: '/generate/from-image',
    iterate: '/generate/iterate',
  },
  export: {
    html: '/export/html',
    figma: '/export/figma',
    react: '/export/react',
  },
  assets: {
    upload: '/assets/upload',
    list: '/assets',
  },
  templates: {
    list: '/templates',
    apply: '/templates/apply',
  },
};

export class AuraAPIClient {
  private client: AxiosInstance;
  private credentials: AuraCredentials | null = null;
  private endpointsDiscovered: boolean = false;

  constructor(config: AgentConfig) {
    this.credentials = config.credentials || null;

    this.client = axios.create({
      baseURL: AURA_BASE_URL,
      timeout: config.timeoutMs,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'AuraAgent/1.0.0',
      },
    });

    // Add request interceptor for auth
    this.client.interceptors.request.use(async (reqConfig) => {
      if (this.credentials?.sessionToken) {
        reqConfig.headers.Authorization = `Bearer ${this.credentials.sessionToken}`;
      }
      return reqConfig;
    });

    // Add response interceptor for token refresh
    this.client.interceptors.response.use(
      (response) => response,
      async (error) => {
        if (error.response?.status === 401 && this.credentials?.refreshToken) {
          await this.refreshToken();
          return this.client.request(error.config);
        }
        throw error;
      }
    );
  }

  /**
   * Health check - verify API is accessible
   */
  async healthCheck(): Promise<boolean> {
    try {
      await this.client.get('/health');
      return true;
    } catch {
      // Try alternative endpoint
      try {
        const response = await this.client.get('/');
        return response.status < 500;
      } catch {
        return false;
      }
    }
  }

  /**
   * Authenticate with Aura.build
   */
  async login(email: string, password: string): Promise<AuraCredentials> {
    const response = await this.client.post<{
      token: string;
      refreshToken: string;
      expiresIn: number;
    }>(DISCOVERED_ENDPOINTS.auth.login, { email, password });

    this.credentials = {
      email,
      password,
      sessionToken: response.data.token,
      refreshToken: response.data.refreshToken,
      expiresAt: new Date(Date.now() + response.data.expiresIn * 1000),
    };

    return this.credentials;
  }

  /**
   * Refresh authentication token
   */
  private async refreshToken(): Promise<void> {
    if (!this.credentials?.refreshToken) {
      throw new Error('No refresh token available');
    }

    const response = await this.client.post<{
      token: string;
      expiresIn: number;
    }>(DISCOVERED_ENDPOINTS.auth.refresh, {
      refreshToken: this.credentials.refreshToken,
    });

    this.credentials.sessionToken = response.data.token;
    this.credentials.expiresAt = new Date(Date.now() + response.data.expiresIn * 1000);
  }

  /**
   * List all projects
   */
  async listProjects(): Promise<AuraProject[]> {
    const response = await this.client.get<{ projects: AuraProject[] }>(
      DISCOVERED_ENDPOINTS.projects.list
    );
    return response.data.projects;
  }

  /**
   * Get a specific project
   */
  async getProject(projectId: string): Promise<AuraProject> {
    const response = await this.client.get<AuraProject>(
      DISCOVERED_ENDPOINTS.projects.get.replace(':id', projectId)
    );
    return response.data;
  }

  /**
   * Create a new project
   */
  async createProject(name: string, description?: string): Promise<AuraProject> {
    const response = await this.client.post<AuraProject>(
      DISCOVERED_ENDPOINTS.projects.create,
      { name, description }
    );
    return response.data;
  }

  /**
   * Generate a design from prompt
   */
  async generateDesign(params: {
    prompt: string;
    template?: string;
    style?: string;
    projectId?: string;
  }): Promise<{ projectId: string; previewUrl: string }> {
    const response = await this.client.post<{
      projectId: string;
      previewUrl: string;
    }>(DISCOVERED_ENDPOINTS.generation.design, params);

    return response.data;
  }

  /**
   * Generate from image (image-to-HTML)
   */
  async generateFromImage(imageData: string | Buffer, prompt?: string): Promise<{
    projectId: string;
    html: string;
    css: string;
  }> {
    const formData = new FormData();

    if (typeof imageData === 'string') {
      // Assume base64 or URL
      formData.append('image', imageData);
    } else {
      // Convert Buffer to Uint8Array for Blob compatibility
      formData.append('image', new Blob([new Uint8Array(imageData)]));
    }

    if (prompt) {
      formData.append('prompt', prompt);
    }

    const response = await this.client.post(
      DISCOVERED_ENDPOINTS.generation.fromImage,
      formData,
      { headers: { 'Content-Type': 'multipart/form-data' } }
    );

    return response.data;
  }

  /**
   * Export project to HTML
   */
  async exportHTML(projectId: string, options?: {
    includeAssets?: boolean;
    minify?: boolean;
  }): Promise<{ downloadUrl: string; html: string; css: string; js?: string }> {
    const response = await this.client.post(
      DISCOVERED_ENDPOINTS.export.html,
      { projectId, ...options }
    );
    return response.data;
  }

  /**
   * Export project to Figma
   */
  async exportFigma(projectId: string): Promise<{ figmaUrl: string }> {
    const response = await this.client.post(
      DISCOVERED_ENDPOINTS.export.figma,
      { projectId }
    );
    return response.data;
  }

  /**
   * List available templates
   */
  async listTemplates(): Promise<Array<{
    id: string;
    name: string;
    category: string;
    thumbnail: string;
  }>> {
    const response = await this.client.get(DISCOVERED_ENDPOINTS.templates.list);
    return response.data.templates;
  }

  /**
   * Apply a template to a project
   */
  async applyTemplate(projectId: string, templateId: string): Promise<void> {
    await this.client.post(DISCOVERED_ENDPOINTS.templates.apply, {
      projectId,
      templateId,
    });
  }

  /**
   * Upload an asset
   */
  async uploadAsset(file: Buffer | string, filename: string): Promise<{
    assetId: string;
    url: string;
  }> {
    const formData = new FormData();

    if (typeof file === 'string') {
      formData.append('file', file);
    } else {
      // Convert Buffer to Uint8Array for Blob compatibility
      formData.append('file', new Blob([new Uint8Array(file)]), filename);
    }

    const response = await this.client.post(
      DISCOVERED_ENDPOINTS.assets.upload,
      formData,
      { headers: { 'Content-Type': 'multipart/form-data' } }
    );

    return response.data;
  }

  /**
   * Execute a generic task (router for all task types)
   */
  async executeTask(task: AuraTask): Promise<TaskResult> {
    if (!this.endpointsDiscovered) {
      console.warn('[API] Endpoints not yet discovered. Run interceptor first.');
    }

    try {
      let result: unknown;

      switch (task.type) {
        case 'create_project':
          result = await this.createProject(
            task.params.name as string,
            task.params.description as string
          );
          break;

        case 'generate_design':
          result = await this.generateDesign({
            prompt: task.params.prompt as string,
            template: task.params.template as string,
            projectId: task.params.projectId as string,
          });
          break;

        case 'export_html':
          result = await this.exportHTML(task.params.projectId as string);
          break;

        case 'export_figma':
          result = await this.exportFigma(task.params.projectId as string);
          break;

        case 'apply_template':
          await this.applyTemplate(
            task.params.projectId as string,
            task.params.template as string
          );
          result = { success: true };
          break;

        default:
          throw new Error(`Task type ${task.type} not supported via API. Use browser automation.`);
      }

      return {
        success: true,
        data: result,
      };
    } catch (error) {
      return {
        success: false,
        logs: [(error as Error).message],
      };
    }
  }

  /**
   * Set discovered endpoints from interceptor
   */
  setDiscoveredEndpoints(endpoints: typeof DISCOVERED_ENDPOINTS): void {
    Object.assign(DISCOVERED_ENDPOINTS, endpoints);
    this.endpointsDiscovered = true;
  }

  /**
   * Get current endpoint configuration
   */
  getEndpoints(): typeof DISCOVERED_ENDPOINTS {
    return DISCOVERED_ENDPOINTS;
  }

  /**
   * Make a raw API request (for testing/discovery)
   */
  async rawRequest<T = unknown>(
    method: string,
    path: string,
    data?: unknown
  ): Promise<AxiosResponse<T>> {
    return this.client.request<T>({
      method,
      url: path,
      data,
    });
  }
}
