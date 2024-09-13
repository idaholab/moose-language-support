//* This file is part of the MOOSE framework
//* https://www.mooseframework.org
//*
//* Licensed under LGPL 2.1, please see LICENSE for details
//* https://www.gnu.org/licenses/lgpl-2.1.html

import * as fs from 'fs';
import * as process from 'process';
import * as path from 'path';
import { formatDistance } from 'date-fns';
import { window, commands, workspace, ExtensionContext, Disposable, QuickPickItem, QuickPickItemKind, Uri, TextDocument, FileType } from 'vscode';

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
let currentDocument: TextDocument | null = null;

// these must match the declarations in server/src/interfaces.ts
export const serverError = new NotificationType<string>('serverErrorNotification');
export const serverDebug = new NotificationType<string>('serverDebugNotification');
export const serverStartWork = new NotificationType0('serverStartWork');
export const serverStopWork = new NotificationType0('serverStopWork');
export const clientDataSend = new NotificationType<string>('clientDataSend');

let statusDisposable: Disposable | null;

// undefined means the user rejected autocomplete, null means the selector will be shown
let lastExecutablePick: string | null | undefined = null;

async function showRestartError() {
    const restart = 'Restart server.';
    const chosen = await window.showErrorMessage("MOOSE language server connection closed.", restart);
    if (chosen === restart) {
        pickServer()
    }
}

function tryStart() {
    client.start()
        .then(() => { /* maybe show a running indicator */ })
        .catch(() => {
            window.showErrorMessage("Failed to start MOOSE executable. You might need to rebuild it.");
            client = null;
            lastExecutablePick = null;
        });
}

async function pickServer() {
    // console.log(currentDocument, lastExecutablePick);
    if (!currentDocument) {
        return;
    }

    // user opted out of autocomplete for now
    if (lastExecutablePick === undefined) {
        let enable = "Enable";
        window.showInformationMessage("MOOSE Language Server disabled.", enable)
            .then(selection => {
                if (selection == enable) {
                    lastExecutablePick = null;
                    pickServer();
                }
            })
        return;
    }

    // prompt user to pick an executable
    if (lastExecutablePick === null) {
        // find executables (up the path)
        let executables = [];
        let uri = currentDocument.uri;

        const pattern = /(-opt|-dev|-oprof|-devel)$/;
        while (true) {
            // parent dir
            let newuri = Uri.joinPath(uri, "..");
            if (newuri == uri) break;
            uri = newuri;

            // list directory
            for (const [name, type] of await workspace.fs.readDirectory(uri)) {
                if (type !== FileType.Directory && pattern.exec(name)) {
                    let fileuri = Uri.joinPath(uri, name);

                    let p = fileuri.fsPath;
                    try {
                        // check if p is executable
                        fs.accessSync(p, fs.constants.X_OK);

                        // get modification time
                        let stat = fs.statSync(p);
                        executables.push(
                            {
                                mtime: stat.mtime,
                                item: {
                                    label: p,
                                    detail: 'Last updated ' + formatDistance(stat.mtime, new Date(), { addSuffix: true })
                                }
                            });
                    } catch (err) {
                        continue;
                    }
                }
            }
        }

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
                    label: 'Executables in parent directories',
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
        if (!result) {
            lastExecutablePick = undefined;
            return;
        }

        // otherwise start a server
        lastExecutablePick = result.label;
    }

    let executable = lastExecutablePick;

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
        let lastMtime = fs.statSync(executable).mtime;

        fs.watch(executable, { persistent: false }, (eventType, name) => {
            if (eventType == 'change' && client !== null) {
                // change gets fired for all kinds of things. here we check the modification time of the file.
                let mtime = fs.statSync(executable).mtime;
                if (mtime <= lastMtime)
                    return;
                lastMtime = mtime;

                window.showInformationMessage("MOOSE executable was updated, restarting language server.");
                client.stop().then(() => { tryStart(); });
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
        documentSelector: [{ scheme: 'file', language: 'moose' }]
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
    tryStart();
}

export async function activate(context: ExtensionContext) {
    let editor = window.activeTextEditor;
    if (editor)
        currentDocument = editor.document;
    pickServer();

    // If no server is running yet and we switch to a new MOOSE input, we offer the choice again
    window.onDidChangeActiveTextEditor(editor => {
        if (!editor || currentDocument === editor.document) return;
        if (editor.document.languageId === 'moose') {
            currentDocument = editor.document;
        }
        if (!client) {
            pickServer();
        }
    });

    // add command
    context.subscriptions.push(commands.registerCommand('mooseLanguageSupport.startServer', async () => {
        lastExecutablePick = null;
        if (client)
            client.stop().then(() => { client = null; pickServer(); });
        else
            pickServer();
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
