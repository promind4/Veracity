chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') void chrome.runtime.openOptionsPage();
});

// Le bouton de la page demande l'ouverture du panneau ; open() doit être appelé tout de suite (geste utilisateur).
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.type === 'open-x' && sender.tab?.id && /^\d+$/.test(msg.id)) {
    const tabId = sender.tab.id;
    const windowId = sender.tab.windowId;
    // open() doit être déclenché pendant le geste utilisateur.
    chrome.sidePanel.open({ windowId }).catch(console.error);
    void chrome.storage.session.set({ pendingX: { tabId, windowId, id: msg.id } }).then(() =>
      chrome.runtime.sendMessage({ type: 'select-x', tabId, windowId, id: msg.id }).catch(() => {}));
    return;
  }
  if (msg?.type !== 'open-panel' || !sender.tab?.id) return;
  const tabId = sender.tab.id;
  const windowId = sender.tab.windowId;
  chrome.sidePanel.open({ windowId }).catch(console.error);
  void chrome.storage.session.set({ pendingAnalysis: { tabId, windowId, videoId: msg.videoId } });
  // Chaque fenêtre a son propre panneau : `windowId` permet aux autres de ne pas réagir.
  chrome.runtime.sendMessage({ type: 'start-analysis', tabId, windowId, videoId: msg.videoId }).catch(() => {
    // panneau pas encore ouvert : il lira pendingAnalysis au démarrage
  });
});
