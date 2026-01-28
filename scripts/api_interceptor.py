#!/usr/bin/env python3
"""
Aura.build API Interceptor
Captures and analyzes API calls to reverse-engineer the Aura.build API

Usage:
  python3 api_interceptor.py [--port 8080] [--output api_endpoints.json]

Requirements:
  pip install mitmproxy
"""

import argparse
import json
import os
import sys
from datetime import datetime
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

try:
    from mitmproxy import http, ctx
    from mitmproxy.tools.main import mitmdump
except ImportError:
    print("Error: mitmproxy not installed. Run: pip install mitmproxy")
    sys.exit(1)

# Storage for captured endpoints
captured_endpoints: dict[str, Any] = {
    "captured_at": datetime.now().isoformat(),
    "base_url": "https://www.aura.build",
    "endpoints": {},
    "auth": {
        "method": None,
        "token_header": None,
        "sample_token": None,
    },
    "requests": [],
}

# Target domains
TARGET_DOMAINS = [
    "aura.build",
    "api.aura.build",
]

# Output file
OUTPUT_FILE = "api_endpoints.json"


def is_target_request(url: str) -> bool:
    """Check if request is to aura.build domain"""
    parsed = urlparse(url)
    return any(domain in parsed.netloc for domain in TARGET_DOMAINS)


