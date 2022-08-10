//* This file is part of the MOOSE framework
//* https://www.mooseframework.org
//*
//* Licensed under LGPL 2.1, please see LICENSE for details
//* https://www.gnu.org/licenses/lgpl-2.1.html

import {
    Position,
    TextDocument
} from 'vscode-languageserver-textdocument';
import { DefinitionLink, LocationLink, Range, TextDocumentPositionParams, TextDocuments } from 'vscode-languageserver/node';
import { URI, Utils } from 'vscode-uri'

import * as Syntax from './syntax';
import { HITParser } from './hit_parser';

export class MooseDefinition {
    // syntax warehouse
    private warehouse: Syntax.Warehouse = Syntax.Warehouse.getInstance();

    // input file parser
    private parser = new HITParser();

    // reference to the language server document store
    private documents: TextDocuments<TextDocument>;

    // Construct a MOOSE input file hover provider
    constructor(documents: TextDocuments<TextDocument>) {
        this.documents = documents;
    }

    private generateLink(pos: Position, syntax: Syntax.Container): DefinitionLink[] | undefined {
        // get block in input file
        const block = this.parser.getBlockAtPosition(pos);
        if (!block) {
            return;
        }
        LocationLink.create
        // get the parameter definition under the cursor
        const decl = this.parser.getParameterAtPosition(pos, block.node);

        if (decl && decl.children.length > 2) {
            const name = decl.children[0].text;
            const type_node = decl.children[2];
            const type = type_node.text;

            // are we on the value of the type parameter?
            if (name == 'type' && HITParser.isPosInNode(pos, type_node)) {
                var b = syntax.getSyntaxNode(block.path);
                if (b == null) {
                    return;
                }
                var fi: Syntax.Type.FileInfo | undefined;

                if ('subblock_types' in b && b.subblock_types && type in b.subblock_types) {
                    fi = b.subblock_types[type].file_info;
                }
                if ('types' in b && b.types && type in b.types) {
                    fi = b.types[type].file_info;
                }

                if (fi) {
                    var dl: DefinitionLink[] = [];
                    for (var file in fi) {
                        const uri = URI.file(file);
                        const line = fi[file] - 1;
                        const range = {
                            start: { line: line, character: 0 },
                            end: { line: line, character: 1000 }
                        };
                        dl.push(LocationLink.create(uri.toString(), range, range));
                    }
                    return dl;
                }
            }

            return;
        }

    }

    getInfo(params: TextDocumentPositionParams): DefinitionLink[] | undefined {
        // the the current document's URI
        let uri: URI = URI.parse(params.textDocument.uri);

        // get the current document
        const document = this.documents.get(params.textDocument.uri);

        if (uri.scheme == 'file' && document) {
            // find path to current document
            let path: string = Utils.dirname(uri).fsPath;

            // get the corresponding syntax
            try {
                var syntax = this.warehouse.getSyntax(path);
                if (syntax) {
                    // get the document text
                    const text = document.getText();
                    if (text) {
                        // parse the text
                        this.parser.parse(text);
                        if (this.parser.tree) {
                            // everything is prepared, now compute the completion
                            return this.generateLink(params.position, syntax);
                        }
                    }
                }
            } catch (e: any) {
                //notifyError(e.message);
                return;
            }
        }
    }

}
