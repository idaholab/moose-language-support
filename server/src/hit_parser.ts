//* This file is part of the MOOSE framework
//* https://www.mooseframework.org
//*
//* Licensed under LGPL 2.1, please see LICENSE for details
//* https://www.gnu.org/licenses/lgpl-2.1.html

import * as Parser from 'web-tree-sitter';
import * as path from 'path';

export interface HITBlock {
    path: string;
    node: Parser.SyntaxNode;
}

export interface HITParameterList
{
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

    onReady(f : Function) {
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

    getBlockList(): HITBlock[] {
        var blockList: HITBlock[] = [];
        function buildBlockList(node: Parser.SyntaxNode, oldPath?: string) {
            var block, c, i, len, newPath: string, ref;
            ref = node.children;
            for (i = 0, len = ref.length; i < len; i++) {
                c = ref[i];
                if (c.type === 'top_block' || c.type === 'block') {
                    block = c.children[1].text;
                    if (block.slice(0, 2) === './') {
                        block = block.slice(2);
                    }
                    newPath = (oldPath ? oldPath + '/' : '') + block;
                    blockList.push({ path: newPath, node: c });
                    buildBlockList(c, newPath);
                }
            }
        };
        if (this.tree) {
            buildBlockList(this.tree.rootNode);
        }
        return blockList;
    }

    findBlock(path : string) : Parser.SyntaxNode | null {
        if (!this.tree) {
            return null;
        }

        function traverseBlocks(node: Parser.SyntaxNode, oldPath?: string) : Parser.SyntaxNode | null {
            var block : string, c : Parser.SyntaxNode, i, len,  ref : Parser.SyntaxNode[];
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

    getPathParameters(path : string): HITParameterList {
        var node = this.findBlock(path);
        if (!node) {
            return {};
        }
        return this.getBlockParameters(node);
    }

    // // determine the active input file path at the current position
    // getPath(request: TextDocumentPositionParams): ConfigPath {
    //     var c, i, len, node: ParseTree, ref, ret: ConfigPath, sourcePath: string[];

    //     var position: Position = request.position;

    //     function recurseCurrentConfigPath(node: HITTree, sourcePath: string[] = []): [HITTree, string[]] {
    //         var c, c2, ce, cs, i, j, len, len1, ref, ref1;
    //         ref = node.children;
    //         for (i = 0, len = ref.length; i < len; i++) {
    //             c = ref[i];
    //             if (c.type !== 'top_block' && c.type !== 'block' && c.type !== 'ERROR') {
    //                 continue;
    //             }
    //             // check if we are inside a block or top_block
    //             cs = c.startPosition;
    //             ce = c.endPosition;
    //             // outside row range
    //             if (position.line < cs.row || position.line > ce.row) {
    //                 continue;
    //             }
    //             // in starting row but before starting column
    //             if (position.line === cs.row && position.character < cs.column) {
    //                 continue;
    //             }
    //             // in ending row but after ending column
    //             if (position.line === ce.row && position.character > ce.column) {
    //                 continue;
    //             }
    //             // if the block does not contain a valid path subnode we give up
    //             if (c.children.length < 2 || c.children[1].type !== 'block_path') {
    //                 return [c.parent, sourcePath];
    //             }
    //             // first block_path node
    //             if (c.type !== 'ERROR') {
    //                 if (c.children[1].startPosition.row >= position.line) {
    //                     continue;
    //                 }
    //                 sourcePath = sourcePath.concat(c.children[1].text.replace(/^\.\//, '').split('/'));
    //             } else {
    //                 ref1 = c.children;
    //                 // if we are in an ERROR block (unclosed) we should try to pick more path elements
    //                 for (j = 0, len1 = ref1.length; j < len1; j++) {
    //                     c2 = ref1[j];
    //                     if (c2.type !== 'block_path' || c2.startPosition.row >= position.line) {
    //                         continue;
    //                     }
    //                     sourcePath = sourcePath.concat(c2.text.replace(/^\.\//, '').split('/'));
    //                 }
    //             }
    //             return recurseCurrentConfigPath(c, sourcePath);
    //         }
    //         return [node, sourcePath];
    //     };

    //     [node, sourcePath] = recurseCurrentConfigPath(this.tree.rootNode);
    //     ret = {
    //         configPath: sourcePath
    //     };

    //     // found a block we can check for a type parameter
    //     if (node !== null) {
    //         ref = node.children;
    //         for (i = 0, len = ref.length; i < len; i++) {
    //             c = ref[i];
    //             if (c.type !== 'parameter_definition' || c.children.length < 3 || c.children[0].text !== 'type') {
    //                 continue;
    //             }
    //             ret.explicitType = c.children[2].text;
    //             break;
    //         }
    //     }
    //     // return value
    //     return ret;
    // }

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

