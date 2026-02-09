/**
 * Compression d'image pour l'avatar : WebP (ou JPEG sur natif), max 30 Ko.
 * Web : Canvas API → WebP.
 * Native : expo-image-manipulator → WebP si dispo, sinon JPEG.
 */

import { Platform } from 'react-native';

const MAX_SIZE_BYTES = 30 * 1024; // 30 Ko
const TARGET_SIZE = 128; // 128x128 px

export interface CompressedAvatarResult {
  /** Données prêtes pour upload (Blob sur web, base64 sur native pour conversion en ArrayBuffer). */
  data: Blob | ArrayBuffer;
  /** MIME type (image/webp ou image/jpeg). */
  mime: string;
}

/**
 * Convertit une base64 en ArrayBuffer (pour upload Supabase sur native).
 */
function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/**
 * Compresse une image (URI ou File) en WebP ≤ 30 Ko.
 * Sur web : Canvas + toBlob('image/webp').
 * Sur native : expo-image-manipulator (WebP si dispo, sinon JPEG).
 */
export async function compressAvatarToWebP(
  source: string | File | { uri: string }
): Promise<CompressedAvatarResult> {
  if (Platform.OS === 'web') {
    return compressAvatarWeb(source as string | File);
  }
  const uri = typeof source === 'object' && source !== null && 'uri' in source ? source.uri : (source as string);
  return compressAvatarNative(uri);
}

/**
 * Web : dessine l'image dans un canvas, redimensionne, exporte en WebP en réduisant la qualité jusqu'à ≤ 30 Ko.
 */
function compressAvatarWeb(source: string | File): Promise<CompressedAvatarResult> {
  return new Promise((resolve, reject) => {
    const img = new (typeof window !== 'undefined' ? window : globalThis).Image();
    const url = typeof source === 'string' ? source : (source instanceof File ? URL.createObjectURL(source) : source);

    img.onload = () => {
      if (typeof source === 'object' && source instanceof File) URL.revokeObjectURL(url as string);

      const canvas = document.createElement('canvas');
      let w = img.width;
      let h = img.height;
      if (w > h) {
        h = Math.round((h * TARGET_SIZE) / w);
        w = TARGET_SIZE;
      } else {
        w = Math.round((w * TARGET_SIZE) / h);
        h = TARGET_SIZE;
      }
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvas 2d non disponible'));
        return;
      }
      ctx.drawImage(img, 0, 0, w, h);

      let quality = 0.9;
      const tryBlob = () => {
        canvas.toBlob(
          (blob) => {
            if (!blob) {
              reject(new Error('Échec toBlob'));
              return;
            }
            if (blob.size <= MAX_SIZE_BYTES || quality <= 0.1) {
              resolve({ data: blob, mime: 'image/webp' });
              return;
            }
            quality -= 0.15;
            if (quality < 0.1) quality = 0.1;
            tryBlob();
          },
          'image/webp',
          quality
        );
      };
      tryBlob();
    };
    img.onerror = () => reject(new Error('Chargement image échoué'));
    img.src = typeof url === 'string' ? url : (url as string);
  });
}

/**
 * Native : expo-image-manipulator. WebP est marqué @platform web ; on utilise JPEG sur mobile avec forte compression.
 */
async function compressAvatarNative(uri: string): Promise<CompressedAvatarResult> {
  const { manipulateAsync, SaveFormat } = await import('expo-image-manipulator');

  let quality = 0.85;
  let lastResult: { uri: string; base64?: string } | null = null;

  while (quality >= 0.2) {
    const result = await manipulateAsync(
      uri,
      [{ resize: { width: TARGET_SIZE, height: TARGET_SIZE } }],
      {
        compress: quality,
        format: SaveFormat.JPEG,
        base64: true,
      }
    );
    lastResult = result;
    const size = result.base64 ? Math.ceil((result.base64.length * 3) / 4) : 0;
    if (size <= MAX_SIZE_BYTES) {
      const data = result.base64 ? base64ToArrayBuffer(result.base64) : new ArrayBuffer(0);
      return { data, mime: 'image/jpeg' };
    }
    quality -= 0.15;
  }

  if (lastResult?.base64) {
    const data = base64ToArrayBuffer(lastResult.base64);
    return { data, mime: 'image/jpeg' };
  }
  throw new Error('Compression avatar échouée');
}
