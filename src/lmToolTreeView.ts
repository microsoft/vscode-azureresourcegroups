import * as vscode from 'vscode';

export interface LmTreeNode {
    label: string;
    children?: (LmTreeNode & Record<string, unknown>)[];
}

const exampleTree: LmTreeNode = {
    "label": "Programming Languages",
    "children": [
        {
            "label": "Frontend",
            "children": [
                {
                    "label": "JavaScript",
                    "children": [
                        {
                            "label": "React",
                            "version": "18.2.0"
                        },
                        {
                            "label": "Vue",
                            "version": "3.3.4"
                        },
                        {
                            "label": "Angular",
                            "version": "17.0.0"
                        }
                    ]
                },
                {
                    "label": "CSS",
                    "children": [
                        {
                            "label": "Tailwind CSS",
                            "version": "3.3.5"
                        },
                        {
                            "label": "Bootstrap",
                            "version": "5.3.2"
                        },
                        {
                            "label": "Sass",
                            "version": "1.69.5"
                        }
                    ]
                }
            ]
        },
        {
            "label": "Backend",
            "children": [
                {
                    "label": "Python",
                    "children": [
                        {
                            "label": "Django",
                            "version": "4.2.7"
                        },
                        {
                            "label": "Flask",
                            "version": "2.3.3"
                        },
                        {
                            "label": "FastAPI",
                            "version": "0.104.1"
                        }
                    ]
                },
                {
                    "label": "Node.js",
                    "children": [
                        {
                            "label": "Express",
                            "version": "4.18.2"
                        },
                        {
                            "label": "NestJS",
                            "version": "10.2.1"
                        },
                        {
                            "label": "Koa",
                            "version": "2.14.2"
                        }
                    ]
                },
                {
                    "label": ".NET",
                    "children": [
                        {
                            "label": "ASP.NET Core",
                            "version": "8.0.0"
                        },
                        {
                            "label": "Entity Framework",
                            "version": "8.0.0"
                        },
                        {
                            "label": "Blazor",
                            "version": "8.0.0"
                        }
                    ]
                }
            ]
        },
        {
            "label": "Database",
            "children": [
                {
                    "label": "SQL",
                    "children": [
                        {
                            "label": "PostgreSQL",
                            "version": "16.0"
                        },
                        {
                            "label": "MySQL",
                            "version": "8.1.0"
                        },
                        {
                            "label": "SQL Server",
                            "version": "2022"
                        }
                    ]
                },
                {
                    "label": "NoSQL",
                    "children": [
                        {
                            "label": "MongoDB",
                            "version": "7.0.2"
                        },
                        {
                            "label": "Redis",
                            "version": "7.2.3"
                        },
                        {
                            "label": "Cosmos DB",
                            "version": "2023"
                        }
                    ]
                }
            ]
        }
    ]
}

export class LmToolTreeDataProvider implements vscode.TreeDataProvider<LmTreeNode> {
    private _onDidChangeTreeData: vscode.EventEmitter<LmTreeNode | undefined | void> = new vscode.EventEmitter<LmTreeNode | undefined | void>();
    readonly onDidChangeTreeData: vscode.Event<LmTreeNode | undefined | void> = this._onDidChangeTreeData.event;

    private tree: LmTreeNode | null = null;

    setTree(tree: LmTreeNode) {
        this.tree = tree;
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: LmTreeNode): vscode.TreeItem {
        const item = new vscode.TreeItem(element.label, element.children ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
        return item;
    }

    getChildren(element?: LmTreeNode): LmTreeNode[] {
        if (!this.tree) {
            return [];
        }
        if (!element) {
            return [this.tree];
        }
        return element.children || [];
    }
}
