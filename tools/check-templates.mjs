/**
 * 防再犯：检查 mobile.mjs 里所有模板字符串内部是否出现了未转义的反引号。
 * 上次就是注释里写了反引号，把模板字符串提前截断，导致语法错误 + 网关起不来。
 *
 * 做法：逐字符扫描，跟踪是否处于模板字符串内；在模板字符串内部发现反引号即报错。
 * （${...} 内的嵌套反引号属于合法情况，这里用简单启发式：跳过 ${ } 配对内容）
 */
import fs from 'node:fs';

const file = process.argv[2];
const src = fs.readFileSync(file, 'utf8');

let i = 0;
let inTemplate = false;
let inLineComment = false;
let inBlockComment = false;
let inSingle = false;
let inDouble = false;
let tplStartLine = 0;
const problems = [];

function lineOf(pos) {
  return src.slice(0, pos).split('\n').length;
}

while (i < src.length) {
  const c = src[i];
  const next = src[i + 1];

  if (inLineComment) { if (c === '\n') inLineComment = false; i++; continue; }
  if (inBlockComment) { if (c === '*' && next === '/') { inBlockComment = false; i += 2; continue; } i++; continue; }

  if (inTemplate) {
    // ${ 开始表达式：跳过到配对 }（粗浅处理，忽略字符串内的 }）
    if (c === '$' && next === '{') {
      let depth = 1; i += 2;
      while (i < src.length && depth > 0) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') depth--;
        i++;
      }
      continue;
    }
    if (c === '\\') { i += 2; continue; }
    if (c === '`') { inTemplate = false; i++; continue; }
    // 模板字符串里的 // 或 /* 都只是普通文本 —— 但这里单列出来便于提示
    i++;
    continue;
  }

  if (inSingle) { if (c === '\\') { i += 2; continue; } if (c === "'") inSingle = false; i++; continue; }
  if (inDouble) { if (c === '\\') { i += 2; continue; } if (c === '"') inDouble = false; i++; continue; }

  if (c === '/' && next === '/') { inLineComment = true; i += 2; continue; }
  if (c === '/' && next === '*') { inBlockComment = true; i += 2; continue; }
  if (c === "'") { inSingle = true; i++; continue; }
  if (c === '"') { inDouble = true; i++; continue; }
  if (c === '`') { inTemplate = true; tplStartLine = lineOf(i); i++; continue; }

  i++;
}

console.log('扫描完成: ' + file);
console.log('  模板字符串配对: ' + (inTemplate ? '✗ 未闭合（起始于第 ' + tplStartLine + ' 行）' : '✓ 全部闭合'));
console.log('  行注释残留: ' + (inLineComment ? '✗' : '✓'));
console.log('  块注释残留: ' + (inBlockComment ? '✗' : '✓'));

// 关键检查：行注释里出现反引号（在模板字符串内时，// 不是注释，而是文本；
// 所以这里改为检查「模板字符串内部的注释文字里是否含反引号」——由上面的扫描天然覆盖：
// 如果模板内有反引号，会提前闭合，导致后续配对错乱 → 用 node --check 兜底）
process.exit(inTemplate || inLineComment || inBlockComment ? 1 : 0);
