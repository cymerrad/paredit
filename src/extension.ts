'use strict';
import * as paredit from "paredit.js";
import { commands, ConfigurationChangeEvent, ExtensionContext, TextEditor, window, workspace } from 'vscode';
import { StatusBar } from './status_bar';
import * as utils from './utils';

interface Selection_ {
    cursor: number,
    end: number,
    prev: number,
    start: number,
}

interface ArgAPI {
    textEditor: TextEditor,
    src: string,
    ast: paredit.AST,
    selection: Selection_,
}

type PareditNavigatorFunc = (ast: paredit.AST, idx: number) => number | [number, number];
type PareditNavigatorExpansionFunc = (ast: paredit.AST, startIdx: number, endIdx: number) => [number, number];

// a.k.a. fuck-it.js
interface _expandState {
    range: any,
    prev: any,
}

const languages = new Set(["clojure", "hy", "lisp", "scheme"]);
let enabled = true;
let expandState: _expandState = { range: null, prev: null };

const navigate = (fn: PareditNavigatorFunc) =>
    ({ textEditor, ast, selection }: ArgAPI) => {
        let res = fn(ast, selection.cursor);
        utils.select(textEditor, res);
    }

const yank = (fn: PareditNavigatorFunc) =>
    ({ textEditor, ast, selection }: ArgAPI) => {
        let res = fn(ast, selection.cursor);
        let positions: [number, number] = typeof (res) === "number" ? [selection.cursor, res] : res;
        utils.copy(textEditor, positions);
    }

const cut = (fn: PareditNavigatorFunc) =>
    ({ textEditor, ast, selection }: ArgAPI) => {
        let res = fn(ast, selection.cursor);
        let positions: [number, number] = typeof (res) === "number" ? [selection.cursor, res] : res;
        utils.cut(textEditor, positions);
    }

const navigateExpandSelecion = (fn: PareditNavigatorExpansionFunc) =>
    ({ textEditor, ast, selection }: ArgAPI) => {
        let range = textEditor.selection;
        let res = fn(ast, selection.start, selection.end);
        if (expandState.prev == null || !range.contains(expandState.prev!.range!)) {
            expandState = { range: range, prev: null };
        }
        expandState = { range: utils.select(textEditor, res), prev: expandState };
    }

function navigateContractSelecion({ textEditor, selection }: ArgAPI) {
    let range = textEditor.selection;
    if (expandState.prev && expandState.prev.range && range.contains(expandState.prev.range)) {
        textEditor.selection = expandState.prev.range;
        expandState = expandState.prev;
    }
}

function indent({ textEditor, selection }: ArgAPI) {
    let src = textEditor.document.getText(),
        ast = paredit.parse(src),
        res = paredit.editor.indentRange(ast, src, selection.start, selection.end);

    utils
        .edit(textEditor, utils.commands(res))
        .then((applied?) => utils.undoStop(textEditor));
}

const wrapAround = (ast: paredit.AST, src: string, start: number, {opening, closing}:{opening: string, closing: string}) => paredit.editor.wrapAround(ast, src, start, opening, closing);

interface EditOpts {
    "_skipIndent"?: boolean,
    "backward"?: boolean,
    opening?: string,
    closing?: string,
}

const edit = (fn: Function, opts = {} as EditOpts) =>
    ({ textEditor, src, ast, selection }: ArgAPI) => {
        let { start, end } = selection;
        let res = fn(ast, src, selection.start, { ...opts, endIdx: start === end ? undefined : end });

        if (res)
            if (res.changes.length > 0) {
                let cmd = utils.commands(res),
                    sel = {
                        // @ts-ignore
                        start: Math.min(...cmd.map(c => c.start)),
                        end: Math.max(...cmd.map(utils.end)),
                    } as Selection_;

                utils
                    .edit(textEditor, cmd)
                    .then((applied?) => {
                        utils.select(textEditor, res.newIndex);
                        if (!opts["_skipIndent"]) {
                            indent({
                                textEditor: textEditor,
                                selection: sel,
                            } as ArgAPI);
                        }
                    });
            }
            else
                utils.select(textEditor, res.newIndex);
    }

const createNavigationCopyCutCommands = (commands: Map<string, PareditNavigatorFunc>) => {
    const capitalizeFirstLetter = (s: string) => { return s.charAt(0).toUpperCase() + s.slice(1); }

    let result: [string, Function][] = new Array<[string, Function]>();
    Object.keys(commands).forEach((c) => {
        let cmd = commands.get(c)!;
        result.push([`paredit.${c}`, navigate(cmd)]);
        result.push([`paredit.yank${capitalizeFirstLetter(c)}`, yank(cmd)]);
        result.push([`paredit.cut${capitalizeFirstLetter(c)}`, cut(cmd)]);
    });
    return result;
}

