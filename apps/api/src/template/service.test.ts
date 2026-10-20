/**
 * Use-case tests for the `template` module (M2).
 *
 * These pin the three things a reviewer cannot eyeball from the code:
 *
 *   B1  a non-owner is rejected **before** the payload is validated -- otherwise a child could use
 *       validation errors to enumerate which fields the owner would have had to fill in;
 *   B2  a template without a positive `maxPoints` never reaches storage;
 *   B7  pausing removes a template from the default list while keeping the row (history retained),
 *       and resuming brings it back.
 *
 * The repository is the real in-memory one (not a mock) so "was anything written?" is answerable.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { Role } from '@fcp/shared';
import { TemplateError } from './errors.js';
import { createInMemoryTemplateRepository } from './repository.js';
import type { InMemoryTemplateRepository } from './repository.js';
import { createTemplateService } from './service.js';
import type { CreateTemplateRequest, TemplateService } from './service.js';
import type { MembershipReader } from './types.js';

const OWNER = 'user-owner';
const CHILD = 'user-child';
const STRANGER = 'user-stranger';
const FAMILY = 'family-1';
const OTHER_FAMILY = 'family-2';

interface MembershipSeed {
  userId: string;
  familyId: string;
  role: Role;
}

/** A structural stand-in for `FamilyRepository.findMembership` (the only method this module uses). */
function readerFor(entries: MembershipSeed[]): MembershipReader {
  return {
    async findMembership(userId: string, familyId: string) {
      const found = entries.find((e) => e.userId === userId && e.familyId === familyId);
      return found === undefined ? null : { role: found.role };
    },
  };
}

const FIXED_NOW = new Date('2026-10-20T12:00:00.000Z');

function validRequest(overrides: Partial<CreateTemplateRequest> = {}): CreateTemplateRequest {
  return {
    title: '洗碗',
    timeOfDay: '14:00',
    repeatRule: 'daily',
    maxPoints: 3,
    ...overrides,
  };
}

async function catchError(run: () => Promise<unknown>): Promise<TemplateError> {
  try {
    await run();
  } catch (caught) {
    expect(caught).toBeInstanceOf(TemplateError);
    return caught as TemplateError;
  }
  throw new Error('expected the call to reject, but it resolved');
}

