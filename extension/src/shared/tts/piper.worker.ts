/// <reference lib="webworker" />
import { TtsSession } from '@mintplex-labs/piper-tts-web';

// Moteurs WebAssembly embarqués dans l'extension (copiés par scripts/copy-piper-assets.mjs).
const base = new URL('/piper/', self.location.href).href;
const WASM_PATHS = { onnxWasm: base, piperData: `${base}piper_phonemize.data`, piperWasm: `${base}piper_phonemize.wasm` };

// Une session par voix : avec plusieurs intervenants, on alterne entre voix sans recharger les modèles.
const sessions = new Map<string, Promise<TtsSession>>();

export interface PiperRequest {
  id: number;
  text: string;
  voiceId: string;
}

function sessionFor(voiceId: string, id: number): Promise<TtsSession> {
  let session = sessions.get(voiceId);
  if (!session) {
    // La bibliothèque réutilise une instance unique : on la libère pour créer une session dédiée à cette voix.
    TtsSession._instance = null;
    session = TtsSession.create({
      voiceId,
      wasmPaths: WASM_PATHS,
      progress: (p) => self.postMessage({ id, progress: { loaded: p.loaded, total: p.total } }),
    });
    sessions.set(voiceId, session);
    session.catch(() => sessions.delete(voiceId));
  }
  return session;
}

self.onmessage = async (event: MessageEvent<PiperRequest>) => {
  const { id, text, voiceId } = event.data;
  try {
    const session = await sessionFor(voiceId, id);
    const wav = await (await session.predict(text)).arrayBuffer();
    self.postMessage({ id, wav }, [wav]);
  } catch (e) {
    self.postMessage({ id, error: (e as Error).message ?? String(e) });
  }
};
