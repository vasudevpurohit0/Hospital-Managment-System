import { classifySeverity } from './severity.util';

describe('classifySeverity (regression: RBAC permission grants under-classified as LOW)', () => {
  it('classifies a permission grant (POST) as HIGH, not LOW', () => {
    expect(
      classifySeverity({ entityType: 'Permission', action: 'permission.post', status: 'SUCCESS' }),
    ).toBe('HIGH');
  });

  it('classifies a permission revoke (DELETE) as CRITICAL now that Permission is a sensitive entity', () => {
    expect(
      classifySeverity({ entityType: 'Permission', action: 'permission.delete', status: 'SUCCESS' }),
    ).toBe('CRITICAL');
  });

  it('still classifies an ordinary, non-sensitive create as LOW', () => {
    expect(
      classifySeverity({ entityType: 'ServiceCategory', action: 'servicecategory.post', status: 'SUCCESS' }),
    ).toBe('LOW');
  });

  it('still classifies a failed login as MEDIUM', () => {
    expect(classifySeverity({ entityType: 'Auth', action: 'auth.login_failed', status: 'FAILURE' })).toBe('MEDIUM');
  });
});
