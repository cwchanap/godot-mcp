import { describe, expect, it } from 'vitest';

import { ProjectUtils } from './project-utils.js';

describe('ProjectUtils.validatePath', () => {
  it('accepts safe relative paths', () => {
    expect(ProjectUtils.validatePath('projects/sample')).toBe(true);
  });

  it('rejects traversal attempts', () => {
    expect(ProjectUtils.validatePath('../outside')).toBe(false);
    expect(ProjectUtils.validatePath('nested/../../escape')).toBe(false);
  });
});

describe('ProjectUtils.isGodot44OrLater', () => {
  it('returns true for 4.4 and later versions', () => {
    expect(ProjectUtils.isGodot44OrLater('4.4')).toBe(true);
    expect(ProjectUtils.isGodot44OrLater('4.5.1')).toBe(true);
    expect(ProjectUtils.isGodot44OrLater('5.0')).toBe(true);
  });

  it('returns false for versions before 4.4', () => {
    expect(ProjectUtils.isGodot44OrLater('4.3')).toBe(false);
    expect(ProjectUtils.isGodot44OrLater('3.5')).toBe(false);
    expect(ProjectUtils.isGodot44OrLater('invalid')).toBe(false);
  });
});
