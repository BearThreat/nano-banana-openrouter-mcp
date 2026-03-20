# Nano Banana - OpenRouter MCP Server

Fast, cost-efficient image generation and editing for MCP. Powered by Nano Banana 2 via OpenRouter.

## Features

- **edit_or_create_image**: Create or edit an image using the Nano Banana 2 model on OpenRouter. Fast, cost-efficient results. Supports up to 12 context images. Saves to project folder by default.
- **batch_edit_or_create_images**: Perform multiple image creation or editing tasks in a single batch. Optimized for Nano Banana 2. Perfect for fast, cost-efficient creative workflows.
- **health_check**: Validate `.env` loading, API key presence, selected model, and optionally run a live OpenRouter connectivity test.
- **start_annotation**: Open a visual annotation UI to draw on images and add notes before editing.
- **get_annotation_results**: Retrieve completed annotation results after the user clicks Finish.
- **complete_annotation_edit**: One-step helper that retrieves completed annotations and immediately applies the requested edit.
- **Multimodal Support**: Provide up to 12 local images as context for editing or inspiration.
- **Flexible Output**: Specify a local path to save each generated image.
- **Model Override**: Still supports `NANO_BANANA_MODEL_ID` if you want to point the server at a different OpenRouter image model.

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
        "NANO_BANANA_MODEL_ID": "google/gemini-3.1-flash-image-preview"
      },
      "disabled": false,
      "autoApprove": [
        "edit_or_create_image",
        "batch_edit_or_create_images",
        "start_annotation",
        "get_annotation_results",
        "complete_annotation_edit",
        "health_check"
      ]
    }
  }
}
```

## Usage

Once configured, your AI client will have access to the image generation tools.

By default, this server now targets **Nano Banana 2** on OpenRouter:

`google/gemini-3.1-flash-image-preview`

This was chosen for better speed/cost tradeoffs. You can still override it with `NANO_BANANA_MODEL_ID` if needed.

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

### Image Annotation

Use the `start_annotation` tool to open a browser-based annotation UI where you can draw freehand markings on images and add notes:

```json
{
  "imagePaths": ["photo1.jpg", "photo2.png", "design.webp"]
}
```

This opens a visual editor where you can:
- **Draw** on each image with freehand markings (red, yellow, green, blue, white colors)
- **Navigate** between images with Back/Next buttons
- **Add notes** under each image (pre-filled with `Notes about {filename}:`)
- **Combine** all prompts into a single combined prompt when finished

The tool returns:
- `annotatedImagePaths`: Paths to the annotated images (saved in `.nano-banana-temp/` folder)
- `combinedPrompt`: All individual prompts concatenated together
- `originalImagePaths`: The original input paths

This is particularly useful when you want to point out specific areas in images that need editing, which the AI can then use with `edit_or_create_image`.

### Annotation Shortcut Flow

If the user has already completed the annotation step in the browser, you can call `complete_annotation_edit` to retrieve the saved annotation results and immediately apply the edit in one tool call.

### Health Check

Use `health_check` to verify local configuration and optionally test OpenRouter connectivity:

```json
{
  "testApi": true
}
```

## License

MIT