const navCopyCutcommands = new Map<string, PareditNavigatorFunc>([
    ['rangeForDefun', paredit.navigator.rangeForDefun],
    ['forwardSexp', paredit.navigator.forwardSexp],
    ['backwardSexp', paredit.navigator.backwardSexp],
    ['forwardDownSexp', paredit.navigator.forwardDownSexp],
    ['backwardUpSexp', paredit.navigator.backwardUpSexp],
    ['closeList', paredit.navigator.closeList],
]);

const pareditCommands: [string, Function][] = [

    // SELECTING
    ['paredit.sexpRangeExpansion', navigateExpandSelecion(paredit.navigator.sexpRangeExpansion)],
    ['paredit.sexpRangeContraction', navigateContractSelecion],

    // NAVIGATION, COPY, CUT
    // (Happens in createNavigationCopyCutCommands())

    // EDITING
    ['paredit.slurpSexpForward', edit(paredit.editor.slurpSexp, { 'backward': false })],
    ['paredit.slurpSexpBackward', edit(paredit.editor.slurpSexp, { 'backward': true })],
    ['paredit.barfSexpForward', edit(paredit.editor.barfSexp, { 'backward': false })],
    ['paredit.barfSexpBackward', edit(paredit.editor.barfSexp, { 'backward': true })],
    ['paredit.spliceSexp', edit(paredit.editor.spliceSexp)],
    ['paredit.splitSexp', edit(paredit.editor.splitSexp)],
    ['paredit.killSexpForward', edit(paredit.editor.killSexp, { 'backward': false })],
    ['paredit.killSexpBackward', edit(paredit.editor.killSexp, { 'backward': true })],
    ['paredit.spliceSexpKillForward', edit(paredit.editor.spliceSexpKill, { 'backward': false })],
    ['paredit.spliceSexpKillBackward', edit(paredit.editor.spliceSexpKill, { 'backward': true })],
    ['paredit.deleteForward', edit(paredit.editor.delete, { 'backward': false, '_skipIndent': true })],
    ['paredit.deleteBackward', edit(paredit.editor.delete, { 'backward': true, '_skipIndent': true })],
    ['paredit.wrapAroundParens', edit(wrapAround, { opening: '(', closing: ')' })],
    ['paredit.wrapAroundSquare', edit(wrapAround, { opening: '[', closing: ']' })],
    ['paredit.wrapAroundCurly', edit(wrapAround, { opening: '{', closing: '}' })],
    ['paredit.indentRange', indent],
    ['paredit.transpose', edit(paredit.editor.transpose)]];

function wrapPareditCommand(fn: Function) {
    return () => {

        let textEditor = window.activeTextEditor;
        if (textEditor == undefined) {
            console.error("Investigate 1");
            return;
        }
        let doc = textEditor.document;
        if (!enabled || !languages.has(doc.languageId)) return;

        let src = textEditor.document.getText();
        fn({
            textEditor: textEditor,
            src: src,
            ast: paredit.parse(src),
            selection: utils.getSelection(textEditor)
        });
    }
}

function setKeyMapConf() {
    let keyMap = workspace.getConfiguration().get('paredit.defaultKeyMap');
    commands.executeCommand('setContext', 'paredit:keyMap', keyMap);
}
setKeyMapConf();

export function activate(context: ExtensionContext) {

    let statusBar = new StatusBar();

    context.subscriptions.push(

        statusBar,
        commands.registerCommand('paredit.toggle', () => { enabled = !enabled; statusBar.enabled = enabled; }),
        window.onDidChangeActiveTextEditor((e) => statusBar.visible = !!e && e.document && languages.has(e.document.languageId)),
        workspace.onDidChangeConfiguration((e: ConfigurationChangeEvent) => {
            console.log(e);
            if (e.affectsConfiguration('paredit.defaultKeyMap')) {
                setKeyMapConf();
            }
        }),

        ...createNavigationCopyCutCommands(navCopyCutcommands)
            .map(([command, fn]) => commands.registerCommand(command, wrapPareditCommand(fn))),
        ...pareditCommands
            .map(([command, fn]) => commands.registerCommand(command, wrapPareditCommand(fn))));
}

export function deactivate() {
}