const VIEWER = 'index.html';
const openViewer = (index) => chrome.tabs.create({ url: chrome.runtime.getURL(VIEWER), index });

chrome.action.onClicked.addListener((tab) => openViewer(tab ? tab.index + 1 : undefined));
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.type === 'open-viewer') openViewer(sender.tab ? sender.tab.index + 1 : undefined);
});
chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') openViewer();
});
