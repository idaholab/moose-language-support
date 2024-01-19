//* This file is part of the MOOSE framework
//* https://www.mooseframework.org
//*
//* Licensed under LGPL 2.1, please see LICENSE for details
//* https://www.gnu.org/licenses/lgpl-2.1.html

import * as path from 'path';
import * as cp from 'child_process';
import { window, workspace, ExtensionContext, Disposable, QuickPickItem, Uri } from 'vscode';

import {
    LanguageClient,
    LanguageClientOptions,
    ServerOptions,
    TransportKind,
    NotificationType,
    NotificationType0
} from 'vscode-languageclient/node';

let client: LanguageClient | null = null;

// these must match the declarations in server/src/interfaces.ts
export const serverError = new NotificationType<string>('serverErrorNotification');
export const serverDebug = new NotificationType<string>('serverDebugNotification');
export const serverStartWork = new NotificationType0('serverStartWork');
export const serverStopWork = new NotificationType0('serverStopWork');
export const clientDataSend = new NotificationType<string>('clientDataSend');

let statusDisposable: Disposable | null;
class FileItem implements QuickPickItem {
    label: string;
    description: string;

    constructor(public base: Uri, public uri: Uri) {
        this.label = path.basename(uri.fsPath);
        this.description = path.dirname(path.relative(base.fsPath, uri.fsPath));
    }
}

class MessageItem implements QuickPickItem {

    label: string;
    description = '';
    detail: string;

    constructor(public base: Uri, public message: string) {
        this.label = message.replace(/\r?\n/g, ' ');
        this.detail = base.fsPath;
    }
}

async function pickFile() {
    const disposables: Disposable[] = [];
    try {
        return await new Promise<Uri | undefined>((resolve, reject) => {
            const input = window.createQuickPick<FileItem | MessageItem>();
            input.placeholder = 'Type to search for files';
            let rgs: cp.ChildProcess[] = [];
            disposables.push(
                input.onDidChangeValue(value => {
                    rgs.forEach(rg => rg.kill());
                    if (!value) {
                        input.items = [];
                        return;
                    }
                    input.busy = true;
                    const cwds = workspace.workspaceFolders ? workspace.workspaceFolders.map(f => f.uri.fsPath) : [process.cwd()];
                    const q = process.platform === 'win32' ? '"' : '\'';
                    rgs = cwds.map(cwd => {
                        const rg = cp.exec(`rg --files -g ${q}*${value}*${q}`, { cwd }, (err, stdout) => {
                            const i = rgs.indexOf(rg);
                            if (i !== -1) {
                                if (rgs.length === cwds.length) {
                                    input.items = [];
                                }
                                if (!err) {
                                    input.items = input.items.concat(
                                        stdout
                                            .split('\n').slice(0, 50)
                                            .map(relative => new FileItem(Uri.file(cwd), Uri.file(path.join(cwd, relative))))
                                    );
                                }
                                if (err && !(<any>err).killed && (<any>err).code !== 1 && err.message) {
                                    input.items = input.items.concat([
                                        new MessageItem(Uri.file(cwd), err.message)
                                    ]);
                                }
                                rgs.splice(i, 1);
                                if (!rgs.length) {
                                    input.busy = false;
                                }
                            }
                        });
                        return rg;
                    });
                }),
                input.onDidChangeSelection(items => {
                    const item = items[0];
                    if (item instanceof FileItem) {
                        resolve(item.uri);
                        input.hide();
                    }
                }),
                input.onDidHide(() => {
                    rgs.forEach(rg => rg.kill());
                    resolve(undefined);
                    input.dispose();
                })
            );
            input.show();
        });
    } finally {
        disposables.forEach(d => d.dispose());
    }
}

async function pickServer() {
    // find executables
    let executable = await pickFile();

    // The debug options for the server
    // --inspect=6009: runs the server in Node's Inspector mode so VS Code can attach to the server for debugging
    const debugOptions = { execArgv: ['--nolazy', '--inspect=6009'] };

    const serverOptions: ServerOptions = {
        command: executable.fsPath,
        args: ['--language-server']
        // transport: TransportKind.stdio,
        // options: debugOptions
    };

    // TODO: watch item and restart server upon changes

    // Options to control the language client
    const clientOptions: LanguageClientOptions = {
        // Register the server for MOOSE input files
        documentSelector: [{ scheme: 'file', language: 'moose' }]
    };

    // Create the language client and start the client.
    client = new LanguageClient(
        'languageServerMoose',
        'MOOSE Language Server',
        serverOptions,
        clientOptions
    );

    // Start the client. This will also launch the server
    client.start();

    // Once client is ready, we can send messages and add listeners for various notifications
    client.onReady().then(() => {
        // handle notifications
        client.onNotification(serverError, (msg: string) => {
            window.showErrorMessage(msg);
        });
        client.onNotification(serverDebug, (msg: string) => {
            console.log(msg);
        });

        client.onNotification(serverStartWork, () => {
            if (statusDisposable) {
                statusDisposable.dispose();
            }
            statusDisposable = window.setStatusBarMessage('Rebuilding MOOSE Syntax...');
        });
        client.onNotification(serverStopWork, () => {
            if (statusDisposable) {
                statusDisposable.dispose();
            }
            statusDisposable = null;
        });
    });
}

export async function activate(context: ExtensionContext) {
    pickServer();
}

export function deactivate(): Thenable<void> | undefined {
    if (!client) {
        return undefined;
    }
    return client.stop();
}