describe('createTemplate', () => {
  let repository: InMemoryTemplateRepository;
  let service: TemplateService;

  beforeEach(() => {
    let sequence = 0;
    repository = createInMemoryTemplateRepository({
      newId: () => {
        sequence += 1;
        return `tpl-${sequence}`;
      },
    });
    service = createTemplateService({
      repository,
      memberships: readerFor([
        { userId: OWNER, familyId: FAMILY, role: 'owner' },
        { userId: CHILD, familyId: FAMILY, role: 'child' },
      ]),
      clock: () => FIXED_NOW,
    });
  });

  it('lets the owner create a template and applies the documented defaults', async () => {
    const { template } = await service.createTemplate(OWNER, FAMILY, validRequest());

    expect(template).toEqual({
      id: 'tpl-1',
      familyId: FAMILY,
      title: '洗碗',
      timeOfDay: '14:00',
      repeatRule: 'daily',
      maxPoints: 3,
      // B5 / B6 / B4 defaults, straight from schema.prisma
      assignMode: 'claim',
      claimerScope: 'all',
      mustBeClaimed: true,
      // B3 default
      remindBeforeMin: 30,
      status: 'active',
      createdAt: FIXED_NOW.toISOString(),
    });
    // `description` is omitted, never null, when absent (wire shape convention).
    expect(template).not.toHaveProperty('description');
    expect(repository.snapshot()).toHaveLength(1);
  });

  it('keeps explicitly provided B3/B4/B5/B6 values and normalises the rule', async () => {
    const { template } = await service.createTemplate(
      OWNER,
      FAMILY,
      validRequest({
        description: '  饭后把所有碗洗掉  ',
        repeatRule: ' Weekly: 5,1 ',
        assignMode: 'rotate',
        claimerScope: 'children',
        mustBeClaimed: false,
        remindBeforeMin: 0,
      }),
    );

    expect(template.description).toBe('饭后把所有碗洗掉');
    expect(template.repeatRule).toBe('weekly:1,5');
    expect(template.assignMode).toBe('rotate');
    expect(template.claimerScope).toBe('children');
    expect(template.mustBeClaimed).toBe(false);
    // 0 is legal and means "remind at the deadline".
    expect(template.remindBeforeMin).toBe(0);
  });

  it('stores an empty description as absent, not as an empty string', async () => {
    const { template } = await service.createTemplate(
      OWNER,
      FAMILY,
      validRequest({ description: '   ' }),
    );
    expect(template).not.toHaveProperty('description');
  });

  it('rejects a stranger with not_a_member (403) -- an unknown family looks the same', async () => {
    const error = await catchError(() => service.createTemplate(STRANGER, FAMILY, validRequest()));
    expect(error.code).toBe('not_a_member');
    expect(error.status).toBe(403);
    expect(repository.snapshot()).toHaveLength(0);
  });

  it('rejects a family member who is not the owner with not_owner (403), B1', async () => {
    const error = await catchError(() => service.createTemplate(CHILD, FAMILY, validRequest()));
    expect(error.code).toBe('not_owner');
    expect(error.status).toBe(403);
    // A different code from not_a_member on purpose: the child IS in this family.
    expect(error.message).toContain('创建者');
    expect(repository.snapshot()).toHaveLength(0);
  });

  it('checks ownership BEFORE the payload, so a non-owner learns nothing from validation', async () => {
    // Every field is wrong here. The reply must still be a permission error, not a 400 listing them.
    const error = await catchError(() =>
      service.createTemplate(CHILD, FAMILY, {
        title: '',
        timeOfDay: '99:99',
        repeatRule: 'hourly',
        maxPoints: -1,
      }),
    );
    expect(error.code).toBe('not_owner');
  });

  it('requires a positive maxPoints (B2) and writes nothing when it is missing', async () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const error = await catchError(() =>
        service.createTemplate(OWNER, FAMILY, validRequest({ maxPoints: bad })),
      );
      expect(error.code).toBe('validation_error');
      expect(error.status).toBe(400);
      const issues = error.details as { path: string }[];
      expect(issues.some((issue) => issue.path === 'maxPoints')).toBe(true);
    }

    // Missing entirely (a client that skipped the field) is the same rule, same code.
    const missing = await catchError(() =>
      service.createTemplate(OWNER, FAMILY, {
        title: '洗碗',
        timeOfDay: '14:00',
        repeatRule: 'daily',
      } as CreateTemplateRequest),
    );
    expect(missing.code).toBe('validation_error');
    expect(repository.snapshot()).toHaveLength(0);
  });

  it('rejects a malformed repeatRule with its own code (400)', async () => {
    for (const bad of ['hourly', 'weekly:8', 'monthly:0', 'weekly:']) {
      const error = await catchError(() =>
        service.createTemplate(OWNER, FAMILY, validRequest({ repeatRule: bad })),
      );
      expect(error.code).toBe('invalid_repeat_rule');
      expect(error.status).toBe(400);
    }
    expect(repository.snapshot()).toHaveLength(0);
  });

  it('accepts weekly:7 (Sunday) rather than treating 7 as out of range', async () => {
    const { template } = await service.createTemplate(
      OWNER,
      FAMILY,
      validRequest({ repeatRule: 'weekly:7' }),
    );
    expect(template.repeatRule).toBe('weekly:7');
  });

  it('rejects unusable timeOfDay, title, assignMode and remindBeforeMin together', async () => {
    const error = await catchError(() =>
      service.createTemplate(OWNER, FAMILY, {
        title: '   ',
        timeOfDay: '24:00',
        repeatRule: 'daily',
        maxPoints: 2,
        assignMode: 'lottery' as never,
        claimerScope: 'nobody' as never,
        remindBeforeMin: 9999,
      }),
    );
    const paths = (error.details as { path: string }[]).map((issue) => issue.path).sort();
    expect(error.code).toBe('validation_error');
    expect(paths).toEqual(['assignMode', 'claimerScope', 'remindBeforeMin', 'timeOfDay', 'title']);
  });
});

