# Nano Banana Pro - OpenRouter MCP Server

The premier image generation and editing suite for MCP. Powered by multimodal AI models via OpenRouter.

## Features

- **edit_or_create_image**: Create or edit an image using the Gemini Nano-Banana Pro model. High-fidelity results. Supports up to 12 context images. Saves to project folder by default.
- **batch_edit_or_create_images**: Perform multiple image creation or editing tasks in a single batch. Optimized for "nano banana Pro". Perfect for complex creative workflows.
- **Multimodal Support**: Provide up to 12 local images as context for editing or inspiration.
- **Flexible Output**: Specify a local path to save each generated image.

## Setup

### Prerequisites

- Node.js and npm installed.
- An [OpenRouter](https://openrouter.ai/) API key.

### Installation

1. Clone this repository:
   ```bash
   git clone https://github.com/BearThreat/nano-banana-openrouter-mcp
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
        "edit_or_create_image",
        "batch_edit_or_create_images"
      ]
    }
  }
}
```

## Usage

Once configured, your AI client will have access to the image generation tools.

### Single Image Generation

```json
{
  "prompt": "Generate a modern technical infographic about the Model Context Protocol.",
  "outputPath": "infographic.png"
}
```

### Batch Image Generation

```json
{
  "tasks": [
    { "prompt": "Create a blue circle", "outputPath": "circle.png" },
    { "prompt": "Create a red square", "outputPath": "square.png" },
    { "prompt": "Combine circle.png and square.png into a single composition", "imagePaths": ["circle.png", "square.png"], "outputPath": "combined.png" }
  ]
}
```

## License

MIT
