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


// export namespace ErrorNotification {
//     interface Params {
//         message: string;
//     }

//     export const type = new NotificationType<Params>('$/errorNotification');
// }
