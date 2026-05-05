/* Pure helper functions from composer.js — no DOM dependencies, importable by Node.js */

// Validates image file size against limit (default 10 MB)
export function validateImageSize(sizeBytes, limitBytes = 10 * 1024 * 1024) {
  return sizeBytes <= limitBytes;
}

// Builds OpenAI-compatible content array for a message with an image
export function buildImageMessageContent(text, base64Data, mimeType) {
  return [
    { type: "text", text },
    { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64Data}` } },
  ];
}
