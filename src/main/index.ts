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
import {
  CommandManager,
  createCommandManager,
  createInsertCommand,
  createDeleteCommand
} from './document'

const LINES_TO_MOVE_WHEN_SCROLLING = 20
const LAST_LINE_ON_FILE_OPEN = 50

let mainWindow: BrowserWindow
let openedFilePath: string
let pieceTreeTextBufferBuilder: PieceTreeTextBufferBuilder
let pieceTree: PieceTreeBase
let lastLine = LAST_LINE_ON_FILE_OPEN
let contentLoading = false
let commandManager: CommandManager

const redrawWindow = (caretPosition?: number) => {
  const extractedContent: string = getLinesFromPieceTree(1, lastLine)

  mainWindow.webContents.send('content-loaded', {
    filePath: openedFilePath,
    content: extractedContent,
    caretPosition
  })
}

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
        {
          label: 'undo',
          accelerator: 'Ctrl+z',
          click: (): void => {
            commandManager.undo()
            // 再描画
            lastLine = pieceTree.getLineCount()
            redrawWindow(0)
          }
        },
        {
          label: 'redo',
          accelerator: 'Ctrl+y',
          click: (): void => {
            commandManager.redo()
            // 再描画
            lastLine = pieceTree.getLineCount()
            redrawWindow(0)
          }
        },
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

  app.on('activate', function () {
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
  commandManager = createCommandManager(pieceTree)
}

const getLinesFromPieceTree = (startLine: number, endLine: number): string => {
  let extractedContent: string = ''
  let i = startLine
  const maxLineCount = pieceTree.getLineCount()
  while (i <= endLine && i <= maxLineCount) {
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
            lastLine = LAST_LINE_ON_FILE_OPEN
            const extractedContent: string = getLinesFromPieceTree(1, lastLine)
            openedFilePath = filePath
            mainWindow.webContents.send('document-opened', { filePath, content: extractedContent })
          }
        })
      }
    })
})

ipcMain.on('input', (_, args: { value: string; offset: number }) => {
  if (args.offset > pieceTree.getLength()) return

  let value = args.value
  if (args.value === 'Enter') {
    value = '\n'
  }
  commandManager.executeCommand(createInsertCommand(args.offset, value))

  // 再描画
  lastLine = pieceTree.getLineCount()
  redrawWindow(args.offset + value.length)
})

ipcMain.on('scroll-down', () => {
  if (contentLoading) return
  contentLoading = true

  const maxLineCount = pieceTree.getLineCount()
  lastLine = lastLine + LINES_TO_MOVE_WHEN_SCROLLING
  if (maxLineCount < lastLine) {
    lastLine = maxLineCount
  }
  // 再描画
  redrawWindow()

  contentLoading = false
})

ipcMain.on('backspace', (_, args: { offset: number; count: number }) => {
  const { offset, count } = args

  if (offset < 1) return
  if (pieceTree.getLength() < offset) return

  commandManager.executeCommand(createDeleteCommand(offset - 1, count))

  lastLine = pieceTree.getLineCount()
  redrawWindow(offset - 1)
})

ipcMain.on('delete', (_, args: { offset: number; count: number }) => {
  const { offset } = args
  let { count } = args
  if (pieceTree.getLength() <= offset + count) {
    count = pieceTree.getLength() - offset
  }

  commandManager.executeCommand(createDeleteCommand(offset, count))

  lastLine = pieceTree.getLineCount()
  redrawWindow(offset)
})
