import { PieceTreeBase } from 'vscode-textbuffer'

// DocumentTextインターフェースの定義
interface DocumentText {
  insert(offset: number, value: string): void
  delete(offset: number, cnt: number): string
}

// コマンドインターフェースの定義
interface Command {
  execute(document: DocumentText): void
  undo(document: DocumentText): void
}

// コマンドオブジェクトを生成する関数
export const createInsertCommand = (offset: number, value: string): Command => {
  return {
    execute: (document) => document.insert(offset, value),
    undo: (document) => document.delete(offset, value.length)
  }
}

export const createDeleteCommand = (offset: number, cnt: number): Command => {
  let deletedText = ''
  return {
    execute: (document) => {
      deletedText = document.delete(offset, cnt)
    },
    undo: (document) => document.insert(offset, deletedText)
  }
}

// DocumentTextを実装する具体的なクラス
class PieceTreeBaseWrapper implements DocumentText {
  private pieceTree: PieceTreeBase

  constructor(pieceTree: PieceTreeBase) {
    this.pieceTree = pieceTree
  }

  insert(offset: number, value: string): void {
    this.pieceTree.insert(offset, value)
  }

  delete(offset: number, cnt: number): string {
    const startPos = this.pieceTree.nodeAt(offset)
    const endPos = this.pieceTree.nodeAt(offset + cnt)
    const deletionText = this.pieceTree.getValueInRange2(startPos, endPos)

    this.pieceTree.delete(offset, cnt)

    return deletionText
  }

  getContent(): string {
    return this.pieceTree.getLinesRawContent()
  }
}

// コマンド管理オブジェクト
export type CommandManager = {
  executeCommand: (command: Command) => void
  undo: () => void
  redo: () => void
  getDocument: () => string
}

export const createCommandManager = (pieceTree: PieceTreeBase): CommandManager => {
  const document: DocumentText = new PieceTreeBaseWrapper(pieceTree) // DocumentTextのインスタンス
  const undoStack: Command[] = []
  const redoStack: Command[] = []

  return {
    executeCommand: (command: Command) => {
      command.execute(document)
      undoStack.push(command)
      redoStack.length = 0 // 新しいコマンドを実行するとRedoスタックはクリアされる
    },
    undo: () => {
      const command = undoStack.pop()
      if (command) {
        command.undo(document)
        redoStack.push(command)
      }
    },
    redo: () => {
      const command = redoStack.pop()
      if (command) {
        command.execute(document)
        undoStack.push(command)
      }
    },
    getDocument: () => (document as PieceTreeBaseWrapper).getContent()
  }
}

// 使用例
// const commandManager = createCommandManager()
//
// commandManager.executeCommand(createInsertCommand(0, 'Hello, World!'))
// console.log(commandManager.getDocument()) // "Hello, World!"
//
// commandManager.executeCommand(createDeleteCommand(0, 5))
// console.log(commandManager.getDocument()) // ", World!"
//
// commandManager.undo()
// console.log(commandManager.getDocument()) // "Hello, World!"
//
// commandManager.redo()
// console.log(commandManager.getDocument()) // ", World!"
//
