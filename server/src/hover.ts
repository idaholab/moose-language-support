//* This file is part of the MOOSE framework
//* https://www.mooseframework.org
//*
//* Licensed under LGPL 2.1, please see LICENSE for details
//* https://www.gnu.org/licenses/lgpl-2.1.html

import {
    Position,
    TextDocument
} from 'vscode-languageserver-textdocument';
import { Hover, TextDocumentPositionParams, TextDocuments } from 'vscode-languageserver/node';
import { URI, Utils } from 'vscode-uri'

import * as Syntax from './syntax';
import { HITParser } from './hit_parser';

export class MooseHover {
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

    private generateHover(pos: Position, syntax: Syntax.Container, document: TextDocument): Hover | undefined {
        // get block in input file
        const block = this.parser.getBlockAtPosition(pos);
        if (!block) {
            return;
        }

        // check for type parameter
        const type = this.parser.getBlockParameter(block.node, "type");

        // get the parameter definition under the cursor
        const decl = this.parser.getParameterAtPosition(pos, block.node);

        if (decl && decl.children.length > 0) {
            const name = decl.children[0].text;

            // are we on the parameter name or value?
            if (HITParser.isPosInNode(pos, decl.children[0])) { // name
                if (name == 'type') {
                    return { contents: 'Type of the object' };
                }

                // get corresponsing syntax
                const params = syntax.getParameters({ path: block.path, type: type });

                if (name in params) {
                    return { contents: params[name].description };
                }

            } else if (decl.children.length > 2 && HITParser.isPosInNode(pos, decl.children[2])) {
                const value = decl.children[2].text;
                if (name == 'type') {
                    const types = syntax.getTypes(block.path);
                    for (var item of types) {
                        if (item.label == value) {
                            return { contents: item.documentation || '' };
                        }
                    }
                }
            }
        }

        return;
    }

    getInfo(params: TextDocumentPositionParams): Hover | undefined {
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
                            return this.generateHover(params.position, syntax, document);
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
