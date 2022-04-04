import { AzExtParentTreeItem, AzExtTreeItem, callWithTelemetryAndErrorHandling, GenericTreeItem, IActionContext, IParsedError, parseError, TreeItemIconPath } from "@microsoft/vscode-azext-utils";
import { randomUUID } from "crypto";
import { ThemeColor, ThemeIcon, TreeItemCollapsibleState } from "vscode";

type OperationOption<T = string> = {
    running: T;
    onError?: (error: IParsedError) => T;
    onSuccess: () => T;
}

export interface OperationOptions {
    contextValuePostfix?: string;
    label: OperationOption<string>;
    description: OperationOption<string | undefined>;
    children?: Omit<OperationOption<(parent: AzExtParentTreeItem) => AzExtTreeItem[]>, 'running'>;
}

export interface CreateOperationOptions<T = void> extends OperationOptions {
    task: () => Thenable<T>;
}

interface OperationOptionsInternal extends CreateOperationOptions {
    iconPath: OperationOption<TreeItemIconPath>;
}

function helper<T>(option: OperationOption<T>, done: boolean, error?: IParsedError): T {
    if (done) {
        return error && option.onError ? option.onError(error) : option.onSuccess();
    }
    return option.running;
}

export class ActivityTreeItemBase extends AzExtParentTreeItem {

    public done: boolean = false;
    public error?: IParsedError;
    public readonly timestamp: number;

    private _options: OperationOptionsInternal;

    public constructor(parent: AzExtParentTreeItem, options: CreateOperationOptions) {
        super(parent);

        this.timestamp = Date.now();
        this.id = randomUUID();

        this._options = {
            ...options,
            iconPath: {
                running: new ThemeIcon('loading~spin'),
                onSuccess: () => new ThemeIcon('pass', new ThemeColor('testing.iconPassed')),
                onError: () => new ThemeIcon('error', new ThemeIcon('testing.iconFailed'))
            }
        }

        void callWithTelemetryAndErrorHandling('operation', async (context: IActionContext) => {
            try {
                await this._options.task();
            } catch (e) {
                this.error = parseError(e);
            } finally {
                this.done = true;
                void this.refresh(context);
            }
        });
    }

    public get contextValue(): string {
        const postfix = this._options.contextValuePostfix ? `.${this._options.contextValuePostfix}` : '';
        return `azureOperation.${this.done ? this.error ? 'failed' : 'succeeded' : 'running'}${postfix}`;
    }

    public get collapsibleState(): TreeItemCollapsibleState {
        return !this.done ? TreeItemCollapsibleState.None : TreeItemCollapsibleState.Collapsed;
    }

    public set collapsibleState(_value: TreeItemCollapsibleState) {
        // noop
    }

    public get label(): string {
        return this.getOption(this._options.label);
    }

    public get description(): string | undefined {
        return this.getOption(this._options.description);
    }

    public get iconPath(): TreeItemIconPath {
        return this.getOption(this._options.iconPath);
    }

    public async loadMoreChildrenImpl(_clearCache: boolean, _context: IActionContext): Promise<AzExtTreeItem[]> {
        if (this._options.children) {
            if (this.done) {
                return ((this.error && this._options.children.onError) ? this._options.children.onError?.(this.error) : this._options.children.onSuccess())(this);
            } else {
                return [];
            }
        }
        return [];
    }

    public hasMoreChildrenImpl(): boolean {
        return false;
    }

    private getOption<T>(option: OperationOption<T>): T {
        return helper(option, this.done, this.error);
    }
}

export function createResourceOperation<T>(task: () => Thenable<T>): CreateOperationOptions<T> {
    return {
        task,
        ...createOperationOptions
    }
}

export const createOperationOptions: OperationOptions = {
    label: {
        onSuccess: () => 'Create static web app',
        running: 'Creating static web app'
    },
    description: {
        running: undefined,
        onSuccess: () => 'Succeeded',
        onError: () => `Failed`
    },
    children: {
        onSuccess: () => (parent) => {
            return [
                new GenericTreeItem(parent, {
                    contextValue: 'operationError',
                    label: 'Hello',
                })
            ];
        },
        onError: (error) => (parent) => {
            return [
                new GenericTreeItem(parent, {
                    contextValue: 'operationError',
                    label: error.message
                })
            ];
        }
    }
}
