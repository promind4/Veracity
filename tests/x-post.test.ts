import { afterEach, describe, expect, it, vi } from 'vitest';
import { readXPost } from '../extension/src/sidepanel/x';

afterEach(() => vi.unstubAllGlobals());

function article(id: string, content: string) {
  const a: Record<string, unknown> = {};
  const text = { innerText: content, closest: () => a, getAttribute: () => 'fr' };
  const link = { closest: () => a, getAttribute: () => `/user/status/${id}`, querySelector: () => ({}) };
  a.querySelectorAll = (selector: string) => selector === 'a[href]' ? [link] : selector === '[data-testid="tweetText"]' ? [text] : [];
  a.querySelector = (selector: string) => selector === '[data-testid="User-Name"]' ? { textContent: 'Auteur' } : null;
  return a;
}

describe('lecture d'une publication X depuis le fil', () => {
  it('s�lectionne exactement la bonne publication parmi plusieurs', async () => {
    const posts = [article('1234', 'Autre publication'), article('123', 'Texte demand�')];
    vi.stubGlobal('location', { hostname: 'x.com', pathname: '/home' });
    vi.stubGlobal('document', { querySelectorAll: () => posts });
    vi.stubGlobal('chrome', { scripting: { executeScript: async (params: { func: (id: string) => unknown; args: string[] }) => [{ result: await params.func(...params.args as [string]) }] } });
    const result = await readXPost(1, '123');
    expect(result.text).toBe('Texte demand�');
    expect(result.hasVideo).toBe(false);
  });
  it('refuse un identifiant absent du fil', async () => {
    vi.stubGlobal('location', { hostname: 'x.com', pathname: '/home' });
    vi.stubGlobal('document', { querySelectorAll: () => [article('1234', 'Autre')] });
    vi.stubGlobal('chrome', { scripting: { executeScript: async (params: { func: (id: string) => unknown; args: string[] }) => [{ result: await params.func(...params.args as [string]) }] } });
    await expect(readXPost(1, '123')).rejects.toThrow('Publication non visible');
  });
});
