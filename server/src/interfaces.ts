// The example settings
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
export const serverStartWork = new rpc.NotificationType0('serverStartWork');
export const serverStopWork = new rpc.NotificationType0('serverStopWork');

// export namespace ErrorNotification {
//     interface Params {
//         message: string;
//     }

//     export const type = new NotificationType<Params>('$/errorNotification');
// }
