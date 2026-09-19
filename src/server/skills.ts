import { readdir, readFile, realpath } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { AppTool } from './tools.js'

// Agent Skills (https://agentskills.io/specification) の読み込み。
// <SKILLS_DIR>/<name>/SKILL.md の frontmatter から name / description を取り、規約に合わないものは警告して除外する。
// 送信のたびに読み直すので、追加・変更はサーバー再起動なしで反映される
export type Skill = { name: string; description: string; dir: string } // dir は realpath 済み

const NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/ // 英小文字・数字・ハイフン (連続不可、端不可)
const MAX_NAME = 64
const MAX_DESCRIPTION = 1024
const MAX_FILE_BYTES = 100_000

// frontmatter の最小パーサー。トップレベルのスカラー (name / description / …) だけ読む。
// metadata のようなネストしたブロックは無視する
export function parseFrontmatter(text: string): Record<string, string> | undefined {
  const m = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(\r?\n|$)/.exec(text)
  if (!m) return undefined
  const lines = m[1].split(/\r?\n/)
  const fields: Record<string, string> = {}
  for (let i = 0; i < lines.length; i++) {
    const kv = /^([A-Za-z0-9_-]+):[ \t]*(.*)$/.exec(lines[i])
    if (!kv) continue
    let value = kv[2].trim()
    if (!value && i + 1 < lines.length && /^[ \t]/.test(lines[i + 1])) continue // 値の無いキー + インデント = ネストしたブロック (metadata など) なので無視
    if (value === '|' || value === '>') {
      // ブロックスカラー: 続くインデント行を連結する
      const block: string[] = []
      while (i + 1 < lines.length && (/^[ \t]/.test(lines[i + 1]) || !lines[i + 1].trim())) block.push(lines[++i].trim())
      value = block.join(value === '|' ? '\n' : ' ').trim()
    } else if (value.length > 1 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
      value = value.slice(1, -1)
    }
    fields[kv[1]] = value
  }
  return fields
}

// SKILL.md の中身を検証する。規約に合わなければ error (警告ログ用の日本語) を返す
export function parseSkill(dirName: string, text: string): { name: string; description: string } | { error: string } {
  const fields = parseFrontmatter(text)
  if (!fields) return { error: 'frontmatter (--- で囲んだ YAML) がありません' }
  const name = fields.name ?? ''
  const description = fields.description ?? ''
  if (!name) return { error: 'name がありません' }
  if (name.length > MAX_NAME || !NAME_RE.test(name)) return { error: `name は英小文字・数字・ハイフンの 1-${MAX_NAME} 文字にしてください: ${name}` }
  if (name !== dirName) return { error: `name "${name}" がディレクトリ名 "${dirName}" と一致しません` }
  if (!description) return { error: 'description がありません' }
  if (description.length > MAX_DESCRIPTION) return { error: `description が長すぎます (${description.length} > ${MAX_DESCRIPTION} 文字)` }
  return { name, description }
}

// target が dir の中か (dir 自身は含まない)。realpath 後の実パス同士で使う
export function isInside(dir: string, target: string): boolean {
  const rel = relative(resolve(dir), resolve(target))
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
}

export async function loadSkills(dir = process.env.SKILLS_DIR || './skills'): Promise<{ skills: Skill[]; warnings: string[] }> {
  const warnings: string[] = []
  const root = await realpath(resolve(dir)).catch(() => undefined)
  if (!root) return { skills: [], warnings } // ディレクトリが無ければ Skill なし (エラーにはしない)
  const skills: Skill[] = []
  for (const entry of await readdir(root)) {
    if (entry.startsWith('.')) continue
    const realDir = await realpath(join(root, entry)).catch(() => undefined)
    if (!realDir) continue
    const text = await readFile(join(realDir, 'SKILL.md'), 'utf8').catch(() => undefined)
    if (text === undefined) continue // SKILL.md の無いディレクトリ・ファイルは対象外
    const parsed = parseSkill(entry, text)
    if ('error' in parsed) {
      warnings.push(`skill "${entry}" を除外しました: ${parsed.error}`)
      continue
    }
    skills.push({ ...parsed, dir: realDir })
  }
  return { skills: skills.sort((a, b) => a.name.localeCompare(b.name)), warnings }
}

// instructions に渡す一覧。本文は読ませず、name と description だけで必要時に読むかをモデルに決めさせる
export function skillsPrompt(skills: Skill[]): string {
  return [
    '利用できるスキル (手順書):',
    ...skills.map((s) => `- ${s.name}: ${s.description}`),
    '依頼に合うスキルがあれば、まず read_skill_file で SKILL.md 本文を読み、同梱ファイルは本文の指示に従って同じツールで読んでください。',
  ].join('\n')
}

// 読み取り専用なので承認は不要。スキルディレクトリの外 (パストラバーサル・シンボリックリンク経由) は拒否する
export function skillTools(skills: Skill[]): AppTool[] {
  if (!skills.length) return []
  return [
    {
      name: 'read_skill_file',
      description:
        'スキル (手順書) のファイルを読む。name は提示されたスキル名、path はスキル内の相対パス (本文は "SKILL.md")。スキルのディレクトリの外は読めない',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'スキル名' },
          path: { type: 'string', description: 'スキルディレクトリからの相対パス (例: SKILL.md, references/template.md)' },
        },
        required: ['name', 'path'],
        additionalProperties: false,
      },
      needsApproval: false,
      async execute(args) {
        const a = args as { name?: unknown; path?: unknown }
        const name = String(a?.name ?? '').trim()
        const rel = String(a?.path ?? '').trim()
        const skill = skills.find((s) => s.name === name)
        if (!skill) return `エラー: スキル "${name || '(未指定)'}" はありません`
        if (!rel) return 'エラー: path が空です'
        const file = await realpath(resolve(skill.dir, rel)).catch(() => undefined)
        if (!file) return `エラー: ファイルがありません: ${rel}`
        if (!isInside(skill.dir, file)) return 'エラー: スキルのディレクトリの外は読めません'
        const buf = await readFile(file).catch(() => undefined)
        if (!buf) return `エラー: ${rel} を読めません`
        if (buf.includes(0)) return `エラー: ${rel} はテキストファイルではありません`
        if (buf.length > MAX_FILE_BYTES) return `エラー: ${rel} は大きすぎます (${buf.length} > ${MAX_FILE_BYTES} バイト)`
        return buf.toString('utf8')
      },
    },
  ]
}
