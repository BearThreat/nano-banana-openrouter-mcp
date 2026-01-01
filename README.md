# Nano Banana OpenRouter MCP Server

An MCP server that provides image generation capabilities using multimodal models (like Gemini 3 Pro) via OpenRouter.

## Features

- **edit_or_create_image**: Create or edit images based on text prompts.
- **Multimodal Support**: Provide up to 12 local images as context for editing or inspiration.
- **Flexible Output**: Specify a local path to save the generated image.

## Setup

### Prerequisites

- Node.js and npm installed.
- An [OpenRouter](https://openrouter.ai/) API key.

### Installation

1. Clone this repository:
   ```bash
   git clone https://github.com/modelcontextprotocol/nano-banana-openrouter-mcp
   cd nano-banana-openrouter-mcp
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Build the server:
   ```bash
   npm run build
   ```

### Configuration

Add the server to your MCP settings file (e.g., `cline_mcp_settings.json` or `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "nano-banana": {
      "command": "node",
      "args": ["/path/to/nano-banana-openrouter-mcp/build/index.js"],
      "cwd": "/path/to/nano-banana-openrouter-mcp",
      "env": {
        "OPENROUTER_API_KEY": "your-openrouter-api-key",
        "NANO_BANANA_MODEL_ID": "google/gemini-3-pro-image-preview"
      },
      "disabled": false,
      "autoApprove": [
        "edit_or_create_image"
      ]
    }
  }
}
```

## Usage

Once configured, your AI client will have access to the `edit_or_create_image` tool.

### Prompt Example

"Generate a modern technical infographic about the Model Context Protocol."

### saving to a file

You can provide an `outputPath` to save the image directly to your project:

```json
{
  "prompt": "Create a blue circle",
  "outputPath": "circle.png"
}
```

## License

MIT
