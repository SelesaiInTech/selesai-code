import { extractText, getDocumentProxy } from 'unpdf';
import type { WebFetchResponse } from '../types.js';
import type { SpecialContentReader } from './types.js';

type PdfReaderDeps = {
  fetchImpl?: typeof fetch;
  /** Injectable for tests; defaults to unpdf. */
  extractPdfText?: (bytes: Uint8Array) => Promise<string>;
};

async function defaultExtract(bytes: Uint8Array): Promise<string> {
  const pdf = await getDocumentProxy(bytes);
  const { text } = await extractText(pdf, { mergePages: true });
  return text;
}

function isPdfUrl(url: string): boolean {
  try {
    return new URL(url).pathname.toLowerCase().endsWith('.pdf');
  } catch {
    return false;
  }
}

export function createPdfReader({ fetchImpl = fetch, extractPdfText = defaultExtract }: PdfReaderDeps = {}): SpecialContentReader {
  return {
    name: 'pdf',
    canHandle: isPdfUrl,
    canHandleContentType(contentType: string): boolean {
      return contentType.toLowerCase().includes('application/pdf');
    },
    async read(url: string): Promise<WebFetchResponse> {
      try {
        const response = await fetchImpl(url);
        if (!('ok' in response) || !response.ok) {
          return {
            status: 'error',
            url,
            metadata: { method: 'pdf', cacheHit: false },
            error: { code: 'PDF_READ_FAILED', message: `Fetching the PDF failed.` }
          };
        }
        const bytes = new Uint8Array(await response.arrayBuffer());
        const text = (await extractPdfText(bytes)).trim();

        if (text.length === 0) {
          return {
            status: 'unsupported',
            url,
            metadata: { method: 'pdf', cacheHit: false, contentType: 'application/pdf' },
            error: { code: 'PDF_NO_TEXT', message: 'This looks like a scanned PDF with no extractable text.' }
          };
        }

        return {
          status: 'ok',
          url,
          content: { title: url.split('/').pop() ?? 'PDF', text: text.slice(0, 4000) },
          metadata: { method: 'pdf', cacheHit: false, contentType: 'application/pdf', truncated: text.length >= 4000 }
        };
      } catch (err) {
        return {
          status: 'error',
          url,
          metadata: { method: 'pdf', cacheHit: false },
          error: { code: 'PDF_READ_FAILED', message: err instanceof Error ? err.message : 'PDF read failed.' }
        };
      }
    }
  };
}
