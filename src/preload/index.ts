import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import path from 'path'
import { clipboard } from 'electron'

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
    openDocumentBtn: document.getElementById('openDocumentBtn'),
    fileTextArea: document.getElementById('fileTextArea') as HTMLTextAreaElement
  }

  el.createDocumentBtn?.addEventListener('click', () => {
    ipcRenderer.send('create-document-triggered')
  })

  el.openDocumentBtn?.addEventListener('click', () => {
    ipcRenderer.send('open-document-triggered')
  })

  let composing = false
  el.fileTextArea.addEventListener('compositionstart', () => {
    composing = true
  })

  el.fileTextArea.addEventListener('compositionend', (event) => {
    composing = false
    ipcRenderer.send('input', {
      value: event.data,
      offset: el.fileTextArea.selectionStart - event.data.length
    })
  })

  el.fileTextArea.addEventListener('keydown', (event) => {
    if (composing) {
      // IMEセッション中は特別な処理をスキップ
      return
    }

    const offset = el.fileTextArea.selectionStart
    let count = el.fileTextArea.selectionEnd - el.fileTextArea.selectionStart
    count = count < 1 ? 1 : count

    // Ctrl-x (カット) の処理
    if (event.ctrlKey && event.key === 'x') {
      // テキストエリアから選択されたテキストを取得
      const selectedText = el.fileTextArea.value.substring(
        el.fileTextArea.selectionStart,
        el.fileTextArea.selectionEnd
      )
      // クリップボードにテキストを設定
      clipboard.writeText(selectedText)

      // 選択されたテキストを削除
      ipcRenderer.send('delete', { offset, count })

      // イベントのデフォルト動作を防止
      event.preventDefault()
    } // Ctrl-v (ペースト) の処理
    else if (event.ctrlKey && event.key === 'v') {
      // クリップボードからテキストを取得
      const textToPaste = clipboard.readText()
      ipcRenderer.send('input', {
        value: textToPaste,
        offset
      })
      // イベントのデフォルト動作を防止
      event.preventDefault()
    }
    // カーソル移動やコピー＆ペーストは許可する
    else if (
      !event.ctrlKey &&
      !event.metaKey &&
      ![
        'ArrowLeft',
        'ArrowRight',
        'ArrowUp',
        'ArrowDown',
        'Home',
        'End',
        'Process',
        'Shift',
        'Escape'
      ].includes(event.key)
    ) {
      if (event.key === 'Backspace') {
        ipcRenderer.send('backspace', { offset, count: 1 }) // TODO: 🔥Backspaceで範囲選択できるようにする
      } else if (event.key === 'Delete') {
        ipcRenderer.send('delete', { offset, count })
      } else {
        ipcRenderer.send('input', {
          value: event.key,
          offset
        })
      }

      event.preventDefault()
    }
  })

  const handleScroll = (): void => {
    // スクロール位置 + テキストエリアの可視領域の高さ
    const currentPosition = el.fileTextArea.scrollTop + el.fileTextArea.clientHeight

    // テキストエリアの全体高さ
    const maxHeight = el.fileTextArea.scrollHeight

    if (currentPosition >= maxHeight * 0.8) {
      ipcRenderer.send('scroll-down')
    }
  }

  el.fileTextArea.addEventListener('scroll', () => {
    handleScroll()
  })

  const setCursorToTop = (): void => {
    // カーソル位置を最上部に設定
    el.fileTextArea.scrollTop = 0

    // カーソルをテキストエリアの最初の位置に設定
    el.fileTextArea.selectionStart = 0
    el.fileTextArea.selectionEnd = 0
  }

  const handleDocumentChange = (filePath: string, content: string = ''): void => {
    if (el.documentName) {
      el.documentName.innerHTML = path.parse(filePath).base
    }
    if (el.fileTextArea) {
      el.fileTextArea.removeAttribute('disabled')
      el.fileTextArea.value = content
      el.fileTextArea.focus()
    }
  }

  ipcRenderer.on('document-created', (_, filePath) => {
    handleDocumentChange(filePath)
  })

  ipcRenderer.on('document-opened', (_, { filePath, content }) => {
    handleDocumentChange(filePath, content)
    setCursorToTop() // ファイル読み込み時にカーソルを先頭に移動
  })

  ipcRenderer.on('content-loaded', (_, { filePath, content, caretPosition }) => {
    handleDocumentChange(filePath, content)
    // キャレットの位置を調整
    el.fileTextArea.selectionStart = caretPosition
    el.fileTextArea.selectionEnd = caretPosition
  })
})
