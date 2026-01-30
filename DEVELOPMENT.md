# Development Guide

This document explains how to develop the Twilio Agent Connect and work with the monorepo structure.

## Monorepo Structure

```
twilio-agent-connect-typescript/
├── packages/                 # Framework packages
│   ├── types/               # @twilio/tac-types
│   ├── core/                # @twilio/tac-core
│   ├── tools/               # @twilio/tac-tools
│   └── server/              # @twilio/tac-server
├── examples/                # Example applications
│   ├── simple-sms-bot/
│   └── multi-channel-demo/
└── package.json             # Workspace root
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
npm run example:sms
```

### 3. Dependency Management

#### Workspace Dependencies (`*`)

Examples use `*` for TAC dependencies:

```json
{
  "dependencies": {
    "@twilio/tac-core": "*",
    "@twilio/tac-server": "*"
  }
}
```

This means:
- ✅ Examples always use your local workspace packages
- ✅ No need to publish during development
- ✅ Changes are reflected immediately after rebuild
- ✅ Version bumps don't break examples

#### External Dependencies

External packages use normal semver:

```json
{
  "dependencies": {
    "openai": "^4.24.0",
    "dotenv": "^16.3.0"
  }
}
```

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
npm run example:sms       # Simple SMS bot
npm run example:multi     # Multi-channel demo
```

### 5. Adding New Packages

1. **Create package directory**:
   ```bash
   mkdir packages/my-new-package
   cd packages/my-new-package
   ```

2. **Create package.json**:
   ```json
   {
     "name": "@twilio/tac-my-new-package",
     "version": "1.0.0",
     "main": "dist/index.js",
     "types": "dist/index.d.ts",
     "scripts": {
       "build": "rimraf dist && tsc",
       "clean": "rimraf dist",
       "dev": "tsc --watch"
     },
     "dependencies": {
       "@twilio/tac-types": "*"
     }
   }
   ```

3. **Create tsconfig.json**:
   ```json
   {
     "extends": "../../tsconfig.json",
     "compilerOptions": {
       "outDir": "./dist",
       "rootDir": "./src"
     },
     "references": [
       { "path": "../types" }
     ]
   }
   ```

4. **Run from root to install**:
   ```bash
   cd ../../
   npm install
   ```

### 6. Adding New Examples

1. **Create example directory**:
   ```bash
   mkdir examples/my-example
   cd examples/my-example
   ```

2. **Create package.json with local dependencies**:
   ```json
   {
     "name": "my-example",
     "private": true,
     "type": "module",
     "dependencies": {
       "@twilio/tac-core": "*",
       "@twilio/tac-server": "*"
     }
   }
   ```

3. **Example automatically available**:
   ```bash
   cd ../../
   npm install
   npm run build
   cd examples/my-example
   npm run dev
   ```

## How Workspace Dependencies Work

### The `*` Pattern

When you specify `"@twilio/tac-core": "*"` in an example:

1. **npm install** looks for `@twilio/tac-core` in the workspace
2. **Finds it** in `packages/core/`
3. **Symlinks** the built package to `node_modules/@twilio/tac-core`
4. **Your example** imports from the local, built package

### Development Flow

```bash
# 1. Make changes to packages/core/src/lib/tac.ts
vim packages/core/src/lib/tac.ts

# 2. Build packages (updates dist/)
npm run build

# 3. Examples automatically use new build
npm run example:sms  # Uses your changes!
```

### Why This Works

- **Symlinks**: npm creates symlinks from `examples/*/node_modules/@twilio/*` → `packages/*/`
- **Built Code**: Examples import from `dist/` (built JavaScript)
- **Type Safety**: TypeScript references ensure proper type checking
- **Hot Reload**: Rebuild packages → restart examples → see changes

## TypeScript Project References

We use TypeScript project references for:
- **Fast builds**: Only rebuild changed packages
- **Type checking**: Cross-package type safety
- **IDE support**: Go-to-definition across packages

### Reference Structure

```
examples/simple-sms-bot → packages/server → packages/core → packages/types
                                        ↘ packages/tools ↗
```

## Common Issues

### "Cannot find module '@twilio/tac-core'"

**Solution**: Build packages first
```bash
npm run build
```

### "Type errors in examples"

**Solution**: Ensure TypeScript references are correct
```bash
npm run typecheck
```

### "Changes not reflected in examples"

**Solution**: Rebuild and restart
```bash
npm run build
# Restart your example
```

### "Examples won't start"

**Solution**: Check workspace setup
```bash
# From root
npm install
npm run build

# Check symlinks exist
ls -la examples/simple-sms-bot/node_modules/@twilio/
```

## Best Practices

1. **Always build before testing examples**
2. **Use TypeScript references for cross-package dependencies**
3. **Keep examples simple and focused**
4. **Document environment variables in .env.example**
5. **Use `*` for workspace dependencies, semver for external**
6. **Run linting and formatting before commits**
7. **Write tests for new features**

## Publishing (Future)

When ready to publish:

1. **Update versions** in package.json files
2. **Build all packages**: `npm run build`
3. **Run tests**: `npm test`
4. **Publish**: `npm publish --workspaces`

Examples will continue to work with published versions by changing `*` to actual version numbers.
