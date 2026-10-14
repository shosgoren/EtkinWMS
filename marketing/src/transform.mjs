// Bileşen kodu dönüştürücüsü (T-941); build.mjs ve testler kullanır.
import ts from "typescript";

/**
 * Bileşen kodunu CSP ve lint uyumlu biçime çevirir: anonim `function` ifadeleri ok işlevine,
 * `var self = this;` kaldırılır ve `self` → `this`. `this`/`arguments` kullanan anonim işlev varsa durur.
 * @param {string} code
 */
export function transformComponent(code) {
  const sf = ts.createSourceFile("component.js", code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  /** @type {{ start: number, end: number, text: string }[]} */
  const edits = [];
  /** @param {ts.Node} fn */
  const usesOwnThis = (fn) => {
    let found = false;
    /** @param {ts.Node} n */
    const walk = (n) => {
      if (found) return;
      if (n !== fn && (ts.isFunctionExpression(n) || ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n))) return;
      if (n.kind === ts.SyntaxKind.ThisKeyword || (ts.isIdentifier(n) && n.text === "arguments")) found = true;
      ts.forEachChild(n, walk);
    };
    ts.forEachChild(fn, walk);
    return found;
  };
  /** @param {ts.Node} n */
  const visit = (n) => {
    if (ts.isFunctionExpression(n) && !n.name && !n.asteriskToken) {
      if (usesOwnThis(n)) throw new Error("anonim işlev kendi this/arguments değerini kullanıyor; elle düzeltin");
      const params = n.parameters.map((p) => p.getText(sf)).join(", ");
      const asyncPrefix = n.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword) ? "async " : "";
      edits.push({ start: n.getStart(sf), end: n.body.getStart(sf), text: `${asyncPrefix}(${params}) => ` });
    }
    if (ts.isVariableStatement(n)) {
      const decls = n.declarationList.declarations;
      if (decls.length === 1 && decls[0]?.initializer?.kind === ts.SyntaxKind.ThisKeyword && ts.isIdentifier(decls[0].name) && decls[0].name.text === "self") {
        edits.push({ start: n.getStart(sf), end: n.getEnd(), text: "" });
        return;
      }
    }
    if (ts.isIdentifier(n) && n.text === "self") {
      const parent = n.parent;
      const isPropertyName = parent && ts.isPropertyAccessExpression(parent) && parent.name === n;
      if (!isPropertyName) edits.push({ start: n.getStart(sf), end: n.getEnd(), text: "this" });
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  edits.sort((a, b) => b.start - a.start);
  let out = code;
  for (const e of edits) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return out;
}
