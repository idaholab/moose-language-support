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
    detailedOutline: boolean;
    formatStyleFile?: string;
}

// the MOOSESyntax (parsed from JSON)
export interface MooseSyntax {
    [key: string]: any;
}
export interface ParseTree {
    [key: string]: any;
}

import {
    NotificationType,
    NotificationType0
} from 'vscode-jsonrpc/node';

export const serverError = new NotificationType<string>('serverErrorNotification');
export const serverDebug = new NotificationType<string>('serverDebugNotification');
export const serverStartWork = new NotificationType0('serverStartWork');
export const serverStopWork = new NotificationType0('serverStopWork');
export const clientDataSend = new NotificationType<string>('clientDataSend');

// export namespace ErrorNotification {
//     interface Params {
//         message: string;
//     }

//     export const type = new NotificationType<Params>('$/errorNotification');
// }
