export function downloadText(filename: string, text: string, mime = 'text/plain'): void {
  downloadBlob(filename, new Blob([text], { type: `${mime};charset=utf-8` }));
}

export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Rasterize an SVG string to a PNG blob. Photos referenced by remote URLs
 * taint the canvas and make this throw — data-URL photos (file uploads) are
 * fine.
 */
export function svgToPng(svgString: string, width: number, height: number, scale = 2): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(width * scale);
        canvas.height = Math.ceil(height * scale);
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('no 2d context');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => {
          if (blob) resolve(blob);
          else reject(new Error('PNG encoding failed'));
        }, 'image/png');
      } catch (e) {
        reject(e);
      }
    };
    img.onerror = () => reject(new Error('Could not render SVG'));
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgString);
  });
}

/** Downscale an image file to a small JPEG data URL (for portable photos). */
export function fileToDataUrl(file: File, maxDim = 256): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const k = Math.min(1, maxDim / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.width * k));
      canvas.height = Math.max(1, Math.round(img.height * k));
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('no 2d context'));
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Not a readable image file'));
    };
    img.src = url;
  });
}

export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsText(file);
  });
}

/**
 * Serialize the live chart SVG into a standalone file. All chart visuals use
 * inline attributes, so a clone with a reset transform renders identically.
 */
export function exportSvg(
  svgEl: SVGSVGElement,
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
  background = '#f4f1ea',
): string {
  const pad = 40;
  const w = Math.ceil(bounds.maxX - bounds.minX + pad * 2);
  const h = Math.ceil(bounds.maxY - bounds.minY + pad * 2);
  const clone = svgEl.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', String(w));
  clone.setAttribute('height', String(h));
  clone.setAttribute(
    'viewBox',
    `${bounds.minX - pad} ${bounds.minY - pad} ${w} ${h}`,
  );
  const inner = clone.querySelector('g');
  inner?.setAttribute('transform', '');
  const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  bg.setAttribute('x', String(bounds.minX - pad));
  bg.setAttribute('y', String(bounds.minY - pad));
  bg.setAttribute('width', String(w));
  bg.setAttribute('height', String(h));
  bg.setAttribute('fill', background);
  clone.insertBefore(bg, clone.firstChild);
  return new XMLSerializer().serializeToString(clone);
}
