//* This file is part of the MOOSE framework
//* https://www.mooseframework.org
//*
//* Licensed under LGPL 2.1, please see LICENSE for details
//* https://www.gnu.org/licenses/lgpl-2.1.html

import * as fs from 'fs';
import * as process from 'process';
import * as path from 'path';
import { formatDistance } from 'date-fns';
import { window, workspace, ExtensionContext, Disposable, QuickPickItem, QuickPickItemKind, Uri } from 'vscode';

import {
    LanguageClient,
    LanguageClientOptions,
    ServerOptions,
    TransportKind,
    NotificationType,
    NotificationType0,
    State
} from 'vscode-languageclient/node';

let client: LanguageClient | null = null;

// these must match the declarations in server/src/interfaces.ts
export const serverError = new NotificationType<string>('serverErrorNotification');
export const serverDebug = new NotificationType<string>('serverDebugNotification');
export const serverStartWork = new NotificationType0('serverStartWork');
export const serverStopWork = new NotificationType0('serverStopWork');
export const clientDataSend = new NotificationType<string>('clientDataSend');

let statusDisposable: Disposable | null;

async function pickServer() {
    // find executables
    const files = await workspace.findFiles('**/*-opt');

    // analyze candidates
    let executables = files.map(f => {
        let p = f.fsPath;

        // check if p is executable
        try {
            fs.accessSync(p, fs.constants.X_OK);
        } catch (err) {
            return undefined;
        }

        // get mtime
        let stats = fs.statSync(p);
        let mtime = stats.mtime;
        return {
            mtime: mtime.getTime(),
            item: {
                label: f.fsPath,
                detail: 'Last updated ' + formatDistance(mtime, new Date(), { addSuffix: true })
            }
        };
    }).filter(i => i !== undefined);

    // sort by modification time
    executables.sort((a, b) => b.mtime - a.mtime);

    // items
    let items: QuickPickItem[] = executables.map(e => e.item);

    // env var set?
    const env_var = 'MOOSE_LANGUAGE_SERVER'
    if (env_var in process.env) {
        let recommended: QuickPickItem[] = [
            {
                label: 'Recommended',
                kind: QuickPickItemKind.Separator
            },
            { label: process.env[env_var], detail: 'Environment Variable' },
            {
                label: 'Workspace Executables',
                kind: QuickPickItemKind.Separator
            }
        ];
        items = recommended.concat(items);
    }

    // build quick pick
    const result = await window.showQuickPick(items, {
        placeHolder: 'MOOSE Executable'
    });

    // no selection
    if (!result) return;

    // otherwise start a server

    // The debug options for the server
    // --inspect=6009: runs the server in Node's Inspector mode so VS Code can attach to the server for debugging
    const debugOptions = { execArgv: ['--nolazy', '--inspect=6009'] };

    const serverOptions: ServerOptions = {
        command: result.label,
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
        client.onDidChangeState(e => {
            console.log("client.onDidChangeState ", e);
            if (e.newState == State.Stopped) {
                client = null;
            }
        });
    });
}

export async function activate(context: ExtensionContext) {
    pickServer();

    // If no server is running yet and we swithc to a new MOOSE input, we offer the choice again  
    window.onDidChangeActiveTextEditor(editor => {
        if (editor && !client) {
            const doc = editor.document;
            if (doc.languageId == 'moose') {
                pickServer();
            }
        }
    });
}

export function deactivate(): Thenable<void> | undefined {
    if (!client) {
        return undefined;
    }
    return client.stop();
}
