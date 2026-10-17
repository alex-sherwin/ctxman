import { describe, expect, it } from 'vitest';
import { classifyRemoteUri, isArchiveUri, isGitUri } from '../../src/lib/remote-uri.ts';

const GIT = [
  'git@github.com:meow-sci/catcom.git',
  'git@github.com:meow-sci/gatOS.git',
  'git@gitlab.example.com:group/sub/repo',
  'ssh://git@host.test/org/repo.git',
  'ssh://git@host.test:2222/org/repo.git',
  'ssh://host.test/repo.git',
  'https://github.com/org/repo',
  'https://github.com/org/repo.git',
  'https://github.com/org/repo/',
  'https://h.test/x.git',
  'https://gitlab.com/group/sub/repo.git',
];
const ARCHIVE = [
  'https://meow.science.fail/ksa-coffer/downloads/ksa-modding-latest.tar.gz',
  'https://h.test/skill.tgz',
  'https://h.test/a/b/skill.zip',
  'https://h.test/a/SKILL.TAR.GZ',
];
const NEITHER = [
  '',
  ' ',
  'github.com/org/repo',
  'org/repo',
  'git@github.com',
  'git@github.com:',
  'git@github.com:/abs/path.git',
  'http://github.com/org/repo',
  'http://h.test/skill.tar.gz',
  'ftp://h.test/org/repo.git',
  'git://h.test/org/repo.git',
  'file:///tmp/repo',
  'https://github.com',
  'https://github.com/org',
  'https://user:pw@github.com/org/repo',
  'https://github.com/org/repo?x=1',
  'https://github.com/org/repo#frag',
  'https://h.test/skill.tar',
  'https://h.test/skill.rar',
  'https://h.test/skill.zip?token=1',
  'https://h.test/a b/repo',
  'ssh://',
];

describe('isGitUri', () => {
  it.each(GIT)('accepts %s', (uri) => expect(isGitUri(uri)).toBe(true));
  it.each([...ARCHIVE, ...NEITHER])('rejects %s', (uri) => expect(isGitUri(uri)).toBe(false));
});

describe('isArchiveUri', () => {
  it.each(ARCHIVE)('accepts %s', (uri) => expect(isArchiveUri(uri)).toBe(true));
  it.each([...GIT, ...NEITHER])('rejects %s', (uri) => expect(isArchiveUri(uri)).toBe(false));
});

describe('classifyRemoteUri', () => {
  it('classifies git, archive and neither', () => {
    for (const uri of GIT) expect(classifyRemoteUri(uri), uri).toBe('git');
    for (const uri of ARCHIVE) expect(classifyRemoteUri(uri), uri).toBe('archive');
    for (const uri of NEITHER) expect(classifyRemoteUri(uri), uri).toBeNull();
  });
});
