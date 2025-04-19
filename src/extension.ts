//* This file is part of the MOOSE framework
//* https://www.mooseframework.org
//*
//* Licensed under LGPL 2.1, please see LICENSE for details
//* https://www.gnu.org/licenses/lgpl-2.1.html

import * as fs from 'fs';
import * as process from 'process';
import * as path from 'path';
import { formatDistance } from 'date-fns';
import { window, commands, workspace, ExtensionContext, Disposable, QuickPickItem, QuickPickItemKind, Uri, TextDocument, FileType, ThemeIcon } from 'vscode';

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
let my_context: ExtensionContext;

// these must match the declarations in server/src/interfaces.ts
export const serverError = new NotificationType<string>('serverErrorNotification');
export const serverDebug = new NotificationType<string>('serverDebugNotification');
export const serverStartWork = new NotificationType0('serverStartWork');
export const serverStopWork = new NotificationType0('serverStopWork');
export const clientDataSend = new NotificationType<string>('clientDataSend');

const RECENT_CHOICES_KEY = 'recentChoicesMooseLanguage';
const MAX_RECENT_CHOICES = 5;

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

function getRecentChoices(): string[] {
    return my_context.globalState.get<string[]>(RECENT_CHOICES_KEY) || [];
}

function updateRecentChoices(choice: string) {
    let recentChoices = getRecentChoices();
    recentChoices = [choice, ...recentChoices.filter(c => c !== choice)];
    if (recentChoices.length > MAX_RECENT_CHOICES) {
        recentChoices = recentChoices.slice(0, MAX_RECENT_CHOICES);
    }
    my_context.globalState.update(RECENT_CHOICES_KEY, recentChoices);
}

interface PathQuickPickItem extends QuickPickItem {
    fullPath: string;
    isDirectory: boolean;
    alwaysShow?: boolean;
}

export async function pickFile(startPath?: string): Promise<string | undefined> {
    const quickPick = window.createQuickPick<PathQuickPickItem>();
    quickPick.placeholder = 'Type a path; select a directory to enter it, or a file to pick it';
    quickPick.matchOnDescription = false;
    quickPick.matchOnDetail = false;

    let basePath = startPath
        ?? workspace.workspaceFolders?.[0].uri.fsPath
        ?? path.parse(process.cwd()).root;

    // initialize
    quickPick.value = basePath + path.sep;
    await updateItems(quickPick.value);

    quickPick.onDidChangeValue(async (value) => {
        await updateItems(value);
    });

    const selection = await new Promise<PathQuickPickItem | undefined>(resolve => {
        quickPick.onDidAccept(async () => {
            const sel = quickPick.selectedItems[0];
            if (!sel) {
                return; // nothing selected
            }

            if (sel.isDirectory) {
                // drill into directory
                quickPick.value = sel.fullPath + path.sep;
                await updateItems(quickPick.value);
            } else {
                // file picked → done
                resolve(sel);
                quickPick.hide();
            }
        });

        quickPick.onDidHide(() => resolve(undefined));
        quickPick.show();
    });

    return selection?.fullPath;

    // ——— helpers ———
    async function updateItems(input: string) {
        const sep = path.sep;
        let dir: string;
        let fragment: string;

        if (input.endsWith(sep)) {
            // “/foo/bar/” → strip trailing slash for filesystem call,
            // but keep dir=/foo/bar and fragment="" so we list *all* children
            dir = input.slice(0, -1);
            fragment = '';
        } else {
            // “/foo/bar/Ba” → split at last slash
            const idx = input.lastIndexOf(sep);
            if (idx >= 0) {
                dir = input.slice(0, idx);
                fragment = input.slice(idx + 1);
            } else {
                // no slash at all → stay in basePath (your starting folder)
                dir = basePath;
                fragment = input;
            }
        }

        // make `dir` absolute if the user typed something relative
        if (!path.isAbsolute(dir)) {
            dir = path.join(basePath, dir);
        }

        basePath = dir;  // so that “foo.txt” after no‑slash will use the correct folder

        try {
            const entries = await fs.promises.readdir(dir, { withFileTypes: true });
            var items = [];
            for (var entry of entries.filter(e => e.name.startsWith(fragment))) {
                const isDirectory = entry.isDirectory();
                const name = entry.name
                const fullPath = path.join(dir, name);
                let stat = fs.statSync(fullPath);
                const item = {
                    label: name + (isDirectory ? sep : ''),
                    description: isDirectory ? '' : 'Last updated ' + formatDistance(stat.mtime, new Date(), { addSuffix: true }),
                    fullPath: fullPath,
                    isDirectory: isDirectory,
                    alwaysShow: true,
                    iconPath: isDirectory ? ThemeIcon.Folder : new ThemeIcon('sparkle'),
                }
                if (isDirectory) {
                    items.push(item);
                }
                else {
                    if (name.endsWith('-opt') || name.endsWith('-dbg') || name.endsWith('-devel') || name.endsWith('-oprof')) {
                        try {
                            // check if item is executable
                            fs.accessSync(fullPath, fs.constants.X_OK);
                            items.unshift(item);
                        }
                        catch (err) { continue; }
                    }
                }
            }

            // add ..
            items.unshift({
                label: '..',
                description: 'Parent',
                fullPath: path.join(dir, '..'),
                isDirectory: true,
                alwaysShow: true,
                iconPath: ThemeIcon.Folder
            } as PathQuickPickItem);
            quickPick.items = items;
        } catch {
            quickPick.items = [];
        }
    }
}

