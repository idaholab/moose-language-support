import {
    TextDocumentPositionParams
} from 'vscode-languageserver/node';

import * as Parser from 'web-tree-sitter';
import * as path from 'path';
import * as readline from 'readline';
import * as fs from 'fs-plus';
import * as cp from 'child_process';

import * as vscode from 'vscode';
import { URI } from 'vscode-uri'

// while the Parser is initializing and loading the language, we block its use
var parser: Parser | null = null;
let tree = null;

Parser.init().then(function () {
    return Parser.Language.load(path.join(__dirname, './tree-sitter-hit.wasm')).then(function (lang) {
        parser = new Parser();
        return parser.setLanguage(lang);
    });
});

const insideBlockTag = /^\s*\[([^\]#\s]*)$/;
const parameterCompletion = /^\s*[^\s#=\]]*$/;
const typeParameter = /^\s*type\s*=\s*[^\s#=\]]*$/;
const otherParameter = /^\s*([^\s#=\]]+)\s*=\s*('\s*[^\s'#=\]]*(\s?)[^'#=\]]*|[^\s#=\]]*)$/;
const mooseApp = /^(.*)-(opt|dbg|oprof|devel)$/;
const stdVector = /^std::([^:]+::)?vector<([a-zA-Z0-9_]+)(,\s?std::\1allocator<\2>\s?)?>$/;

const suggestionIcon = {
    required: '<i class="icon-primitive-square text-error"></i>',
    hasDefault: '<i class="icon-primitive-square text-success"></i>',
    noDefault: '<i class="icon-primitive-dot text-success"></i>',
    type: '<i class="icon-gear keyword"></i>',
    output: '<i class="icon-database text-info"></i>'
};

// we cache the settings here so we don't have to pass them as function arguments
var mySettings;

// each moose input file in the project dir could have its own moose app and
// json/syntax associated this table points to the app dir for each editor path
let appDirs = {};
let syntaxWarehouse = {};
let offlineSyntax = null;

// Clear the cache for the app associated with current file.
// This is made available as a VSCode command.
export function clearCache() {
    var appPath, editor, filePath;
    //editor = atom.workspace.getActiveTextEditor(); TODO!
    filePath = path.dirname(editor.getPath());
    if (filePath in appDirs) {
        appPath = appDirs[filePath].appPath;
        delete appDirs[filePath];
        if (appPath in syntaxWarehouse) {
            return delete syntaxWarehouse[appPath];
        }
    }
}

function findApp(filePath: string): string | null {
    var fallbackMooseDir, file, fileTime, fileWithPath, i, isWSL, len, match, matches, previous_path, ref, searchPath, stats, wslDistro, wslPath;
    if (filePath == null) {
        vscode.window.showErrorMessage('File not saved, nowhere to search for MOOSE syntax data.');
        return null;
    }
    if (filePath in appDirs) {
        return appDirs[filePath];
    }
    // is this a WSL (Windows Subsystem for Linux) path?
    isWSL = filePath.slice(0, 7).toLowerCase() === '\\\\wsl$\\';
    searchPath = filePath;
    matches = [];
    while (true) {
        ref = fs.readdirSync(searchPath);
        // list all files
        for (i = 0, len = ref.length; i < len; i++) {
            file = ref[i];
            match = mooseApp.exec(file);
            if (match) {
                fileWithPath = path.join(searchPath, file);
                if (!isWSL && !fs.isExecutableSync(fileWithPath)) {
                    // on non-WSL systems we make sure the matched path is executable
                    continue;
                }
                stats = fs.statSync(fileWithPath);
                if (!isWSL && stats.isDirectory()) {
                    // ignore directories that match the naming pattern
                    continue;
                }
                fileTime = stats.mtime.getTime();
                // convert from Windows to WSL Unix path
                if (isWSL) {
                    wslPath = fileWithPath.slice(7).split('\\');
                    fileWithPath = '/' + wslPath.slice(1).join('/');
                    wslDistro = wslPath[0];
                } else {
                    wslDistro = null;
                }
                matches.push({
                    appPath: searchPath,
                    appName: match[1],
                    appFile: fileWithPath,
                    appDate: fileTime,
                    appWSL: wslDistro
                });
            }
        }
        if (matches.length > 0) {
            // return newest application
            matches.sort(function (a, b) {
                return b.appDate - a.appDate;
            });
            appDirs[filePath] = matches[0];
            return appDirs[filePath];
        }
        // go to parent
        previous_path = searchPath;
        searchPath = path.join(searchPath, '..');
        if (searchPath === previous_path) {
            // no executable found, let's check the fallback path
            fallbackMooseDir = mySettings.fallbackMooseDir;
            if (fallbackMooseDir !== '' && filePath !== fallbackMooseDir) {
                return findApp(fallbackMooseDir);
            }
            if (!mySettings.ignoreMooseNotFoundError) {
                // otherwise pop up an error notification (if not disabled) end give up
                vscode.window.showErrorMessage('No MOOSE application executable found.');
            }
            return null;
        }
    }
}

// fetch JSON syntax data
function loadSyntax(app) {
    var appDate, appFile, appName, appPath, cacheDate, cacheDir, cacheFile, loadCache, w;
    ({ appPath, appName, appFile, appDate } = app);
    // prepare entry in the syntax warehouse
    w = syntaxWarehouse[appPath] = {};
    // do not cache offlineSyntax
    if (appName) {
        // we cache syntax data here
        cacheDir = path.join(__dirname, '..', 'cache');
        fs.makeTreeSync(cacheDir);
        cacheFile = path.join(cacheDir, `${appName}.json`);

        // see if the cache file exists
        if (fs.existsSync(cacheFile)) {
            cacheDate = fs.statSync(cacheFile).mtime.getTime();
            // if the cacheFile is newer than the app compile date we use the cache
            if (cacheDate > appDate) {
                // load and parse the cached syntax
                try {
                    let result = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
                    if (!('blocks' in result)) {
                        // validate cache version
                        throw 'Invalid cache';
                    }

                    return w.json = result;
                } catch (error) {
                    // TODO: rebuild syntax if loading the cache fails
                    vscode.window.showWarningMessage('Failed to load cached syntax (probably a legacy cache file).');
                    delete syntaxWarehouse[appPath];
                    return fs.unlink(cacheFile, function () { });
                };
            }
        }
    }

    return rebuildSyntax(app, cacheFile, w);
}

// rebuild syntax
function rebuildSyntax(app, cacheFile, w) {
    var appDate, appFile, appName, appPath, appWSL, mooseJSON, workingNotification;
    ({ appPath, appName, appFile, appDate, appWSL } = app);

    // open notification about syntax generation
    workingNotification = vscode.window.setStatusBarMessage('Rebuilding MOOSE syntax data.');

    var args: Array<string>, jsonData: string, moose;

    // either run moose or use the offlineSyntax file
    try {
        if (appFile != null) {
            args = ['--json'];
            if (mySettings.allowTestObjects) {
                args.push('--allow-test-objects');
            }
            if (appWSL) {
                moose = cp.spawnSync('wsl', ['-d', appWSL, appFile].concat(args, {
                    stdio: ['pipe', 'pipe', 'ignore']
                }));
            } else {
                moose = cp.spawnSync(appFile, args, {
                    stdio: ['pipe', 'pipe', 'ignore']
                });
            }

            // check if the MOOSE app ran successfully
            if (moose.status != 0)
                throw 'Failed to run MOOSE to obtain syntax data';

            // clip the JSON from the output using the markers
            const beginMarker = '**START JSON DATA**\n';
            const endMarker = '**END JSON DATA**\n';
            let begin = moose.stdout.indexOf(beginMarker);
            let end = moose.stdout.lastIndexOf(endMarker);

            if (begin < 0 || end < begin) {
                throw 'Markers not found';
            }

            // parse the JSON
            jsonData = moose.stdout.slice(begin + beginMarker.length, end); // Wat?!
        } else {
            try {
                // read offline syntax dump (./moose-opt --json > offlinesyntax)
                jsonData = fs.readFileSync(appPath, 'utf8');
            } catch (e) {
                throw `Failed to load offline syntax file '${offlineSyntax}'`;
            }

            // parse the JSON
            w.json = JSON.parse(jsonData);

            // write the JSON cache
            if (cacheFile != null) {
                fs.writeFile(cacheFile, JSON.stringify(w.json), function () { });
            }
        }

        workingNotification.dispose();
        return w;
    } catch (error) {
        workingNotification.dispose();
        console.log(error);
        vscode.window.showErrorMessage(error != null ? error.text : "Failed to obtain syntax data");
    }
}

export function getSuggestions(request: TextDocumentPositionParams, settings) {
    var dir, loaded, w;

    let uri: URI = URI.parse(request.textDocument.uri);
    if (uri.scheme != 'file')
        return;
    let filePath: string = uri.fsPath;

    // cache settings
    mySettings = settings;

    // lookup application for current input file (cached)
    if (offlineSyntax) {
        dir = {
            appPath: offlineSyntax,
            appName: null,
            appFile: null,
            appDate: null,
            appWSL: null
        };
    } else {
        dir = findApp(filePath);
    }
    if (dir == null) {
        return [];
    }

    // check if the syntax is already loaded, currently loading,
    // or not requested yet
    if (!(dir.appPath in syntaxWarehouse)) {
        // return a promise that gets fulfilled as soon as the syntax data is loaded
        loadSyntax(dir);

        // watch executable (unless it's WSL)
        if ((dir.appFile != null) && (dir.appWSL == null)) {
            fs.watch(dir.appFile, function (event, filename) {
                // force rebuilding of syntax if executable changed
                delete appDirs[filePath];
                return delete syntaxWarehouse[dir.appPath];
            });
        }
        // perform completion
        return prepareCompletion(request, syntaxWarehouse[dir.appPath]);
    }

    w = syntaxWarehouse[dir.appPath];
    return this.prepareCompletion(request, w);
}

