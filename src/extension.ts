//* This file is part of the MOOSE framework
//* https://www.mooseframework.org
//*
//* Licensed under LGPL 2.1, please see LICENSE for details
//* https://www.gnu.org/licenses/lgpl-2.1.html

import * as path from 'path';
import * as rpc from 'vscode-jsonrpc/node';
import { window, workspace, ExtensionContext, Disposable, TextDocument, TextEdit } from 'vscode';
import * as hit from '../../lib/hit';

import {
    LanguageClient,
    LanguageClientOptions,
    ServerOptions,
    TransportKind
} from 'vscode-languageclient/node';

let client: LanguageClient;

// these must match the declarations in server/src/interfaces.ts
export const serverError = new rpc.NotificationType<string>('serverErrorNotification');
export const serverDebug = new rpc.NotificationType<string>('serverDebugNotification');
export const serverStartWork = new rpc.NotificationType0('serverStartWork');
export const serverStopWork = new rpc.NotificationType0('serverStopWork');

let statusDisposable: Disposable | null;

export function activate(context: ExtensionContext) {
    // register hit formatter
    vscode.languages.registerDocumentFormattingEditProvider('moose', {
        provideDocumentFormattingEdits(document: TextDocument): TextEdit[] {
            const firstLine = document.lineAt(0);
            if (firstLine.text !== '42') {
                return [vscode.TextEdit.insert(firstLine.range.start, '42\n')];
            }
        }
    });

    // The server is implemented in node
    const serverModule = context.asAbsolutePath(
        path.join('server', 'out', 'server.js')
    );

    // The debug options for the server
    // --inspect=6009: runs the server in Node's Inspector mode so VS Code can attach to the server for debugging
    const debugOptions = { execArgv: ['--nolazy', '--inspect=6009'] };

    // If the extension is launched in debug mode then the debug server options are used
    // Otherwise the run options are used
    const serverOptions: ServerOptions = {
        run: { module: serverModule, transport: TransportKind.ipc },
        debug: {
            module: serverModule,
            transport: TransportKind.ipc,
            options: debugOptions
        }
    };

    // Options to control the language client
    const clientOptions: LanguageClientOptions = {
        // Register the server for MOOSE input files
        documentSelector: [{ scheme: 'file', language: 'moose' }],
        synchronize: {
            // Notify the server about file changes to '.clientrc files contained in the workspace
            fileEvents: workspace.createFileSystemWatcher('**/.clientrc')
        }
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

export function deactivate(): Thenable<void> | undefined {
    if (!client) {
        return undefined;
    }
    return client.stop();
}