describe('listTemplates', () => {
  let repository: InMemoryTemplateRepository;
  let service: TemplateService;

  beforeEach(async () => {
    repository = createInMemoryTemplateRepository();
    service = createTemplateService({
      repository,
      memberships: readerFor([
        { userId: OWNER, familyId: FAMILY, role: 'owner' },
        { userId: CHILD, familyId: FAMILY, role: 'child' },
      ]),
      clock: () => FIXED_NOW,
    });
    await service.createTemplate(OWNER, FAMILY, validRequest({ title: '洗碗' }));
    await service.createTemplate(OWNER, FAMILY, validRequest({ title: '扫地' }));
  });

  it('returns only active templates by default', async () => {
    const { templates } = await service.listTemplates(CHILD, FAMILY);
    expect(templates.map((t) => t.title)).toEqual(['洗碗', '扫地']);
    expect(templates.every((t) => t.status === 'active')).toBe(true);
  });

  it('lets an ordinary member read the schedule (reading is not owner-only)', async () => {
    const { templates } = await service.listTemplates(CHILD, FAMILY, 'all');
    expect(templates).toHaveLength(2);
  });

  it('rejects a non-member with not_a_member', async () => {
    const error = await catchError(() => service.listTemplates(STRANGER, FAMILY));
    expect(error.code).toBe('not_a_member');
    expect(error.status).toBe(403);
  });

  it('answers not_a_member (403) for a family the caller is not in -- never an empty list', async () => {
    // An empty list would confirm "this family id exists but has no templates", which is a probe.
    const error = await catchError(() => service.listTemplates(OWNER, OTHER_FAMILY));
    expect(error.code).toBe('not_a_member');
    expect(error.status).toBe(403);
  });
});

describe('setTemplateStatus (B7: pause / resume, history retained)', () => {
  let repository: InMemoryTemplateRepository;
  let service: TemplateService;
  let templateId: string;

  beforeEach(async () => {
    repository = createInMemoryTemplateRepository({ newId: () => 'tpl-1' });
    service = createTemplateService({
      repository,
      memberships: readerFor([
        { userId: OWNER, familyId: FAMILY, role: 'owner' },
        { userId: CHILD, familyId: FAMILY, role: 'child' },
      ]),
      clock: () => FIXED_NOW,
    });
    const created = await service.createTemplate(OWNER, FAMILY, validRequest());
    templateId = created.template.id;
  });

  it('pauses: the row survives but leaves the active list', async () => {
    const { template } = await service.setTemplateStatus(OWNER, FAMILY, templateId, 'paused');
    expect(template.status).toBe('paused');

    // History retained: still in storage, still returned by `status=all` / `status=paused`.
    expect(repository.snapshot()).toHaveLength(1);
    expect((await service.listTemplates(OWNER, FAMILY)).templates).toHaveLength(0);
    expect((await service.listTemplates(OWNER, FAMILY, 'all')).templates).toHaveLength(1);
    expect((await service.listTemplates(OWNER, FAMILY, 'paused')).templates.map((t) => t.id)).toEqual([
      templateId,
    ]);
  });

  it('resumes: back in the active list', async () => {
    await service.setTemplateStatus(OWNER, FAMILY, templateId, 'paused');
    const { template } = await service.setTemplateStatus(OWNER, FAMILY, templateId, 'active');
    expect(template.status).toBe('active');
    expect((await service.listTemplates(OWNER, FAMILY)).templates).toHaveLength(1);
  });

  it('is idempotent: pausing twice is not an error', async () => {
    await service.setTemplateStatus(OWNER, FAMILY, templateId, 'paused');
    const { template } = await service.setTemplateStatus(OWNER, FAMILY, templateId, 'paused');
    expect(template.status).toBe('paused');
  });

  it('rejects archived (reserved by the schema) with invalid_status_transition', async () => {
    const error = await catchError(() =>
      service.setTemplateStatus(OWNER, FAMILY, templateId, 'archived'),
    );
    expect(error.code).toBe('invalid_status_transition');
    expect(error.status).toBe(400);
    expect(repository.snapshot()[0]?.status).toBe('active');
  });

  it('rejects a non-owner with not_owner and changes nothing', async () => {
    const error = await catchError(() =>
      service.setTemplateStatus(CHILD, FAMILY, templateId, 'paused'),
    );
    expect(error.code).toBe('not_owner');
    expect(repository.snapshot()[0]?.status).toBe('active');
  });

  it('answers template_not_found for an unknown id, and for a valid id of another family', async () => {
    const unknown = await catchError(() =>
      service.setTemplateStatus(OWNER, FAMILY, 'tpl-does-not-exist', 'paused'),
    );
    expect(unknown.code).toBe('template_not_found');
    expect(unknown.status).toBe(404);

    // The same id under a family the caller owns nothing in: still 404, never a successful write.
    const otherFamily = createTemplateService({
      repository,
      memberships: readerFor([{ userId: OWNER, familyId: OTHER_FAMILY, role: 'owner' }]),
    });
    const crossFamily = await catchError(() =>
      otherFamily.setTemplateStatus(OWNER, OTHER_FAMILY, templateId, 'paused'),
    );
    expect(crossFamily.code).toBe('template_not_found');
    expect(repository.snapshot()[0]?.status).toBe('active');
  });
});
