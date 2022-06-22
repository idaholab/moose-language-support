//* This file is part of the MOOSE framework
//* https://www.mooseframework.org
//*
//* Licensed under LGPL 2.1, please see LICENSE for details
//* https://www.gnu.org/licenses/lgpl-2.1.html

import * as fs from 'fs';
import { CompletionItem, CompletionItemKind } from 'vscode-languageserver/node';


export namespace Type {
    export interface TypedPath {
        path: string[];
        type?: string;
    }

    // parameter description
    export type Parameter = {
        basic_type: string,
        controllable: boolean,
        cpp_type: string,
        default: string,
        description: string,
        group_name: string,
        name: string,
        required: boolean,
        deprecated: boolean,
        out_of_range_allowed: boolean
    } | { [key: string]: any };
    export type Parameters = { [key: string]: Parameter };

    export type FileInfo = {
        [key: string]: number
    };

    export type Task = {
        [key: string]: { file_info: FileInfo }
    };
    export type Tasks = { [key: string]: Task };

    export type Object = {
        description: string,
        file_info: FileInfo,
        label: string,
        moose_base: string,
        parameters: Parameters,
        parent_syntax: string,
        register_file: string,
        syntax_path: string
    } | { [key: string]: any };
    export type Objects = { [key: string]: Object };

    export type Action = {
        action_path: string,
        description: string,
        label: string,
        parameters: Parameters,
        register_file: string,
        tasks: Task
    } | { [key: string]: any };
    export type Actions = { [key: string]: Action };

    export type Star = {
        actions: Actions,
        subblock_types: Objects,
        associated_types?: string[]
    }

    export type Block = {
        actions?: Actions,
        subblocks?: Blocks,
        star?: Star,
        types?: Objects
    } | { [key: string]: any };
    export type Blocks = { [key: string]: Block };

    // top level "global" section
    export type Global = {
        associated_types: { [key: string]: string[] },
        parameters: Parameters,
        registered_apps: string[]
    } | { [key: string]: any };

    export type Root = {
        blocks: Blocks,
        global: Global
    } | { [key: string]: any }
}

export class Container {
    tree: Type.Root;
    test_objects: boolean;

    constructor(_tree: Type.Root, _test_objects?: boolean) {
        this.tree = _tree;
        this.test_objects = !!_test_objects;
    }

    // construct a container from a JSON dump file
    static fromFile(filename: string, test_objects?: boolean) {
        return new Container(JSON.parse(fs.readFileSync(filename, 'utf8')), test_objects);
    }

    // prune a syntax file for testing purposes (this is for internal use only)
    prune(n_max: number) {
        function pruneParameters(parameters: Type.Parameters) {
            var n = 0;
            for (var p in parameters) {
                if (n < n_max) {
                    n++;
                } else {
                    delete parameters[p];
                }
            }
        }

        function pruneObjects(objects: Type.Objects) {
            var n = 0;
            for (var o in objects) {
                if (n < n_max) {
                    if (objects[o].parameters) {
                        pruneParameters(objects[o].parameters);
                    }
                    n++;
                } else {
                    delete objects[o];
                }
            }
        }

        function pruneActions(actions: Type.Actions) {
            var n = 0;
            for (var a in actions) {
                if (n < n_max) {
                    if (actions[a].parameters) {
                        pruneParameters(actions[a].parameters);
                    }
                    n++;
                } else {
                    delete actions[a];
                }
            }
        }

        function pruneBlocks(blocks: Type.Blocks) {
            var n = 0;
            for (var b in blocks) {
                if (n < n_max) {
                    if (blocks[b].subblocks) {
                        pruneBlocks(blocks[b].subblocks);
                    }
                    if (blocks[b].actions) {
                        pruneActions(blocks[b].actions);
                    }
                    if (blocks[b].star) {
                        var star = blocks[b].star;
                        if (star.actions) {
                            pruneActions(star.actions);
                        }
                        if (star.subblock_types) {
                            pruneObjects(star.subblock_types);
                        }
                    }
                    n++;
                } else {
                    delete blocks[b];
                }
            }
        }
        pruneBlocks(this.tree.blocks);
    }

    // get the node in the JSON stucture for the current block level
    getSyntaxNode(path: string[]): Type.Block | Type.Star | null {
        var p, ref, b: Type.Block | Type.Star;

        // no parameters at the root
        if (path.length === 0) {
            return null;
        }

        // traverse subblocks
        b = this.tree.blocks[path[0]];
        if (b == null) {
            return null;
        }

        ref = path.slice(1);
        for (var i = 0, len = ref.length; i < len; i++) {
            p = ref[i];
            if ('subblocks' in b && p in b.subblocks) {
                b = b.subblocks[p];
            } else if ('star' in b) {
                b = b.star;
            }
            else {
                return null;
            }
        }

        return b;
    }

    // get a list of valid subblocks
    getSubblocks(path: string[]): string[] {
        // get top level blocks
        if (path.length === 0) {
            return Object.keys(this.tree.blocks);
        }

        // traverse subblocks
        var b = this.getSyntaxNode(path);
        if (!b) {
            return [];
        }

        var ret: string[] = [];
        if ('subblocks' in b) {
            ret = Object.keys(b.subblocks);
        }
        if ('star' in b) {
            ret.push('*');
        }

        return ret.sort();
    }

    // get a list of parameters for the current block
    // if the type parameter is known add in class specific parameters
    getParameters(p: Type.TypedPath): Type.Parameters {
        var currentType, n, ref1, ref2, ret: Type.Parameters = {};

        var b = this.getSyntaxNode(p.path);
        if (b == null) {
            return ret;
        }

        // handle block level action parameters first
        for (n in b.actions) {
            Object.assign(ret, b.actions[n].parameters);
        }

        // if no type is explicitly set check if a default value exists
        currentType = p.type || ('type' in ret ? ret.type.default : null);

        // if the type is known add the specific parameters
        if (currentType) {
            if ('subblock_types' in b) {
                // add parameters for known type
                Object.assign(ret, b.subblock_types[currentType].parameters);
            }
            if ('types' in b) {
                // add parameters for known type
                Object.assign(ret, b.types[currentType].parameters);
            }
        }

        return ret;
    }

    // get a list of possible completions for the type parameter at the current block level
    getTypes(path: string[]): CompletionItem[] {
        var n, ret: CompletionItem[];
        ret = [];

        var b = this.getSyntaxNode(path);
        if (b != null) {
            if ('subblock_types' in b) {
                for (n in b.subblock_types) {
                    ret.push({
                        label: n,
                        documentation: b.subblock_types[n].description,
                        kind: CompletionItemKind.TypeParameter
                    });
                }
            }
            if ('types' in b) {
                for (n in b.types) {
                    ret.push({
                        label: n,
                        documentation: b.types[n].description,
                        kind: CompletionItemKind.TypeParameter
                    });
                }
            }
        }

        return ret;
    }

}

export class Warehouse { }

