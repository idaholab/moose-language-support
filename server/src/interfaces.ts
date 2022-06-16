//* This file is part of the MOOSE framework
//* https://www.mooseframework.org
//*
//* Licensed under LGPL 2.1, please see LICENSE for details
//* https://www.gnu.org/licenses/lgpl-2.1.html


// The language server settings
export interface MooseLanguageSettings {
    maxNumberOfProblems: number;
    fallbackMooseDir: string;
    ignoreMooseNotFoundError: boolean;
    hideDeprecatedParams: boolean;
    allowTestObjects: boolean;
}

// the MOOSESyntax (parsed from JSON)
export interface MooseSyntax
{
    [key: string]: any;
}
export interface ParseTree
{
    [key: string]: any;
}

import * as rpc from 'vscode-jsonrpc/node';

export const serverError = new rpc.NotificationType<string>('serverErrorNotification');
export const serverDebug = new rpc.NotificationType<string>('serverDebugNotification');
export const serverStartWork = new rpc.NotificationType0('serverStartWork');
export const serverStopWork = new rpc.NotificationType0('serverStopWork');

// export namespace ErrorNotification {
//     interface Params {
//         message: string;
//     }

//     export const type = new NotificationType<Params>('$/errorNotification');
// }
