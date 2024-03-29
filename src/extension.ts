//* This file is part of the MOOSE framework
//* https://www.mooseframework.org
//*
//* Licensed under LGPL 2.1, please see LICENSE for details
//* https://www.gnu.org/licenses/lgpl-2.1.html

import * as fs from 'fs';
import * as process from 'process';
import * as path from 'path';
import { formatDistance } from 'date-fns';
import { window, commands, workspace, ExtensionContext, Disposable, QuickPickItem, QuickPickItemKind, Uri } from 'vscode';

import {
    LanguageClient,
    LanguageClientOptions,
    ServerOptions,
    TransportKind,
    NotificationType,
    NotificationType0,
    State,
    ErrorAction,
    CloseAction
} from 'vscode-languageclient/node';
import { count, error } from 'console';
import { Message } from 'vscode-jsonrpc';

let client: LanguageClient | null = null;

// these must match the declarations in server/src/interfaces.ts
export const serverError = new NotificationType<string>('serverErrorNotification');
export const serverDebug = new NotificationType<string>('serverDebugNotification');
export const serverStartWork = new NotificationType0('serverStartWork');
export const serverStopWork = new NotificationType0('serverStopWork');
export const clientDataSend = new NotificationType<string>('clientDataSend');

let statusDisposable: Disposable | null;

async function showRestartError() {
    const restart = 'Restart server.';
    const chosen = await window.showErrorMessage("MOOSE language server connection closed.", restart);
    if (chosen === restart) {
        pickServer()
    }
}

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
    const executable = result.label;

    // The debug options for the server
    // --inspect=6009: runs the server in Node's Inspector mode so VS Code can attach to the server for debugging
    const debugOptions = { execArgv: ['--nolazy', '--inspect=6009'] };

    // build server options
    let ls_args = ['--language-server'];
    const config_test_objects = workspace.getConfiguration('languageServerMoose.allowTestObjects');
    if (config_test_objects) {
        ls_args.push('--allow-test-objects')
    }
    const serverOptions: ServerOptions = {
        command: executable,
        args: ls_args
    };

    // watch item and restart server upon changes
    try {
        fs.watch(executable, { persistent: false }, (eventType) => {
            if (eventType == 'change') {
                client.stop();
                window.showInformationMessage("MOOSE executable was updated, restarting language server.");
                client.start();
            }
            if (eventType == 'rename') {
                window.showInformationMessage("MOOSE language server executable was renamed or deleted.");
            }
        });
    } catch (err) {
    }

    // Options to control the language client
    const clientOptions: LanguageClientOptions = {
        // Register the server for MOOSE input files
        documentSelector: [{ scheme: 'file', language: 'moose' }],
        initializationFailedHandler: (error) => {
            window.showErrorMessage("MOOSE language server failed to initialize.");
            client = null;
            return false;
        }
    };

    // Create the language client and start the client.
    client = new LanguageClient(
        'languageServerMoose',
        'MOOSE Language Server',
        serverOptions,
        clientOptions
    );

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
    });
    client.onNotification(serverStopWork, () => {
        if (statusDisposable) {
            statusDisposable.dispose();
        }
        statusDisposable = null;
    });

    // Start the client. This will also launch the server
    await client.start();
}

export async function activate(context: ExtensionContext) {
    pickServer();

    // If no server is running yet and we switch to a new MOOSE input, we offer the choice again
    window.onDidChangeActiveTextEditor(editor => {
        if (!editor) return;
        if (!client) {
            const doc = editor.document;
            if (doc.languageId == 'moose') {
                pickServer();
            }
        }
    });

    // add command
	context.subscriptions.push(commands.registerCommand('mooseLanguageSupport.startServer', async () => {
        if (client) {
            client.stop();
            pickServer();
        }
	}));

    // update language specific configuration
    const config = workspace.getConfiguration("", { languageId: "moose" });
    config.update("outline.showProperties", false, false, true);
    config.update("outline.showStrings", false, false, true);
    config.update("gitlens.codeLens.scopes", ['document'], false, true);
}

export function deactivate(): Thenable<void> | undefined {
    if (!client) {
        return undefined;
    }
    return client.stop();
}
