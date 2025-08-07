# 🚀 Gemini CLI OpenAI Worker with Load Blancing

## Acknowledgements

This project is based on [gemini-cli-openai](https://github.com/GewoonJaap/gemini-cli-openai). Special thanks to the original author!

## Overview

This project has been enhanced with the following features:

- **Multi-Key Load Balancing**: Supports using multiple Gemini API keys via a round-robin load balancing mechanism.
- **Per-Client Project ID**: Allows individual Gemini API clients to be configured with their own Google Cloud Project IDs.
- **Fault Tolerance**: Implements an error tracking system for each client. Clients exceeding a configurable error threshold are temporarily marked as invalid and skipped during load balancing. Invalid clients are automatically re-enabled after a one-hour cooldown period.
- **Environment Variable Storage for API Keys**: To enhance security, API keys are stored as individual secrets in environment variables.

## 🛠️ Setup

### Prerequisites

1.  **Google Account** with access to Gemini
2.  **Cloudflare Account** with Workers enabled
3.  **Wrangler CLI** installed (`npm install -g wrangler`)

### Step 1: Get OAuth2 Credentials

You need OAuth2 credentials from a Google account that has accessed Gemini. The easiest way to get these is through the official Gemini CLI.

#### Using Gemini CLI

1.  **Install Gemini CLI**:
    ```bash
    npm install -g @google/gemini-cli
    ```

2.  **Start the Gemini CLI**:
    ```bash
    gemini
    ```
3.  **Authenticate with Google**:

    Select `● Login with Google`.

    A browser window will now open prompting you to login with your Google account.

4.  **Locate the credentials file**:

    **Windows:**
    ```
    C:\Users\USERNAME\.gemini\oauth_creds.json
    ```

    **macOS/Linux:**
    ```
    ~/.gemini/oauth_creds.json
    ```

5.  **Copy the credentials**:
    The file contains JSON in this format:
    ```json
    {
      "access_token": "ya29....",
      "refresh_token": "1//0...",
      "scope": "https://www.googleapis.com/auth/cloud-platform ...",
      "token_type": "Bearer",
      "id_token": "eyJ...",
      "expiry_date": 175...
    }
    ```

### Step 2: Environment Setup

The setup process differs for local development and remote deployment.

#### For Local Development (`npm run dev`)

1.  **Create a `.dev.vars` file**: This file will store your credentials for local testing.
2.  **Add your keys to `.dev.vars`**: Each key must be a single-line JSON string. The variable name must start with `GEMINI_API_KEY_`.
    ```bash
    # .dev.vars
    GEMINI_API_KEY_1='{"access_token": "...", "refresh_token": "...", "scope": "...", "token_type": "Bearer", "id_token": "...", "expiry_date": 1750927763467, "project_id": "your-project-id-1"}'
    GEMINI_API_KEY_2='{"access_token": "...", "refresh_token": "...", "scope": "...", "token_type": "Bearer", "id_token": "...", "expiry_date": 1750927763467, "project_id": "your-project-id-2"}'

    # Optional: Other variables
    OPENAI_API_KEY=sk-your-secret-api-key-here
    MAX_ERROR_COUNT=5
    ```

#### For Remote Deployment (`npm run deploy`)

1.  **Set each key as a secret**: For each credential, use the `wrangler secret put` command. The secret name must start with `GEMINI_API_KEY_`.
    - **Format the credential**: The JSON content needs to be passed as a single-line string. You can prepare this manually or use a tool like `jq`:
      ```bash
      cat oauth_creds.json | jq -c .
      ```
    - **Set the secret**:
      ```bash
      # Set the first key
      wrangler secret put GEMINI_API_KEY_1
      # Paste the single-line JSON credential when prompted

      # Set the second key
      wrangler secret put GEMINI_API_KEY_2
      # Paste the second single-line JSON credential when prompted

      # ... and so on for all your keys
      ```
2.  **Set other optional secrets**:
    ```bash
    wrangler secret put OPENAI_API_KEY  # Optional, only if you want authentication
    wrangler secret put GEMINI_PROJECT_ID # Optional
    wrangler secret put MAX_ERROR_COUNT # Optional
    ```

### Step 3: Deploy

```bash
# Install dependencies
npm install

# Deploy to Cloudflare Workers
npm run deploy

# Or run locally for development
npm run dev
