# Twilio Setup Wizard

A web-based setup wizard to help you create the Memory Store and Conversation Configuration required for Twilio Agent Connect.

> **Note**: This wizard is optional. You can also create a Memory Store and Conversation Configuration manually through the [Twilio Console](https://1console.twilio.com) if you prefer.

## Overview

Before using TAC, you need to set up two Twilio services:

1. **Memory Store** - Stores conversation memories, observations, and user profiles
2. **Conversation Configuration** - Manages conversations and participants

This wizard automates the creation of these services using your Twilio credentials.

## Prerequisites

You'll need the following from your [Twilio Console](https://1console.twilio.com):

- **Account SID** - Found on your Console dashboard (starts with `AC`)
- **Auth Token** - Found on your Console dashboard
- **API Key SID** - Create at Console > Account > API keys & tokens (starts with `SK`)
- **API Secret** - Shown only once when creating the API key

## Usage

```bash
# From the repository root
npm run setup
```

Then open http://localhost:8080 in your browser.

## What It Does

1. Validates your Twilio credentials
2. Creates a Memory Store
3. Creates a test Profile with your contact info (for verifying the setup works)
4. Creates a Conversation Configuration
5. Returns the service IDs to add to your `.env` file

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `TAC_SETUP_PORT` | `8080` | Port to listen on |
| `TAC_SETUP_HOST` | `0.0.0.0` | Bind address. Set to `127.0.0.1` to keep the credential form reachable only from this machine. |
| `TWILIO_LOG_LEVEL` | `info` | Log level |

## Implementation notes

`templates/index.html` is a verbatim copy of the same file in the
[Python SDK](https://github.com/twilio/twilio-agent-connect-python/tree/main/getting_started/twilio_setup).
It is backend-agnostic — all of the wizard's step sequencing, polling and retry logic
lives in that page, and it only calls the `/api/*` endpoints this server exposes. Keep the
two files identical; update this one by copying from the Python repo so `diff` stays empty.

The server deliberately does not use the SDK's `BaseClient`. That class is built from a
validated `TACConfig` with one fixed base URL and retries through axios-retry, whereas the
wizard has only the API key and secret you just typed into the browser, polls an arbitrary
absolute operation URL, and needs to branch on status codes rather than catch. Plain axios
matches the Python wizard's single-attempt calls exactly.
