// Master 7cx. Phone photos of an ID or a certificate are often 4 to 10 MB, and the private bucket refuses anything over
// 5 MB or any type but PDF, JPG and PNG (an iPhone's default HEIC photo, for example). This makes a photo fit before it
// is uploaded: it is drawn onto a canvas no bigger than MAX_EDGE pixels on its longest side and saved as a JPEG, which
// keeps an ID readable at a fraction of the size and saves the tutor's mobile data. PDFs are never touched. Browser
// only (canvas); the rules about what is allowed live in tutorOnboarding.ts and are tested there.
import { MAX_FILE_BYTES } from './tutorOnboarding';

const MAX_EDGE = 2200;
const JPEG_QUALITY = 0.85;
// A JPEG or PNG already this small and not huge in pixels is uploaded exactly as the tutor took it.
const LEAVE_ALONE_BELOW_BYTES = 1.5 * 1024 * 1024;

const COULD_NOT_READ = "We couldn't read that photo. Try a JPG or PNG photo, or a PDF.";

async function decode(file: File): Promise<{ source: CanvasImageSource; width: number; height: number; release: () => void }> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file); // applies the photo's rotation (EXIF) in current browsers
      return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() };
    } catch {
      // fall through to an <img>, which some browsers decode when createImageBitmap will not (HEIC in Safari)
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, release: () => URL.revokeObjectURL(url) };
  } catch {
    URL.revokeObjectURL(url);
    throw new Error(COULD_NOT_READ);
  }
}

function toJpegBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error(COULD_NOT_READ))), 'image/jpeg', JPEG_QUALITY);
  });
}

// Returns the file to upload: the PDF as it is, a small JPG or PNG as it is, and any other photo shrunk and saved as a JPEG.
export async function prepareFileForUpload(file: File): Promise<File> {
  if (file.type === 'application/pdf') return file;
  if (!file.type.startsWith('image/')) return file; // fileProblem() will refuse it with a clear message
  if ((file.type === 'image/jpeg' || file.type === 'image/png') && file.size <= LEAVE_ALONE_BELOW_BYTES) return file;

  const { source, width, height, release } = await decode(file);
  try {
    if (!width || !height) throw new Error(COULD_NOT_READ);
    const scale = Math.min(1, MAX_EDGE / Math.max(width, height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error(COULD_NOT_READ);
    context.fillStyle = '#ffffff'; // a PNG with a transparent background would otherwise turn black
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    const blob = await toJpegBlob(canvas);
    // Never make a small, already-acceptable file bigger.
    if ((file.type === 'image/jpeg' || file.type === 'image/png') && file.size <= MAX_FILE_BYTES && blob.size >= file.size) return file;
    const base = file.name.replace(/\.[^.]+$/, '') || 'photo';
    return new File([blob], `${base}.jpg`, { type: 'image/jpeg', lastModified: Date.now() });
  } finally {
    release();
  }
}
