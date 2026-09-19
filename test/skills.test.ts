import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isInside, loadSkills, parseFrontmatter, parseSkill, skillTools, skillsPrompt } from '../src/server/skills.ts'

const md = (frontmatter: string, body = '') => `---\n${frontmatter}\n---\n${body}`
const errorOf = (dir: string, frontmatter: string) => {
  const r = parseSkill(dir, md(frontmatter))
  return 'error' in r ? r.error : undefined
}
const withTemp = async (fn: (dir: string) => Promise<void>) => {
  const dir = await mkdtemp(join(tmpdir(), 'orchat-skills-'))
  try {
    await fn(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

test('parseFrontmatter: スカラー・引用符・ブロックスカラーを読み、ネストは無視する', () => {
  assert.deepEqual(parseFrontmatter(md('name: pdf-processing\ndescription: "PDF を扱う。使うとき: 抽出・結合"')), {
    name: 'pdf-processing',
    description: 'PDF を扱う。使うとき: 抽出・結合',
  })
  assert.deepEqual(parseFrontmatter(md("name: a\ndescription: 'single'")), { name: 'a', description: 'single' })
  const block = parseFrontmatter('---\nname: a\ndescription: >\n  長い説明の\n  続き\nmetadata:\n  author: me\n---\n')
  assert.deepEqual(block, { name: 'a', description: '長い説明の 続き' })
  assert.equal(parseFrontmatter('name: a'), undefined)
  assert.equal(parseFrontmatter('# frontmatter なし'), undefined)
})

test('parseSkill: name / description の規約を検証する', () => {
  assert.deepEqual(parseSkill('pdf-processing', md('name: pdf-processing\ndescription: PDF を扱う')), { name: 'pdf-processing', description: 'PDF を扱う' })
  const noFrontmatter = parseSkill('a', 'frontmatter なし')
  assert.ok('error' in noFrontmatter && /frontmatter/.test(noFrontmatter.error))
  assert.match(errorOf('a', 'description: x')!, /name がありません/)
  assert.match(errorOf('a', 'name: a')!, /description がありません/)
  assert.match(errorOf('a', 'name: A\ndescription: x')!, /name は/)
  assert.match(errorOf('a', 'name: -pdf\ndescription: x')!, /name は/)
  assert.match(errorOf('a', 'name: pdf--processing\ndescription: x')!, /name は/)
  assert.match(errorOf('a', `name: ${'a'.repeat(65)}\ndescription: x`)!, /name は/)
  assert.match(errorOf('a', 'name: b\ndescription: x')!, /ディレクトリ名/)
  const long = errorOf('a', `name: a\ndescription: ${'x'.repeat(1025)}`)!
  assert.match(long, /description が長すぎます/)
  assert.deepEqual(parseSkill('a', md(`name: a\ndescription: ${'x'.repeat(1024)}`)), { name: 'a', description: 'x'.repeat(1024) })
})

test('isInside: 親ディレクトリ・絶対パス・自分自身は外、.. で始まる名前は中', () => {
  assert.equal(isInside('/s/a', '/s/a/SKILL.md'), true)
  assert.equal(isInside('/s/a', '/s/a/..foo/x'), true)
  assert.equal(isInside('/s/a', '/s/b/SKILL.md'), false)
  assert.equal(isInside('/s/a', '/s/a/../b/x'), false)
  assert.equal(isInside('/s/a', '/s/a'), false)
})

test('skillsPrompt: 一覧 (name: description) と読み方を渡す', () => {
  const p = skillsPrompt([{ name: 'a', description: '説明', dir: '/x' }])
  assert.match(p, /- a: 説明/)
  assert.match(p, /read_skill_file/)
})

test('skillTools: Skill が無ければツール無し、あれば承認不要の read_skill_file を返す', () => {
  assert.deepEqual(skillTools([]), [])
  const [tool] = skillTools([{ name: 'a', description: 'x', dir: '/x' }])
  assert.equal(tool.name, 'read_skill_file')
  assert.equal(tool.needsApproval, false)
  assert.deepEqual(tool.parameters.required, ['name', 'path'])
})

test('loadSkills: 有効な Skill だけ読み込み、不正なものは警告して除外する', async () => {
  await withTemp(async (dir) => {
    await mkdir(join(dir, 'good-skill', 'references'), { recursive: true })
    await writeFile(join(dir, 'good-skill', 'SKILL.md'), md('name: good-skill\ndescription: 良いスキル'))
    await writeFile(join(dir, 'good-skill', 'references', 'note.md'), 'note')
    await mkdir(join(dir, 'bad-name'))
    await writeFile(join(dir, 'bad-name', 'SKILL.md'), md('name: Bad\ndescription: 不正'))
    await mkdir(join(dir, 'no-skillmd'))
    await writeFile(join(dir, 'no-skillmd', 'readme.txt'), 'x')

    const { skills, warnings } = await loadSkills(dir)
    assert.deepEqual(skills.map((s) => s.name), ['good-skill'])
    assert.equal(warnings.length, 1)
    assert.match(warnings[0], /bad-name/)
  })
  assert.deepEqual(await loadSkills(join(tmpdir(), `orchat-nope-${Date.now()}`)), { skills: [], warnings: [] })
})

test('read_skill_file: 本文と同梱ファイルを読み、ディレクトリの外 (トラバーサル・シンボリックリンク) は拒否する', async () => {
  await withTemp(async (dir) => {
    await mkdir(join(dir, 'skills', 'good-skill'), { recursive: true })
    const skillDir = join(dir, 'skills', 'good-skill')
    await writeFile(join(skillDir, 'SKILL.md'), md('name: good-skill\ndescription: x', '# 本文'))
    await writeFile(join(skillDir, 'note.md'), 'note')
    await writeFile(join(dir, 'skills', 'outside.txt'), 'secret') // スキル外だが skills 直下 (一覧の外)
    await writeFile(join(dir, 'outside.txt'), 'secret')
    await symlink(join(dir, 'outside.txt'), join(skillDir, 'link.txt'))

    const { skills } = await loadSkills(join(dir, 'skills'))
    const [tool] = skillTools(skills)
    const ctx = { userId: 'u', signal: new AbortController().signal }
    assert.match(await tool.execute({ name: 'good-skill', path: 'SKILL.md' }, ctx), /# 本文/)
    assert.equal(await tool.execute({ name: 'good-skill', path: 'note.md' }, ctx), 'note')
    assert.match(await tool.execute({ name: 'good-skill', path: '../outside.txt' }, ctx), /外は読めません/)
    assert.match(await tool.execute({ name: 'good-skill', path: join(dir, 'outside.txt') }, ctx), /外は読めません/)
    assert.match(await tool.execute({ name: 'good-skill', path: 'link.txt' }, ctx), /外は読めません/)
    assert.match(await tool.execute({ name: 'nope', path: 'SKILL.md' }, ctx), /スキル "nope" はありません/)
    assert.match(await tool.execute({ name: 'good-skill', path: 'nope.md' }, ctx), /ファイルがありません/)
    assert.match(await tool.execute({ name: 'good-skill', path: '' }, ctx), /path が空です/)
  })
})
