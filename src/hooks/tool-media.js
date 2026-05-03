const { GoogleGenAI } = require('@google/genai');
const fs = require('fs');
const path = require('path');

const POLL_INTERVAL = 15000;
const MAX_WAIT = 5 * 60 * 1000;

const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };

function readImage(filePath) {
  const p = path.normalize(filePath);
  if (!fs.existsSync(p)) throw new Error('Image file not found: ' + p);
  const ext = path.extname(p).toLowerCase();
  if (!MIME[ext]) throw new Error('Unsupported image format: ' + ext);
  return { imageBytes: fs.readFileSync(p).toString('base64'), mimeType: MIME[ext] };
}

let _client;
function getClient() {
  if (!_client) {
    _client = new GoogleGenAI({
      apiKey: process.env.LLM_API_KEY,
      vertexai: true,
      httpOptions: { apiVersion: 'v1', baseUrl: 'https://zenmux.ai/api/vertex-ai' },
    });
  }
  return _client;
}

module.exports = [
  {
    name: 'image',
    description: `生成图片。根据文本描述生成图片并保存到指定路径。（这个很贵，用户批准后，谨慎节约的使用）

用法：
- prompt 描述要生成的图片内容。
- path 为输出文件的绝对路径（如 .png）。
- images 可选，参考图片的绝对路径数组，模型会参考这些图片来生成。
- prompt 中用 [1] [2] 引用 images 数组中的第1、2张图，实现图文交织。
  例：images=["/a/hero.png","/a/bg.png"], prompt="把[1]绘制到[2]的场景中"
  → 模型看到的是: 文字"把" + hero图 + 文字"绘制到" + bg图 + 文字"的场景中"
  不写 [N] 时所有图片放在 prompt 前面，效果相当于整体参考。
- options 可选配置对象。`,
    input_schema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'Image description. Use [1] [2] to reference images by index, e.g. "draw [1] into [2] scene"' },
        path: { type: 'string', description: 'Absolute file path to save the generated image' },
        images: { type: 'array', items: { type: 'string' }, description: 'Reference image paths. Referenced in prompt as [1] [2] by position' },
        options: {
          type: 'object',
          description: 'Optional configuration',
          properties: {
            aspectRatio: { type: 'string', description: 'Aspect ratio: 1:1, 2:3, 3:2, 3:4, 4:3, 9:16, 16:9, 21:9' },
            imageSize: { type: 'string', description: 'Image size: 1K, 2K, 4K' },
          },
        },
      },
      required: ['prompt', 'path'],
    },
    execute: async (input) => {
      const client = getClient();
      const opts = input.options || {};
      const imageConfig = {};
      if (opts.aspectRatio) imageConfig.aspectRatio = opts.aspectRatio;
      if (opts.imageSize) imageConfig.imageSize = opts.imageSize;

      let contents = input.prompt;
      if (input.images && input.images.length > 0) {
        // 支持 prompt 中 [1] [2] 引用 → 图文交织 parts
        const imgParts = input.images.map(img => {
          const { imageBytes, mimeType } = readImage(img);
          return { inlineData: { data: imageBytes, mimeType } };
        });
        const regex = /\[(\d+)\]/g;
        let hasRef = false, lastIdx = 0, match;
        const parts = [];
        while ((match = regex.exec(input.prompt)) !== null) {
          const n = parseInt(match[1], 10);
          if (n < 1 || n > input.images.length) continue;
          hasRef = true;
          const before = input.prompt.slice(lastIdx, match.index);
          if (before) parts.push({ text: before });
          parts.push(imgParts[n - 1]);
          lastIdx = regex.lastIndex;
        }
        if (hasRef) {
          const tail = input.prompt.slice(lastIdx);
          if (tail) parts.push({ text: tail });
          contents = parts;
        } else {
          contents = [...imgParts, { text: input.prompt }];
        }
      }

      const response = await client.models.generateContent({
        model: 'google/gemini-3-pro-image-preview',
        contents,
        config: {
          responseModalities: ['TEXT', 'IMAGE'],
          ...(Object.keys(imageConfig).length > 0 ? { imageConfig } : {}),
        },
      });

      const parts = response.candidates?.[0]?.content?.parts || [];
      const texts = [];
      let saved = false;

      for (const part of parts) {
        if (part.text) texts.push(part.text);
        if (part.inlineData && part.inlineData.data) {
          const filePath = path.normalize(input.path);
          fs.mkdirSync(path.dirname(filePath), { recursive: true });
          fs.writeFileSync(filePath, Buffer.from(part.inlineData.data, 'base64'));
          saved = true;
        }
      }

      if (!saved) throw new Error('No image generated. ' + (texts.join(' ') || 'Empty response.'));
      const result = `Image saved to ${input.path}`;
      return texts.length > 0 ? result + '\n' + texts.join('\n') : result;
    },
  },
  {
    name: 'video',
    description: `生成视频。根据文本描述生成视频并保存到指定路径。生成需要较长时间（通常30秒-几分钟）。（这个很贵，用户批准后，谨慎节约的使用）

用法：
- prompt 描述要生成的视频内容（有参考图片时可选）。
- path 为输出文件的绝对路径（如 .mp4）。
- image 可选，参考图片的绝对路径，用于图生视频（图片作为首帧，模型据此生成动画）。
- lastFrame 可选，尾帧图片的绝对路径（需配合 image 使用，控制视频结束画面）。
- options 可选配置对象。`,
    input_schema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'Text description of the video to generate (optional if image is provided)' },
        path: { type: 'string', description: 'Absolute file path to save the generated video' },
        image: { type: 'string', description: 'Absolute file path of reference image as the first frame' },
        lastFrame: { type: 'string', description: 'Absolute file path of image to use as the last frame (requires image)' },
        options: {
          type: 'object',
          description: 'Optional configuration',
          properties: {
            aspectRatio: { type: 'string', description: 'Aspect ratio: 16:9 (landscape) or 9:16 (portrait)' },
            resolution: { type: 'string', description: 'Resolution: 480p, 720p or 1080p' },
            durationSeconds: { type: 'number', description: 'Video duration in seconds (min 4)' },
            generateAudio: { type: 'boolean', description: 'Whether to generate audio along with the video' },
          },
        },
      },
      required: ['path'],
    },
    execute: async (input) => {
      if (!input.prompt && !input.image) throw new Error('At least one of prompt or image is required.');
      const client = getClient();
      const opts = input.options || {};
      const config = {};
      if (opts.aspectRatio) config.aspectRatio = opts.aspectRatio;
      if (opts.resolution) config.resolution = opts.resolution;
      if (opts.durationSeconds) config.durationSeconds = opts.durationSeconds;
      if (opts.generateAudio != null) config.generateAudio = opts.generateAudio;
      if (input.lastFrame) config.lastFrame = readImage(input.lastFrame);

      const params = {
        model: 'bytedance/doubao-seedance-1.5-pro',
        ...(input.prompt ? { prompt: input.prompt } : {}),
        ...(Object.keys(config).length > 0 ? { config } : {}),
      };

      if (input.image) params.image = readImage(input.image);

      let operation = await client.models.generateVideos(params);

      const start = Date.now();
      while (!operation.done) {
        if (Date.now() - start > MAX_WAIT) throw new Error('Video generation timed out after 5 minutes.');
        await new Promise(r => setTimeout(r, POLL_INTERVAL));
        operation = await client.operations.getVideosOperation({ operation });
      }

      if (operation.error) throw new Error('Video generation failed: ' + JSON.stringify(operation.error));

      const videos = operation.response?.generatedVideos || [];
      if (videos.length === 0) throw new Error('No video generated.');

      const video = videos[0].video;
      const filePath = path.normalize(input.path);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });

      if (video.videoBytes) {
        fs.writeFileSync(filePath, Buffer.from(video.videoBytes, 'base64'));
      } else if (video.uri) {
        await client.files.download({ file: video, downloadPath: filePath });
      } else {
        throw new Error('Video response contains no data.');
      }

      return `Video saved to ${input.path}`;
    },
  },
];
