import { describe, expect, it } from 'vitest'
import { byOrder, groupByFolder } from '../src/lib/folders'

const folders = [
  { id: 'f1', name: 'Clients', createdAt: '' },
  { id: 'f2', name: 'Empty', createdAt: '' },
]
const projects = [
  { id: 'a', name: 'Rolki', createdAt: '', folderId: 'f1' },
  { id: 'b', name: 'Default', createdAt: '' },
  { id: 'c', name: 'Pawel', createdAt: '', folderId: 'f1' },
  { id: 'd', name: 'Orphan', createdAt: '', folderId: 'gone' },
]

describe('groupByFolder', () => {
  it('lists folders first, then projects without (or with a deleted) folder; drops empty folders', () => {
    const g = groupByFolder(projects, folders)
    expect(g.map((x) => [x.folder?.name ?? '-', x.projects.map((p) => p.name)])).toEqual([
      ['Clients', ['Rolki', 'Pawel']],
      ['-', ['Default', 'Orphan']],
    ])
  })

  it('follows the saved order; never-ordered items keep creation order after the ordered ones', () => {
    const ordered = [
      { id: 'a', name: 'A', createdAt: '' },
      { id: 'b', name: 'B', createdAt: '', order: 1 },
      { id: 'c', name: 'C', createdAt: '', order: 0 },
      { id: 'd', name: 'D', createdAt: '' },
    ]
    expect(byOrder(ordered).map((x) => x.name)).toEqual(['C', 'B', 'A', 'D'])
    const fs = [
      { id: 'f1', name: 'First', createdAt: '', order: 1 },
      { id: 'f2', name: 'Second', createdAt: '', order: 0 },
    ]
    const ps = [
      { id: 'x', name: 'X', createdAt: '', folderId: 'f1' },
      { id: 'y', name: 'Y', createdAt: '', folderId: 'f2' },
    ]
    expect(groupByFolder(ps, fs).map((g) => g.folder?.name)).toEqual(['Second', 'First'])
  })

  it('matches project names, and a folder name shows all its projects', () => {
    expect(groupByFolder(projects, folders, 'paw').map((x) => x.projects.map((p) => p.name))).toEqual([['Pawel']])
    expect(groupByFolder(projects, folders, 'client').flatMap((x) => x.projects.map((p) => p.name))).toEqual(['Rolki', 'Pawel'])
    expect(groupByFolder(projects, folders, 'nothing')).toEqual([])
  })
})
