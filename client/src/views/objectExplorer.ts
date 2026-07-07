import {
  TreeDataProvider,
  TreeItem,
  TreeItemCollapsibleState,
  Uri,
  EventEmitter,
  Event,
  ThemeIcon,
  commands,
  window
} from "vscode"
import { getRoot, ADTSCHEME, getConnectedRoots } from "../adt/conections"
import { isAbapFolder, isAbapStat, isFolder } from "abapfs"
import { isAbapFile } from "abapfs"

export class ObjectExplorerNode extends TreeItem {
  constructor(
    public readonly label: string,
    public readonly adtUri: Uri | undefined,
    public readonly isFile: boolean,
    collapsibleState: TreeItemCollapsibleState,
    public readonly connId?: string
  ) {
    super(label, collapsibleState)
    if (isFile && adtUri) {
      this.command = {
        title: "Open",
        command: "vscode.open",
        arguments: [adtUri]
      }
      this.contextValue = "abapObject"
    } else if (connId && !adtUri) {
      this.contextValue = "abapSystem"
      this.iconPath = new ThemeIcon("server")
    } else {
      this.contextValue = "abapFolder"
    }
  }
}

export class ObjectExplorerProvider implements TreeDataProvider<ObjectExplorerNode> {
  private _onDidChangeTreeData = new EventEmitter<ObjectExplorerNode | undefined>()
  readonly onDidChangeTreeData: Event<ObjectExplorerNode | undefined> =
    this._onDidChangeTreeData.event

  private static instance: ObjectExplorerProvider
  private filterText = ""

  static get() {
    if (!ObjectExplorerProvider.instance) {
      ObjectExplorerProvider.instance = new ObjectExplorerProvider()
    }
    return ObjectExplorerProvider.instance
  }

  refresh() {
    this._onDidChangeTreeData.fire(undefined)
  }

  async promptFilter() {
    const input = await window.showInputBox({
      prompt: "Filter Object Explorer (leer = Filter entfernen)",
      placeHolder: "z.B. CL_PIM oder FI_POST",
      value: this.filterText
    })
    if (input === undefined) return
    this.filterText = input.toUpperCase()
    this.refresh()
  }

  clearFilter() {
    this.filterText = ""
    this.refresh()
  }

  get isFiltered() {
    return this.filterText.length > 0
  }

  getTreeItem(element: ObjectExplorerNode): TreeItem {
    return element
  }

  async getChildren(element?: ObjectExplorerNode): Promise<ObjectExplorerNode[]> {
    if (!element) {
      return this.getRootNodes()
    }
    // System-level node: return its package children
    if (element.connId && !element.adtUri) {
      return this.getSystemChildren(element.connId)
    }
    return this.getChildNodes(element)
  }

  private getRootNodes(): ObjectExplorerNode[] {
    const roots = getConnectedRoots()
    if (roots.size === 0) {
      return [
        new ObjectExplorerNode(
          "No connection — use 'ABAP FS: Connect' first",
          undefined,
          false,
          TreeItemCollapsibleState.None
        )
      ]
    }

    // Multiple systems: create system-level parent nodes
    if (roots.size > 1) {
      const nodes: ObjectExplorerNode[] = []
      for (const [connId] of roots) {
        nodes.push(
          new ObjectExplorerNode(
            connId,
            undefined,
            false,
            TreeItemCollapsibleState.Expanded,
            connId
          )
        )
      }
      return nodes
    }

    // Single system: flat list with description showing connId
    const [connId, root] = [...roots.entries()][0]
    return this.buildPackageNodes(connId, root)
  }

  private getSystemChildren(connId: string): ObjectExplorerNode[] {
    const roots = getConnectedRoots()
    const root = roots.get(connId)
    if (!root) return []
    return this.buildPackageNodes(connId, root)
  }

  private buildPackageNodes(connId: string, root: Iterable<{ name: string; file: any }>): ObjectExplorerNode[] {
    const nodes: ObjectExplorerNode[] = []
    for (const { name, file } of root) {
      const uri = Uri.parse(`${ADTSCHEME}://${connId}/${name}`)
      const isDir = isFolder(file)
      const node = new ObjectExplorerNode(
        name,
        uri,
        !isDir,
        isDir ? TreeItemCollapsibleState.Collapsed : TreeItemCollapsibleState.None
      )
      node.description = connId
      nodes.push(node)
    }
    return nodes
  }

  private async getChildNodes(element: ObjectExplorerNode): Promise<ObjectExplorerNode[]> {
    if (!element.adtUri) return []

    const connId = element.adtUri.authority
    let root
    try {
      root = getRoot(connId)
    } catch {
      return []
    }

    const path = element.adtUri.path
    let node = root.getNode(path)

    if (!node && path) {
      node = await root.getNodeAsync(path)
    }

    if (!node || !isFolder(node)) return []

    if (isAbapFolder(node) && node.size === 0) {
      await node.refresh()
    }

    const children: ObjectExplorerNode[] = []
    for (const { name, file } of node as Iterable<{ name: string; file: any }>) {
      const childPath = `${path}/${name}`
      const childUri = element.adtUri.with({ path: childPath })
      const isDir = isFolder(file)
      const isAbap = isAbapFile(file)

      let itemLabel = name
      if (isAbapStat(file) && isAbapFolder(file)) {
        itemLabel = file.object?.name || name
      }

      children.push(
        new ObjectExplorerNode(
          itemLabel,
          childUri,
          !isDir,
          isDir ? TreeItemCollapsibleState.Collapsed : TreeItemCollapsibleState.None
        )
      )
    }

    const filtered = this.filterText
      ? children.filter(
          (c) =>
            !c.isFile || c.label!.toString().toUpperCase().includes(this.filterText)
        )
      : children

    return filtered.sort((a, b) => {
      if (a.isFile === b.isFile) return a.label!.toString().localeCompare(b.label!.toString())
      return a.isFile ? 1 : -1
    })
  }
}
