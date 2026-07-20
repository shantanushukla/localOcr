export const IMAGE_MIME = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/gif',
]);

export function isPdfFile(file: { type: string; name: string }): boolean {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
}

export function isImageFile(file: { type: string; name: string }): boolean {
  return IMAGE_MIME.has(file.type) || /\.(png|jpe?g|webp|gif)$/i.test(file.name);
}

export function isSupportedFile(file: { type: string; name: string }): boolean {
  return isPdfFile(file) || isImageFile(file);
}
