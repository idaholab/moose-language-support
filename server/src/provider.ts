//* This file is part of the MOOSE framework
//* https://www.mooseframework.org
//*
//* Licensed under LGPL 2.1, please see LICENSE for details
//* https://www.gnu.org/licenses/lgpl-2.1.html

import {
    TextDocumentPositionParams,
    TextDocuments,
    Position,
    CompletionItem,
    CompletionItemKind,
    CompletionItemTag,
    Connection,
    InsertTextFormat
} from 'vscode-languageserver/node';

import {
    TextDocument
} from 'vscode-languageserver-textdocument';

import {
    MooseLanguageSettings,
    MooseSyntax,
    ParseTree,
    serverError,
    serverDebug,
    serverStartWork,
    serverStopWork
} from './interfaces';

import * as Parser from 'web-tree-sitter';
import * as path from 'path';
import * as readline from 'readline';
import * as fs from 'fs-plus';
import * as glob from 'glob';
import * as cp from 'child_process';

// import * as vscode from 'vscode';
import { URI, Utils } from 'vscode-uri'

// while the Parser is initializing and loading the language, we block its use
var parser: Parser | null = null;
let tree: any = null;

Parser.init().then(function () {
    return Parser.Language.load(path.join(__dirname, '../tree-sitter-hit.wasm')).then(function (lang) {
        // return Parser.Language.load('../tree-sitter-hit.wasm').then(function (lang) {
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

// we cache the settings here so we don't have to pass them as function arguments
var mySettings: MooseLanguageSettings;

// we cache the documents cache
var myDocuments: TextDocuments<TextDocument>;

// we cache the connection so we can send notifications
var myConnection: Connection;

export function init(settings: MooseLanguageSettings, documents: TextDocuments<TextDocument>, connection: Connection) {
    mySettings = settings;
    myDocuments = documents;
    myConnection = connection;
}

interface ConfigPath {
    configPath: string[];
    explicitType?: string;
}
interface AppDir {
    path: string;
    date: number;
    name?: string;
    file?: string;
    WSL?: string;
}

// each moose input file in the project dir could have its own moose app and
// json/syntax associated this table points to the app dir for each editor path
let appDirs: { [key: string]: AppDir } = {};
let syntaxWarehouse: { [key: string]: MooseSyntax } = {};
let offlineSyntax: string | null = null;

// Clear the cache for the app associated with current file.
// This is made available as a VSCode command.
// export function clearCache() {
//     var appPath: string, editor, filePath: string;

//     let uri: URI = URI.parse(request.textDocument.uri);
//     let filePath: string = uri.fsPath;

//     if (filePath in appDirs) {
//         appPath = appDirs[filePath].appPath;
//         delete appDirs[filePath];
//         if (appPath in syntaxWarehouse) {
//             return delete syntaxWarehouse[appPath];
//         }
//     }
// }

export function notifyError(msg: string) {
    myConnection.sendNotification(serverError, msg);
}

export function notifyDebug(...items: any[]) {
    var msgs: string[] = [], msg: string;
    for (var i = 0; i < items.length; ++i) {
        var item: any = items[i];
        if (typeof item == 'string')
            msg = item;
        else if (typeof item == 'function')
            msg = '[function]';
        else if (typeof item == 'undefined')
            msg = '[undefined]';
        else if (typeof item == 'object')
            msg = JSON.stringify(item);
        else if (typeof item == 'number' || typeof item == 'boolean')
            msg = item.toString();
        else
            msg = '[?]';
        msgs.push(msg);
    }

    myConnection.sendNotification(serverDebug, msgs.join(' '));
}

function notifyStartWork() {
    myConnection.sendNotification(serverStartWork);
}
function notifyStopWork() {
    myConnection.sendNotification(serverStopWork);
}

function findApp(filePath: string): AppDir | null {
    var fallbackMooseDir, file, fileTime, fileWithPath, i, isWSL, len, match, matches: AppDir[], previous_path, ref, searchPath, stats, wslDistro, wslPath;
    if (filePath == null) {
        notifyError('File not saved, nowhere to search for MOOSE syntax data.');
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
                    wslDistro = undefined;
                }
                matches.push({
                    path: searchPath,
                    name: match[1],
                    file: fileWithPath,
                    date: fileTime,
                    WSL: wslDistro
                });
            }
        }
        if (matches.length > 0) {
            // return newest application
            matches.sort(function (a, b) {
                return b.date - a.date;
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
                notifyError('No MOOSE application executable found.');
            }
            return null;
        }
    }
}

// fetch JSON syntax data
function loadSyntax(app: AppDir): MooseSyntax {
    var cacheDate: number, cacheDir: string, cacheFile: string | null = null, w: MooseSyntax;
    // prepare entry in the syntax warehouse
    w = syntaxWarehouse[app.path] = {};

    // do not cache offlineSyntax
    if (app.name && __dirname) {
        // we cache syntax data here
        cacheDir = path.join(__dirname, '..', 'cache');
        fs.makeTreeSync(cacheDir);
        cacheFile = path.join(cacheDir, `${app.name}.json`);

        // see if the cache file exists
        if (fs.existsSync(cacheFile)) {
            cacheDate = fs.statSync(cacheFile).mtime.getTime();
            // if the cacheFile is newer than the app compile date we use the cache
            if (cacheDate > app.date) {
                notifyError("cacheDate > app.date");
                // load and parse the cached syntax
                try {
                    let result = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
                    notifyError(`0 result.length = ${JSON.stringify(result).length}`);
                    if (!('blocks' in result)) {
                        // validate cache version
                        notifyError("no blocks!");
                        throw 'Invalid cache';
                    }
                    notifyError(`1 result.length = ${JSON.stringify(result).length}`);
                    w = result;
                    return w;
                } catch (error) {
                    // TODO: rebuild syntax if loading the cache fails
                    // vscode.window.showWarningMessage('Failed to load cached syntax (probably a legacy cache file).');
                    delete syntaxWarehouse[app.path];
                    fs.unlink(cacheFile, function () { });
                    return {};
                };
            }
        }
    }

    return rebuildSyntax(app, cacheFile, w);
}

// rebuild syntax
function rebuildSyntax(app: AppDir, cacheFile: string | null, w: MooseSyntax): MooseSyntax {
    // indicate to the client that the server is busy
    notifyStartWork();

    var args: Array<string>, jsonData: string, moose;

    // either run moose or use the offlineSyntax file
    try {
        if (app.file != null) {
            args = ['--json'];
            if (mySettings.allowTestObjects) {
                args.push('--allow-test-objects');
            }
            if (app.WSL) {
                moose = cp.spawnSync('wsl', ['-d', app.WSL, app.file].concat(args), {
                    stdio: ['pipe', 'pipe', 'ignore'],
                    maxBuffer: 1024 * 1024 * 1024
                });
            } else {
                moose = cp.spawnSync(app.file, args, {
                    stdio: ['pipe', 'pipe', 'ignore'],
                    maxBuffer: 1024 * 1024 * 1024
                });
            }

            // check if the MOOSE app ran successfully
            if (moose.status != 0)
                throw new Error(`Failed to run MOOSE to obtain syntax data ${moose.status} ${moose.signal}`);

            // clip the JSON from the output using the markers
            const out: string = moose.stdout.toString();
            const beginMarker = '**START JSON DATA**\n';
            const endMarker = '**END JSON DATA**\n';
            let begin = out.indexOf(beginMarker);
            let end = out.lastIndexOf(endMarker);

            if (begin < 0 || end < begin) {
                throw new Error('Markers not found');
            }

            // parse the JSON
            jsonData = out.slice(begin + beginMarker.length, end);
        } else {
            try {
                // read offline syntax dump (./moose-opt --json > offlinesyntax)
                jsonData = fs.readFileSync(app.path, 'utf8');
            } catch (e) {
                throw new Error(`Failed to load offline syntax file '${offlineSyntax}'`);
            }
        }

        // parse the JSON
        w = JSON.parse(jsonData);

        // write the JSON cache
        if (cacheFile != null) {
            fs.writeFile(cacheFile, JSON.stringify(w), function () { });
        }

        notifyStopWork();
        return w;
    } catch (error: any) {
        notifyStopWork();
        notifyError(error['message']);
        return {};
    }
}

function prepareCompletion(request: TextDocumentPositionParams, w: MooseSyntax): CompletionItem[] {
    // tree update
    if (parser == null) {
        return [];
    }

    const document = myDocuments.get(request.textDocument.uri);
    if (!document) {
        return [];
    }

    const text = document.getText();
    if (text) {
        tree = parser.parse(text);
        return computeCompletion(request, w);
    } else { return []; }
}

// get the node in the JSON stucture for the current block level
function getSyntaxNode(configPath: string[], w: MooseSyntax): MooseSyntax | null {
    var i, len, p, ref, ref1;
    // no parameters at the root
    if (configPath.length === 0) {
        return null;
    }
    // traverse subblocks
    var b = w.blocks[configPath[0]];
    ref = configPath.slice(1);
    for (i = 0, len = ref.length; i < len; i++) {
        p = ref[i];
        if (b != null) {
            if (b.subblocks && p in b.subblocks) {
                b = b.subblocks[p];
            }
            else {
                b = b.star;
            }
        }
        if (b == null) {
            return null;
        }
    }
    return b;
}

// get a list of valid subblocks
function getSubblocks(configPath: string[], w: MooseSyntax): string[] {
    var ret: string[] = [];
    // get top level blocks
    if (configPath.length === 0) {
        return Object.keys(w.blocks);
    }
    // traverse subblocks
    var b = getSyntaxNode(configPath, w);
    ret = Object.keys((b != null ? b.subblocks : void 0) || {});
    if (b != null ? b.star : void 0) {
        ret.push('*');
    }
    return ret.sort();
}

// get a list of parameters for the current block
// if the type parameter is known add in class specific parameters
function getParameters(cp: ConfigPath, w: MooseSyntax): MooseSyntax {
    var currentType, n, ref, ref1, ref2, ret: MooseSyntax = {}, t;
    var b = getSyntaxNode(cp.configPath, w);
    // handle block level action parameters first
    if (b != null) {
        for (n in b.actions) {
            Object.assign(ret, b.actions[n].parameters);
        }
    }
    // if no type is explicitly set check if a default value exists
    currentType = cp.explicitType || (ret != null ? (ref = ret['type']) != null ? ref.default : void 0 : void 0);
    // if the type is known add the specific parameters
    t = (b != null ? (ref1 = b.subblock_types) != null ? ref1[currentType] : void 0 : void 0) || (b != null ? (ref2 = b.types) != null ? ref2[currentType] : void 0 : void 0);
    Object.assign(ret, t != null ? t.parameters : void 0);
    return ret;
}

// get a list of possible completions for the type parameter at the current block level
function getTypes(configPath: string[], w: MooseSyntax): CompletionItem[] {
    var n, ret: CompletionItem[];
    ret = [];

    var b = getSyntaxNode(configPath, w);
    if (b != null) {
        for (n in b.subblock_types) {
            ret.push({
                label: n,
                documentation: b.subblock_types[n].description,
                kind: CompletionItemKind.TypeParameter
            });
        }
        for (n in b.types) {
            ret.push({
                label: n,
                documentation: b.types[n].description,
                kind: CompletionItemKind.TypeParameter
            });
        }
    }

    return ret;
}

// Filename completions (TODO, traverse directories)
function computeFileNameCompletion(regex: RegExp, request: TextDocumentPositionParams): CompletionItem[] {
    var completions: CompletionItem[], dir: string[], i, len;

    let uri: URI = URI.parse(request.textDocument.uri);
    let filePath: string = Utils.dirname(uri).fsPath;

    dir = fs.readdirSync(filePath);
    completions = [];
    for (i = 0, len = dir.length; i < len; i++) {
        if (regex.test(dir[i])) {
            completions.push({
                label: dir[i],
                kind: CompletionItemKind.File
            })
        };
    }
    return completions;
}

// checks if this is a vector type build the vector cpp_type name for a
// given single type (checks for gcc and clang variants)
function isVectorOf(yamlType: string, type: string): boolean {
    var match = stdVector.exec(yamlType);
    return !!match && (match[2] === type);
}

// build the suggestion list for parameter values (editor is passed in
// to build the variable list)
function computeValueCompletion(param: MooseSyntax, request: TextDocumentPositionParams, isQuoted: boolean, hasSpace: boolean, w: MooseSyntax): CompletionItem[] {
    var basicType, blockList: string[], completions: CompletionItem[], i, len,
        option, output, ref, singleOK: boolean, vectorOK: boolean;

    singleOK = !hasSpace;
    vectorOK = isQuoted || !hasSpace;
    // hasType = (type) => {
    //     return (param.cpp_type === type && singleOK) || (isVectorOf(param.cpp_type, type) && vectorOK);
    // };

    blockList = [];
    function buildBlockList(node: MooseSyntax, oldPath?: string) {
        var block, c, i, len, newPath : string, ref, results: string[];
        ref = node.children;
        results = [];
        for (i = 0, len = ref.length; i < len; i++) {
            c = ref[i];
            if (c.type === 'top_block' || c.type === 'block') {
                block = c.children[1].text;
                if (block.slice(0, 2) === './') {
                    block = block.slice(2);
                }
                newPath = (oldPath ? oldPath + '/' : '') + block;
                blockList.push(newPath);
                buildBlockList(c, newPath);
            }
        }
    };

    if ((param.cpp_type === 'bool' && singleOK) || (isVectorOf(param.cpp_type, 'bool') && vectorOK)) {
        return [
            {
                label: 'true',
                kind: CompletionItemKind.Value
            },
            {
                label: 'false',
                kind: CompletionItemKind.Value
            }
        ];
    }

    if (!!param.options) {
        if ((param.basic_type === 'String' && singleOK) || (param.basic_type === 'Array:String' && vectorOK)) {
            notifyDebug('completion ok');
            completions = [];
            ref = param.options.split(' ');
            for (i = 0, len = ref.length; i < len; i++) {
                option = ref[i];
                completions.push({
                    label: option,
                    kind: CompletionItemKind.EnumMember
                });
            }
            return completions;
        }
    }

    var match = param.cpp_type.match(/^std::vector<([^>]+)>$/);
    if ((match && !vectorOK) || (!match && !singleOK)) {
        return [];
    }

    basicType = match ? match[1] : param.cpp_type;
    if (basicType === 'FileName') {
        return computeFileNameCompletion(/.*/, request);
    }
    if (basicType === 'MeshFileName') {
        return computeFileNameCompletion(/.*\.(e|exd|dat|gmv|msh|inp|xda|xdr|vtk)$/, request);
    }
    if (basicType === 'OutputName') {
        return (function () {
            var j, len1, ref1, results;
            ref1 = ['exodus', 'csv', 'console', 'gmv', 'gnuplot', 'nemesis', 'tecplot', 'vtk', 'xda', 'xdr'];
            results = [];
            for (j = 0, len1 = ref1.length; j < len1; j++) {
                output = ref1[j];
                results.push({
                    label: output,
                    kind: CompletionItemKind.Folder
                });
            }
            return results;
        })();
    }

    // automatically generated matches from registerSyntaxType
    if (basicType in w.global.associated_types) {
        buildBlockList(tree.rootNode);
        notifyDebug(blockList);
        completions = [];
        var matches: Set<string> = new Set(w.global.associated_types[basicType]);
        matches.forEach(function (match: string) {
            var block, j, key, len1, results;
            if (match.slice(-2) === '/*') {
                key = match.slice(0, -1);
                results = [];
                for (j = 0, len1 = blockList.length; j < len1; j++) {
                    block = blockList[j];
                    if (block.slice(0, key.length) === key) {
                        results.push(completions.push({
                            label: block.slice(key.length),
                            kind: CompletionItemKind.Field
                        }));
                    }
                    // else {
                    //     results.push(void 0);
                    // }
                }
                return results;
            }
        });
        return completions;
    }
    return [];
}

function getPrefix(line: string) {
    var ref;
    // Whatever your prefix regex might be
    const regex = /[\w0-9_\-.\/\[]+$/;
    // Match the regex to the line, and return the match
    return ((ref = line.match(regex)) != null ? ref[0] : void 0) || '';
}

// determine the active input file path at the current position
function getCurrentConfigPath(request: TextDocumentPositionParams): ConfigPath {
    var c, i, len, node: ParseTree, ref, ret: ConfigPath, sourcePath: string[];
    var position: Position = request.position;

    function recurseCurrentConfigPath(node: ParseTree, sourcePath: string[] = []): [ParseTree, string[]] {
        var c, c2, ce, cs, i, j, len, len1, ref, ref1;
        ref = node.children;
        for (i = 0, len = ref.length; i < len; i++) {
            c = ref[i];
            if (c.type !== 'top_block' && c.type !== 'block' && c.type !== 'ERROR') {
                continue;
            }
            // check if we are inside a block or top_block
            cs = c.startPosition;
            ce = c.endPosition;
            // outside row range
            if (position.line < cs.row || position.line > ce.row) {
                continue;
            }
            // in starting row but before starting column
            if (position.line === cs.row && position.character < cs.column) {
                continue;
            }
            // in ending row but after ending column
            if (position.line === ce.row && position.character > ce.column) {
                continue;
            }
            // if the block does not contain a valid path subnode we give up
            if (c.children.length < 2 || c.children[1].type !== 'block_path') {
                return [c.parent, sourcePath];
            }
            // first block_path node
            if (c.type !== 'ERROR') {
                if (c.children[1].startPosition.row >= position.line) {
                    continue;
                }
                sourcePath = sourcePath.concat(c.children[1].text.replace(/^\.\//, '').split('/'));
            } else {
                ref1 = c.children;
                // if we are in an ERROR block (unclosed) we should try to pick more path elements
                for (j = 0, len1 = ref1.length; j < len1; j++) {
                    c2 = ref1[j];
                    if (c2.type !== 'block_path' || c2.startPosition.row >= position.line) {
                        continue;
                    }
                    sourcePath = sourcePath.concat(c2.text.replace(/^\.\//, '').split('/'));
                }
            }
            return recurseCurrentConfigPath(c, sourcePath);
        }
        return [node, sourcePath];
    };

    [node, sourcePath] = recurseCurrentConfigPath(tree.rootNode);
    ret = {
        configPath: sourcePath
    };

    // found a block we can check for a type parameter
    if (node !== null) {
        ref = node.children;
        for (i = 0, len = ref.length; i < len; i++) {
            c = ref[i];
            if (c.type !== 'parameter_definition' || c.children.length < 3 || c.children[0].text !== 'type') {
                continue;
            }
            ret.explicitType = c.children[2].text;
            break;
        }
    }
    // return value
    return ret;
}

// check if there is an square bracket pair around the cursor
function isOpenBracketPair(line: string): boolean {
    return insideBlockTag.test(line);
}

// check if the current line is a type parameter
function isParameterCompletion(line: string): boolean {
    return parameterCompletion.test(line);
}

// formats the default value of a paramete
function paramDefault(param: MooseSyntax): string | undefined {
    if (param.default) {
        // if (param.default.indexOf(' ') >= 0) {
        //     return `"${param.default}"`;
        // }
        if (param.cpp_type === 'bool') {
            if (param.default === '0') {
                return 'false';
            }
            if (param.default === '1') {
                return 'true';
            }
        }
        return param.default;
    }
}
// w contains the syntax applicable to the current file
function computeCompletion(request: TextDocumentPositionParams, w: MooseSyntax): CompletionItem[] {
    var addedWildcard, blockPostfix, bufferPosition: Position, completion: string, completions: CompletionItem[],
        defaultValue, hasSpace, i, icon: CompletionItemKind,
        isQuoted, j, len, len1, line: string, match, name, param: MooseSyntax, paramName,
        partialPath: string[], postLine, prefix, ref, ref1;

    completions = [];
    bufferPosition = request.position;

    // current line up to the cursor position
    const document = myDocuments.get(request.textDocument.uri);
    if (!document) {
        return [];
    }
    line = document.getText({
        start: { line: bufferPosition.line, character: 0 },
        end: bufferPosition
    });
    prefix = getPrefix(line);

    // get the type pseudo path (for the yaml)
    var cp = getCurrentConfigPath(request);

    // for empty [] we suggest blocks
    if (isOpenBracketPair(line)) {
        // get a partial path
        var lineMatch = line.match(insideBlockTag);
        if (lineMatch) {
            partialPath = lineMatch[1].replace(/^\.\//, '').split('/');
            partialPath.pop();
        } else { partialPath = []; }

        // get the postfix (to determine if we need to append a ] or not)
        postLine = document.getText({
            start: bufferPosition,
            end: { line: bufferPosition.line, character: bufferPosition.character + 1 }
        });

        blockPostfix = postLine.length > 0 && postLine[0] === ']' ? '' : ']';
        // handle relative paths
        // blockPrefix = cp.configPath.length > 0 ? '[./' : '[';

        // add block close tag to suggestions
        if (cp.configPath.length > 0 && partialPath.length === 0) {
            completions.push({
                label: '..',
                insertText: '[../' + blockPostfix
            });
        }
        cp.configPath = cp.configPath.concat(partialPath);
        ref = getSubblocks(cp.configPath, w);
        for (i = 0, len = ref.length; i < len; i++) {
            completion = ref[i];
            // add to suggestions if it is a new suggestion
            if (completion === '*') {
                if (!addedWildcard) {
                    completions.push({
                        label: '*',
                        insertText: '${1:name}' + blockPostfix,
                        insertTextFormat: InsertTextFormat.Snippet
                    });
                    addedWildcard = true;
                }
            } else if (completion !== '') {
                if ((completions.findIndex(function (c) {
                    return c.label === completion;
                })) < 0) {
                    completions.push({
                        label: completion,
                        insertText: [...partialPath, completion].join('/') + blockPostfix
                    });
                }
            }
        }
        // suggest parameters
    } else if (isParameterCompletion(line)) {
        notifyDebug('isParameterCompletion');
        ref1 = getParameters(cp, w);
        // loop over valid parameters
        for (name in ref1) {
            param = ref1[name];
            // skip deprecated params
            if (mySettings.hideDeprecatedParams && param.deprecated) {
                continue;
            }
            defaultValue = paramDefault(param) || '';
            if (defaultValue.indexOf(' ') >= 0) {
                defaultValue = `'${defaultValue}'`;
            }
            if (param.cpp_type === 'bool') {
                if (defaultValue === '0') {
                    defaultValue = 'false';
                }
                if (defaultValue === '1') {
                    defaultValue = 'true';
                }
            }

            icon = param.name === 'type' ? CompletionItemKind.TypeParameter : param.required ? CompletionItemKind.Constructor : param.default != null ? CompletionItemKind.Variable : CompletionItemKind.Field;
            completions.push({
                label: param.name,
                insertText: param.name + ' = ${1:' + defaultValue + '}',
                insertTextFormat: InsertTextFormat.Snippet,
                documentation: param.description,
                detail: param.required ? '(required)' : paramDefault(param),
                kind: icon,
                tags: param.deprecated ? [CompletionItemTag.Deprecated] : []
            });
        }
    } else if (!!(match = otherParameter.exec(line))) {
        paramName = match[1];
        isQuoted = match[2][0] === "'";
        hasSpace = !!match[3];
        param = getParameters(cp, w)[paramName];
        if (param == null) {
            return [];
        }
        // this takes care of 'broken' type parameters like Executioner/Qudadrature/type
        if (paramName === 'type' && param.cpp_type === 'std::string') {
            completions = getTypes(cp.configPath, w);
        } else {
            completions = computeValueCompletion(param, request, isQuoted, hasSpace, w);
        }
    }
    // set the custom prefix
    for (j = 0, len1 = completions.length; j < len1; j++) {
        // completions[j].replacementPrefix = prefix; TODO: maybe use edit range stuff here?
    }
    return completions;
}


export function getSuggestions(request: TextDocumentPositionParams): CompletionItem[] {
    var app: AppDir | null, loaded, w: MooseSyntax;

    let uri: URI = URI.parse(request.textDocument.uri);
    if (uri.scheme != 'file')
        return [];
    let filePath: string = Utils.dirname(uri).fsPath;

    // lookup application for current input file (cached)
    if (offlineSyntax) {
        app = {
            path: offlineSyntax,
            date: 0
        };
    } else {
        app = findApp(filePath);
    }
    if (app == null) {
        return [];
    }

    // check if the syntax is already loaded, currently loading,
    // or not requested yet
    if (!(app.path in syntaxWarehouse)) {
        // return a promise that gets fulfilled as soon as the syntax data is loaded
        syntaxWarehouse[app.path] = loadSyntax(app);

        // watch executable (unless it's WSL)
        if ((app.file != null) && (app.WSL == null)) {
            fs.watch(app.file, function (event, filename) {
                // force rebuilding of syntax if executable changed
                delete appDirs[filePath];
                if (app != null) {
                    delete syntaxWarehouse[app.path];
                }
            });
        }
        // perform completion
        return prepareCompletion(request, syntaxWarehouse[app.path]);
    }

    w = syntaxWarehouse[app.path];
    return prepareCompletion(request, w);
}