def extract_endpoint_info(flow: http.HTTPFlow) -> dict[str, Any]:
    """Extract relevant information from HTTP flow"""
    request = flow.request
    response = flow.response

    # Parse URL
    parsed = urlparse(request.pretty_url)
    path = parsed.path

    # Extract request body
    request_body = None
    if request.content:
        try:
            request_body = json.loads(request.content.decode("utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError):
            request_body = request.content.decode("utf-8", errors="replace")

    # Extract response body
    response_body = None
    if response and response.content:
        try:
            response_body = json.loads(response.content.decode("utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError):
            response_body = response.content.decode("utf-8", errors="replace")[:500]

    # Extract authentication info
    auth_header = dict(request.headers).get("authorization", "")
    if auth_header:
        captured_endpoints["auth"]["method"] = "Bearer" if "Bearer" in auth_header else "Unknown"
        captured_endpoints["auth"]["token_header"] = "Authorization"
        if "Bearer" in auth_header:
            captured_endpoints["auth"]["sample_token"] = auth_header.split(" ")[-1][:20] + "..."

    return {
        "method": request.method,
        "path": path,
        "full_url": request.pretty_url,
        "query_params": dict(request.query or {}),
        "request_headers": {
            k: v for k, v in dict(request.headers).items()
            if k.lower() in ["content-type", "authorization", "x-api-key", "accept"]
        },
        "request_body": request_body,
        "response_status": response.status_code if response else None,
        "response_headers": {
            k: v for k, v in dict(response.headers).items()
            if k.lower() in ["content-type", "set-cookie"]
        } if response else None,
        "response_body_preview": (
            str(response_body)[:500] if response_body else None
        ),
        "timestamp": datetime.now().isoformat(),
    }


def categorize_endpoint(path: str, method: str) -> str:
    """Categorize endpoint based on path pattern"""
    path_lower = path.lower()

    if "/auth" in path_lower or "/login" in path_lower or "/token" in path_lower:
        return "auth"
    elif "/project" in path_lower:
        return "projects"
    elif "/generate" in path_lower or "/ai" in path_lower:
        return "generation"
    elif "/export" in path_lower or "/download" in path_lower:
        return "export"
    elif "/asset" in path_lower or "/upload" in path_lower or "/image" in path_lower:
        return "assets"
    elif "/template" in path_lower:
        return "templates"
    elif "/component" in path_lower:
        return "components"
    elif "/user" in path_lower or "/account" in path_lower:
        return "users"
    else:
        return "other"


class AuraInterceptor:
    """mitmproxy addon for capturing Aura.build API calls"""

    def __init__(self, output_file: str):
        self.output_file = output_file
        self.request_count = 0

    def response(self, flow: http.HTTPFlow) -> None:
        """Called when a response is received"""
        if not is_target_request(flow.request.pretty_url):
            return

        # Skip static assets
        if any(ext in flow.request.path for ext in [".js", ".css", ".png", ".jpg", ".svg", ".woff"]):
            return

        self.request_count += 1
        endpoint_info = extract_endpoint_info(flow)

        # Categorize and store
        category = categorize_endpoint(endpoint_info["path"], endpoint_info["method"])
        endpoint_key = f"{endpoint_info['method']} {endpoint_info['path']}"

        if category not in captured_endpoints["endpoints"]:
            captured_endpoints["endpoints"][category] = {}

        # Store unique endpoint with latest data
        captured_endpoints["endpoints"][category][endpoint_key] = {
            "method": endpoint_info["method"],
            "path": endpoint_info["path"],
            "query_params": endpoint_info["query_params"],
            "request_body_example": endpoint_info["request_body"],
            "response_status": endpoint_info["response_status"],
            "response_body_example": endpoint_info["response_body_preview"],
            "last_seen": endpoint_info["timestamp"],
        }

        # Store raw request for reference
        captured_endpoints["requests"].append(endpoint_info)

        # Save to file
        self.save()

        # Log
        status = endpoint_info["response_status"] or "?"
        ctx.log.info(f"[{self.request_count}] {endpoint_info['method']} {endpoint_info['path']} -> {status}")

    def save(self) -> None:
        """Save captured data to file"""
        with open(self.output_file, "w") as f:
            json.dump(captured_endpoints, f, indent=2, default=str)


def generate_typescript_client(endpoints_file: str) -> str:
    """Generate TypeScript client code from captured endpoints"""
    with open(endpoints_file, "r") as f:
        data = json.load(f)

    ts_code = '''/**
 * Auto-generated Aura.build API Client
 * Generated from intercepted API calls
 */

import axios, { AxiosInstance } from 'axios';

const BASE_URL = '${BASE_URL}';

export class AuraClient {
  private client: AxiosInstance;

  constructor(token?: string) {
    this.client = axios.create({
      baseURL: BASE_URL,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      },
    });
  }

'''

    # Generate methods for each endpoint
    for category, endpoints in data.get("endpoints", {}).items():
        ts_code += f"  // {category.upper()}\n"

        for endpoint_key, endpoint in endpoints.items():
            method = endpoint["method"].lower()
            path = endpoint["path"]
            func_name = path.replace("/", "_").replace("-", "_").strip("_")
            func_name = f"{method}_{func_name}"

            ts_code += f"""
  async {func_name}(params?: Record<string, unknown>): Promise<unknown> {{
    return this.client.{method}('{path}', params).then(r => r.data);
  }}
"""

    ts_code += "}\n"

    return ts_code


def main():
    parser = argparse.ArgumentParser(description="Aura.build API Interceptor")
    parser.add_argument("--port", type=int, default=8080, help="Proxy port")
    parser.add_argument("--output", default="api_endpoints.json", help="Output file")
    parser.add_argument("--generate-client", action="store_true", help="Generate TypeScript client")
    args = parser.parse_args()

    global OUTPUT_FILE
    OUTPUT_FILE = args.output

    if args.generate_client:
        if Path(args.output).exists():
            ts_client = generate_typescript_client(args.output)
            ts_output = args.output.replace(".json", "_client.ts")
            with open(ts_output, "w") as f:
                f.write(ts_client)
            print(f"Generated TypeScript client: {ts_output}")
        else:
            print(f"Error: {args.output} not found. Run interception first.")
        return

    print(f"""
╔══════════════════════════════════════════════════════════════╗
║              Aura.build API Interceptor                       ║
╠══════════════════════════════════════════════════════════════╣
║  Proxy running on: http://127.0.0.1:{args.port:<5}                    ║
║  Output file: {args.output:<45} ║
║                                                              ║
║  Configure your browser proxy to 127.0.0.1:{args.port:<5}             ║
║  Then navigate to https://www.aura.build                      ║
║                                                              ║
║  Press Ctrl+C to stop and save captured endpoints             ║
╚══════════════════════════════════════════════════════════════╝
""")

    # Create addon
    addon = AuraInterceptor(args.output)

    # Start mitmproxy
    sys.argv = [
        "mitmdump",
        "-p", str(args.port),
        "--set", "block_global=false",
        "--set", "ssl_insecure=true",
    ]

    # Run with addon
    from mitmproxy.tools.main import mitmdump as run_mitmdump
    run_mitmdump([addon])


if __name__ == "__main__":
    main()
