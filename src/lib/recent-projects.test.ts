import { describe, expect, it } from 'vitest'
import {
  MAX_RECENT_PROJECTS,
  addRecentProject,
  parseRecentProjects,
  projectNameFromPath,
  removeRecentProject,
  validateProjectName,
} from './recent-projects'

const entry = (path: string, openedAt = 1) => ({ path, name: projectNameFromPath(path), openedAt })

describe('addRecentProject', () => {
  it('adds the newest project first', () => {
    const list = addRecentProject([entry('/a/first.dthat')], entry('/a/second.dthat'))
    expect(list.map((item) => item.path)).toEqual(['/a/second.dthat', '/a/first.dthat'])
  })

  it('moves an already-listed project back to the top instead of duplicating it', () => {
    const list = addRecentProject(
      [entry('/a/first.dthat'), entry('/a/second.dthat'), entry('/a/third.dthat')],
      entry('/a/third.dthat', 99),
    )
    expect(list.map((item) => item.path)).toEqual(['/a/third.dthat', '/a/first.dthat', '/a/second.dthat'])
    expect(list).toHaveLength(3)
  })

  it('caps the list', () => {
    let list: ReturnType<typeof entry>[] = []
    for (let i = 0; i < 15; i++) list = addRecentProject(list, entry(`/a/p${i}.dthat`))
    expect(list).toHaveLength(MAX_RECENT_PROJECTS)
    expect(list[0].path).toBe('/a/p14.dthat')
    expect(list.some((item) => item.path === '/a/p0.dthat')).toBe(false)
  })

  it('ignores an entry with no path', () => {
    const list = [entry('/a/first.dthat')]
    expect(addRecentProject(list, { path: '', name: '', openedAt: 1 })).toBe(list)
  })
})

describe('removeRecentProject', () => {
  it('drops just the named project', () => {
    const list = removeRecentProject([entry('/a/one.dthat'), entry('/a/two.dthat')], '/a/one.dthat')
    expect(list.map((item) => item.path)).toEqual(['/a/two.dthat'])
  })
})

describe('parseRecentProjects', () => {
  it('accepts a well-formed list', () => {
    expect(parseRecentProjects([entry('/a/one.dthat', 5)])).toEqual([
      { path: '/a/one.dthat', name: 'one', openedAt: 5 },
    ])
  })

  it('returns an empty list for anything else', () => {
    expect(parseRecentProjects(undefined)).toEqual([])
    expect(parseRecentProjects('nope')).toEqual([])
    expect(parseRecentProjects({ path: '/a/x.dthat' })).toEqual([])
  })

  it('drops junk rows and fills in a missing name', () => {
    const parsed = parseRecentProjects([{ path: '/a/one.dthat' }, { nope: true }, 42, { path: '' }])
    expect(parsed).toEqual([{ path: '/a/one.dthat', name: 'one', openedAt: 0 }])
  })

  it('caps a list written by a different version', () => {
    const raw = Array.from({ length: 30 }, (_, i) => entry(`/a/p${i}.dthat`))
    expect(parseRecentProjects(raw)).toHaveLength(MAX_RECENT_PROJECTS)
  })
})

describe('projectNameFromPath', () => {
  it('strips the directory and extension', () => {
    expect(projectNameFromPath('/home/me/Projects/My Clip.dthat')).toBe('My Clip')
  })

  it('handles Windows separators', () => {
    expect(projectNameFromPath('C:\\Users\\me\\demo.dthat')).toBe('demo')
  })

  it('handles a missing extension and an empty path', () => {
    expect(projectNameFromPath('/a/b/some-project')).toBe('some-project')
    expect(projectNameFromPath('')).toBe('Untitled project')
  })
})

describe('validateProjectName', () => {
  it('accepts an ordinary name', () => {
    expect(validateProjectName('Demo Recording')).toBeNull()
  })

  it('rejects an empty or whitespace-only name', () => {
    expect(validateProjectName('')).toBe('Enter a name')
    expect(validateProjectName('   ')).toBe('Enter a name')
    expect(validateProjectName('.')).toBe('Enter a name')
  })

  it('rejects path separators and reserved characters', () => {
    for (const bad of ['a/b', 'a\\b', 'a:b', 'a*b', 'a?b', 'a"b', 'a<b', 'a>b', 'a|b']) {
      expect(validateProjectName(bad)).toBe('A name cannot contain \\ / : * ? " < > |')
    }
  })

  it('rejects a name ending with a dot', () => {
    expect(validateProjectName('recording.')).toBe('A name cannot end with a dot')
  })

  it('trims a trailing space rather than rejecting it', () => {
    expect(validateProjectName('recording ')).toBeNull()
  })

  it('rejects an over-long name', () => {
    expect(validateProjectName('x'.repeat(121))).toBe('That name is too long')
  })

  it('rejects a collision, ignoring case', () => {
    expect(validateProjectName('Demo', ['demo', 'other'])).toBe('A project with that name already exists here')
  })

  it('allows the name it already has when other projects are the only clashes', () => {
    // The caller excludes the current project from `existingNames`, so keeping
    // the same name is a harmless no-op rather than a collision.
    expect(validateProjectName('Demo', ['other'])).toBeNull()
  })
})
