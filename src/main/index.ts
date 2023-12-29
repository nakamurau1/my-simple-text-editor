import {
  app,
  shell,
  BrowserWindow,
  ipcMain,
  dialog,
  Notification,
  Menu,
  MenuItem,
  MenuItemConstructorOptions
} from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import fs from 'fs'
import { PieceTreeTextBufferBuilder, PieceTreeBase } from 'vscode-textbuffer'

const LINES_PER_READ = 50
const LINES_TO_MOVE_WHEN_SCROLLING = 20

let mainWindow: BrowserWindow
let openedFilePath: string
let pieceTreeTextBufferBuilder: PieceTreeTextBufferBuilder
let pieceTree: PieceTreeBase
let topDisplayedLine = 1 // 表示中の先頭行
let contentLoading = false

function createWindow(): void {
  // Create the browser window.
  mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    titleBarStyle: 'hiddenInset', // for mac
    show: false,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  const menuTemplate: MenuItem[] | MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Add New File',
          click: (): void => {
            ipcMain.emit('create-document-triggered')
          }
        },
        {
          label: 'Open File',
          click: (): void => {
            ipcMain.emit('open-document-triggered')
          }
        },
        {
          role: 'quit'
        }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' }
      ]
    }
  ]
  const menu = Menu.buildFromTemplate(menuTemplate)
  Menu.setApplicationMenu(menu)
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  createWindow()

  app.on('activate', function() {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// In this file you can include the rest of your app"s specific main process
// code. You can also put them in separate files and require them here.

const handleError = (): void => {
  new Notification({ title: 'Error', body: 'Sorry, something went wrong :)' }).show()
}

ipcMain.on('create-document-triggered', () => {
  dialog
    .showSaveDialog(mainWindow, {
      filters: [{ name: 'text files', extensions: ['txt'] }]
    })
    .then(({ filePath }) => {
      if (filePath) {
        fs.writeFile(filePath, '', (error) => {
          if (error) {
            handleError()
          } else {
            openedFilePath = filePath
            mainWindow.webContents.send('document-created', filePath)
          }
        })
      }
    })
})

const loadPieceTree = (content: string): void => {
  pieceTreeTextBufferBuilder = new PieceTreeTextBufferBuilder()
  pieceTreeTextBufferBuilder.acceptChunk(content)
  const pieceTreeFactory = pieceTreeTextBufferBuilder.finish(true)
  pieceTree = pieceTreeFactory.create(
    1 // DefaultEndOfLine.LF を指定すると実行時エラーになる問題が解決できないので
  )
}

const getLinesFromPieceTree = (startLine: number): string => {
  let extractedContent: string = ''
  let i = startLine
  const maxLineCount = pieceTree.getLineCount()
  while (i <= startLine + LINES_PER_READ && i <= maxLineCount) {
    extractedContent = extractedContent.concat(pieceTree.getLineContent(i) + '\n')
    i = i + 1
  }
  return extractedContent
}

ipcMain.on('open-document-triggered', () => {
  dialog
    .showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [{ name: 'text files', extensions: ['txt'] }]
    })
    .then((dialogReturnValue) => {
      const filePath = dialogReturnValue.filePaths[0]
      if (filePath) {
        fs.readFile(filePath, 'utf-8', (error, content) => {
          if (error) {
            handleError()
          } else {
            loadPieceTree(content)
            topDisplayedLine = 1
            const extractedContent: string = getLinesFromPieceTree(topDisplayedLine)
            openedFilePath = filePath
            mainWindow.webContents.send('document-opened', { filePath, content: extractedContent })
          }
        })
      }
    })
})

ipcMain.on('file-content-updated', (_, textAreaContent) => {
  fs.writeFile(openedFilePath, textAreaContent, (error) => {
    if (error) {
      handleError()
    }
  })
})

ipcMain.on('scroll-up', () => {
  if (contentLoading) return
  contentLoading = true

  topDisplayedLine = topDisplayedLine - LINES_TO_MOVE_WHEN_SCROLLING
  if (topDisplayedLine < 1) {
    topDisplayedLine = 1
  }
  const extractedContent: string = getLinesFromPieceTree(topDisplayedLine)
  mainWindow.webContents.send('content-loaded', { filePath: openedFilePath, content: extractedContent })
  contentLoading = false
})

ipcMain.on('scroll-down', () => {
  if (contentLoading) return
  contentLoading = true

  const maxLineCount = pieceTree.getLineCount()
  topDisplayedLine = topDisplayedLine + LINES_TO_MOVE_WHEN_SCROLLING
  if (maxLineCount - LINES_PER_READ < topDisplayedLine) {
    topDisplayedLine = maxLineCount - LINES_PER_READ
  }
  const extractedContent: string = getLinesFromPieceTree(topDisplayedLine)
  mainWindow.webContents.send('content-loaded', { filePath: openedFilePath, content: extractedContent })
  contentLoading = false
})

