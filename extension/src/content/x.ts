/** Bouton associé à l'identifiant de chaque publication, y compris dans un fil dynamique. */
function refreshButtons(): void {
  for (const article of document.querySelectorAll<HTMLElement>('article[data-testid="tweet"]')) {
    const time = Array.from(article.querySelectorAll('time')).find((t) => t.closest('article') === article);
    const href = time?.closest('a')?.getAttribute('href') ?? '';
    const id = href.match(/\/status\/(\d+)(?:[/?#]|$)/)?.[1];
    const previous = article.querySelector<HTMLButtonElement>('button[data-veracity-x]');
    if (!id) { previous?.remove(); continue; }
    if (previous) { previous.dataset.veracityX = id; continue; }
    const anchor = article.querySelector<HTMLElement>('[role="group"]');
    if (!anchor) continue;
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.veracityX = id;
    button.textContent = 'Vérifier avec Veracity';
    button.setAttribute('aria-label', 'Vérifier cette publication avec Veracity');
    Object.assign(button.style, { color: '#39d6bd', background: 'transparent', border: '1px solid #39d6bd', borderRadius: '999px', padding: '5px 10px', margin: '6px 0', cursor: 'pointer', fontSize: '12px' });
    button.addEventListener('click', (event) => {
      event.preventDefault(); event.stopPropagation();
      const selected = button.dataset.veracityX;
      if (selected) void chrome.runtime.sendMessage({ type: 'open-x', id: selected });
    });
    anchor.insertAdjacentElement('afterend', button);
  }
}

let scheduled = false;
new MutationObserver(() => {
  if (scheduled) return;
  scheduled = true;
  setTimeout(() => { scheduled = false; refreshButtons(); }, 200);
}).observe(document.documentElement, { subtree: true, childList: true });
refreshButtons();
