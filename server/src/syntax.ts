//* This file is part of the MOOSE framework
//* https://www.mooseframework.org
//*
//* Licensed under LGPL 2.1, please see LICENSE for details
//* https://www.gnu.org/licenses/lgpl-2.1.html

import * as fs from 'fs-plus';
import * as cp from 'child_process';
import * as path from 'path';
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
        out_of_range_allowed: boolean,
        options: string
    };
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

export function runApp(path: string, extra_args: string[]): string {
    extra_args = extra_args || [];

    // is this a WSL (Windows Subsystem for Linux) path?
    var isWSL: boolean = path.slice(0, 7).toLowerCase() === '\\\\wsl$\\';

    // child process options
    const cp_options: cp.ExecSyncOptionsWithStringEncoding = {
        stdio: ['pipe', 'pipe', 'ignore'],
        maxBuffer: 1024 * 1024 * 1024,
        encoding: 'utf8'
    };

    var app;
    if (isWSL) {
        var wsl = path.slice(7).split('\\');
        var wsl_path = '/' + wsl.slice(1).join('/');
        var wsl_distro = wsl[0];
        app = cp.spawnSync('wsl', ['-d', wsl_distro, wsl_path, ...extra_args], cp_options);
    } else {
        app = cp.spawnSync(path, extra_args, cp_options);
    }

    // check if the app ran successfully
    if (app.status != 0) {
        throw new Error(`Failed to run application.`);
    }

    // clip the JSON from the output using the markers
    return app.stdout;
}

// This class holds the syntax tree extracted from one application
export class Container {
    tree: Type.Root = {};
    test_objects: boolean = true;

    private constructor() { }

    // construct a container from a JSON dump file
    static fromFile(filename: string, test_objects?: boolean) {
        var c = new Container();
        c.test_objects = !!test_objects;

        function update() {
            c.tree = JSON.parse(fs.readFileSync(filename, 'utf8'));
        }

        update();
        fs.watch(filename, { persistent: false }, update);

        return c;
    }

    static fromProvider(provider: SyntaxProvider, test_objects?: boolean) {
        // static dump file
        if (provider.type == SyntaxProviderEnum.JSONFile) {
            return Container.fromFile(provider.path);
        }

        // otherwise we assume the path describes an app
        var c = new Container();
        c.test_objects = !!test_objects;

        function update() {
            // command line arguments
            var args: string[] = ['--json'];
            if (test_objects) {
                args.push('--allow-test-objects');
            }

            const out = runApp(provider.path, args);
            const beginMarker = '**START JSON DATA**\n';
            const endMarker = '**END JSON DATA**\n';
            let begin = out.indexOf(beginMarker);
            let end = out.lastIndexOf(endMarker);

            if (begin < 0 || end < begin) {
                throw new Error('Markers not found');
            }

            // snip and parse the JSON
            const jsonData = out.slice(begin + beginMarker.length, end);
            c.tree = JSON.parse(jsonData);
        }

        update();
        fs.watch(provider.path, { persistent: false }, update);

        return c;
    }

