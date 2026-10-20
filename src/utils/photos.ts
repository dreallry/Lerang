export const MAX_LOT_PHOTOS = 12;
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
export const PHOTO_ACCEPT = 'image/jpeg,image/png,image/webp,image/gif,.jpg,.jpeg,.png,.webp,.gif';

export function photoBatchError(files: { name: string; size: number; type: string }[], currentCount: number): string {
  if (currentCount + files.length > MAX_LOT_PHOTOS) return `Maksimal ${MAX_LOT_PHOTOS} foto. Sisa tempat: ${MAX_LOT_PHOTOS - currentCount}.`;
  for (const file of files) {
    if (!file.size) return `File “${file.name}” kosong. Pilih foto lain.`;
    if (file.size > MAX_PHOTO_BYTES) return `File “${file.name}” melebihi 10 MB. Perkecil ukuran foto terlebih dahulu.`;
    if (!/\.(jpe?g|png|webp|gif)$/i.test(file.name) || (file.type && !/^image\/(jpeg|png|webp|gif)$/.test(file.type))) {
      return `File “${file.name}” bukan format yang didukung. Gunakan JPG, PNG, WebP, atau GIF.`;
    }
  }
  return '';
}

export function validPhotoUrl(value: string): boolean {
  if (/^\/api\/photos\/[a-f0-9]{32}\.(jpg|png|webp|gif)$/.test(value)) return true;
  try {
    const url = new URL(value);
    return value.length <= 4096 && /^https?:\/\//i.test(value) && ['https:', 'http:'].includes(url.protocol) && Boolean(url.hostname) && !url.username && !url.password;
  } catch {
    return false;
  }
}