async function pickServer() {
    if (!currentDocument) {
        return;
    }

    // env var set?
    const env_var = 'MOOSE_LANGUAGE_SERVER'
    if (env_var in process.env) {
        lastExecutablePick = process.env[env_var];
    }
    else {
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

            // we might have an "untitled" editor (an non existing file that was opend using the command line)
            // let's just drop the `untitled:` scheme and hope for the best. In the worst case the user can still
            // manually select an executable (or use one from the list of recent ones).
            if (uri.scheme == 'untitled') {
                uri = uri.with({ scheme: 'file' });
            }

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

            // add file selector
            items = items.concat([{
                label: 'Other options...',
                kind: QuickPickItemKind.Separator
            },
            { label: "Open File...", detail: 'Manually select an executable' }]);

            // add recent choices
            const recent = getRecentChoices();
            if (recent.length > 0) {
                items.push({
                    label: 'Recently used executables',
                    kind: QuickPickItemKind.Separator
                });
                items = items.concat(recent.map(name => ({ label: name })));
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
            if (result.label == 'Open File...') {
                const filePath = await pickFile();

                if (filePath) {
                    lastExecutablePick = filePath;
                } else {
                    lastExecutablePick = undefined;
                    return;
                }
            } else {
                lastExecutablePick = result.label;
            }
        }

        updateRecentChoices(lastExecutablePick);
    }

    let executable = lastExecutablePick;

    // The debug options for the server
    // --inspect=6009: runs the server in Node's Inspector mode so VS Code can attach to the server for debugging
    const debugOptions = { execArgv: ['--nolazy', '--inspect=6009'] };

    // build server options
    let ls_args = ['--language-server'];
    const config_test_objects = workspace.getConfiguration('languageServerMoose').get<boolean>("allowTestObjects");
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
        documentSelector: [{ scheme: 'file', language: 'moose' }, { scheme: 'untitled', language: 'moose' }]
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
    my_context = context;
    pickServer();

    // If no server is running yet and we switch to a new MOOSE input, we offer the choice again
    window.onDidChangeActiveTextEditor(editor => {
        if (!editor) {
            editor = window.activeTextEditor;
            if (!editor) {
                return;
            }
        }
        if (currentDocument === editor.document) {
            return;
        }

        if (editor.document.languageId === 'moose') {
            currentDocument = editor.document;
            if (!client) {
                pickServer();
            }
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
