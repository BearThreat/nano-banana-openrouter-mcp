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
import express, { Request, Response } from 'express';
import { fileURLToPath } from 'url';
import { createServer } from 'http';

const API_KEY = process.env.OPENROUTER_API_KEY;
const MODEL_ID = process.env.NANO_BANANA_MODEL_ID || 'google/gemini-3-pro-image-preview';

if (!API_KEY) {
  throw new Error('OPENROUTER_API_KEY environment variable is required');
}

// Store annotation sessions
interface AnnotationSession {
  id: string;
  port: number;
  images: { name: string; path: string; dataUrl: string }[];
  httpServer: any;
  results: any | null;
  status: 'waiting' | 'completed' | 'error';
  createdAt: Date;
}

const annotationSessions: Map<string, AnnotationSession> = new Map();

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
        },
        {
          name: 'start_annotation',
          description: `Start an annotation session for visual image editing. Opens a browser window where users can draw circles, arrows, and highlight areas on images, plus add text prompts describing what changes they want.

**WORKFLOW (3 steps):**
1. Call start_annotation with image path(s) → Browser opens automatically
2. User annotates images and clicks "Finish" in browser
3. Call get_annotation_results → Then IMMEDIATELY call edit_or_create_image with the returned paths and prompt

**REQUIRED:** You must provide at least one image path. Ask the user for an image path if not provided.

**Example:** "I want to annotate my photo at /home/user/photo.jpg" → Call start_annotation with imagePaths: ["/home/user/photo.jpg"]`,
          inputSchema: {
            type: 'object',
            properties: {
              imagePaths: {
                type: 'array',
                items: { type: 'string' },
                description: 'Local paths to images to annotate (max 12). Must be absolute paths or paths relative to the MCP server working directory.',
                maxItems: 12,
              }
            },
            required: ['imagePaths']
          }
        },
        {
          name: 'get_annotation_results',
          description: `Retrieve results from an annotation session. Call this after the user has finished annotating images in the browser and clicked "Finish".

**Returns:** Annotated image paths and combined prompts from user's annotations.

**IMPORTANT:** Once you receive completed results with status "completed", you MUST IMMEDIATELY call edit_or_create_image with:
- imagePaths: the annotatedImagePaths from the results
- prompt: the combinedPrompt from the results
- outputPath: suggested path from results or ask user

**If status is "waiting":** Tell the user to complete annotations in the browser and click "Finish", then call this tool again.`,
          inputSchema: {
            type: 'object',
            properties: {
              sessionId: {
                type: 'string',
                description: 'The session ID returned by start_annotation. If not provided, uses the most recent session.',
              }
            },
            required: []
          }
        }
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      if (request.params.name === 'edit_or_create_image') {
        return this.handleImageTask(request.params.arguments as any);
      } else if (request.params.name === 'batch_edit_or_create_images') {
        const { tasks } = request.params.arguments as { tasks: any[] };

        const results = await Promise.all(tasks.map(async (task) => {
          try {
            const result: any = await this.handleImageTask(task);
            return {
              task: task.prompt,
              status: 'success',
              imageSaved: !!task.outputPath,
              output: result.content?.[0]?.text,
              usage: result.usage
            };
          } catch (err: any) {
            return { task: task.prompt, status: 'failed', error: err.message };
          }
        }));

        return {
          content: [{ type: 'text', text: JSON.stringify(results, null, 2) }]
        };
      } else if (request.params.name === 'start_annotation') {
        return this.handleStartAnnotation(request.params.arguments as any);
      } else if (request.params.name === 'get_annotation_results') {
        return this.handleGetAnnotationResults(request.params.arguments as any);
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

      // Add cost summary to the output
      if (response.data.usage) {
        mcpContent.push({
          type: 'text',
          text: `[Usage Summary] Prompt Tokens: ${response.data.usage.prompt_tokens}, Completion Tokens: ${response.data.usage.completion_tokens}, Total Tokens: ${response.data.usage.total_tokens}`
        });
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

      return { content: mcpContent, usage: response.data.usage };
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

  private async handleStartAnnotation(args: { imagePaths: string[] }): Promise<any> {
    const { imagePaths } = args;

    if (!imagePaths || imagePaths.length === 0) {
      return {
        content: [{ type: 'text', text: 'Error: No image paths provided.' }],
        isError: true,
      };
    }

    // Generate session ID
    const sessionId = `session_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    console.error(`[Nano Banana Pro] Starting annotation session: ${sessionId}`);

    // Load images and convert to base64
    const images: { name: string; path: string; dataUrl: string }[] = [];
    for (const imagePath of imagePaths) {
      try {
        const absolutePath = path.isAbsolute(imagePath) ? imagePath : path.resolve(process.cwd(), imagePath);
        const data = await fs.readFile(absolutePath);
        const base64 = data.toString('base64');
        const mimeType = this.getMimeType(imagePath);
        images.push({
          name: path.basename(imagePath),
          path: absolutePath,
          dataUrl: `data:${mimeType};base64,${base64}`,
        });
      } catch (err: any) {
        return {
          content: [{ type: 'text', text: `Error reading image ${imagePath}: ${err.message}` }],
          isError: true,
        };
      }
    }

    // Create Express app
    const app = express();
    app.use(express.json({ limit: '100mb' }));

    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const annotatorPath = path.join(__dirname, 'annotator', 'index.html');

    app.get('/', async (req, res) => {
      try {
        const html = await fs.readFile(annotatorPath, 'utf-8');
        res.type('html').send(html);
      } catch (err) {
        res.status(500).send('Error loading annotator UI');
      }
    });

    app.get('/api/images', (req, res) => {
      res.json({ images });
    });

    // Handle submission - store results in session
    app.post('/api/submit', async (req, res) => {
      try {
        const { annotations } = req.body;
        const session = annotationSessions.get(sessionId);
        
        if (!session) {
          res.status(404).json({ error: 'Session not found' });
          return;
        }

        // Save annotated images to temp files
        const tempDir = path.join(process.cwd(), '.nano-banana-temp');
        await fs.mkdir(tempDir, { recursive: true });
        
        const annotatedPaths: string[] = [];
        const prompts: string[] = [];
        
        for (const annotation of annotations) {
          const match = annotation.annotatedDataUrl.match(/^data:([^;]+);base64,(.+)$/);
          if (match) {
            const annotatedPath = path.join(tempDir, `annotated_${sessionId}_${annotation.name}`);
            await fs.writeFile(annotatedPath, match[2], 'base64');
            annotatedPaths.push(annotatedPath);
          }
          
          if (annotation.prompt && annotation.prompt.trim()) {
            prompts.push(annotation.prompt.trim());
          }
        }
        
        const combinedPrompt = prompts.join('\n\n');
        
        // Update session with results
        session.results = {
          annotatedPaths,
          combinedPrompt,
          originalPaths: annotations.map((a: any) => a.originalPath),
        };
        session.status = 'completed';
        
        console.error(`[Nano Banana Pro] Session ${sessionId} completed with ${annotatedPaths.length} annotated images`);
        
        res.json({ success: true });
      } catch (err: any) {
        console.error('[Nano Banana Pro] Error saving annotations:', err);
        const session = annotationSessions.get(sessionId);
        if (session) {
          session.status = 'error';
        }
        res.status(500).json({ error: err.message });
      }
    });

    // Find available port
    const findPort = (): Promise<number> => {
      return new Promise((resolve) => {
        const tempServer = createServer();
        tempServer.listen(0, () => {
          const address = tempServer.address();
          const port = typeof address === 'object' && address ? address.port : 3456;
          tempServer.close(() => resolve(port));
        });
      });
    };

    const port = await findPort();
    
    // Start server
    const httpServer = createServer(app);
    await new Promise<void>((resolve) => {
      httpServer.listen(port, () => {
        console.error(`[Nano Banana Pro] Annotation server for session ${sessionId} running at http://localhost:${port}`);
        resolve();
      });
    });

    // Store session
    const session: AnnotationSession = {
      id: sessionId,
      port,
      images,
      httpServer,
      results: null,
      status: 'waiting',
      createdAt: new Date(),
    };
    annotationSessions.set(sessionId, session);

    // Open browser with fallback methods
    const url = `http://localhost:${port}`;
    console.error(`[Nano Banana Pro] Opening browser at ${url}`);
    
    let browserOpened = false;
    
    // Method 1: Try the 'open' package first
    try {
      const open = (await import('open')).default;
      await open(url);
      browserOpened = true;
      console.error(`[Nano Banana Pro] Browser opened successfully via 'open' package`);
    } catch (openErr: any) {
      console.error(`[Nano Banana Pro] 'open' package failed: ${openErr.message}`);
    }
    
    // Method 2: Try xdg-open with spawn (better for detached processes)
    if (!browserOpened) {
      try {
        const { spawn } = await import('child_process');
        const child = spawn('xdg-open', [url], {
          detached: true,
          stdio: 'ignore',
          env: { ...process.env, DISPLAY: process.env.DISPLAY || ':0' }
        });
        child.unref();
        browserOpened = true;
        console.error(`[Nano Banana Pro] Browser opened via xdg-open spawn`);
      } catch (spawnErr: any) {
        console.error(`[Nano Banana Pro] xdg-open spawn failed: ${spawnErr.message}`);
      }
    }

    // Method 3: Try sensible-browser (Debian/Ubuntu fallback)
    if (!browserOpened) {
      try {
        const { spawn } = await import('child_process');
        const child = spawn('sensible-browser', [url], {
          detached: true,
          stdio: 'ignore',
          env: { ...process.env, DISPLAY: process.env.DISPLAY || ':0' }
        });
        child.unref();
        browserOpened = true;
        console.error(`[Nano Banana Pro] Browser opened via sensible-browser`);
      } catch (sbErr: any) {
        console.error(`[Nano Banana Pro] sensible-browser failed: ${sbErr.message}`);
      }
    }

    // Method 4: Try common browsers directly
    if (!browserOpened) {
      const browsers = ['google-chrome', 'chromium-browser', 'firefox', 'brave-browser'];
      const { spawn } = await import('child_process');
      
      for (const browser of browsers) {
        try {
          const child = spawn(browser, [url], {
            detached: true,
            stdio: 'ignore',
            env: { ...process.env, DISPLAY: process.env.DISPLAY || ':0' }
          });
          child.unref();
          browserOpened = true;
          console.error(`[Nano Banana Pro] Browser opened via ${browser}`);
          break;
        } catch (browserErr: any) {
          console.error(`[Nano Banana Pro] ${browser} failed: ${browserErr.message}`);
        }
      }
    }

    if (!browserOpened) {
      console.error(`[Nano Banana Pro] All browser open methods failed. User must open manually.`);
    }

    const browserNote = browserOpened 
      ? 'The browser should have opened automatically.' 
      : `⚠️ Could not auto-open browser. Please manually open: ${url}`;

    // Return immediately with session info
    return {
      content: [
        { 
          type: 'text', 
          text: `🍌 Annotation session started!\n\nSession ID: ${sessionId}\nURL: ${url}\n\n${browserNote}\n\nTake your time to annotate the image(s). When you're done, click "Finish" in the browser.\n\n⚠️ IMPORTANT: After the user finishes annotating, you MUST call get_annotation_results to retrieve the results, then IMMEDIATELY call edit_or_create_image to apply the edits.`
        },
        {
          type: 'text',
          text: JSON.stringify({
            sessionId,
            url,
            status: 'waiting',
            imageCount: images.length,
            nextStep: 'Call get_annotation_results when user finishes, then immediately call edit_or_create_image with results',
          }, null, 2)
        }
      ],
    };
  }

  private async handleGetAnnotationResults(args: { sessionId?: string }): Promise<any> {
    let { sessionId } = args;
    
    // If no session ID, use the most recent session
    if (!sessionId) {
      const sessions = Array.from(annotationSessions.values());
      if (sessions.length === 0) {
        return {
          content: [{ type: 'text', text: 'No annotation sessions found. Use start_annotation first to begin a session.' }],
          isError: true,
        };
      }
      // Get the most recent session
      const mostRecent = sessions.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
      sessionId = mostRecent.id;
    }
    
    const session = annotationSessions.get(sessionId);
    
    if (!session) {
      return {
        content: [{ type: 'text', text: `Session not found: ${sessionId}` }],
        isError: true,
      };
    }
    
    if (session.status === 'waiting') {
      return {
        content: [
          { 
            type: 'text', 
            text: `Session ${sessionId} is still waiting for annotations.\n\nPlease complete your annotations in the browser at http://localhost:${session.port} and click "Finish", then call get_annotation_results again.`
          },
          {
            type: 'text',
            text: JSON.stringify({
              sessionId,
              status: 'waiting',
              url: `http://localhost:${session.port}`,
            }, null, 2)
          }
        ],
      };
    }
    
    if (session.status === 'error') {
      // Clean up
      session.httpServer.close();
      annotationSessions.delete(sessionId);
      
      return {
        content: [{ type: 'text', text: `Session ${sessionId} encountered an error. Please start a new annotation session.` }],
        isError: true,
      };
    }
    
    // Session completed - return results
    const results = session.results;
    
    // Close server and clean up session
    session.httpServer.close();
    annotationSessions.delete(sessionId);
    console.error(`[Nano Banana Pro] Session ${sessionId} closed and cleaned up`);
    
    return {
      content: [
        { 
          type: 'text', 
          text: `✅ Annotation complete!\n\nAnnotated images saved to:\n${results.annotatedPaths.join('\n')}\n\nUser's edit request:\n${results.combinedPrompt}\n\n🚀 **NEXT STEP - DO THIS NOW:**\nImmediately call edit_or_create_image with:\n- imagePaths: ${JSON.stringify(results.annotatedPaths)}\n- prompt: "${results.combinedPrompt}"\n- outputPath: (choose an appropriate output path)\n\nThis will apply the user's requested edits to the annotated images.`
        },
        {
          type: 'text',
          text: JSON.stringify({
            annotatedImagePaths: results.annotatedPaths,
            combinedPrompt: results.combinedPrompt,
            originalImagePaths: results.originalPaths,
            suggestedNextAction: {
              tool: 'edit_or_create_image',
              arguments: {
                prompt: results.combinedPrompt,
                imagePaths: results.annotatedPaths,
                outputPath: results.originalPaths[0]?.replace(/\.[^.]+$/, '_edited.png') || 'edited_output.png'
              }
            }
          }, null, 2)
        }
      ],
    };
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Nano Banana Pro MCP server running on stdio');
  }
}

const server = new NanoBananaServer();
server.run().catch(console.error);
