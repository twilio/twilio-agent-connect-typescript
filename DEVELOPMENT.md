# Development Guide

This document explains how to develop the Twilio Agent Connect TypeScript SDK.

## Project Structure

```
twilio-agent-connect-typescript/
├── packages/                 # Source code
│   ├── core/                # Orchestrator, channels, API clients, config, types
│   ├── tools/               # Tool system (defineTool, built-in tools)
│   └── server/              # TACServer (Fastify, webhooks, WebSocket)
├── src/
│   └── index.ts             # Root re-export (single entry point)
├── getting_started/         # Getting started guide and examples
│   ├── README.md            # Step-by-step tutorial
│   └── examples/            # Example apps (OpenAI, chat, WhatsApp, etc.)
├── tests/                   # Vitest test suite
└── package.json             # Package root (published as twilio-agent-connect)
```

## Local Development Workflow

### 1. Initial Setup

```bash
# Clone and install
git clone https://github.com/twilio/twilio-agent-connect-typescript.git
cd twilio-agent-connect-typescript
npm install
```

### 2. Making Changes to Framework

```bash
# Make your changes in packages/
vim packages/core/src/lib/tac.ts

# Build the packages
npm run build

# Test with examples (they automatically use your changes)
npm run example:getting-started
```

### 3. Dependency Management

Examples reference the local SDK using a `file:` dependency:

```json
{
  "dependencies": {
    "twilio-agent-connect": "file:../../.."
  }
}
```

This means changes are reflected immediately after rebuilding — no need to publish during development.

### 4. Development Commands

```bash
# Install dependencies for all packages
npm install

# Build all packages
npm run build

# Clean all build outputs
npm run clean

# Watch mode (rebuilds on changes)
npm run dev

# Type checking
npm run typecheck

# Linting
npm run lint
npm run lint:fix

# Formatting
npm run format
npm run format:check

# Testing
npm test
npm run test:coverage

# Run examples
npm run example:getting-started  # OpenAI example (SMS + Voice)
```

## API Reference Documentation

The API reference site is generated from the TSDoc comments in the source and
published to GitHub Pages on each release. [TypeDoc](https://typedoc.org)
extracts the reference into Markdown, and [MkDocs](https://www.mkdocs.org) with
the Material theme renders it into the published site (versioned via
[mike](https://github.com/jimporter/mike)).

TSDoc comments are treated as published documentation — keep them accurate and
tag internal-only public members with `@internal` so they are excluded from the
reference.

Building and serving the docs locally requires Python (3.10+ recommended) in
addition to Node:

```bash
# One-time: install the Python doc tooling (ideally in a virtualenv)
pip install -r requirements-docs.txt

# Generate the API reference Markdown into docs/api/ (TypeDoc)
npm run docs:api

# Build the full static site into site/
npm run docs:build

# Serve locally with live reload at http://127.0.0.1:8000
npm run docs:serve

# List the versions published to the gh-pages branch
npm run docs:versions
```

The generated `docs/api/` and the `site/` build output are gitignored — only the
docs shell (`mkdocs.yml`, `docs/index.md`, `docs/.pages`, `docs/assets/`) is
committed.

## Common Issues

### "Cannot find module 'twilio-agent-connect'"

**Solution**: Build the package first

```bash
npm run build
```

### "Type errors in examples"

**Solution**: Run type checking from the root

```bash
npm run typecheck
```

### "Changes not reflected in examples"

**Solution**: Rebuild and restart

```bash
npm run build
# Restart your example
```

## Best Practices

1. **Always build before testing examples**
2. **Keep examples simple and focused**
3. **Document environment variables in .env.example**
4. **Run linting and formatting before commits**
5. **Write tests for new features**

## Publishing

The SDK is published to npm as `twilio-agent-connect` via CI when a GitHub Release is created.

1. Bump the version with `npm version <major|minor|patch>` and open a PR
2. After merging, go to [Releases](https://github.com/twilio/twilio-agent-connect-typescript/releases/new)
3. Create a new tag matching the version (e.g. `v1.2.3`)
4. Click "Generate release notes" for a changelog
5. Publish the release
6. The workflow runs tests (Node 22/24), then waits for `npm` environment approval
7. After approval, the package is published to npm with provenance
