# Aura Agent 🚀

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/template/aura-agent?referralCode=alias)

Expert AI agent for full automation of [Aura.build](https://www.aura.build) - the AI website builder platform.

## 🚀 One-Click Deploy to Railway

Click the button above to deploy Aura Agent to Railway instantly. You'll need to configure the following environment variables after deployment:

| Variable | Required | Description |
|----------|----------|-------------|
| `AURA_EMAIL` | Yes | Your Aura.build email |
| `AURA_PASSWORD` | Yes | Your Aura.build password |
| `OAGI_API_KEY` | Recommended | Lux API key from [developer.agiopen.org](https://developer.agiopen.org) |
| `BROWSER_USE_API_KEY` | Optional | browser-use API key |
| `PREFERRED_BACKEND` | Optional | `auto`, `lux`, `browser-use`, `steel` (default: `auto`) |

## Features

- **Hybrid Backend System**: Intelligently routes tasks between API calls, Lux (OpenAGI), browser-use, Steel.dev, and local agent-browser
- **API Reverse Engineering**: Intercept and discover Aura.build API endpoints
- **Multi-Model Support**: Lux (83.6% benchmark), Claude, GPT-4.1, Gemini Pro
- **Full Automation**: Generate designs, export HTML/Figma, manage projects, apply templates
- **CLI & Library**: Use as CLI tool or import as npm package
- **REST API**: HTTP server for remote automation

## Quick Start

### Local Development

```bash
# Clone and install
git clone https://github.com/yourusername/aura-agent
cd aura-agent
bun install

# Configure
cp .env.example .env
# Edit .env with your credentials

# Run CLI
bun run dev generate "A modern SaaS landing page with dark mode"

# Run Server
bun run dev:server
```

### Docker

```bash
# Build
docker build -t aura-agent .

# Run
docker run -p 3000:3000 \
  -e AURA_EMAIL=your@email.com \
  -e AURA_PASSWORD=yourpassword \
  -e OAGI_API_KEY=your-key \
  aura-agent
```

### Railway Deployment

```bash
# Using Railway CLI
railway login
railway init
railway up

# Or use the deploy button above
```

## API Reference

When deployed as a server, Aura Agent exposes a REST API:

### Health Check
```bash
GET /health
```

### Generate Design
```bash
POST /generate
Content-Type: application/json

{
  "prompt": "A modern SaaS landing page",
  "template": "saas-landing",
  "style": "modern"
}
```

### Execute Any Task
```bash
POST /task
Content-Type: application/json

{
  "type": "generate_design",
  "params": {
    "prompt": "Tech startup homepage"
  }
}
```

### Export Project
```bash
POST /export/:projectId
Content-Type: application/json

{
  "format": "html"
}
```

### Task Types

| Type | Description |
|------|-------------|
| `generate_design` | Create design from AI prompt |
| `export_html` | Export project to HTML/CSS/JS |
| `export_figma` | Export project to Figma |
| `create_project` | Create new empty project |
| `edit_component` | Edit a component |
| `apply_template` | Apply template to project |
| `ai_prompt` | Send AI prompt to iterate |
| `publish` | Publish project |
| `custom_action` | Execute custom steps |

## CLI Usage

### Generate Design

```bash
# Basic generation
aura generate "A modern portfolio website for a photographer"

# With template and style
aura generate "E-commerce homepage" -t "saas-landing" -s modern

# Generate and auto-export
aura generate "Blog layout" --export html -o ./output
```

### Export Project

```bash
# Export to HTML
aura export proj_123abc html -o ./export

# Export to Figma
aura export proj_123abc figma
```

### Create Project

```bash
aura create "My New Project" -d "A project for testing"
```

### AI Prompt

```bash
aura prompt proj_123abc "Make the header more prominent and add a CTA button"
```

### Health Check

```bash
aura health
# Shows status of all backends:
# ✓ api             Available
# ✓ lux             Available
# ✗ browser-use     Unavailable
# ✓ steel           Available
# ✓ agent-browser   Available
```

### Interactive Mode

```bash
aura interactive
# or
aura i
```

## Backend Selection

The orchestrator automatically selects the best backend:

| Backend | Best For | Speed | Cost |
|---------|----------|-------|------|
| `api` | Simple CRUD operations | ⚡⚡⚡ | Free |
| `lux` | Complex visual tasks | ⚡⚡⚡ | $$ |
| `browser-use` | Auth-heavy workflows | ⚡⚡ | $$$ |
| `steel` | Self-hosted control | ⚡⚡ | Self-host |
| `agent-browser` | Local fallback | ⚡ | Free |

Override with:
```bash
aura generate "prompt" --backend lux
```

## Programmatic Usage

```typescript
import { createAgent, generateDesign, exportProject } from 'aura-agent';

// Quick functions
const result = await generateDesign("Modern landing page");
console.log(result.data);

// Full control
const agent = createAgent({
  preferredBackend: 'lux',
  debug: true,
});

agent.onEvent((event) => {
  console.log(`[${event.type}]`, event.data);
});

const task = await agent.executeTask({
  id: 'my-task',
  type: 'generate_design',
  params: { prompt: 'Tech startup homepage' },
  status: 'pending',
});
```

## Architecture

```
┌─────────────────────────────────────────────────┐
│              REST API / CLI                      │
├─────────────────────────────────────────────────┤
│                  Orchestrator                    │
│  (Routes tasks, manages fallbacks, events)      │
├──────────┬──────────┬──────────┬───────────────┤
│   API    │   Lux    │ browser- │    Steel      │
│  Client  │  Agent   │   use    │    Agent      │
└──────────┴──────────┴──────────┴───────────────┘
                     │
                     ▼
              ┌─────────────┐
              │  Aura.build │
              └─────────────┘
```

## Environment Variables

```env
# Required
AURA_EMAIL=your-email@example.com
AURA_PASSWORD=your-password

# Backend API keys (at least one recommended)
OAGI_API_KEY=your-lux-key           # developer.agiopen.org
BROWSER_USE_API_KEY=your-key        # browser-use.com
STEEL_BASE_URL=http://localhost:3000 # Self-hosted Steel

# Configuration
PREFERRED_BACKEND=auto              # auto|api|lux|browser-use|steel
PORT=3000                           # Server port
MODE=server                         # server|cli|intercept
DEBUG=false                         # Enable debug logging
HEADLESS=true                       # Run browsers headless
```

## API Reverse Engineering

Discover Aura.build's API:

```bash
# Start interceptor
aura intercept --port 8080

# Or with Python directly
python3 scripts/api_interceptor.py --port 8080

# Generate TypeScript client from captured endpoints
python3 scripts/api_interceptor.py --generate-client
```

## Development

```bash
# Development mode (CLI)
bun run dev

# Development mode (Server)
bun run dev:server

# Build
bun run build

# Test
bun run test

# Type check
bun run typecheck

# Docker build
bun run docker:build
```

## Troubleshooting

### Backend not available

```bash
# Check all backends
aura health

# Check specific backend
DEBUG=true aura generate "test" --backend lux
```

### Lux not working

```bash
# Verify installation
python3 -c "import oagi; print('OK')"

# Check API key
echo $OAGI_API_KEY
```

### Railway deployment issues

```bash
# Check logs
railway logs

# Restart service
railway restart

# Check environment variables
railway variables
```

## License

MIT

## Credits

- [Lux by OpenAGI](https://agiopen.org) - Computer use model (83.6% benchmark)
- [browser-use](https://browser-use.com) - Browser automation with MCP
- [Steel.dev](https://steel.dev) - Open-source browser API
- [Railway](https://railway.app) - Deployment platform
- [Aura.build](https://aura.build) - Target platform

---

**Built with 🤖 by Claude Code**
