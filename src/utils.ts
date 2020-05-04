'use strict';
import * as clipboardy from 'clipboardy';
import { Range, Selection, TextEditor } from 'vscode';

interface Insert {
    kind: "insert",
    start: number,
    text: string
}

interface Delete {
    kind: "delete",
    start: number,
    length: number
}

type Command = Insert | Delete;

function toCommand([command, start, arg]: [string, number, any]): Command {
    if (command === 'insert')
        return { kind: command, start: start, text: arg } as Insert;
    else
        return { kind: command, start: start, length: arg } as Delete;
}



function toVscodePositions(editor: TextEditor, pos: any) {
    let start = -1, end = -1;
    if (typeof pos === "number")
        start = end = pos;
    else if (pos instanceof Array)
        [start, end] = pos;
    let pos1 = editor.document.positionAt(start), pos2 = editor.document.positionAt(end);
    return { pos1, pos2 };
}


export const commands = (res: any) => res.changes.map(toCommand);

export function end(command: Command) {
    if (command.kind === 'insert')
        return command.start + command.text.length;
    else
        return command.start + command.length;
}

export function getSelection(editor: TextEditor) {
    return {
        start: editor.document.offsetAt(editor.selection.start),
        end: editor.document.offsetAt(editor.selection.end),
        cursor: editor.document.offsetAt(editor.selection.active)
    };
}

export function select(editor: TextEditor, pos: any): Range {
    const { pos1, pos2 } = toVscodePositions(editor, pos),
          sel = new Selection(pos1, pos2);

    editor.selection = sel;
    editor.revealRange(sel);
    return sel;
}


export function copy(editor: TextEditor, pos: [number, number]) {
    const { pos1, pos2 } = toVscodePositions(editor, pos),
          range = new Range(pos1, pos2),
          text = editor.document.getText(range);

    clipboardy.writeSync(text);
}


export function cut(editor: TextEditor, pos: [number, number]) {
    const command = toCommand(["delete", Math.min(pos[0], pos[1]), Math.abs(pos[1] - pos[0])]);

    copy(editor, pos);
    edit(editor, [command]);
}


export const handle = (editor: TextEditor, command: Command) =>
    (edit: any) => {
        let start = editor.document.positionAt(command.start);

        if (command.kind === 'insert')
            edit.insert(start, command.text);
        else {
            let end = editor.document.positionAt(command.start + command.length);
            edit.delete(new Selection(start, end));
        }
    }


export const edit = (editor: TextEditor, commands: [Command]) =>
    commands
        .reduce((prev, command) =>
            prev.then((_) =>
                editor.edit(handle(editor, command),
                    { undoStopAfter: false, undoStopBefore: false })),
            Promise.resolve(true));


export function undoStop(editor: TextEditor) {
    let pos = editor.document.positionAt(0);
    editor.edit((edit) => edit.insert(pos, ""),
        { undoStopAfter: true, undoStopBefore: false })
}