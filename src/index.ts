#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import axios from 'axios';
import fs from 'fs/promises';
import path from 'path';

const API_KEY = process.env.OPENROUTER_API_KEY;
const MODEL_ID = process.env.NANO_BANANA_MODEL_ID || 'google/gemini-3-pro-image-preview';

if (!API_KEY) {
  throw new Error('OPENROUTER_API_KEY environment variable is required');
}

class NanoBananaServer {
  private server: Server;
  private axiosInstance;

  constructor() {
    this.server = new Server(
      {
        name: 'nano-banana-pro',
        version: '0.1.0',
        description: 'The premier image generation and editing suite. This is the official Nano Banana Pro implementation, optimized for maximum multimodal creative fidelity.'
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.axiosInstance = axios.create({
      baseURL: 'https://openrouter.ai/api/v1',
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'HTTP-Referer': 'https://github.com/modelcontextprotocol/nano-banana',
        'X-Title': 'Nano Banana Pro MCP',
        'Content-Type': 'application/json',
      },
    });

    this.setupHandlers();
    
    this.server.onerror = (error) => console.error('[MCP Error]', error);
    process.on('SIGINT', async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  private setupHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'edit_or_create_image',
          description: 'Create or edit an image using the Gemini Nano-Banana Pro model. High-fidelity results. Supports up to 12 context images. Saves to project folder by default.',
          inputSchema: {
            type: 'object',
            properties: {
              prompt: {
                type: 'string',
                description: 'The instruction for image creation or editing. Reference existing images by their filenames.',
              },
              imagePaths: {
                type: 'array',
                items: { type: 'string' },
                description: 'Local paths to images to be used as context (max 12).',
                maxItems: 12,
              },
              outputPath: {
                type: 'string',
                description: 'The local path where the generated image should be saved (e.g., "output.png").',
              }
            },
            required: ['prompt'],
          },
        },
        {
          name: 'batch_edit_or_create_images',
          description: 'Perform multiple image creation or editing tasks in a single batch. Optimized for "nano banana Pro". Perfect for complex creative workflows.',
          inputSchema: {
            type: 'object',
            properties: {
              tasks: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    prompt: { type: 'string', description: 'Prompt for this specific task.' },
                    imagePaths: { type: 'array', items: { type: 'string' }, description: 'Context images for this specific task.' },
                    outputPath: { type: 'string', description: 'Where to save the result of this specific task.' }
                  },
                  required: ['prompt']
                },
                minItems: 1
              }
            },
            required: ['tasks']
          }
        }
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      if (request.params.name === 'edit_or_create_image') {
        return this.handleImageTask(request.params.arguments as any);
      } else if (request.params.name === 'batch_edit_or_create_images') {
        const { tasks } = request.params.arguments as { tasks: any[] };
        const results = [];
        for (const task of tasks) {
          try {
            const result: any = await this.handleImageTask(task);
            results.push({ task: task.prompt, status: 'success', imageSaved: !!task.outputPath, output: result.content?.[0]?.text });
          } catch (err: any) {
            results.push({ task: task.prompt, status: 'failed', error: err.message });
          }
        }
        return {
          content: [{ type: 'text', text: JSON.stringify(results, null, 2) }]
        };
      } else {
        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${request.params.name}`);
      }
    });
  }

  private async handleImageTask(args: { prompt: string; imagePaths?: string[]; outputPath?: string }) {
    const { prompt, imagePaths = [], outputPath } = args;

    try {
      const messages: any[] = [];
      const content: any[] = [{ type: 'text', text: prompt }];

      for (const imagePath of imagePaths) {
        try {
          const absolutePath = path.isAbsolute(imagePath) ? imagePath : path.resolve(process.cwd(), imagePath);
          const data = await fs.readFile(absolutePath);
          const base64Image = data.toString('base64');
          const mimeType = this.getMimeType(imagePath);
          
          content.push({
            type: 'image_url',
            image_url: {
              url: `data:${mimeType};base64,${base64Image}`,
            },
          });
        } catch (err: any) {
          return {
            content: [{ type: 'text', text: `Error reading image ${imagePath}: ${err.message}` }],
            isError: true,
          };
        }
      }

      messages.push({ role: 'user', content });

      console.error(`[Nano Banana Pro] Sending request to OpenRouter with model: ${MODEL_ID}`);
      console.error(`[Nano Banana Pro] Full request payload: ${JSON.stringify({ model: MODEL_ID, messages: messages.map(m => ({ ...m, content: m.content.map((c: any) => c.type === 'image_url' ? { type: 'image_url', image_url: { url: 'DATA_REDACTED' } } : c) })) })}`);

      const response = await this.axiosInstance.post('/chat/completions', {
        model: MODEL_ID,
        messages,
      });

      console.error(`[Nano Banana Pro] Received response from OpenRouter: ${response.status}`);
      console.error(`[Nano Banana Pro] Raw response data (redacted): ${JSON.stringify(response.data, (key, value) => {
        if (key === 'data' && typeof value === 'string' && value.length > 100) return 'DATA_REDACTED';
        if (key === 'url' && typeof value === 'string' && value.startsWith('data:')) return 'DATA_REDACTED';
        return value;
      })}`);
      
      const choice = response.data.choices?.[0];
      const resultText = choice?.message?.content || '';
      
      // Final results to return to MCP
      const mcpContent: any[] = [];
      if (resultText && typeof resultText === 'string') {
        mcpContent.push({ type: 'text', text: resultText });
      }

      // 1. Handle choice.message.images (Used by Gemini 3 Pro Image Preview)
      if (choice?.message?.images && Array.isArray(choice.message.images)) {
        for (const imgEntry of choice.message.images) {
          if (imgEntry.type === 'image_url' && imgEntry.image_url?.url) {
            const url = imgEntry.image_url.url;
            if (url.startsWith('data:')) {
              const match = url.match(/^data:([^;]+);base64,(.+)$/);
              if (match) {
                mcpContent.push({ type: 'image', data: match[2], mimeType: match[1] });
              }
            }
          }
        }
      }

      // 2. Handle choice.message.content as an array
      if (Array.isArray(choice?.message?.content)) {
        for (const block of choice.message.content) {
          if (block.type === 'image_url' && block.image_url?.url) {
            const url = block.image_url.url;
            if (url.startsWith('data:')) {
              const match = url.match(/^data:([^;]+);base64,(.+)$/);
              if (match) {
                mcpContent.push({ type: 'image', data: match[2], mimeType: match[1] });
              }
            }
          }
        }
      }

      if (mcpContent.length === 0) {
        return {
          content: [{ type: 'text', text: "Model returned a successful response but no text or images were found." }],
        };
      }

      // If outputPath is provided, save the FIRST image found to that path
      if (outputPath) {
        const firstImage = mcpContent.find(c => c.type === 'image');
        if (firstImage) {
          try {
            const absoluteOutputPath = path.isAbsolute(outputPath) ? outputPath : path.resolve(process.cwd(), outputPath);
            await fs.mkdir(path.dirname(absoluteOutputPath), { recursive: true });
            await fs.writeFile(absoluteOutputPath, firstImage.data, 'base64');
            console.error(`[Nano Banana Pro] Saved image to ${absoluteOutputPath}`);
            mcpContent.push({ type: 'text', text: `Successfully saved the generated image to: ${absoluteOutputPath}` });
          } catch (err: any) {
            console.error(`[Nano Banana Pro] Failed to save image: ${err.message}`);
            mcpContent.push({ type: 'text', text: `Warning: Failed to save image to path: ${err.message}` });
          }
        }
      }

      return { content: mcpContent };
    } catch (error: any) {
      if (axios.isAxiosError(error)) {
        console.error(`[Nano Banana Pro] Axios Error: ${JSON.stringify(error.response?.data || error.message, null, 2)}`);
        return {
          content: [{ type: 'text', text: `OpenRouter API error: ${JSON.stringify(error.response?.data || error.message)}` }],
          isError: true,
        };
      }
      console.error(`[Nano Banana Pro] Unexpected Error: ${error.stack || error.message}`);
      throw error;
    }
  }

  private getMimeType(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    switch (ext) {
      case '.png': return 'image/png';
      case '.jpg':
      case '.jpeg': return 'image/jpeg';
      case '.gif': return 'image/gif';
      case '.webp': return 'image/webp';
      default: return 'application/octet-stream';
    }
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Nano Banana Pro MCP server running on stdio');
  }
}

const server = new NanoBananaServer();
server.run().catch(console.error);
