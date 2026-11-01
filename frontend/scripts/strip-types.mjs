// Node's own stripTypeScriptTypes needs Node 22.13, and the supported minimum is 22.12.
import ts from "typescript";

export const stripTypeScriptTypes = (source) =>
  ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, verbatimModuleSyntax: true },
  }).outputText;
