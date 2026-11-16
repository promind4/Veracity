import { wavDuration } from '../../../../core/tts-gemini';

type Pending = {
  resolve: (r: { wav: Uint8Array<ArrayBuffer>; durationS: number }) => void;
  reject: (e: Error) => void;
  onProgress?: (loaded: number, total: number) => void;
};

/** Synthèse Piper dans un worker (le calcul ne fige pas l'interface). */
export class PiperClient {
  private worker: Worker | null = null;
  private pending = new Map<number, Pending>();
  private nextId = 1;

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const worker = new Worker(new URL('./piper.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event) => {
      const { id, wav, error, progress } = event.data as { id: number; wav?: ArrayBuffer; error?: string; progress?: { loaded: number; total: number } };
      const job = this.pending.get(id);
      if (!job) return;
      if (progress) return job.onProgress?.(progress.loaded, progress.total);
      this.pending.delete(id);
      if (error || !wav) job.reject(new Error(`Piper : ${error ?? 'aucun audio'}`));
      else {
        const bytes = new Uint8Array(wav);
        job.resolve({ wav: bytes, durationS: wavDuration(bytes) });
      }
    };
    worker.onerror = (event) => {
      for (const job of this.pending.values()) job.reject(new Error(`Piper : ${event.message}`));
      this.pending.clear();
      this.worker = null;
    };
    this.worker = worker;
    return worker;
  }

  speak(text: string, voiceId: string, onProgress?: Pending['onProgress']): Promise<{ wav: Uint8Array<ArrayBuffer>; durationS: number }> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, onProgress });
      this.ensureWorker().postMessage({ id, text, voiceId });
    });
  }
}
