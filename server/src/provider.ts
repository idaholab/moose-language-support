import {
    TextDocumentPositionParams,
    CompletionItem,
    CompletionItemKind,
    CompletionItemTag
} from 'vscode-languageserver/node';

import {
    MooseLanguageSettings,
    MooseSyntax
} from './interfaces';

import * as Parser from 'web-tree-sitter';
import * as path from 'path';
import * as readline from 'readline';
import * as fs from 'fs-plus';
import * as cp from 'child_process';

import * as vscode from 'vscode';
import { URI } from 'vscode-uri'

// while the Parser is initializing and loading the language, we block its use
var parser: Parser | null = null;
let tree: any = null;

Parser.init().then(function () {
    return Parser.Language.load(path.join(__dirname, '../tree-sitter-hit.wasm')).then(function (lang) {
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

interface AppDir {
    appPath: string;
    appName: string;
    appFile: string | null;
    appDate: number;
    appWSL: string | null;
}

// each moose input file in the project dir could have its own moose app and
// json/syntax associated this table points to the app dir for each editor path
let appDirs: { [key: string]: AppDir } = {};
let syntaxWarehouse: { [key: string]: {} } = {};
let offlineSyntax: string | null = null;

// Clear the cache for the app associated with current file.
// This is made available as a VSCode command.
export function clearCache() {
    var appPath: string, editor, filePath: string;
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

function findApp(filePath: string): AppDir | null {
    var fallbackMooseDir, file, fileTime, fileWithPath, i, isWSL, len, match, matches: AppDir[], previous_path, ref, searchPath, stats, wslDistro, wslPath;
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
function loadSyntax(app: AppDir): MooseSyntax {
    var cacheDate: number, cacheDir: string, cacheFile: string | null = null, w: MooseSyntax;
    // prepare entry in the syntax warehouse
    w = syntaxWarehouse[app.appPath] = {};
    // do not cache offlineSyntax
    if (app.appName) {
        // we cache syntax data here
        cacheDir = path.join(__dirname, '..', 'cache');
        fs.makeTreeSync(cacheDir);
        cacheFile = path.join(cacheDir, `${app.appName}.json`);

        // see if the cache file exists
        if (fs.existsSync(cacheFile)) {
            cacheDate = fs.statSync(cacheFile).mtime.getTime();
            // if the cacheFile is newer than the app compile date we use the cache
            if (cacheDate > app.appDate) {
                // load and parse the cached syntax
                try {
                    let result = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
                    if (!('blocks' in result)) {
                        // validate cache version
                        throw 'Invalid cache';
                    }

                    return w = result;
                } catch (error) {
                    // TODO: rebuild syntax if loading the cache fails
                    vscode.window.showWarningMessage('Failed to load cached syntax (probably a legacy cache file).');
                    delete syntaxWarehouse[app.appPath];
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
    // open notification about syntax generation
    var workingNotification = vscode.window.setStatusBarMessage('Rebuilding MOOSE syntax data.');

    var args: Array<string>, jsonData: string, moose;

    // either run moose or use the offlineSyntax file
    try {
        if (app.appFile != null) {
            args = ['--json'];
            if (mySettings.allowTestObjects) {
                args.push('--allow-test-objects');
            }
            if (app.appWSL) {
                moose = cp.spawnSync('wsl', ['-d', app.appWSL, app.appFile].concat(args), {
                    stdio: ['pipe', 'pipe', 'ignore']
                });
            } else {
                moose = cp.spawnSync(app.appFile, args, {
                    stdio: ['pipe', 'pipe', 'ignore']
                });
            }

            // check if the MOOSE app ran successfully
            if (moose.status != 0)
                throw new Error('Failed to run MOOSE to obtain syntax data');

            // clip the JSON from the output using the markers
            const beginMarker = '**START JSON DATA**\n';
            const endMarker = '**END JSON DATA**\n';
            let begin = moose.stdout.indexOf(beginMarker);
            let end = moose.stdout.lastIndexOf(endMarker);

            if (begin < 0 || end < begin) {
                throw new Error('Markers not found');
            }

            // parse the JSON
            jsonData = moose.stdout.slice(begin + beginMarker.length, end).toString();
        } else {
            try {
                // read offline syntax dump (./moose-opt --json > offlinesyntax)
                jsonData = fs.readFileSync(app.appPath, 'utf8');
            } catch (e) {
                throw new Error(`Failed to load offline syntax file '${offlineSyntax}'`);
            }

            // parse the JSON
            w = JSON.parse(jsonData);

            // write the JSON cache
            if (cacheFile != null) {
                fs.writeFile(cacheFile, JSON.stringify(w), function () { });
            }
        }

        workingNotification.dispose();
        return w;
    } catch (error: any) {
        workingNotification.dispose();
        vscode.window.showErrorMessage(error['message']);
        return {};
    }
}

function prepareCompletion(request: TextDocumentPositionParams, w: {}) {
    // tree update
    if (parser == null) {
        return;
    }
    tree = parser.parse(request.editor.getBuffer().getText());
    return computeCompletion(request, w);
}

// get the node in the JSON stucture for the current block level
function getSyntaxNode(configPath: string, w: MooseSyntax): MooseSyntax | null {
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
            if (b.subblocks) {
                b = b.subblocks[p];
            }
            else {
                b = b.star;
            }
        }
        if (b == null)
            return null;
    }
    return b;
}

// get a list of valid subblocks
function getSubblocks(configPath: string, w: MooseSyntax): string[] {
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
function getParameters(configPath: string, explicitType: string, w: MooseSyntax): MooseSyntax {
    var currentType, n, ref, ref1, ref2, ret: MooseSyntax = {}, t;
    var b = getSyntaxNode(configPath, w);
    // handle block level action parameters first
    if (b != null) {
        for (n in b.actions) {
            Object.assign(ret, b.actions[n].parameters);
        }
    }
    // if no type is explicitly set check if a default value exists
    currentType = explicitType || (ret != null ? (ref = ret['type']) != null ? ref.default : void 0 : void 0);
    // if the type is known add the specific parameters
    t = (b != null ? (ref1 = b.subblock_types) != null ? ref1[currentType] : void 0 : void 0) || (b != null ? (ref2 = b.types) != null ? ref2[currentType] : void 0 : void 0);
    Object.assign(ret, t != null ? t.parameters : void 0);
    return ret;
}

// get a list of possible completions for the type parameter at the current block level
function getTypes(configPath: string, w: MooseSyntax): CompletionItem[] {
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

// Filename completions (TODO, respect wildcards)
function computeFileNameCompletion(wildcards: string[], editor) {
    var completions: CompletionItem[], dir, filePath, i, len, name;
    filePath = path.dirname(editor.getPath());
    dir = fs.readdirSync(filePath);
    completions = [];
    for (i = 0, len = dir.length; i < len; i++) {
        name = dir[i];
        completions.push({
            label: name,
            kind: CompletionItemKind.File
        });
    }
    return completions;
}

// checks if this is a vector type build the vector cpp_type name for a
// given single type (checks for gcc and clang variants)
function isVectorOf(yamlType: string, type: string) {
    var match;
    return (match = stdVector.exec(yamlType)) && match[2] === type;
}

// build the suggestion list for parameter values (editor is passed in
// to build the variable list)
function computeValueCompletion(param: MooseSyntax, editor, isQuoted: boolean, hasSpace: boolean, w: MooseSyntax): CompletionItem[] {
    var basicType, blockList: string[], completions: CompletionItem[], i, len, match, matches,
        option, output, ref, singleOK : boolean, vectorOK:boolean;

    singleOK = !hasSpace;
    vectorOK = isQuoted || !hasSpace;
    // hasType = (type) => {
    //     return (param.cpp_type === type && singleOK) || (isVectorOf(param.cpp_type, type) && vectorOK);
    // };

    blockList = [];
    var buildBlockList = function (node, oldPath?: string) {
        var block, c, i, len, newPath, ref, results: CompletionItem[];
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
                results.concat(buildBlockList(c, newPath));
            } else {
                results.push({ label: 'void' }); // TODO: why did I push undefined here?
            }
        }
        return results;
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

    if ((param.cpp_type === 'MooseEnum' && singleOK) || (param.cpp_type === 'MultiMooseEnum' && vectorOK)) {
        if (param.options != null) {
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

    match = param.cpp_type.match(/^std::vector<([^>]+)>$/);
    if ((match && !vectorOK) || (!match && !singleOK)) {
        return [];
    }

    basicType = match ? match[1] : param.cpp_type;
    if (basicType === 'FileName') {
        return computeFileNameCompletion(['*'], editor);
    }
    if (basicType === 'MeshFileName') {
        return computeFileNameCompletion(['*.e'], editor);
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
        completions = [];
        matches = new Set(w.global.associated_types[basicType]);
        matches.forEach(function (match) {
            var block, j, key, len1, results;
            if (match.slice(-2) === '/*') {
                key = match.slice(0, -1);
                results = [];
                for (j = 0, len1 = blockList.length; j < len1; j++) {
                    block = blockList[j];
                    if (block.slice(0, +(key.length - 1) + 1 || 9e9) === key) {
                        results.push(completions.push({
                            label: block.slice(key.length),
                            kind: CompletionItemKind.Field
                        }));
                    } else {
                        results.push(void 0);
                    }
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
function getCurrentConfigPath(editor, position) {
    var c, i, len, node, recurseCurrentConfigPath, ref, ret, sourcePath;
    recurseCurrentConfigPath = function (node, sourcePath = []) {
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
            if (position.row < cs.row || position.row > ce.row) {
                continue;
            }
            // in starting row but before starting column
            if (position.row === cs.row && position.column < cs.column) {
                continue;
            }
            // in ending row but after ending column
            if (position.row === ce.row && position.column > ce.column) {
                continue;
            }
            // if the block does not contain a valid path subnode we give up
            if (c.children.length < 2 || c.children[1].type !== 'block_path') {
                return [c.parent, sourcePath];
            }
            // first block_path node
            if (c.type !== 'ERROR') {
                if (c.children[1].startPosition.row >= position.row) {
                    continue;
                }
                sourcePath = sourcePath.concat(c.children[1].text.replace(/^\.\//, '').split('/'));
            } else {
                ref1 = c.children;
                // if we are in an ERROR block (unclosed) we should try to pick more path elements
                for (j = 0, len1 = ref1.length; j < len1; j++) {
                    c2 = ref1[j];
                    if (c2.type !== 'block_path' || c2.startPosition.row >= position.row) {
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
        configPath: sourcePath,
        explicitType: null
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
function isOpenBracketPair(line): boolean {
    return insideBlockTag.test(line);
}

// check if the current line is a type parameter
function isParameterCompletion(line): boolean {
    return parameterCompletion.test(line);
}

// w contains the syntax applicable to the current file
function computeCompletion(request, w) {
    var addedWildcard, blockPostfix, blockPrefix, bufferPosition, completion, completions, configPath, defaultValue, editor, explicitType, hasSpace, i, icon: CompletionItemKind, isQuoted, j, len, len1, line, match, name, param: MooseSyntax, paramName, partialPath, postLine, prefix, ref, ref1;
    ({ editor, bufferPosition } = request);
    completions = [];
    // current line up to the cursor position
    line = editor.getTextInRange([[bufferPosition.row, 0], bufferPosition]);
    prefix = getPrefix(line);
    // get the type pseudo path (for the yaml)
    ({ configPath, explicitType } = getCurrentConfigPath(editor, bufferPosition));
    // for empty [] we suggest blocks
    if (isOpenBracketPair(line)) {
        // get a partial path
        partialPath = line.match(insideBlockTag)[1].replace(/^\.\//, '').split('/');
        partialPath.pop();
        // get the postfix (to determine if we need to append a ] or not)
        postLine = editor.getTextInRange([bufferPosition, [bufferPosition.row, bufferPosition.column + 1]]);
        blockPostfix = postLine.length > 0 && postLine[0] === ']' ? '' : ']';
        // handle relative paths
        blockPrefix = configPath.length > 0 ? '[./' : '[';
        // add block close tag to suggestions
        if (configPath.length > 0 && partialPath.length === 0) {
            completions.push({
                label: '..',
                insertText: '[../' + blockPostfix
            });
        }
        configPath = configPath.concat(partialPath);
        ref = getSubblocks(configPath, w);
        for (i = 0, len = ref.length; i < len; i++) {
            completion = ref[i];
            // add to suggestions if it is a new suggestion
            if (completion === '*') {
                if (!addedWildcard) {
                    completions.push({
                        label: '*',
                        insertText: blockPrefix + '${1:name}' + blockPostfix
                    });
                    addedWildcard = true;
                }
            } else if (completion !== '') {
                if ((completions.findIndex(function (c) {
                    return c.displayText === completion;
                })) < 0) {
                    completions.push({
                        label: completion,
                        insertText: blockPrefix + [...partialPath, completion].join('/') + blockPostfix
                    });
                }
            }
        }
        // suggest parameters
    } else if (isParameterCompletion(line)) {
        ref1 = getParameters(configPath, explicitType, w);
        // loop over valid parameters
        for (name in ref1) {
            param = ref1[name];
            // skip deprecated params
            if (mySettings.hideDeprecatedParams && param.deprecated) {
                continue;
            }
            defaultValue = param.default || '';
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
                documentation: param.description,
                kind: icon,
                tags: param.deprecated ? [CompletionItemTag.Deprecated] : []
            });
        }
    } else if (!!(match = otherParameter.exec(line))) {
        paramName = match[1];
        isQuoted = match[2][0] === "'";
        hasSpace = !!match[3];
        param = getParameters(configPath, explicitType, w)[paramName];
        if (param == null) {
            return [];
        }
        // this takes care of 'broken' type parameters like Executioner/Qudadrature/type
        if (paramName === 'type' && param.cpp_type === 'std::string') {
            completions = getTypes(configPath, w);
        } else {
            completions = computeValueCompletion(param, editor, isQuoted, hasSpace, w);
        }
    }
    // set the custom prefix
    for (j = 0, len1 = completions.length; j < len1; j++) {
        completion = completions[j];
        completion.replacementPrefix = prefix;
    }
    return completions;
}


export function getSuggestions(request: TextDocumentPositionParams, settings: MooseLanguageSettings): CompletionItem[] {
    var dir: AppDir | null, loaded, w;

    let uri: URI = URI.parse(request.textDocument.uri);
    if (uri.scheme != 'file')
        return [];
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
    return prepareCompletion(request, w);
}

