(() => {
  'use strict';
  const button=document.querySelector('#open-side-panel');let windowId=null;
  const initialize=async()=>{try{windowId=(await chrome.windows.getCurrent()).id;}catch{}};
  void initialize();
  button.addEventListener('click',()=>{
    if(!Number.isInteger(windowId)){document.querySelector('#chunk-feedback').textContent='Yan panel penceresi belirlenemedi; popup’ı yeniden aç.';return;}
    // Call directly in the click handler to preserve Chrome's required user gesture.
    void chrome.sidePanel.open({windowId}).catch(()=>{document.querySelector('#chunk-feedback').textContent='Yan panel açılamadı. Chrome 120+ ve sidePanel iznini kontrol et.';});
  });
})();
