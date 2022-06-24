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
    InsertTextFormat,
    SymbolKind
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

import * as Syntax from './syntax';
import { HITBlock, HITParameterList, HITParser } from './hit_parser';

import * as path from 'path';
import * as fs from 'fs-plus';
import * as cp from 'child_process';

// import * as vscode from 'vscode';
import { URI, Utils } from 'vscode-uri'

// HIT parser wrapper
const parser: HITParser = new HITParser();

// MOOSE syntax warehouse
const warehouse = Syntax.Warehouse.getInstance();

const insideBlockTag = /^\s*\[([^\]#\s]*)$/;
const parameterCompletion = /^\s*[^\s#=\]]*$/;
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
function computeValueCompletion(param: Syntax.Type.Parameter, request: TextDocumentPositionParams,
    is_quoted: boolean, has_space: boolean, syntax: Syntax.Container): CompletionItem[] {
    var basic_type, completions: CompletionItem[], i, len,
        option, output, ref;

    var single_ok = !has_space;
    var vector_ok = is_quoted || !has_space;

    // bool value completion
    if ((param.cpp_type === 'bool' && single_ok) || (isVectorOf(param.cpp_type, 'bool') && vector_ok)) {
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

    // enum type completion
    if (!!param.options) {
        if ((param.basic_type === 'String' && single_ok) || (param.basic_type === 'Array:String' && vector_ok)) {
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
    if ((match && !vector_ok) || (!match && !single_ok)) {
        return [];
    }

    basic_type = match ? match[1] : param.cpp_type;
    if (basic_type === 'FileName') {
        return computeFileNameCompletion(/.*/, request);
    }
    if (basic_type === 'MeshFileName') {
        return computeFileNameCompletion(/.*\.(e|exd|dat|gmv|msh|inp|xda|xdr|vtk)$/, request);
    }
    if (basic_type === 'OutputName') {
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
    if (basic_type in syntax.tree.global.associated_types) {
        var block_list = parser.getBlockList();
        completions = [];
        var matches: Set<string> = new Set(syntax.tree.global.associated_types[basic_type]);
        matches.forEach((match: string) => {
            var j, key, len1, results;
            if (match.slice(-2) === '/*') {
                key = match.slice(0, -1);
                for (j = 0, len1 = block_list.length; j < len1; j++) {
                    var block = block_list[j].path.join('/');
                    if (block.slice(0, key.length) === key) {
                        var label = block.slice(key.length);
                        if (label.indexOf('/') < 0) {
                            completions.push({
                                label: label,
                                kind: CompletionItemKind.Field
                            });
                        }
                    }
                }
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


// check if there is an square bracket pair around the cursor
function isOpenBracketPair(line: string): boolean {
    return insideBlockTag.test(line);
}

// check if the current line is a type parameter
function isParameterCompletion(line: string): boolean {
    return parameterCompletion.test(line);
}

// formats the default value of a parameter
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
function computeCompletion(request: TextDocumentPositionParams, syntax: Syntax.Container, document: TextDocument): CompletionItem[] {
    var addedWildcard, block_postfix, bufferPosition: Position, completion: string, completions: CompletionItem[],
        defaultValue, i, icon: CompletionItemKind,
        len, line: string, match, name,
        partial_path: string[], postLine, ref;

    completions = [];
    bufferPosition = request.position;

    // current line up to the cursor position
    line = document.getText({
        start: { line: bufferPosition.line, character: 0 },
        end: bufferPosition
    });

    // TODO: do we need this?
    // prefix = getPrefix(line);

    // get the type pseudo path (for the yaml)
    var cp = parser.getBlockAtPosition(request.position);
    if (!cp) {
        // this should only happen if the parser is not yet initialized
        return [];
    }

    // for empty [] we suggest blocks
    if (isOpenBracketPair(line)) {
        // get a partial path
        var line_match = line.match(insideBlockTag);
        if (line_match) {
            partial_path = line_match[1].replace(/^\.\//, '').split('/');
            partial_path.pop();
        } else { partial_path = []; }

        // get the postfix (to determine if we need to append a ] or not)
        postLine = document.getText({
            start: bufferPosition,
            end: { line: bufferPosition.line, character: bufferPosition.character + 1 }
        });

        // add block close tag to suggestions
        block_postfix = postLine.length > 0 && postLine[0] === ']' ? '' : ']';
        if (cp.path.length > 0 && partial_path.length === 0) {
            completions.push({
                label: '..',
                insertText: '[' + block_postfix
            });
        }
        cp.path = [...cp.path, ...partial_path];
        ref = syntax.getSubblocks(cp.path);
        for (i = 0, len = ref.length; i < len; i++) {
            completion = ref[i];
            // add to suggestions if it is a new suggestion
            if (completion === '*') {
                if (!addedWildcard) {
                    completions.push({
                        label: '*',
                        insertText: '${1:name}' + block_postfix,
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
                        insertText: completion + block_postfix
                    });
                }
            }
        }
        return completions;
    }

    // get parameters we already have and parameters that are valid
    var existing_params = parser.getBlockParameters(cp.node);
    var valid_params = syntax.getParameters({ path: cp.path, type: existing_params.type });

    // suggest parameters
    if (isParameterCompletion(line)) {
        // loop over valid parameters
        for (name in valid_params) {
            var param = valid_params[name];

            // skip deprecated params
            if (mySettings.hideDeprecatedParams && param.deprecated) {
                continue;
            }

            // skip parameters that are already present in the block
            if (name in existing_params) {
                continue;
            }

            // format the default vaklue
            defaultValue = paramDefault(param) || '';
            if (defaultValue.indexOf(' ') >= 0) {
                defaultValue = `'${defaultValue}'`;
            }

            // set icon and build completion
            icon = param.name === 'type' ? CompletionItemKind.TypeParameter : param.required ? CompletionItemKind.Constructor : param.default != null ? CompletionItemKind.Variable : CompletionItemKind.Field;
            completions.push({
                label: param.name,
                insertText: param.name + ' = ' + (defaultValue ? '${1:' + defaultValue + '}' : ''),
                insertTextFormat: defaultValue ? InsertTextFormat.Snippet : undefined,
                documentation: param.description,
                detail: param.required ? '(required)' : paramDefault(param),
                kind: icon,
                tags: param.deprecated ? [CompletionItemTag.Deprecated] : []
            });
        }

        return completions;
    }

    // value completion
    if (!!(match = otherParameter.exec(line))) {
        var param_name = match[1];
        var is_quoted = match[2][0] === "'";
        var has_space = !!match[3];

        var param = valid_params[param_name];
        if (param == null) {
            return [];
        }
        // this takes care of 'broken' type parameters like Executioner/Qudadrature/type
        if (param_name === 'type' && param.cpp_type === 'std::string') {
            completions = syntax.getTypes(cp.path);
        } else if (param_name === 'active' || param_name === 'inactive') {
            // filter direct subblocks from block list
            var block_list = parser.getBlockList();
            var path = cp.path.join('/');
            block_list.forEach((b) => {
                var sub_path = b.path.join('/');
                if (sub_path.slice(0, path.length) === path) {
                    sub_path = sub_path.slice(path.length + 1);
                    if (sub_path.indexOf('/') < 0) {
                        completions.push({
                            label: sub_path,
                            kind: SymbolKind.Array
                        });
                    }
                }
            });
            return completions;
        } else {
            completions = computeValueCompletion(param, request, is_quoted, has_space, syntax);
        }
    }

    return completions;
}


export function getSuggestions(request: TextDocumentPositionParams): CompletionItem[] {
    // the the current document's URI
    let uri: URI = URI.parse(request.textDocument.uri);

    // get the current document
    const document = myDocuments.get(request.textDocument.uri);

    if (uri.scheme == 'file' && document) {
        // find path to current document
        let path: string = Utils.dirname(uri).fsPath;

        // get the corresponding syntax
        try {
            var syntax = warehouse.getSyntax(path, () => notifyStartWork(), () => notifyStopWork());
            if (syntax) {
                // get the document text
                const text = document.getText();
                if (text) {
                    // parse the text
                    parser.parse(text);
                    if (parser.tree) {
                        // everything is prepared, now compute the completion
                        return computeCompletion(request, syntax, document);
                    }
                }
            }
        } catch (e: any) {
            notifyStopWork();
            notifyError(e.message);
        }
    }

    // no completion available
    return [];
}

