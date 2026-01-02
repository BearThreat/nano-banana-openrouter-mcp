#!/usr/bin/env node
import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer } from 'http';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Test image path
const imagePath = process.argv[2] || './test_image.jpg';

async function getMimeType(filePath) {
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

async function startServer() {
  const absolutePath = path.isAbsolute(imagePath) ? imagePath : path.resolve(process.cwd(), imagePath);
  
  console.log(`Loading image: ${absolutePath}`);
  
  let images;
  try {
    const data = await fs.readFile(absolutePath);
    const base64 = data.toString('base64');
    const mimeType = await getMimeType(imagePath);
    images = [{
      name: path.basename(imagePath),
      path: absolutePath,
      dataUrl: `data:${mimeType};base64,${base64}`,
    }];
    console.log('Image loaded successfully');
  } catch (err) {
    console.error('Error loading image:', err.message);
    process.exit(1);
  }

  const app = express();
  app.use(express.json({ limit: '100mb' }));

  // Serve the annotator HTML
  const annotatorPath = path.join(__dirname, 'build', 'annotator', 'index.html');
  
  app.get('/', async (req, res) => {
    try {
      const html = await fs.readFile(annotatorPath, 'utf-8');
      res.type('html').send(html);
    } catch (err) {
      console.error('Error loading annotator:', err);
      res.status(500).send('Error loading annotator UI');
    }
  });

  app.get('/api/images', (req, res) => {
    res.json({ images });
  });

  app.post('/api/submit', async (req, res) => {
    console.log('\n=== ANNOTATIONS RECEIVED ===');
    const { annotations } = req.body;
    
    for (const annotation of annotations) {
      console.log(`Image: ${annotation.name}`);
      console.log(`Prompt: ${annotation.prompt}`);
      console.log(`Has annotated image: ${!!annotation.annotatedDataUrl}`);
    }
    
    // Save annotated image
    const tempDir = path.join(process.cwd(), '.nano-banana-temp');
    await fs.mkdir(tempDir, { recursive: true });
    
    for (const annotation of annotations) {
      const match = annotation.annotatedDataUrl.match(/^data:([^;]+);base64,(.+)$/);
      if (match) {
        const annotatedPath = path.join(tempDir, `annotated_${annotation.name}`);
        await fs.writeFile(annotatedPath, match[2], 'base64');
        console.log(`Saved annotated image to: ${annotatedPath}`);
      }
    }
    
    res.json({ success: true });
    console.log('\nAnnotation complete! Server closing automatically...');
    
    // Auto-close server after a short delay to allow response to be sent
    setTimeout(() => {
      httpServer.close(() => {
        console.log('Server closed.');
        process.exit(0);
      });
    }, 500);
  });

  const PORT = 3456;
  const httpServer = createServer(app);
  
  httpServer.listen(PORT, async () => {
    const url = `http://localhost:${PORT}`;
    console.log(`\n🍌 Nano Banana Annotator Test Server`);
    console.log(`================================`);
    console.log(`Server running at: ${url}`);
    
    // Auto-open browser
    let browserOpened = false;
    try {
      const open = (await import('open')).default;
      await open(url);
      browserOpened = true;
      console.log(`Browser opened successfully`);
    } catch (openErr) {
      console.error(`Failed to open browser with 'open' package: ${openErr.message}`);
      // Try fallback with xdg-open on Linux
      try {
        const { exec } = await import('child_process');
        exec(`xdg-open "${url}"`, (err) => {
          if (err) {
            console.error(`xdg-open fallback also failed: ${err.message}`);
          } else {
            console.log(`Browser opened via xdg-open fallback`);
          }
        });
        browserOpened = true;
      } catch (fallbackErr) {
        console.error(`All browser open methods failed`);
      }
    }
    
    if (!browserOpened) {
      console.log(`\nPlease manually open: ${url}`);
    }
  });
}

startServer().catch(console.error);
