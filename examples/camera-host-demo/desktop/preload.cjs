const {contextBridge, ipcRenderer} = require('electron')

contextBridge.exposeInMainWorld('cameraStudioDesktop', {
  loadScene: () => ipcRenderer.invoke('camera-studio:load-scene'),
  saveScene: (scene) => ipcRenderer.invoke('camera-studio:save-scene', scene),
  saveExport: (output) =>
    ipcRenderer.invoke('camera-studio:save-export', output),
  sceneClosed: (scene) =>
    ipcRenderer.invoke('camera-studio:scene-closed', scene),
  finishQuit: () => ipcRenderer.send('camera-studio:finish-quit'),
  onCommand(listener) {
    const receive = (_event, command) => listener(command)
    ipcRenderer.on('camera-studio:command', receive)
    return () => ipcRenderer.removeListener('camera-studio:command', receive)
  },
})
