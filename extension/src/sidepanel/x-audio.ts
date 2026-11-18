import { geminiGenerate, geminiKeys } from '../../../core/gemini';
import { buildTranscribePrompt, parseTimedLines } from '../../../core/transcribe';
import type { Config, Segment } from '../../../core/types';

export interface AudioCapture { stop(): Promise<{ audio: Blob; duration: number }> }

/** L'utilisateur choisit l'onglet et partage explicitement son audio. */
export async function startAudioCapture(): Promise<AudioCapture> {
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
  if (!stream.getAudioTracks().length) {
    stream.getTracks().forEach((track) => track.stop());
    throw new Error('Aucun son partagé. Choisis l’onglet X et active le partage audio.');
  }
  let recorder: MediaRecorder;
  try { recorder = new MediaRecorder(new MediaStream(stream.getAudioTracks()), { mimeType: 'audio/webm' }); }
  catch (error) { stream.getTracks().forEach((track) => track.stop()); throw error; }
  const chunks: Blob[] = [];
  const started = Date.now();
  let finished = false;
  let timeout: ReturnType<typeof setTimeout>;
  const result = new Promise<{ audio: Blob; duration: number }>((resolve, reject) => {
    recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
    recorder.onerror = () => { clearTimeout(timeout); stream.getTracks().forEach((track) => track.stop()); reject(new Error('Enregistrement audio interrompu.')); };
    recorder.onstop = () => { finished = true; clearTimeout(timeout); stream.getTracks().forEach((track) => track.stop()); resolve({ audio: new Blob(chunks, { type: 'audio/webm' }), duration: (Date.now() - started) / 1000 }); };
  });
  void result.catch(() => {});
  recorder.start();
  timeout = setTimeout(() => { if (recorder.state !== 'inactive') recorder.stop(); }, 180_000);
  stream.getVideoTracks()[0]?.addEventListener('ended', () => { if (recorder.state !== 'inactive') recorder.stop(); });
  return { stop: async () => {
    if (!finished && recorder.state !== 'inactive') recorder.stop();
    try { return await result; } finally { clearTimeout(timeout); stream.getTracks().forEach((track) => track.stop()); }
  } };
}

export async function transcribeXAudio(audio: Blob, duration: number, config: Config): Promise<{ language: string; segments: Segment[] }> {
  const keys = geminiKeys(config);
  if (!keys.length) throw new Error('Ajoute une clé Gemini dans les paramètres pour transcrire l’audio.');
  if (!audio.size) throw new Error('L’enregistrement est vide.');
  if (audio.size > 12_000_000) throw new Error('Enregistrement trop volumineux ; essaie un extrait plus court.');
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(new Error('Lecture de l’audio impossible.'));
    reader.readAsDataURL(audio);
  });
  const { text } = await geminiGenerate([{ inlineData: { mimeType: 'audio/webm', data } }, { text: buildTranscribePrompt(duration) }],
    { key: keys, attempts: 2, failurePrefix: 'Transcription audio impossible' },
    (answer) => parseTimedLines(answer, duration).segments.length > 0);
  return parseTimedLines(text, duration);
}
