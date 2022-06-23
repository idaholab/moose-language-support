//* This file is part of the MOOSE framework
//* https://www.mooseframework.org
//*
//* Licensed under LGPL 2.1, please see LICENSE for details
//* https://www.gnu.org/licenses/lgpl-2.1.html

import * as Parser from 'web-tree-sitter';
import * as path from 'path';
import { Position } from 'vscode-languageserver/node';

export interface HITBlock {
    path: string[];
    node: Parser.SyntaxNode;
}

export interface HITParameterList {
    [key: string]: string;
}

export class HITParser {
    parser: Parser | null = null;
    tree: Parser.Tree | null = null;

    readyCallback: Function | null = null;

    constructor() {
        if (tree_sitter_ready) {
            this._initParser();
        } else {
            // add to list for late binding
            uninitialized_parsers.push(this);
        }
    }

    _initParser() {
        this.parser = new Parser();
        this.parser.setLanguage(hit_language);
        if (this.readyCallback) {
            this.readyCallback();
        }
    }

    onReady(f: Function) {
        if (this.parser) {
            // if the parser is already initialized execute f right away
            f();
        } else {
            // otherwise save it for later
            this.readyCallback = f;
        }
    }

    parse(text: string) {
        if (this.parser) {
            this.tree = this.parser.parse(text);
        } else {
            this.tree = null;
        }
    }

    // Removes quotes if possible (i.e. the string contains no whitespace or other quotes)
    static normalizeValue(val : string) : string {
        const okSingleQuote = /^'.*["\s].*'$/;
        const okDoubleQuote = /^".*['\s].*"$/;
        if (okSingleQuote.test(val) || okDoubleQuote.test(val)) {
            return val;
        }
        return val;
    }

    getBlockList(): HITBlock[] {
        var blockList: HITBlock[] = [];
        function buildBlockList(node: Parser.SyntaxNode, oldPath: string[]) {
            var block, c, i, len, ref;
            ref = node.children;
            for (i = 0, len = ref.length; i < len; i++) {
                c = ref[i];
                if (c.type === 'top_block' || c.type === 'block') {
                    block = c.children[1].text.split('/');
                    if (block[0] == '.') {
                        block = block.slice(1);
                    }

                    var newPath = [...oldPath, ...block];
                    blockList.push({ path: newPath, node: c });
                    buildBlockList(c, newPath);
                }
            }
        };
        if (this.tree) {
            buildBlockList(this.tree.rootNode, []);
        }
        return blockList;
    }

    // Get the HIT syntax node for a block specified by a path. The path may either be
    // a string with path components delimited by '/' or an array of path components.
    findBlock(pathParam: string | string[]): Parser.SyntaxNode | null {
        if (!this.tree) {
            return null;
        }

        var path: string;
        if (typeof pathParam === 'string') {
            path = pathParam;
        } else {
            path = pathParam.join('/');
        }

        function traverseBlocks(node: Parser.SyntaxNode, oldPath?: string): Parser.SyntaxNode | null {
            var block: string, c: Parser.SyntaxNode, i, len, ref: Parser.SyntaxNode[];
            ref = node.children;
            for (i = 0, len = ref.length; i < len; i++) {
                c = ref[i];
                if (c.type === 'top_block' || c.type === 'block') {
                    block = c.children[1].text;
                    if (block.slice(0, 2) === './') {
                        block = block.slice(2);
                    }
                    var newPath = (oldPath ? oldPath + '/' : '') + block;
                    if (newPath === path) {
                        return c;
                    } else if (path.slice(0, newPath.length) === newPath) {
                        var ret = traverseBlocks(c, newPath);
                        // if we found a match, return it
                        if (ret) {
                            return ret;
                        }
                        // otherwise keep looking
                    }
                }
            }
            // no match found
            return null;
        };
        return traverseBlocks(this.tree.rootNode);
    }

    // get a map from all parameters to their correspoding values
    getBlockParameters(node: Parser.SyntaxNode): HITParameterList {
        var params: HITParameterList = {}, i, len, c: Parser.SyntaxNode;
        for (i = 0, len = node.children.length; i < len; i++) {
            c = node.children[i];
            if (c.type === 'parameter_definition') {
                params[c.children[0].text] = c.children[2].text;
            }
        }
        return params;
    }

    getBlockParameter(node: Parser.SyntaxNode, name: string) : string | null {
        for (var i = 0, len = node.children.length; i < len; i++) {
            var c = node.children[i];
            if (c.type === 'parameter_definition' && c.children[0].text == name) {
                return c.children[2].text;
            }
        }
        return null;
    }

    getPathParameters(path: string | string[]): HITParameterList {
        var node = this.findBlock(path);
        if (!node) {
            return {};
        }
        return this.getBlockParameters(node);
    }

    getBlockAtPosition(p: Position): HITBlock | null {
        function recurseCurrentConfigPath(block: HITBlock): HITBlock {
            var newBlock: HITBlock;
            var ref = block.node.children;
            for (var i = 0, len = ref.length; i < len; i++) {
                var c = ref[i];
                if (c.type !== 'top_block' && c.type !== 'block' && c.type !== 'ERROR') {
                    continue;
                }

                // check if we are inside a block or top_block
                var cs = c.startPosition;
                var ce = c.endPosition;

                // outside row range
                if (p.line < cs.row || p.line > ce.row) {
                    continue;
                }
                // in starting row but before starting column
                if (p.line === cs.row && p.character < cs.column) {
                    continue;
                }
                // in ending row but after ending column
                if (p.line === ce.row && p.character > ce.column) {
                    continue;
                }
                // if the block does not contain a valid path subnode we give up
                if (c.children.length < 2 || c.children[1].type !== 'block_path') {
                    return block;
                }
                // first block_path node
                if (c.type !== 'ERROR') {
                    if (c.children[1].startPosition.row >= p.line) {
                        continue;
                    }
                    newBlock = { node: c, path: [...block.path, ...c.children[1].text.replace(/^\.\//, '').split('/')] };
                } else {
                    var ref1 = c.children, path = block.path;
                    // if we are in an ERROR block (unclosed) we should try to pick more path elements
                    for (var j = 0, len1 = ref1.length; j < len1; j++) {
                        var c2 = ref1[j];
                        if (c2.type !== 'block_path' || c2.startPosition.row >= p.line) {
                            continue;
                        }
                        path = [...path, ...c2.text.replace(/^\.\//, '').split('/')];
                    }
                    newBlock = { node: c, path: path };
                }
                return recurseCurrentConfigPath(newBlock);
            }
            return block;
        };

        if (this.tree) {
            return recurseCurrentConfigPath({ path: [], node: this.tree.rootNode });
        } else {
            return null;
        }
    }
}

// while TreeSitter is initializing and loading the language, we allow late binding initialization of the HITParser class
var tree_sitter_ready: boolean = false;

// we allow instantiating our parser class early
var uninitialized_parsers: HITParser[] = [];

// HIT grammar
var hit_language: Parser.Language;

// initializing the TreeSitter parser is asynchronous
Parser.init().then(() => {
    Parser.Language.load(path.join(__dirname, '../tree-sitter-hit.wasm')).then((lang) => {
        // language loaded
        hit_language = lang;
        tree_sitter_ready = true;

        // update parsers that have been requested befor the library was ready
        uninitialized_parsers.forEach((hit_parser) => { hit_parser._initParser(); })
    });
});

