//* This file is part of the MOOSE framework
//* https://www.mooseframework.org
//*
//* Licensed under LGPL 2.1, please see LICENSE for details
//* https://www.gnu.org/licenses/lgpl-2.1.html

import {
    TextDocument
} from 'vscode-languageserver-textdocument';
import { DocumentSymbolParams, DocumentSymbol, SymbolKind, Range, TextDocuments } from 'vscode-languageserver/node';

import * as Parser from 'web-tree-sitter';
import { HITParser } from './hit_parser';

export class MooseOutline {
    // input file parser
    private parser = new HITParser();

    // reference to the language server document store
    private documents: TextDocuments<TextDocument>;

    // Construct a MOOSE input file validator
    constructor(documents: TextDocuments<TextDocument>) {
        this.documents = documents;
    }

    private generateOutline(): DocumentSymbol[] {
        if (!this.parser.tree) {
            return [];
        }

        const traverse = (node: Parser.SyntaxNode): DocumentSymbol[] => {
            var symbols: DocumentSymbol[] = [];

            var active = this.parser.getBlockParameter(node, 'active');
            var active_list: string[] | undefined;
            if (active) {
                active_list = HITParser.explode(active);
                if (active_list[0] == '__all__') {
                    active = undefined;
                }
            }

            var inactive_list = HITParser.explode(this.parser.getBlockParameter(node, 'inactive') || '');

            for (var i = 0, len = node.children.length; i < len; i++) {
                var c = node.children[i];
                if (c.type === 'top_block' || c.type === 'block') {
                    // get block title
                    var t = c.children[1];
                    var block = t.text;
                    if (block.slice(0, 2) === './') {
                        block = block.slice(2);
                    }

                    console.log(block, active, active_list, inactive_list);
                    if ((active_list && active_list.indexOf(block) < 0) || inactive_list.indexOf(block) >= 0) {
                        continue;
                    }

                    symbols.push(DocumentSymbol.create(
                        block,
                        this.parser.getBlockParameter(c, 'type') || undefined,
                        c.type === 'top_block' ? SymbolKind.Constructor : SymbolKind.Array,
                        Range.create(HITParser.pos(c.startPosition), HITParser.pos(c.endPosition)),
                        Range.create(HITParser.pos(t.startPosition), HITParser.pos(t.endPosition)),
                        traverse(c)
                    ));
                }
            }
            return symbols;
        }

        return traverse(this.parser.tree.rootNode);
    }

    getInfo(request: DocumentSymbolParams): DocumentSymbol[] {
        // get the current document
        const document = this.documents.get(request.textDocument.uri);
        if (document) {
            const text = document.getText();
            if (text) {
                this.parser.parse(text);
                if (this.parser.tree) {
                    return this.generateOutline();
                }
            }
        }

        return [];
    }

}
