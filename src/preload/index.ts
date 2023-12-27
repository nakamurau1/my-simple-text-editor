import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import path from 'path'

// Custom APIs for renderer
const api = {}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}

window.addEventListener('DOMContentLoaded', () => {
  const el = {
    documentName: document.getElementById('documentName'),
    createDocumentBtn: document.getElementById('createDocumentBtn'),
    fileTextArea: document.getElementById('fileTextArea')
  }

  el.createDocumentBtn?.addEventListener('click', () => {
    console.log('clicked createDocumentBtn')
    ipcRenderer.send('create-document-triggered')
  })

  ipcRenderer.on('document-created', (_, filePath) => {
    if (el.documentName) {
      el.documentName.innerHTML = path.parse(filePath).base
    }
    if (el.fileTextArea) {
      el.fileTextArea.removeAttribute('disabled')
      el.fileTextArea.nodeValue = ''
      el.fileTextArea.focus()
    }
  })
})