    // prune a syntax file for testing purposes (this is for internal use only)
    prune(n_max: number): void {
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

        function pruneObjects(objects: Type.Objects): void {
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

        function pruneActions(actions: Type.Actions): void {
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

        function pruneBlocks(blocks: Type.Blocks): void {
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
        Object.assign(ret, this.tree.global.parameters);

        var b = this.getSyntaxNode(p.path);
        if (b == null) {
            return ret;
        }

        // handle block level action parameters first
        if ('actions' in b && b.actions) {
            for (n in b.actions) {
                Object.assign(ret, b.actions[n].parameters);
            }
        }

        // if no type is explicitly set check if a default value exists
        currentType = p.type || ('type' in ret ? ret.type.default : null);

        // if the type is known add the specific parameters
        if (currentType) {
            if ('subblock_types' in b && b.subblock_types && currentType in b.subblock_types) {
                // add parameters for known type
                Object.assign(ret, b.subblock_types[currentType].parameters);
            }
            if ('types' in b && b.types && currentType in b.types) {
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

// types of syntax providers
enum SyntaxProviderEnum {
    NativeApp, WSLApp, JSONFile
};

// descriptor for a moose application syntax provider
interface SyntaxProvider {
    type: SyntaxProviderEnum;
    path: string;
    mtime: number;
    test_objects?: boolean;
    distro?: string;
};

// The syntax warehouse manages multiple syntax containers
export class Warehouse {
    // if the search for an executable fails the warehouse can fall back to looking in this directory
    fallback_app_dir: string = '';

    // offline syntax

    // internal storage for all app syntaxes
    private syntax: { [key: string]: Container } = {};

    // singleton instance for the warehouse
    private static instance: Warehouse = new Warehouse();

    // cache the restults of findSyntaxProvider for faster access
    provider_cache: { [key: string]: SyntaxProvider } = {};

    // singleton pattern use
    // var w = Warehouse.getInstance();
    private constructor() { }
    static getInstance(): Warehouse {
        return this.instance;
    }

    getSyntax(input_path: string, begin?: Function, end?: Function): Container {
        var provider = this.getSyntaxProvider(input_path);
        var key = JSON.stringify(provider);
        if (key in this.syntax) {
            return this.syntax[key];
        } else {
            if (begin) { begin(); }
            var syntax = Container.fromProvider(provider);
            this.syntax[key] = syntax;
            if (end) { end(); }
            return syntax;
        }
    }

    private getSyntaxProvider(input_path: string): SyntaxProvider {
        var matches: SyntaxProvider[], stats;
        if (!input_path) {
            throw new Error('File not saved, nowhere to search for MOOSE syntax data.');
        }

        const mooseApp = /^(.*)-(opt|dbg|oprof|devel)$/;

        if (input_path in this.provider_cache) {
            return this.provider_cache[input_path];
        }

        // is this a WSL (Windows Subsystem for Linux) path?
        var isWSL: boolean = input_path.slice(0, 7).toLowerCase() === '\\\\wsl$\\';

        var search_path = input_path;
        matches = [];
        while (true) {
            // read directory
            var dir = fs.readdirSync(search_path);

            // list all files
            for (var i = 0, n = dir.length; i < n; i++) {
                // check for native or WSL executable or static dump
                var match = mooseApp.exec(dir[i]);
                if (match || dir[i] == 'syntax.json') {
                    var file = path.join(search_path, dir[i]);

                    // on non-WSL systems we make sure the matched path is executable
                    if (match && !isWSL && !fs.isExecutableSync(file)) {
                        continue;
                    }

                    stats = fs.statSync(file);

                    // ignore directories that match the naming pattern
                    if (!isWSL && stats.isDirectory()) {
                        continue;
                    }

                    // get time of last file modification
                    var mtime = stats.mtime.getTime();

                    if (match) {
                        // match is true if the app name regex is matched...
                        matches.push({ type: SyntaxProviderEnum.NativeApp, path: file, mtime: mtime });
                    } else {
                        // ...otherwise we match the 'syntax.json' static dump filename
                        matches.push({ type: SyntaxProviderEnum.JSONFile, path: file, mtime: mtime });
                    }
                }
            }

            // if any app candidates were found return the newest one
            if (matches.length > 0) {
                // return newest match (app or static dump)
                var provider = matches.reduce((a, b) => a.mtime > b.mtime ? a : b);
                this.provider_cache[input_path] = provider;
                return provider;
            }

            // go to parent
            var previous_path = search_path;
            search_path = path.join(search_path, '..');

            // are we at the top level directory already?
            if (search_path == previous_path) {
                // no executable found, let's check the fallback path
                if (this.fallback_app_dir !== '' && input_path !== this.fallback_app_dir) {
                    return this.getSyntaxProvider(this.fallback_app_dir);
                }
                throw new Error('No MOOSE application executable found.');
            }
        }
    }
}

