// deno-lint-ignore-file no-explicit-any
import { std } from "./deps.ts";
import { highlight } from "./highlight.ts";
import { html, HtmlString, time } from "./templates.ts";

import * as djot from "./djot.js/src/index.ts";
import {
  AstNode,
  Doc,
  getStringContent,
  Para,
  Section,
} from "./djot.js/src/ast.ts";
export { getStringContent };

export function parse(source: string): Doc {
  return djot.parse(source);
}

function has_class(node: AstNode, cls: string): boolean {
  return node.attributes?.["class"]?.split(" ")?.includes(cls) ?? false;
}

export function render(node: Doc, ctx: any): HtmlString {
  let current_section: Section | undefined = undefined;
  try {
    const result = djot.renderHTML(node, {
      overrides: {
        section(node, r) {
          const old_section = current_section;
          current_section = node;
          for (const child of node.children) {
            if (child.tag == "heading" && child.level == 1) {
              r.renderChildren(node);
              return;
            }
          }
          r.renderAstNodeDefault(node);
          current_section = old_section;
        },
        heading(node, r) {
          if (node.level == 1 && ctx.date) {
            node.children.push({
              tag: "raw_inline",
              format: "html",
              text: time(ctx.date).value,
            });
          }
          if (current_section && node.level > 1) {
            if (node == current_section.children[0]) {
              const id = current_section.attributes?.id;
              if (id) {
                node.children = [{
                  tag: "link",
                  destination: `#${id}`,
                  children: node.children,
                }];
              }
            }
          }
          r.renderAstNodeDefault(node);
        },
        para: (node, r) => {
          if (!ctx.summary) ctx.summary = getStringContent(node);
          if (node.children.length == 1 && node.children[0].tag == "image") {
            r.renderTag("figure", node);
            const cap = node.attributes?.cap;
            if (cap) {
              r.literal('<figcaption class="title">');
              r.out(cap);
              r.literal("</figcaption>");
            }
            r.renderChildren(node);
            r.renderCloseTag("figure");
            return;
          }
          r.renderAstNodeDefault(node);
        },
        list: (node, r) => {
          if (node.style == "1)") {
            const attributes = node.attributes ?? {};
            const cls = attributes["class"] ?? "";
            attributes["class"] = `${cls} callout`;
            node.attributes = attributes;
          }
          r.renderAstNodeDefault(node);
        },
        div: (node, r) => {
          let admon_icon = "";
          if (has_class(node, "note")) admon_icon = "info-circle";
          if (has_class(node, "quiz")) admon_icon = "question-circle";
          if (has_class(node, "warn")) admon_icon = "exclamation-circle";

          if (admon_icon) {
            r.renderTag("aside", node, { "class": "admn" });
            r.literal(`<i class="fa fa-${admon_icon}"></i>`);
            r.literal("<div>");
            r.renderChildren(node);
            r.literal("</div>");
            r.renderCloseTag("aside");
            return;
          }

          if (has_class(node, "block")) {
            r.renderTag("aside", node, { "class": "block" });
            const cap = node.attributes?.cap;
            if (cap) {
              r.literal('<div class="title">');
              r.out(cap);
              r.literal("</div>");
            }
            r.renderChildren(node);
            r.renderCloseTag("aside");
            return;
          }

          if (has_class(node, "details")) {
            r.renderTag("details", node);
            r.literal("<summary>");
            r.out(node.attributes?.cap ?? "");
            r.literal("</summary>");
            r.renderChildren(node);
            r.renderCloseTag("details");
            return;
          }

          r.renderAstNodeDefault(node);
        },
        code_block: (node, r) => {
          r.renderTag("figure", node, { "class": "code-block" });
          const cap = node.attributes?.cap;
          if (cap) {
            r.literal('<figcaption class="title">');
            r.out(cap);
            r.literal("</figcaption>");
          }
          r.literal(
            highlight(
              node.text,
              node.lang,
              node.attributes?.highlight,
            ).value,
          );
          r.renderCloseTag("figure");
        },
        blockquote: (node, r) => {
          let source = undefined;
          if (node.children.length > 0) {
            const last_child = node.children[node.children.length - 1];
            const children = (<Para> last_child).children;
            if (
              children.length == 1 &&
              children[0].tag == "link"
            ) {
              source = children[0];
              children.pop();
            }
          }

          r.renderTag("figure", node, { class: "blockquote" });
          r.literal("<blockquote>");
          r.renderChildren(node);
          r.literal("</blockquote>");
          if (source) {
            r.literal("<figcaption><cite>");
            r.renderAstNode(source);
            r.literal("</cite></figcaption>");
          }
          r.renderCloseTag("figure");
        },
      },
    });

    return new HtmlString(result);
  } catch (e) {
    return html`Error: ${e}`;
  }
}

