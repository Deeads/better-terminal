const { contextBridge, ipcRenderer } = require('electron');
const subscribe = (channel, callback) => {
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};
contextBridge.exposeInMainWorld('betterTerminal', {
  bootstrap: () => ipcRenderer.invoke('app:bootstrap'),
  chooseFolder: () => ipcRenderer.invoke('project:choose'),
  addProject: folder => ipcRenderer.invoke('project:add', folder),
  removeProject: id => ipcRenderer.invoke('project:remove', id),
  projectContext: (id, refresh) => ipcRenderer.invoke('project:context', id, refresh),
  suggestions: (id, revision) => ipcRenderer.invoke('terminal:suggest', id, revision),
  completeTerminal: (id, request) => ipcRenderer.invoke('terminal:complete', id, request),
  onInputState: callback => subscribe('terminal:input-state', callback),
  pinProject: id => ipcRenderer.invoke('project:pin', id),
  forgetProject: id => ipcRenderer.invoke('project:forget', id),
  history: (id, query, offset) => ipcRenderer.invoke('history:list', id, query, offset),
  deleteHistory: (id, entryId) => ipcRenderer.invoke('history:delete', id, entryId),
  exportHistory: id => ipcRenderer.invoke('history:export', id),
  updateSettings: patch => ipcRenderer.invoke('settings:update', patch),
  saveLayout: tabs => ipcRenderer.invoke('layout:save', tabs),
  createTerminal: options => ipcRenderer.invoke('terminal:create', options),
  startTerminal: id => ipcRenderer.send('terminal:start', id),
  writeTerminal: (id, data) => ipcRenderer.send('terminal:write', id, data),
  resizeTerminal: (id, cols, rows) => ipcRenderer.send('terminal:resize', id, cols, rows),
  acknowledge: (id, size) => ipcRenderer.send('terminal:ack', id, size),
  closeTerminal: id => ipcRenderer.invoke('terminal:close', id),
  onCloseRequested: callback => subscribe('window:close-requested', callback),
  confirmWindowClose: approved => ipcRenderer.send('window:confirm-close', approved),
  windowAction: action => ipcRenderer.send('window:action', action),
  openLink: url => ipcRenderer.invoke('app:link', url),
  copy: text => ipcRenderer.invoke('clipboard:write', text),
  paste: () => ipcRenderer.invoke('clipboard:read'),
  onData: callback => subscribe('terminal:data', callback),
  onExit: callback => subscribe('terminal:exit', callback),
  onCwd: callback => subscribe('terminal:cwd', callback),
  onProjects: callback => subscribe('projects:changed', callback),
  onHistory: callback => subscribe('history:changed', callback),
  onError: callback => subscribe('app:error', callback),
});
