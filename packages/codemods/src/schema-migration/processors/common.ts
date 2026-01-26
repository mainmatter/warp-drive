/**
 * Extract kebab-case base name (without extension) from a file path
 */
export function extractBaseName(filePath: string): string {
  const fileName = filePath.split('/').pop() || filePath.split('\\').pop() || 'unknown';
  return fileName.replace(/\.(js|ts)$/, '');
}