const visitor: { [key: string]: (node: Node) => HtmlString } = {
  image: (node) => {
    const href = node.ast.reference
      ? node.references[node.ast.reference].destination
      : node.ast.destination;
    if (node.cls.includes("video")) {
      return html`<video src="${href}" controls=""></video>`;
    } else {
      const attrs = Object.entries(node.ast.attr ?? {}).map(([k, v]) =>
        ` ${k}="${v}"`
      ).join("");
      return html`<img src="${href}" alt="${node.text}"${attrs}>`;
    }
  },
  reference_definition: (_node) => html``,
  span: (node) => {
    if (node.cls.includes("kbd")) {
      let first = true;
      const keystrokes = node.text.split("+")
        .map((it) => {
          const plus = first ? "" : "+";
          first = false;
          return html`${plus}<kbd>${it}</kbd>`;
        });
      return html`${keystrokes}`;
    }
    if (node.cls.includes("menu")) {
      const content = new HtmlString(html`${node.content}`.value.replaceAll(
        "&gt;",
        '<i class="fa fa-angle-right"></i>',
      ));
      return html`<span class="menu">${content}</span>`;
    }
    throw `unhandled node: ${JSON.stringify(node.ast)}`;
  },
};

const substs: Record<string, string> = {
  ellipses: "…",
  left_single_quote: "‘",
  right_single_quote: "’",
  left_double_quote: "“",
  right_double_quote: "”",
  en_dash: "–",
  em_dash: "—",
  softbreak: "\n",
};

export class Node {
  private constructor(
    public ast: any,
    public parent: Node | undefined,
    public ctx: any,
  ) {}

  public static new_root(ast: any): Node {
    return new Node(ast, undefined, undefined);
  }

  public withContext(ctx: any): Node {
    if (this.parent) throw "not a root";
    return new Node(this.ast, undefined, ctx);
  }

  public get tag(): string {
    return this.ast.tag;
  }

  public get children(): Node[] {
    return this.ast.children?.map((it: any) => new Node(it, this, this.ctx)) ??
      [];
  }

  public get text(): string {
    const s = this.ast.text;
    if (s !== undefined) return s;
    return this.child("str")?.text ?? "";
  }

  public get cls(): string {
    const attrs = (this.ast.attr ?? {});
    return attrs["class"] ?? "";
  }

  public get class_attr(): HtmlString {
    return this.class_attr_extra();
  }

  public class_attr_extra(exra = ""): HtmlString {
    let cls = this.cls ?? "";
    if (exra) cls += ` ${exra}`;
    if (!cls.trim()) return new HtmlString("");
    return html` class = "${cls}"`;
  }

  get content(): HtmlString {
    return html`${this.children.map((it) => it.render())}`;
  }
  get references(): Record<string, { destination: string }> {
    if (this.parent) return this.parent.references;
    return this.ast.references;
  }

  public child(t: string): Node | undefined {
    return this.children.find((it) => it.tag == t);
  }

  render(): HtmlString {
    try {
      const subst = substs[this.tag];
      if (subst) return html`${subst}`;
      const f = visitor[this.tag];
      if (!f) throw `unhandled node ${this.tag}`;
      return f(this);
    } catch (e) {
      console.error(e);
      return html`<strong>${e}</strong>:<br>can't render ${
        JSON.stringify(this.ast)
      }<br/>${e.stack}`;
    }
  }
}
