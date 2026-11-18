import { afterEach, expect, it, vi } from 'vitest';
import { startAudioCapture, transcribeXAudio } from '../extension/src/sidepanel/x-audio';

afterEach(() => vi.unstubAllGlobals());

it('arrête le partage si aucun son de l’onglet n’a été autorisé', async () => {
  const stop = vi.fn();
  vi.stubGlobal('navigator', { mediaDevices: { getDisplayMedia: async () => ({ getAudioTracks: () => [], getTracks: () => [{ stop }] }) } });
  await expect(startAudioCapture()).rejects.toThrow('Aucun son partagé');
  expect(stop).toHaveBeenCalledOnce();
});

it('indique qu’une clé est nécessaire avant d’envoyer un enregistrement', async () => {
  await expect(transcribeXAudio(new Blob(['son']), 5, { openrouterKey: '', models: [] })).rejects.toThrow('clé Gemini');
});
